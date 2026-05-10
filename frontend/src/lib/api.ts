import type {
  BrowserAction,
  BrowserEventType,
  BrowserObservation,
  OnboardingTask,
  PredictActionResponse,
  Trajectory,
  TrainingJob,
  UserProfile
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
  listUsers: () => apiFetch<UserProfile[]>("/api/users"),

  createUser: (displayName: string, emailHint: string, preferences: Record<string, unknown>) =>
    apiFetch<UserProfile>("/api/users", {
      method: "POST",
      body: JSON.stringify({
        display_name: displayName,
        email_hint: emailHint || null,
        preferences
      })
    }),

  createTasks: (userId: string, preferredSites: string[]) =>
    apiFetch<OnboardingTask[]>("/api/onboarding/tasks", {
      method: "POST",
      body: JSON.stringify({
        user_id: userId,
        preferred_sites: preferredSites,
        count: 6
      })
    }),

  listTasks: (userId: string) => apiFetch<OnboardingTask[]>(`/api/users/${userId}/tasks`),

  listTrajectories: (userId: string) => apiFetch<Trajectory[]>(`/api/users/${userId}/trajectories`),

  getTrajectory: (trajectoryId: string) => apiFetch<Trajectory>(`/api/trajectories/${trajectoryId}`),

  createTrajectory: (userId: string, task: string, taskId: string | null, observation: BrowserObservation) =>
    apiFetch<Trajectory>("/api/trajectories", {
      method: "POST",
      body: JSON.stringify({
        user_id: userId,
        task,
        task_id: taskId,
        source: taskId ? "onboarding" : "manual",
        initial_observation: observation
      })
    }),

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

  trainUserModel: (userId: string) =>
    apiFetch<TrainingJob>("/api/training/jobs", {
      method: "POST",
      body: JSON.stringify({
        user_id: userId,
        epochs: 40,
        batch_size: 16
      })
    }),

  getTrainingJob: (jobId: string) => apiFetch<TrainingJob>(`/api/training/jobs/${jobId}`),

  predictAction: (userId: string, task: string, observation: BrowserObservation, previousActions: BrowserAction[]) =>
    apiFetch<PredictActionResponse>("/api/agent/predict", {
      method: "POST",
      body: JSON.stringify({
        user_id: userId,
        task,
        observation,
        previous_actions: previousActions
      })
    })
};
