import type {
  BrowserAction,
  BrowserEventType,
  BrowserObservation,
  OnboardingTask,
  PredictActionResponse,
  SkillChatSession,
  Trajectory,
  TrainingJob,
  UserProfile,
  UserSkill
} from "./types";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

type RequestOptions = RequestInit & {
  body?: BodyInit | null;
};

async function apiFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers ?? {})
    },
    cache: "no-store"
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail || `Request failed with ${response.status}`);
  }
  return response.json() as Promise<T>;
}

export const api = {
  login: (displayName: string, emailHint: string) =>
    apiFetch<UserProfile>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({
        display_name: displayName,
        email_hint: emailHint || null
      })
    }),

  listUsers: () => apiFetch<UserProfile[]>("/api/users"),

  getUser: (userId: string) => apiFetch<UserProfile>(`/api/users/${userId}`),

  listSkills: (userId: string) => apiFetch<UserSkill[]>(`/api/users/${userId}/skills`),

  startSkillSession: (userId: string) =>
    apiFetch<SkillChatSession>("/api/skills/sessions", {
      method: "POST",
      body: JSON.stringify({ user_id: userId })
    }),

  sendSkillMessage: (sessionId: string, content: string) =>
    apiFetch<SkillChatSession>(`/api/skills/sessions/${sessionId}/messages`, {
      method: "POST",
      body: JSON.stringify({ content })
    }),

  finalizeSkill: (sessionId: string) =>
    apiFetch<{ session: SkillChatSession; skill: UserSkill; tasks: OnboardingTask[] }>(
      `/api/skills/sessions/${sessionId}/finalize`,
      { method: "POST" }
    ),

  listSkillTasks: (skillId: string) => apiFetch<OnboardingTask[]>(`/api/skills/${skillId}/tasks`),

  createTrajectory: (
    userId: string,
    skillId: string | null,
    task: string,
    taskId: string | null,
    observation: BrowserObservation
  ) =>
    apiFetch<Trajectory>("/api/trajectories", {
      method: "POST",
      body: JSON.stringify({
        user_id: userId,
        skill_id: skillId,
        task,
        task_id: taskId,
        source: "onboarding",
        initial_observation: observation,
        metadata: { skill_id: skillId }
      })
    }),

  getTrajectory: (trajectoryId: string) => apiFetch<Trajectory>(`/api/trajectories/${trajectoryId}`),

  recordEvent: (
    trajectoryId: string,
    payload: {
      actor: "user" | "agent" | "system";
      event_type: BrowserEventType;
      observation?: BrowserObservation;
      action?: BrowserAction;
      question?: string;
      answer?: string;
      success?: boolean;
      metadata?: Record<string, unknown>;
    }
  ) =>
    apiFetch(`/api/trajectories/${trajectoryId}/events`, {
      method: "POST",
      body: JSON.stringify(payload)
    }),

  trainSkillModel: (userId: string, skillId: string) =>
    apiFetch<TrainingJob>("/api/training/jobs", {
      method: "POST",
      body: JSON.stringify({
        user_id: userId,
        skill_id: skillId,
        epochs: 40,
        batch_size: 16
      })
    }),

  getTrainingJob: (jobId: string) => apiFetch<TrainingJob>(`/api/training/jobs/${jobId}`),

  predictAction: (
    userId: string,
    skillId: string | null,
    task: string,
    observation: BrowserObservation,
    previousActions: BrowserAction[]
  ) =>
    apiFetch<PredictActionResponse>("/api/agent/predict", {
      method: "POST",
      body: JSON.stringify({
        user_id: userId,
        skill_id: skillId,
        task,
        observation,
        previous_actions: previousActions
      })
    })
};
