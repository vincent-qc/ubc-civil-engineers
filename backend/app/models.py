from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Literal
from uuid import uuid4

from pydantic import BaseModel, Field


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def new_id(prefix: str) -> str:
    return f"{prefix}_{uuid4().hex[:12]}"


Actor = Literal["user", "agent", "system"]
TrajectorySource = Literal["onboarding", "question_takeover", "manual", "agent_run"]
TrajectoryStatus = Literal["recording", "completed", "abandoned"]
BrowserEventType = Literal[
    "observation",
    "action",
    "ask_user",
    "user_answer",
    "control_returned",
    "success_state",
]
ActionType = Literal[
    "click",
    "type",
    "scroll",
    "open_url",
    "search",
    "wait",
    "ask_user",
    "stop",
    "press_key",
]
TrainingStatus = Literal["queued", "running", "completed", "failed"]
ModelStatus = Literal["untrained", "training", "ready", "failed"]
SkillStatus = Literal["draft", "collecting", "training", "ready", "failed"]
SkillSessionStatus = Literal["chatting", "ready_for_tasks", "completed"]


class BoundingBox(BaseModel):
    x: float
    y: float
    width: float
    height: float


class DomNode(BaseModel):
    selector: str
    role: str | None = None
    name: str | None = None
    text: str | None = None
    tag: str | None = None
    attributes: dict[str, Any] = Field(default_factory=dict)
    bbox: BoundingBox | None = None
    is_sensitive: bool = False


class BrowserObservation(BaseModel):
    url: str = ""
    title: str = ""
    visible_text: str = ""
    focused_selector: str | None = None
    dom_nodes: list[DomNode] = Field(default_factory=list)
    screenshot_id: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class BrowserAction(BaseModel):
    type: ActionType
    selector: str | None = None
    text: str | None = None
    direction: Literal["up", "down", "left", "right"] | None = None
    url: str | None = None
    query: str | None = None
    question: str | None = None
    key: str | None = None
    confidence: float | None = Field(default=None, ge=0, le=1)
    requires_confirmation: bool = False
    metadata: dict[str, Any] = Field(default_factory=dict)


class CreateUserRequest(BaseModel):
    display_name: str
    email_hint: str | None = None
    preferences: dict[str, Any] = Field(default_factory=dict)


class LoginRequest(BaseModel):
    display_name: str
    email_hint: str | None = None


class UserProfile(BaseModel):
    id: str = Field(default_factory=lambda: new_id("user"))
    display_name: str
    email_hint: str | None = None
    preferences: dict[str, Any] = Field(default_factory=dict)
    model_status: ModelStatus = "untrained"
    model_checkpoint_uri: str | None = None
    model_artifact_id: str | None = None
    created_at: str = Field(default_factory=utc_now)
    updated_at: str = Field(default_factory=utc_now)


class OnboardingTaskRequest(BaseModel):
    user_id: str
    preferred_sites: list[str] = Field(default_factory=list)
    count: int = Field(default=6, ge=1, le=12)
    skill_id: str | None = None
    goal: str | None = None


class OnboardingTask(BaseModel):
    id: str = Field(default_factory=lambda: new_id("task"))
    user_id: str
    skill_id: str | None = None
    title: str
    prompt: str
    success_hint: str
    risk_level: Literal["low", "medium", "high"] = "low"
    tags: list[str] = Field(default_factory=list)
    order: int = 0
    metadata: dict[str, Any] = Field(default_factory=dict)
    created_at: str = Field(default_factory=utc_now)


class SkillChatMessage(BaseModel):
    role: Actor
    content: str
    created_at: str = Field(default_factory=utc_now)


class CreateSkillSessionRequest(BaseModel):
    user_id: str


class SkillChatTurnRequest(BaseModel):
    content: str


class SkillChatSession(BaseModel):
    id: str = Field(default_factory=lambda: new_id("skillchat"))
    user_id: str
    status: SkillSessionStatus = "chatting"
    messages: list[SkillChatMessage] = Field(default_factory=list)
    inferred_goal: str = ""
    inferred_sites: list[str] = Field(default_factory=list)
    created_at: str = Field(default_factory=utc_now)
    updated_at: str = Field(default_factory=utc_now)


