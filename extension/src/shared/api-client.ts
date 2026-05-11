// ============================================================
// API Client — CUA Gregory Control Panel extension.
//
// Every exported function corresponds to one backend endpoint.
// Each stub is annotated with:
//   - The HTTP method + path to call
//   - The expected request shape (if any)
//   - The expected response shape
//
// To wire up the backend:
//   1. Delete the "STUB" block in each function.
//   2. Uncomment the apiFetch(...) line above it.
//   3. Adjust types if the real response shape differs.
// ============================================================

import type {
  GregoryConversation,
  HealthResponse,
  ModelStatus,
  RecorderStatus,
  SafetyConfirmation,
  SendMessageRequest,
  SendMessageResponse,
  SessionState,
  Skill,
  StartRecordingRequest,
  StartRecordingResponse,
  Task,
  TrainingJob,
  UserAnswerRequest,
} from "./types";

// ----------------------------------------------------------------
// Config
// ----------------------------------------------------------------

// TODO: Make this configurable via an extension settings page.
// Read from chrome.storage.local["backend_url"] at runtime.
export const DEFAULT_BACKEND_URL = "http://localhost:8000";

function getBackendUrl(): string {
  // TODO: Replace with async read from chrome.storage.local.
  // For now, uses the compile-time default.
  return DEFAULT_BACKEND_URL;
}

// ----------------------------------------------------------------
// Core fetch helper
// ----------------------------------------------------------------

interface ApiError extends Error {
  status?: number;
}

async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${getBackendUrl()}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init.headers ?? {}) },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    const err: ApiError = new Error(`HTTP ${res.status}: ${body || res.statusText}`);
    err.status = res.status;
    throw err;
  }

  const text = await res.text();
  return (text ? JSON.parse(text) : null) as T;
}

// ----------------------------------------------------------------
// Health & Status
// ----------------------------------------------------------------

/**
 * GET /api/health
 *
 * Determine if the backend is up and if the Electron recorder is attached.
 * Poll this every 2–3 seconds from the service worker while the extension is open.
 */
export async function checkHealth(): Promise<HealthResponse> {
  return apiFetch<HealthResponse>("/api/health");
}

/**
 * GET /api/recorder/status
 *
 * Current recorder state (idle | recording | paused | …) plus IDs for the
 * active session, trajectory, skill, and task.
 */
export async function getRecorderStatus(): Promise<RecorderStatus> {
  return apiFetch<RecorderStatus>("/api/recorder/status");
}

/**
 * GET /api/session/current
 *
 * Aggregate snapshot: who is logged in, what skill/task/trajectory is active,
 * and what the current recording state is.  Returns null if no session exists.
 */
export async function getSessionState(): Promise<SessionState | null> {
  return apiFetch<SessionState | null>("/api/session/current");
}

// ----------------------------------------------------------------
// Recording Controls
// ----------------------------------------------------------------

/**
 * POST /api/recorder/start
 *
 * Request body: StartRecordingRequest
 *   { source, user_id, skill_id?, task_id?, context?: { url, title, tab_id, window_id } }
 *
 * Response: StartRecordingResponse
 *   { ok, session_id, trajectory_id, recording_state }
 */
export async function startRecording(req: StartRecordingRequest): Promise<StartRecordingResponse> {
  return apiFetch<StartRecordingResponse>("/api/recorder/start", {
    method: "POST",
    body: JSON.stringify(req),
  });
}

/**
 * POST /api/recorder/pause
 */
export async function pauseRecording(): Promise<{ ok: boolean }> {
  // TODO: return apiFetch("/api/recorder/pause", { method: "POST" });

  // STUB ↓
  console.log("[API STUB] pauseRecording");
  await delay(200);
  return { ok: true };
}

/**
 * POST /api/recorder/resume
 */
export async function resumeRecording(): Promise<{ ok: boolean }> {
  // TODO: return apiFetch("/api/recorder/resume", { method: "POST" });

  // STUB ↓
  console.log("[API STUB] resumeRecording");
  await delay(200);
  return { ok: true };
}

/**
 * POST /api/recorder/stop
 */
export async function stopRecording(): Promise<{ ok: boolean }> {
  return apiFetch("/api/recorder/stop", { method: "POST" });
}

// ----------------------------------------------------------------
// Gregory Chat
// ----------------------------------------------------------------

/**
 * GET /api/gregory/conversations/current
 *
 * Fetch the current active conversation so the extension can resume it.
 * Returns null if no conversation is in progress.
 */
export async function getCurrentConversation(): Promise<GregoryConversation | null> {
  // TODO: return apiFetch<GregoryConversation | null>("/api/gregory/conversations/current");

  // STUB ↓
  await delay(150);
  return null;
}

/**
 * POST /api/gregory/messages
 *
 * Request body: SendMessageRequest
 *   { source: "extension", conversation_id: string | null, message: string }
 *
 * Response: SendMessageResponse
 *   { conversation_id, messages, pending_question }
 */
export async function sendGregoryMessage(req: SendMessageRequest): Promise<SendMessageResponse> {
  return apiFetch<SendMessageResponse>("/api/gregory/messages", {
    method: "POST",
    body: JSON.stringify(req),
  });
}

// ----------------------------------------------------------------
// Skills
// ----------------------------------------------------------------

