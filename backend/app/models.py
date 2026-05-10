from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Literal
from uuid import uuid4

from pydantic import BaseModel, Field


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def new_id(prefix: str) -> str:
    return f"{prefix}_{uuid4().hex[:12]}"


AgentRole = Literal["assistant", "user", "system"]
AgentProvider = Literal["clod", "gemini"]
JobStatus = Literal["queued", "assigned", "running", "completed", "failed", "cancelled"]
WorkerStatus = Literal["idle", "assigned", "running", "offline"]
TrainingMode = Literal["short", "max"]


class AgentMessage(BaseModel):
    role: AgentRole
    content: str


class DatasetResult(BaseModel):
    id: str
    title: str
    source: str
    rows: int | None = None
    license: str | None = None
    match_reason: str
    url: str | None = None


class TrainingReport(BaseModel):
    id: str = Field(default_factory=lambda: new_id("report"))
    goal: str
    base_model: str = "Qwen/Qwen3-0.6B"
    mode: TrainingMode = "short"
    task_type: str = "instruction-following"
    dataset_query: str
    dataset_candidates: list[DatasetResult] = Field(default_factory=list)
    training_method: str = "LoRA SFT"
    eval_prompts: list[str]
    hardware_requirement: str = ">=8GB VRAM preferred, CPU fallback allowed for toy mode"
    provider: AgentProvider = "clod"
    notes: list[str] = Field(default_factory=list)
    created_at: str = Field(default_factory=utc_now)


class TrainingReportRequest(BaseModel):
    messages: list[AgentMessage]
    provider: AgentProvider | None = None
    search_datasets: bool = True


class DatasetSearchRequest(BaseModel):
    query: str
    limit: int = Field(default=5, ge=1, le=20)


class CreateJobRequest(BaseModel):
    report_id: str | None = None
    report: TrainingReport | None = None
    priority: int = Field(default=5, ge=1, le=10)


class WorkerCapabilities(BaseModel):
    hostname: str
    platform: str
    cpu_count: int
    memory_gb: float | None = None
    gpu_name: str | None = None
    cuda_available: bool = False
    vram_gb: float | None = None
    supports_cpu: bool = True
    tags: list[str] = Field(default_factory=list)


class WorkerRegistration(BaseModel):
    name: str
    capabilities: WorkerCapabilities


class WorkerHeartbeat(BaseModel):
    status: WorkerStatus
    current_job_id: str | None = None
    metrics: dict[str, Any] = Field(default_factory=dict)


class JobEventIn(BaseModel):
    kind: str
    message: str
    progress: float | None = Field(default=None, ge=0, le=1)
    metrics: dict[str, Any] = Field(default_factory=dict)


class CompleteJobRequest(BaseModel):
    status: Literal["completed", "failed"]
    adapter_uri: str | None = None
    metrics: dict[str, Any] = Field(default_factory=dict)
    error: str | None = None


class JobAssignment(BaseModel):
    job: dict[str, Any] | None = None