class UserSkill(BaseModel):
    id: str = Field(default_factory=lambda: new_id("skill"))
    user_id: str
    session_id: str
    name: str
    goal: str
    description: str
    preferred_sites: list[str] = Field(default_factory=list)
    status: SkillStatus = "draft"
    task_count: int = 0
    trajectory_count: int = 0
    training_job_id: str | None = None
    model_checkpoint_uri: str | None = None
    model_artifact_id: str | None = None
    created_at: str = Field(default_factory=utc_now)
    updated_at: str = Field(default_factory=utc_now)


class CreateTrajectoryRequest(BaseModel):
    user_id: str
    task: str
    source: TrajectorySource = "manual"
    task_id: str | None = None
    skill_id: str | None = None
    initial_observation: BrowserObservation | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class Trajectory(BaseModel):
    id: str = Field(default_factory=lambda: new_id("traj"))
    user_id: str
    skill_id: str | None = None
    task_id: str | None = None
    task: str
    source: TrajectorySource = "manual"
    status: TrajectoryStatus = "recording"
    success: bool | None = None
    event_count: int = 0
    metadata: dict[str, Any] = Field(default_factory=dict)
    created_at: str = Field(default_factory=utc_now)
    updated_at: str = Field(default_factory=utc_now)


class TrajectoryEventRequest(BaseModel):
    actor: Actor
    event_type: BrowserEventType
    observation: BrowserObservation | None = None
    action: BrowserAction | None = None
    question: str | None = None
    answer: str | None = None
    success: bool | None = None
    redaction_map: dict[str, str] = Field(default_factory=dict)
    metadata: dict[str, Any] = Field(default_factory=dict)


class TrajectoryEvent(BaseModel):
    id: str = Field(default_factory=lambda: new_id("event"))
    trajectory_id: str
    user_id: str
    task_id: str | None = None
    actor: Actor
    event_type: BrowserEventType
    observation: BrowserObservation | None = None
    action: BrowserAction | None = None
    question: str | None = None
    answer: str | None = None
    success: bool | None = None
    redaction_map: dict[str, str] = Field(default_factory=dict)
    metadata: dict[str, Any] = Field(default_factory=dict)
    created_at: str = Field(default_factory=utc_now)


class BulkRecordingRequest(BaseModel):
    user_id: str
    task: str
    source: TrajectorySource = "manual"
    task_id: str | None = None
    skill_id: str | None = None
    initial_observation: BrowserObservation | None = None
    events: list[TrajectoryEventRequest]
    metadata: dict[str, Any] = Field(default_factory=dict)


class CreateTrainingJobRequest(BaseModel):
    user_id: str
    skill_id: str | None = None
    epochs: int = Field(default=40, ge=1, le=500)
    batch_size: int = Field(default=16, ge=1, le=128)


class TrainingJob(BaseModel):
    id: str = Field(default_factory=lambda: new_id("train"))
    user_id: str
    skill_id: str | None = None
    status: TrainingStatus = "queued"
    epochs: int = 40
    batch_size: int = 16
    progress: float = Field(default=0.0, ge=0, le=1)
    example_count: int = 0
    artifact_uri: str | None = None
    metrics: dict[str, Any] = Field(default_factory=dict)
    error: str | None = None
    created_at: str = Field(default_factory=utc_now)
    updated_at: str = Field(default_factory=utc_now)


class ModelArtifact(BaseModel):
    id: str = Field(default_factory=lambda: new_id("model"))
    user_id: str
    skill_id: str | None = None
    training_job_id: str
    uri: str
    label_set: list[str] = Field(default_factory=list)
    example_count: int
    metrics: dict[str, Any] = Field(default_factory=dict)
    created_at: str = Field(default_factory=utc_now)


class PredictActionRequest(BaseModel):
    user_id: str
    skill_id: str | None = None
    task: str
    observation: BrowserObservation
    previous_actions: list[BrowserAction] = Field(default_factory=list)


class PredictActionResponse(BaseModel):
    user_id: str
    model_artifact_id: str | None = None
    model_checkpoint_uri: str | None = None
    action: BrowserAction
    confidence: float = Field(ge=0, le=1)
    rationale: str
    used_fallback: bool = False
