from __future__ import annotations

import asyncio
import json
from contextlib import asynccontextmanager
from typing import Any, AsyncIterator

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

from app.agents.harness import AgentHarness
from app.agents.nia import NiaSearchClient
from app.core.config import settings
from app.models import (
    CompleteJobRequest,
    CreateJobRequest,
    DatasetSearchRequest,
    JobAssignment,
    JobEventIn,
    TrainingReport,
    TrainingReportRequest,
    WorkerHeartbeat,
    WorkerRegistration,
    new_id,
    utc_now,
)
from app.scheduler.heuristic import HeuristicScheduler
from app.storage import MemoryStore, MongoStore, create_store


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
agent = AgentHarness()
nia = NiaSearchClient()
scheduler = HeuristicScheduler()


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    global store
    store = await create_store()
    yield
    await store.close()


app = FastAPI(title="Distributed Fine-Tuning Marketplace", lifespan=lifespan)
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


@app.post("/api/agent/training-report")
async def create_training_report(request: TrainingReportRequest) -> TrainingReport:
    report = await agent.build_training_report(request.messages, request.provider)
    if request.search_datasets:
        report.dataset_candidates = await nia.search(report.dataset_query, limit=5)
    await store.insert("reports", report.model_dump())
    await events.publish({"type": "report_created", "report": report.model_dump()})
    return report


@app.get("/api/reports")
async def list_reports() -> list[dict[str, Any]]:
    return await store.list("reports")


@app.post("/api/datasets/search")
async def search_datasets(request: DatasetSearchRequest) -> list[dict[str, Any]]:
    return [result.model_dump() for result in await nia.search(request.query, request.limit)]


@app.post("/api/jobs")
async def create_job(request: CreateJobRequest) -> dict[str, Any]:
    report: TrainingReport | None = request.report
    if report is None and request.report_id:
        stored_report = await store.get("reports", request.report_id)
        if stored_report:
            report = TrainingReport(**stored_report)
    if report is None:
        raise HTTPException(status_code=400, detail="Provide report or report_id")

    job = {
        "id": new_id("job"),
        "training_report_id": report.id,
        "training_report": report.model_dump(),
        "priority": request.priority,
        "status": "queued",
        "assigned_worker_id": None,
        "adapter_uri": None,
        "metrics": {},
        "created_at": utc_now(),
        "updated_at": utc_now(),
    }
    await store.insert("jobs", job)
    await append_job_event(job["id"], "queued", "Job queued.", 0.0, {})
    await events.publish({"type": "job_created", "job": job})
    await schedule_once()
    return job


@app.get("/api/jobs")
async def list_jobs() -> list[dict[str, Any]]:
    return await store.list("jobs")


