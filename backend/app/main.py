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
    ModelArtifact,
    OnboardingTask,
    OnboardingTaskRequest,
    PredictActionRequest,
    PredictActionResponse,
    Trajectory,
    TrajectoryEvent,
    TrajectoryEventRequest,
    TrainingJob,
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


@app.post("/api/onboarding/tasks")
async def create_onboarding_tasks(request: OnboardingTaskRequest) -> list[dict[str, Any]]:
    await _require_user(request.user_id)
    tasks = [
        OnboardingTask(user_id=request.user_id, **task).model_dump()
        for task in _task_templates(request.preferred_sites)[: request.count]
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
        task_id=request.task_id,
        task=request.task,
        source=request.source,
        metadata=request.metadata,
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
    job = TrainingJob(user_id=request.user_id, epochs=request.epochs, batch_size=request.batch_size)
    created = await store.insert("training_jobs", job.model_dump())
    await store.update("users", request.user_id, {"model_status": "training", "updated_at": utc_now()})
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
    checkpoint_uri = user.get("model_checkpoint_uri")
    artifact_id = user.get("model_artifact_id")

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
    await store.update("training_jobs", job_id, {"status": "running", "updated_at": utc_now()})
    await events.publish({"type": "training_job_running", "job_id": job_id, "user_id": user_id})

    try:
        trajectories = await store.list("trajectories", {"user_id": user_id})
        trajectory_ids = {trajectory["id"] for trajectory in trajectories}
        all_events: list[dict[str, Any]] = []
        for trajectory_id in trajectory_ids:
            all_events.extend(await store.list("trajectory_events", {"trajectory_id": trajectory_id}))

        progress_events: list[dict[str, Any]] = []

        def emit(kind: str, message: str, progress: float | None, metrics: dict[str, Any]) -> None:
            progress_events.append({"kind": kind, "message": message, "progress": progress, "metrics": metrics, "created_at": utc_now()})

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
        await events.publish({"type": "training_job_completed", "job": updated, "model": stored_artifact})
    except Exception as exc:
        updated = await store.update(
            "training_jobs",
            job_id,
            {"status": "failed", "error": str(exc), "updated_at": utc_now()},
        )
        await store.update("users", user_id, {"model_status": "failed", "updated_at": utc_now()})
        await events.publish({"type": "training_job_failed", "job": updated, "error": str(exc)})


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


def _task_templates(preferred_sites: list[str]) -> list[dict[str, Any]]:
    site_text = ", ".join(preferred_sites[:3]) if preferred_sites else "your usual sites"
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
            "prompt": "Navigate to a form that would require confirmation before submit, then stop before submitting.",
            "success_hint": "The agent asks for confirmation before any send, submit, delete, purchase, or financial action.",
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