/**
 * GET /api/skills
 */
export async function listSkills(): Promise<Skill[]> {
  return apiFetch<Skill[]>("/api/skills");
}

/**
 * POST /api/skills
 *
 * Called at the end of the Add Skill flow when Gregory has enough information.
 * Body: { name, description, preferred_sites?, ... }
 */
export async function createSkill(params: { name: string; description: string }): Promise<Skill> {
  // TODO:
  // return apiFetch<Skill>("/api/skills", {
  //   method: "POST",
  //   body: JSON.stringify(params),
  // });

  // STUB ↓
  console.log("[API STUB] createSkill →", params);
  await delay(500);
  return {
    id: "stub-skill-001",
    name: params.name,
    description: params.description,
    status: "draft",
    task_count: 0,
    trajectory_count: 0,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

/**
 * POST /api/skills/{skill_id}/activate
 */
export async function activateSkill(skillId: string): Promise<{ ok: boolean }> {
  return apiFetch(`/api/skills/${skillId}/activate`, { method: "POST" });
}

// ----------------------------------------------------------------
// Tasks
// ----------------------------------------------------------------

/**
 * GET /api/tasks/active
 *
 * The current task the agent / user is working on, or null if idle.
 */
export async function getActiveTask(): Promise<Task | null> {
  // TODO: return apiFetch<Task | null>("/api/tasks/active");

  // STUB ↓
  await delay(100);
  return null;
}

/**
 * POST /api/tasks/{task_id}/start
 */
export async function startTask(taskId: string): Promise<{ ok: boolean }> {
  // TODO: return apiFetch(`/api/tasks/${taskId}/start`, { method: "POST" });

  // STUB ↓
  console.log("[API STUB] startTask →", taskId);
  await delay(200);
  return { ok: true };
}

/**
 * POST /api/tasks/{task_id}/complete
 */
export async function completeTask(taskId: string): Promise<{ ok: boolean }> {
  // TODO: return apiFetch(`/api/tasks/${taskId}/complete`, { method: "POST" });

  // STUB ↓
  console.log("[API STUB] completeTask →", taskId);
  await delay(200);
  return { ok: true };
}

/**
 * POST /api/tasks/{task_id}/fail
 */
export async function failTask(taskId: string, reason?: string): Promise<{ ok: boolean }> {
  // TODO:
  // return apiFetch(`/api/tasks/${taskId}/fail`, {
  //   method: "POST",
  //   body: JSON.stringify({ reason }),
  // });

  // STUB ↓
  console.log("[API STUB] failTask →", taskId, reason);
  await delay(200);
  return { ok: true };
}

// ----------------------------------------------------------------
// User Answers
// ----------------------------------------------------------------

/**
 * POST /api/user-answers
 *
 * Submit the user's answer to a Gregory clarifying question or
 * an agent ask_user event.
 *
 * Body: UserAnswerRequest
 *   { source, session_id, trajectory_id, question_id, answer }
 */
export async function submitUserAnswer(req: UserAnswerRequest): Promise<{ ok: boolean }> {
  // TODO:
  // return apiFetch<{ ok: boolean }>("/api/user-answers", {
  //   method: "POST",
  //   body: JSON.stringify(req),
  // });

  // STUB ↓
  console.log("[API STUB] submitUserAnswer →", req);
  await delay(200);
  return { ok: true };
}

// ----------------------------------------------------------------
// Safety Confirmations
// ----------------------------------------------------------------

/**
 * GET /api/safety/pending
 *
 * List of safety confirmations the agent is blocked on.
 * Poll frequently while recording is active.
 */
export async function getPendingSafetyConfirmations(): Promise<SafetyConfirmation[]> {
  // TODO: return apiFetch<SafetyConfirmation[]>("/api/safety/pending");

  // STUB ↓
  await delay(100);
  return [];
}

/**
 * POST /api/safety/{confirmation_id}/approve
 */
export async function approveSafetyConfirmation(id: string): Promise<{ ok: boolean }> {
  // TODO: return apiFetch(`/api/safety/${id}/approve`, { method: "POST" });

  // STUB ↓
  console.log("[API STUB] approveSafetyConfirmation →", id);
  await delay(200);
  return { ok: true };
}

/**
 * POST /api/safety/{confirmation_id}/reject
 */
export async function rejectSafetyConfirmation(id: string): Promise<{ ok: boolean }> {
  // TODO: return apiFetch(`/api/safety/${id}/reject`, { method: "POST" });

  // STUB ↓
  console.log("[API STUB] rejectSafetyConfirmation →", id);
  await delay(200);
  return { ok: true };
}

// ----------------------------------------------------------------
// Training & Model
// ----------------------------------------------------------------

/**
 * GET /api/training/jobs
 */
export async function listTrainingJobs(): Promise<TrainingJob[]> {
  // TODO: return apiFetch<TrainingJob[]>("/api/training/jobs");

  // STUB ↓
  await delay(100);
  return [];
}

/**
 * GET /api/model/status
 */
export async function getModelStatus(): Promise<ModelStatus> {
  return apiFetch<ModelStatus>("/api/model/status");
}

// ----------------------------------------------------------------
// Utility
// ----------------------------------------------------------------

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export { apiFetch };