@app.get("/api/jobs/{job_id}")
async def get_job(job_id: str) -> dict[str, Any]:
    job = await store.get("jobs", job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    job["events"] = await store.list("events", {"job_id": job_id})
    return job


@app.post("/api/jobs/{job_id}/events")
async def create_job_event(job_id: str, event: JobEventIn) -> dict[str, Any]:
    job = await store.get("jobs", job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    if event.kind == "progress" and event.progress is not None:
        await store.update("jobs", job_id, {"progress": event.progress, "metrics": event.metrics, "updated_at": utc_now()})
    return await append_job_event(job_id, event.kind, event.message, event.progress, event.metrics)


@app.post("/api/jobs/{job_id}/complete")
async def complete_job(job_id: str, request: CompleteJobRequest) -> dict[str, Any]:
    job = await store.get("jobs", job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    updated = await store.update(
        "jobs",
        job_id,
        {
            "status": request.status,
            "adapter_uri": request.adapter_uri,
            "metrics": request.metrics,
            "error": request.error,
            "progress": 1.0 if request.status == "completed" else job.get("progress", 0),
            "updated_at": utc_now(),
        },
    )
    worker_id = job.get("assigned_worker_id")
    if worker_id:
        await store.update(
            "workers",
            worker_id,
            {
                "status": "idle",
                "current_job_id": None,
                "updated_at": utc_now(),
                "reliability": _updated_reliability(await store.get("workers", worker_id), request.status == "completed"),
            },
        )
    await append_job_event(job_id, request.status, request.error or f"Job {request.status}.", None, request.metrics)
    await events.publish({"type": "job_completed", "job": updated})
    return updated or {}


@app.post("/api/jobs/{job_id}/cancel")
async def cancel_job(job_id: str) -> dict[str, Any]:
    job = await store.update("jobs", job_id, {"status": "cancelled", "updated_at": utc_now()})
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    await append_job_event(job_id, "cancelled", "Job cancelled.", None, {})
    await events.publish({"type": "job_cancelled", "job": job})
    return job


@app.post("/api/workers/register")
async def register_worker(request: WorkerRegistration) -> dict[str, Any]:
    worker = {
        "id": new_id("worker"),
        "name": request.name,
        "capabilities": request.capabilities.model_dump(),
        "status": "idle",
        "current_job_id": None,
        "metrics": {},
        "reliability": 0.75,
        "created_at": utc_now(),
        "updated_at": utc_now(),
        "last_seen_at": utc_now(),
    }
    await store.insert("workers", worker)
    await events.publish({"type": "worker_registered", "worker": worker})
    await schedule_once()
    return worker


@app.get("/api/workers")
async def list_workers() -> list[dict[str, Any]]:
    return await store.list("workers")


@app.post("/api/workers/{worker_id}/heartbeat")
async def worker_heartbeat(worker_id: str, heartbeat: WorkerHeartbeat) -> dict[str, Any]:
    worker = await store.update(
        "workers",
        worker_id,
        {
            "status": heartbeat.status,
            "current_job_id": heartbeat.current_job_id,
            "metrics": heartbeat.metrics,
            "last_seen_at": utc_now(),
            "updated_at": utc_now(),
        },
    )
    if not worker:
        raise HTTPException(status_code=404, detail="Worker not found")
    await events.publish({"type": "worker_heartbeat", "worker": worker})
    return worker


@app.get("/api/workers/{worker_id}/next-job")
async def next_job(worker_id: str) -> JobAssignment:
    worker = await store.get("workers", worker_id)
    if not worker:
        raise HTTPException(status_code=404, detail="Worker not found")

    existing = [
        job
        for job in await store.list("jobs", {"assigned_worker_id": worker_id})
        if job.get("status") in {"assigned", "running"}
    ]
    if existing:
        job = existing[0]
        if job["status"] == "assigned":
            job = await store.update("jobs", job["id"], {"status": "running", "updated_at": utc_now()}) or job
            await append_job_event(job["id"], "running", f"Worker {worker['name']} started training.", 0.0, {})
        return JobAssignment(job=job)

    await schedule_once()
    assigned = [
        job
        for job in await store.list("jobs", {"assigned_worker_id": worker_id})
        if job.get("status") == "assigned"
    ]
    return JobAssignment(job=assigned[0] if assigned else None)


@app.post("/api/schedule/tick")
async def schedule_tick() -> dict[str, Any]:
    assignments = await schedule_once()
    return {"assignments": assignments}


@app.get("/api/events")
async def event_stream(request: Request) -> StreamingResponse:
    return StreamingResponse(events.stream(request), media_type="text/event-stream")


async def schedule_once() -> list[dict[str, str]]:
    queued_jobs = await store.list("jobs", {"status": "queued"})
    idle_workers = [worker for worker in await store.list("workers", {"status": "idle"}) if _worker_is_fresh(worker)]
    assignments: list[dict[str, str]] = []

    for job in reversed(queued_jobs):
        candidates = [worker for worker in idle_workers if _can_run(job, worker)]
        decision = scheduler.choose_worker(job, candidates)
        if decision is None:
            continue
        worker = next(item for item in candidates if item["id"] == decision.worker_id)
        updated_job = await store.update(
            "jobs",
            job["id"],
            {
                "status": "assigned",
                "assigned_worker_id": worker["id"],
                "scheduler_score": decision.score,
                "updated_at": utc_now(),
            },
        )
        await store.update(
            "workers",
            worker["id"],
            {"status": "assigned", "current_job_id": job["id"], "updated_at": utc_now()},
        )
        idle_workers = [item for item in idle_workers if item["id"] != worker["id"]]
        assignments.append({"job_id": job["id"], "worker_id": worker["id"]})
        await append_job_event(job["id"], "assigned", f"Assigned to {worker['name']}.", None, {"score": decision.score})
        await events.publish({"type": "job_assigned", "job": updated_job, "worker": worker})

    return assignments


async def append_job_event(
    job_id: str,
    kind: str,
    message: str,
    progress: float | None,
    metrics: dict[str, Any],
) -> dict[str, Any]:
    event = {
        "id": new_id("event"),
        "job_id": job_id,
        "kind": kind,
        "message": message,
        "progress": progress,
        "metrics": metrics,
        "created_at": utc_now(),
    }
    await store.insert("events", event)
    await events.publish({"type": "job_event", "event": event})
    return event


def _can_run(job: dict[str, Any], worker: dict[str, Any]) -> bool:
    report = job.get("training_report", {})
    capabilities = worker.get("capabilities", {})
    vram = float(capabilities.get("vram_gb") or 0)
    requires_max = report.get("mode") == "max"
    if requires_max and vram >= 12:
        return True
    if vram >= 6:
        return True
    return bool(capabilities.get("supports_cpu", True)) and "CPU fallback" in report.get("hardware_requirement", "")


def _worker_is_fresh(worker: dict[str, Any]) -> bool:
    return worker.get("status") in {"idle", "assigned"}


def _updated_reliability(worker: dict[str, Any] | None, succeeded: bool) -> float:
    current = float((worker or {}).get("reliability", 0.75))
    target = 1.0 if succeeded else 0.0
    return round(0.85 * current + 0.15 * target, 4)
