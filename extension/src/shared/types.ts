// ============================================================
// Shared types for the CUA Gregory Control Panel extension.
//
// These mirror the FastAPI backend response schemas.
// When the backend stabilises, consider generating from OpenAPI.
// ============================================================

// --- Connection ---

export type ConnectionState =
  | "connected"
  | "connecting"
  | "disconnected"
  | "backend_unavailable"
  | "recorder_unavailable";

// --- Recorder ---

export type RecordingState =
  | "idle"
  | "starting"
  | "recording"
  | "paused"
  | "stopping"
  | "error";

// --- Health ---

export interface HealthResponse {
  status: "ok" | "degraded";
  version: string;
  recorder_available: boolean;
}

// --- Recorder ---

export interface RecorderStatus {
  state: RecordingState;
  session_id: string | null;
  trajectory_id: string | null;
  skill_id: string | null;
  task_id: string | null;
  started_at: string | null;
  paused_at: string | null;
}

export interface StartRecordingRequest {
  source: "extension";
  user_id: string;
  skill_id?: string;
  task_id?: string;
  context?: ActiveTabContext;
}

export interface StartRecordingResponse {
  ok: boolean;
  session_id: string;
  trajectory_id: string;
  recording_state: RecordingState;
}

// --- Session ---

export interface SessionState {
  user_id: string;
  user_display_name: string;
  active_skill_id: string | null;
  active_task_id: string | null;
  active_trajectory_id: string | null;
  recording_state: RecordingState;
}

// --- Gregory Chat ---

export type MessageRole = "user" | "assistant" | "system";

export interface GregoryMessage {
  id: string;
  role: MessageRole;
  content: string;
  created_at: string;
}

export interface GregoryQuestion {
  id: string;
  question: string;
  options?: string[];
}

export interface GregoryConversation {
  id: string;
  status: "active" | "completed";
  messages: GregoryMessage[];
  pending_question: GregoryQuestion | null;
  created_at: string;
  updated_at: string;
}

export interface SendMessageRequest {
  source: "extension";
  conversation_id: string | null;
  message: string;
}

export interface SendMessageResponse {
  conversation_id: string;
  messages: GregoryMessage[];
  pending_question: GregoryQuestion | null;
}

// --- Skills ---

export type SkillStatus =
  | "draft"
  | "collecting"
  | "training"
  | "ready"
  | "failed";

export interface Skill {
  id: string;
  name: string;
  description: string;
  status: SkillStatus;
  task_count: number;
  trajectory_count: number;
  created_at: string;
  updated_at: string;
}

// --- Tasks ---

export type TaskStatus = "pending" | "active" | "completed" | "failed";

export interface Task {
  id: string;
  skill_id: string | null;
  title: string;
  prompt: string;
  success_hint: string;
  risk_level: "low" | "medium" | "high";
  status: TaskStatus;
  current_step: string | null;
  step_number: number | null;
  step_count: number | null;
}

// --- User Answers ---

export interface UserAnswerRequest {
  source: "extension";
  session_id: string;
  trajectory_id: string | null;
  question_id: string;
  answer: string;
}

// --- Safety ---

export type SafetyActionType =
  | "send_email"
  | "delete_item"
  | "submit_form"
  | "make_purchase"
  | "share_data"
  | "change_settings"
  | "other";

export interface SafetyConfirmation {
  id: string;
  action_type: SafetyActionType;
  description: string;
  details: Record<string, unknown>;
  risk_level: "low" | "medium" | "high";
  expires_at: string | null;
  created_at: string;
}

// --- Training / Model ---

export interface TrainingJob {
  id: string;
  skill_id: string | null;
  status: "queued" | "running" | "completed" | "failed";
  progress: number;
  created_at: string;
  updated_at: string;
}

export interface ModelStatus {
  is_loaded: boolean;
  model_id: string | null;
  skill_id: string | null;
  last_trained_at: string | null;
}

// --- Active tab (read via chrome.tabs API in the service worker) ---

export interface ActiveTabContext {
  url: string;
  title: string;
  tab_id: number;
  window_id: number;
}

// --- Chrome extension local storage schema ---

export interface ExtensionLocalState {
  backend_url: string;
  connection_state: ConnectionState;
  last_health_check: number | null;
  recorder_status: RecorderStatus | null;
  pending_safety_count: number;
}

// --- Messages between popup / sidepanel / service worker ---

export type ExtensionMessage =
  | { type: "OPEN_SIDE_PANEL" }
  | { type: "GET_STATUS" }
  | { type: "STATUS_UPDATE"; payload: Partial<ExtensionLocalState> }
  | { type: "START_RECORDING"; payload: { task_id?: string; skill_id?: string } }
  | { type: "STOP_RECORDING" }
  | { type: "TOGGLE_RECORDING" };
