from __future__ import annotations

import asyncio
import json
from contextlib import asynccontextmanager
from typing import Any, AsyncIterator

from fastapi import BackgroundTasks, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

from app.core.config import settings
from app.models import (
    BrowserAction,
    BrowserObservation,
    BulkRecordingRequest,
    CreateTrainingJobRequest,
    CreateTrajectoryRequest,
    CreateUserRequest,
    LoginRequest,
    ModelArtifact,
    OnboardingTask,
    OnboardingTaskRequest,
    PredictActionRequest,
    PredictActionResponse,
    SkillChatMessage,
    SkillChatSession,
    SkillChatTurnRequest,
    CreateSkillSessionRequest,
    Trajectory,
    TrajectoryEvent,
    TrajectoryEventRequest,
    TrainingJob,
    UserSkill,
    UserProfile,
    utc_now,
)
from app.storage import MemoryStore, MongoStore, create_store
from app.training.browser_policy import predict_action_from_checkpoint, train_user_policy


class EventBus:
    def __init__(self) -> None:
        self.subscribers: set[asyncio.Queue[dict[str, Any]]] = set()

    async def publish(self, event: dict[str, Any]) -> None:
        for queue in list(self.subscribers):
            await queue.put(event)

    async def stream(self, request: Request) -> AsyncIterator[str]:
        queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue()
        self.subscribers.add(queue)
        try:
            while not await request.is_disconnected():
                try:
                    event = await asyncio.wait_for(queue.get(), timeout=15)
                    yield f"data: {json.dumps(event)}\n\n"
                except asyncio.TimeoutError:
                    yield ": heartbeat\n\n"
        finally:
            self.subscribers.discard(queue)


store: MemoryStore | MongoStore
events = EventBus()


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    global store
    store = await create_store()
    yield
    await store.close()


app = FastAPI(title="Personal Browser-Use Agent", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/api/auth/login")
async def login(request: LoginRequest) -> dict[str, Any]:
    existing_users = await store.list("users")
    normalized = request.display_name.strip().lower()
    for user in existing_users:
        if user.get("display_name", "").strip().lower() == normalized:
            return user

    user = UserProfile(
        display_name=request.display_name.strip() or "Browser User",
        email_hint=request.email_hint,
        preferences={"created_from": "login"},
    )
    created = await store.insert("users", user.model_dump())
    await events.publish({"type": "user_logged_in", "user": created})
    return created


@app.post("/api/users")
async def create_user(request: CreateUserRequest) -> dict[str, Any]:
    user = UserProfile(**request.model_dump())
    created = await store.insert("users", user.model_dump())
    await events.publish({"type": "user_created", "user": created})
    return created


@app.get("/api/users")
async def list_users() -> list[dict[str, Any]]:
    return await store.list("users")


@app.get("/api/users/{user_id}")
async def get_user(user_id: str) -> dict[str, Any]:
    user = await store.get("users", user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return user


@app.post("/api/skills/sessions")
async def create_skill_session(request: CreateSkillSessionRequest) -> dict[str, Any]:
    await _require_user(request.user_id)
    session = SkillChatSession(
        user_id=request.user_id,
        messages=[
            SkillChatMessage(
                role="agent",
                content="What browser workflow should this new skill learn? Tell me the outcome, the websites involved, and what should count as done.",
            )
        ],
    )
    created = await store.insert("skill_sessions", session.model_dump())
    await events.publish({"type": "skill_session_created", "session": created})
    return created


@app.get("/api/skills/sessions/{session_id}")
async def get_skill_session(session_id: str) -> dict[str, Any]:
    session = await store.get("skill_sessions", session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Skill chat session not found")
    return session


@app.post("/api/skills/sessions/{session_id}/messages")
async def add_skill_session_message(session_id: str, request: SkillChatTurnRequest) -> dict[str, Any]:
    session = await store.get("skill_sessions", session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Skill chat session not found")

    messages = [SkillChatMessage(**message) for message in session.get("messages", [])]
    messages.append(SkillChatMessage(role="user", content=request.content))
    user_turns = [message.content for message in messages if message.role == "user"]
    inferred = _infer_skill_from_chat(user_turns)

    if len(user_turns) == 1:
        reply = "Which sites, accounts, or pages should I watch for, and are there any steps that should always ask for confirmation?"
        status = "chatting"
    elif len(user_turns) == 2:
        reply = "What are two or three examples of success and one example of a mistake this skill should avoid?"
        status = "chatting"
    else:
        reply = f"I have enough to build a data-collection plan for {inferred['name']}. Press Next when you are ready to collect demonstrations."
        status = "ready_for_tasks"

    messages.append(SkillChatMessage(role="agent", content=reply))
    updated = await store.update(
        "skill_sessions",
        session_id,
        {
            "messages": [message.model_dump() for message in messages],
            "status": status,
            "inferred_goal": inferred["goal"],
            "inferred_sites": inferred["sites"],
            "updated_at": utc_now(),
        },
    )
    await events.publish({"type": "skill_session_message", "session": updated})
    return updated or {}


@app.post("/api/skills/sessions/{session_id}/finalize")
async def finalize_skill_session(session_id: str) -> dict[str, Any]:
    session = await store.get("skill_sessions", session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Skill chat session not found")
    if session.get("status") == "completed":
        existing = await store.list("user_skills", {"session_id": session_id})
        skill = existing[0] if existing else None
        tasks = await store.list("onboarding_tasks", {"skill_id": skill["id"]}) if skill else []
        return {"session": session, "skill": skill, "tasks": tasks}

    user_turns = [message.get("content", "") for message in session.get("messages", []) if message.get("role") == "user"]
    inferred = _infer_skill_from_chat(user_turns)
    skill = UserSkill(
        user_id=session["user_id"],
        session_id=session_id,
        name=inferred["name"],
        goal=inferred["goal"],
        description=inferred["description"],
        preferred_sites=inferred["sites"],
        status="collecting",
    )
    stored_skill = await store.insert("user_skills", skill.model_dump())
    task_templates = _skill_task_templates(inferred["goal"], inferred["sites"])
    stored_tasks: list[dict[str, Any]] = []
    for index, task in enumerate(task_templates, start=1):
        stored_tasks.append(
            await store.insert(
                "onboarding_tasks",
                OnboardingTask(
                    user_id=session["user_id"],
                    skill_id=stored_skill["id"],
                    order=index,
                    **task,
                ).model_dump(),
            )
        )
    stored_skill = await store.update(
        "user_skills",
        stored_skill["id"],
        {"task_count": len(stored_tasks), "updated_at": utc_now()},
    ) or stored_skill
    updated_session = await store.update("skill_sessions", session_id, {"status": "completed", "updated_at": utc_now()})
    await events.publish({"type": "skill_finalized", "skill": stored_skill, "tasks": stored_tasks})
    return {"session": updated_session, "skill": stored_skill, "tasks": stored_tasks}


@app.get("/api/users/{user_id}/skills")
async def list_user_skills(user_id: str) -> list[dict[str, Any]]:
    await _require_user(user_id)
    return await store.list("user_skills", {"user_id": user_id})


@app.get("/api/skills/{skill_id}")
async def get_skill(skill_id: str) -> dict[str, Any]:
    return await _require_skill(skill_id)


@app.get("/api/skills/{skill_id}/tasks")
async def list_skill_tasks(skill_id: str) -> list[dict[str, Any]]:
    await _require_skill(skill_id)
    tasks = await store.list("onboarding_tasks", {"skill_id": skill_id})
    return sorted(tasks, key=lambda task: int(task.get("order", 0)))


@app.post("/api/onboarding/tasks")
async def create_onboarding_tasks(request: OnboardingTaskRequest) -> list[dict[str, Any]]:
    await _require_user(request.user_id)
    tasks = [
        OnboardingTask(user_id=request.user_id, skill_id=request.skill_id, order=index + 1, **task).model_dump()
        for index, task in enumerate(_task_templates(request.preferred_sites, request.goal)[: request.count])
    ]
    for task in tasks:
        await store.insert("onboarding_tasks", task)
    await events.publish({"type": "onboarding_tasks_created", "user_id": request.user_id, "tasks": tasks})
    return tasks


@app.get("/api/users/{user_id}/tasks")
async def list_user_tasks(user_id: str) -> list[dict[str, Any]]:
    await _require_user(user_id)
    return await store.list("onboarding_tasks", {"user_id": user_id})


@app.post("/api/trajectories")
async def create_trajectory(request: CreateTrajectoryRequest) -> dict[str, Any]:
    await _require_user(request.user_id)
    trajectory = Trajectory(
        user_id=request.user_id,
        skill_id=request.skill_id,
        task_id=request.task_id,
        task=request.task,
        source=request.source,
        metadata={**request.metadata, **({"skill_id": request.skill_id} if request.skill_id else {})},
    )
    created = await store.insert("trajectories", trajectory.model_dump())
    if request.initial_observation:
        await _append_event(
            created,
            TrajectoryEventRequest(
                actor="system",
                event_type="observation",
                observation=request.initial_observation,
                metadata={"reason": "initial_observation"},
            ),
        )
    await events.publish({"type": "trajectory_created", "trajectory": created})
    return await _hydrate_trajectory(created["id"])


@app.get("/api/users/{user_id}/trajectories")
async def list_user_trajectories(user_id: str) -> list[dict[str, Any]]:
    await _require_user(user_id)
    return await store.list("trajectories", {"user_id": user_id})


@app.get("/api/trajectories/{trajectory_id}")
async def get_trajectory(trajectory_id: str) -> dict[str, Any]:
    return await _hydrate_trajectory(trajectory_id)


@app.post("/api/trajectories/{trajectory_id}/events")
async def create_trajectory_event(trajectory_id: str, request: TrajectoryEventRequest) -> dict[str, Any]:
    trajectory = await _require_trajectory(trajectory_id)
    event = await _append_event(trajectory, request)
    await events.publish({"type": "trajectory_event", "event": event})
    return event


@app.post("/api/trajectories/{trajectory_id}/ask-user")
async def record_agent_question(trajectory_id: str, request: TrajectoryEventRequest) -> dict[str, Any]:
    if request.event_type != "ask_user":
        raise HTTPException(status_code=400, detail="event_type must be ask_user")
    if not request.question:
        raise HTTPException(status_code=400, detail="question is required")
    trajectory = await _require_trajectory(trajectory_id)
    event = await _append_event(trajectory, request)
    await events.publish({"type": "agent_question_recorded", "event": event})
    return event


@app.post("/api/recordings/bulk")
async def create_bulk_recording(request: BulkRecordingRequest) -> dict[str, Any]:
    trajectory = await create_trajectory(
        CreateTrajectoryRequest(
            user_id=request.user_id,
            task=request.task,
            source=request.source,
            task_id=request.task_id,
            skill_id=request.skill_id,
            initial_observation=request.initial_observation,
            metadata=request.metadata,
        )
    )
    for event_request in request.events:
        current = await _require_trajectory(trajectory["id"])
        await _append_event(current, event_request)
    hydrated = await _hydrate_trajectory(trajectory["id"])
    await events.publish({"type": "bulk_recording_created", "trajectory": hydrated})
    return hydrated


@app.post("/api/training/jobs")
async def create_training_job(request: CreateTrainingJobRequest, background_tasks: BackgroundTasks) -> dict[str, Any]:
    await _require_user(request.user_id)
    if request.skill_id:
        await _require_skill(request.skill_id)
    job = TrainingJob(user_id=request.user_id, skill_id=request.skill_id, epochs=request.epochs, batch_size=request.batch_size)
    created = await store.insert("training_jobs", job.model_dump())
    await store.update("users", request.user_id, {"model_status": "training", "updated_at": utc_now()})
    if request.skill_id:
        await store.update(
            "user_skills",
            request.skill_id,
            {"status": "training", "training_job_id": created["id"], "updated_at": utc_now()},
        )
    background_tasks.add_task(_run_training_job, created["id"])
    await events.publish({"type": "training_job_created", "job": created})
    return created


@app.get("/api/training/jobs/{job_id}")
async def get_training_job(job_id: str) -> dict[str, Any]:
    job = await store.get("training_jobs", job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Training job not found")
    return job


@app.get("/api/users/{user_id}/models")
async def list_user_models(user_id: str) -> list[dict[str, Any]]:
    await _require_user(user_id)
    return await store.list("model_artifacts", {"user_id": user_id})


@app.post("/api/agent/predict")
async def predict_action(request: PredictActionRequest) -> PredictActionResponse:
    user = await _require_user(request.user_id)
    skill = await _require_skill(request.skill_id) if request.skill_id else None
    checkpoint_uri = (skill or {}).get("model_checkpoint_uri") or user.get("model_checkpoint_uri")
    artifact_id = (skill or {}).get("model_artifact_id") or user.get("model_artifact_id")

    if checkpoint_uri:
        try:
            prediction = predict_action_from_checkpoint(
                checkpoint_uri,
                request.task,
                request.observation.model_dump(),
                [action.model_dump() for action in request.previous_actions],
            )
            action = BrowserAction(**prediction["action"])
            action.requires_confirmation = action.requires_confirmation or _requires_confirmation(action, request.observation)
            return PredictActionResponse(
                user_id=request.user_id,
                model_artifact_id=artifact_id,
                model_checkpoint_uri=checkpoint_uri,
                action=action,
                confidence=prediction["confidence"],
                rationale=f"Predicted with personalized checkpoint; nearest event {prediction.get('nearest_event_id')}.",
            )
        except Exception as exc:
            fallback = _fallback_action(request.task, request.observation)
            fallback.requires_confirmation = _requires_confirmation(fallback, request.observation)
            return PredictActionResponse(
                user_id=request.user_id,
                model_artifact_id=artifact_id,
                model_checkpoint_uri=checkpoint_uri,
                action=fallback,
                confidence=0.2,
                rationale=f"Personalized model could not run, so the backend used a safe heuristic: {exc}",
                used_fallback=True,
            )

    fallback = _fallback_action(request.task, request.observation)
    fallback.requires_confirmation = _requires_confirmation(fallback, request.observation)
    return PredictActionResponse(
        user_id=request.user_id,
        action=fallback,
        confidence=0.25,
        rationale="No trained user checkpoint exists yet; used conservative heuristic.",
        used_fallback=True,
    )


@app.get("/api/events")
async def event_stream(request: Request) -> StreamingResponse:
    return StreamingResponse(events.stream(request), media_type="text/event-stream")


async def _run_training_job(job_id: str) -> None:
    job = await store.get("training_jobs", job_id)
    if not job:
        return
    user_id = job["user_id"]
    skill_id = job.get("skill_id")
    await store.update("training_jobs", job_id, {"status": "running", "progress": 0.05, "updated_at": utc_now()})
    await events.publish({"type": "training_job_running", "job_id": job_id, "user_id": user_id})

    try:
        trajectories = await store.list("trajectories", {"user_id": user_id})
        if skill_id:
            trajectories = [trajectory for trajectory in trajectories if trajectory.get("skill_id") == skill_id]
        trajectory_ids = {trajectory["id"] for trajectory in trajectories}
        all_events: list[dict[str, Any]] = []
        for trajectory_id in trajectory_ids:
            all_events.extend(await store.list("trajectory_events", {"trajectory_id": trajectory_id}))

        progress_events: list[dict[str, Any]] = []
        loop = asyncio.get_running_loop()

        def emit(kind: str, message: str, progress: float | None, metrics: dict[str, Any]) -> None:
            event = {"kind": kind, "message": message, "progress": progress, "metrics": metrics, "created_at": utc_now()}
            progress_events.append(event)
            if progress is not None:
                asyncio.run_coroutine_threadsafe(_record_training_progress(job_id, event, progress), loop)

        result = await asyncio.to_thread(
            train_user_policy,
            user_id,
            trajectories,
            all_events,
            settings.model_output_dir,
            job_id,
            int(job.get("epochs", 40)),
            int(job.get("batch_size", 16)),
            emit,
        )
        artifact = ModelArtifact(
            user_id=user_id,
            skill_id=skill_id,
            training_job_id=job_id,
            uri=result["artifact_uri"],
            label_set=result["label_set"],
            example_count=result["example_count"],
            metrics=result["metrics"],
        )
        stored_artifact = await store.insert("model_artifacts", artifact.model_dump())
        updated = await store.update(
            "training_jobs",
            job_id,
            {
                "status": "completed",
                "progress": 1.0,
                "example_count": result["example_count"],
                "artifact_uri": result["artifact_uri"],
                "metrics": {**result["metrics"], "progress_events": progress_events},
                "updated_at": utc_now(),
            },
        )
        await store.update(
            "users",
            user_id,
            {
                "model_status": "ready",
                "model_checkpoint_uri": result["artifact_uri"],
                "model_artifact_id": stored_artifact["id"],
                "updated_at": utc_now(),
            },
        )
        if skill_id:
            trajectory_count = len(trajectories)
            await store.update(
                "user_skills",
                skill_id,
                {
                    "status": "ready",
                    "trajectory_count": trajectory_count,
                    "model_checkpoint_uri": result["artifact_uri"],
                    "model_artifact_id": stored_artifact["id"],
                    "updated_at": utc_now(),
                },
            )
        await events.publish({"type": "training_job_completed", "job": updated, "model": stored_artifact})
    except Exception as exc:
        updated = await store.update(
            "training_jobs",
            job_id,
            {"status": "failed", "progress": 1.0, "error": str(exc), "updated_at": utc_now()},
        )
        await store.update("users", user_id, {"model_status": "failed", "updated_at": utc_now()})
        if skill_id:
            await store.update("user_skills", skill_id, {"status": "failed", "updated_at": utc_now()})
        await events.publish({"type": "training_job_failed", "job": updated, "error": str(exc)})


async def _record_training_progress(job_id: str, event: dict[str, Any], progress: float) -> None:
    job = await store.get("training_jobs", job_id)
    if not job or job.get("status") == "completed":
        return
    metrics = dict(job.get("metrics", {}))
    recent = list(metrics.get("progress_events", []))[-12:]
    recent.append(event)
    metrics["progress_events"] = recent
    metrics.update(event.get("metrics", {}))
    await store.update(
        "training_jobs",
        job_id,
        {"progress": progress, "metrics": metrics, "updated_at": utc_now()},
    )


async def _append_event(trajectory: dict[str, Any], request: TrajectoryEventRequest) -> dict[str, Any]:
    action = request.action
    if request.event_type == "ask_user" and action is None:
        action = BrowserAction(type="ask_user", question=request.question)
    event = TrajectoryEvent(
        trajectory_id=trajectory["id"],
        user_id=trajectory["user_id"],
        task_id=trajectory.get("task_id"),
        actor=request.actor,
        event_type=request.event_type,
        observation=request.observation,
        action=action,
        question=request.question,
        answer=request.answer,
        success=request.success,
        redaction_map=request.redaction_map,
        metadata=request.metadata,
    )
    created = await store.insert("trajectory_events", event.model_dump())
    updates: dict[str, Any] = {"event_count": int(trajectory.get("event_count", 0)) + 1, "updated_at": utc_now()}
    if request.event_type == "success_state":
        updates["status"] = "completed"
        updates["success"] = bool(request.success)
    await store.update("trajectories", trajectory["id"], updates)
    return created


async def _hydrate_trajectory(trajectory_id: str) -> dict[str, Any]:
    trajectory = await _require_trajectory(trajectory_id)
    trajectory["events"] = list(reversed(await store.list("trajectory_events", {"trajectory_id": trajectory_id})))
    return trajectory


async def _require_user(user_id: str) -> dict[str, Any]:
    user = await store.get("users", user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return user


async def _require_trajectory(trajectory_id: str) -> dict[str, Any]:
    trajectory = await store.get("trajectories", trajectory_id)
    if not trajectory:
        raise HTTPException(status_code=404, detail="Trajectory not found")
    return trajectory


async def _require_skill(skill_id: str | None) -> dict[str, Any]:
    if not skill_id:
        raise HTTPException(status_code=400, detail="skill_id is required")
    skill = await store.get("user_skills", skill_id)
    if not skill:
        raise HTTPException(status_code=404, detail="Skill not found")
    return skill


def _infer_skill_from_chat(user_turns: list[str]) -> dict[str, Any]:
    text = " ".join(user_turns).strip()
    lowered = text.lower()
    sites = _extract_sites(text)
    if "receipt" in lowered or "invoice" in lowered:
        name = "Receipt Finder"
    elif "calendar" in lowered or "meeting" in lowered:
        name = "Calendar Assistant"
    elif "email" in lowered or "gmail" in lowered or "outlook" in lowered:
        name = "Email Workflow"
    elif "document" in lowered or "drive" in lowered or "notion" in lowered:
        name = "Document Search"
    else:
        name = "Browser Workflow"
    goal = text or "Learn a repeated browser workflow from user demonstrations."
    description = f"Learns how this user completes: {goal[:180]}"
    return {"name": name, "goal": goal, "description": description, "sites": sites}


def _extract_sites(text: str) -> list[str]:
    known_sites = [
        "Gmail",
        "Outlook",
        "Google Calendar",
        "Google Drive",
        "Notion",
        "Slack",
        "Linear",
        "GitHub",
        "Amazon",
        "Stripe",
    ]
    lowered = text.lower()
    sites = [site for site in known_sites if site.lower() in lowered]
    return sites or ["the user's usual browser workspace"]


def _task_templates(preferred_sites: list[str], goal: str | None = None) -> list[dict[str, Any]]:
    site_text = ", ".join(preferred_sites[:3]) if preferred_sites else "your usual sites"
    goal_text = goal or "your repeated workflow"
    return [
        {
            "title": "Open primary email",
            "prompt": f"Open your primary email using {site_text}, then stop on the inbox.",
            "success_hint": "Inbox is visible and no message is sent.",
            "risk_level": "medium",
            "tags": ["email", "navigation"],
        },
        {
            "title": "Find a recent receipt",
            "prompt": "Search your email for a recent receipt and open the most relevant result.",
            "success_hint": "A receipt email is open; no attachments are downloaded without confirmation.",
            "risk_level": "medium",
            "tags": ["email", "search"],
        },
        {
            "title": "Navigate to calendar",
            "prompt": "Open your calendar and find this week.",
            "success_hint": "The weekly calendar view is visible.",
            "risk_level": "low",
            "tags": ["calendar", "navigation"],
        },
        {
            "title": "Search for a document",
            "prompt": "Open your document workspace and search for a project document.",
            "success_hint": "A relevant document search result is visible.",
            "risk_level": "low",
            "tags": ["documents", "search"],
        },
        {
            "title": "Resolve account ambiguity",
            "prompt": "Show which account or workspace you normally choose when a picker appears.",
            "success_hint": "The preferred account or workspace is selected.",
            "risk_level": "medium",
            "tags": ["preference", "ask_user"],
        },
        {
            "title": "Sensitive action confirmation",
            "prompt": f"Navigate near a submit/send/delete step related to {goal_text}, then stop before the final action.",
            "success_hint": "The agent asks for confirmation before any send, submit, delete, purchase, or financial action.",
            "risk_level": "high",
            "tags": ["safety", "confirmation"],
        },
    ]


def _skill_task_templates(goal: str, sites: list[str]) -> list[dict[str, Any]]:
    site_text = ", ".join(sites[:3]) if sites else "the sites involved"
    return [
        {
            "title": "Start from a blank browser",
            "prompt": f"Open {site_text} and navigate to the place where you normally begin this workflow: {goal}.",
            "success_hint": "The starting page, account, and workspace are visible.",
            "risk_level": "low",
            "tags": ["navigation", "start-state"],
        },
        {
            "title": "Find the right object",
            "prompt": "Search, filter, or browse until you find the email, event, document, record, or page this workflow usually needs.",
            "success_hint": "The correct object or result is visible and selected.",
            "risk_level": "low",
            "tags": ["search", "selection"],
        },
        {
            "title": "Resolve an ambiguity",
            "prompt": "When there is an account, folder, workspace, date range, or result choice, pick what you usually pick.",
            "success_hint": "The preferred user-specific choice is selected.",
            "risk_level": "medium",
            "tags": ["preference", "ambiguity"],
        },
        {
            "title": "Complete the normal path",
            "prompt": "Run the workflow until the useful final state is visible, without taking any sensitive final action.",
            "success_hint": "The final useful state is visible and no external side effect has been triggered.",
            "risk_level": "medium",
            "tags": ["happy-path", "completion"],
        },
        {
            "title": "Recover from a wrong turn",
            "prompt": "Intentionally go one step into a less useful result or page, then demonstrate how you recover.",
            "success_hint": "The browser returns to the correct path.",
            "risk_level": "low",
            "tags": ["recovery", "correction"],
        },
        {
            "title": "Show the confirmation boundary",
            "prompt": "Navigate to any send, submit, purchase, delete, or financial step this skill might encounter, then stop before confirming.",
            "success_hint": "The agent can learn where it must ask before acting.",
            "risk_level": "high",
            "tags": ["safety", "confirmation"],
        },
    ]


def _fallback_action(task: str, observation: BrowserObservation) -> BrowserAction:
    lowered = task.lower()
    if not observation.url and "email" in lowered:
        return BrowserAction(type="open_url", url="https://mail.google.com", confidence=0.25)
    search_node = _find_node(observation, ["search", "query"])
    if search_node and any(token in lowered for token in ["search", "find", "receipt", "document"]):
        return BrowserAction(type="click", selector=search_node.selector, confidence=0.3)
    if "which" in lowered or "choose" in lowered or "account" in lowered:
        return BrowserAction(type="ask_user", question="Which account or workspace should I use here?", confidence=0.35)
    button_node = _find_node(observation, ["continue", "next", "open"])
    if button_node:
        return BrowserAction(type="click", selector=button_node.selector, confidence=0.25)
    return BrowserAction(type="ask_user", question="Can you show me the next step you want in this browser state?", confidence=0.2)


def _find_node(observation: BrowserObservation, keywords: list[str]) -> Any | None:
    for node in observation.dom_nodes:
        haystack = " ".join([node.selector, node.role or "", node.name or "", node.text or "", node.tag or ""]).lower()
        if any(keyword in haystack for keyword in keywords):
            return node
    return None


def _requires_confirmation(action: BrowserAction, observation: BrowserObservation) -> bool:
    if action.type in {"ask_user", "wait", "stop", "scroll"}:
        return False
    sensitive_words = ["send", "submit", "delete", "purchase", "buy", "checkout", "bank", "card", "password", "ssn"]
    haystack = " ".join(
        str(value or "")
        for value in [action.selector, action.text, action.url, action.query, action.question, observation.url, observation.title]
    ).lower()
    if any(word in haystack for word in sensitive_words):
        return True
    if action.selector:
        for node in observation.dom_nodes:
            if node.selector == action.selector and node.is_sensitive:
                return True
            node_text = " ".join([node.name or "", node.text or "", node.role or ""]).lower()
            if node.selector == action.selector and any(word in node_text for word in sensitive_words):
                return True
    return False
