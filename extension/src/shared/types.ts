// Types copied from frontend to maintain consistency with backend

export type Actor = "user" | "agent" | "system";

export type BrowserEventType =
  | "observation"
  | "action"
  | "ask_user"
  | "user_answer"
  | "control_returned"
  | "success_state";

export type ActionType =
  | "click"
  | "type"
  | "scroll"
  | "open_url"
  | "search"
  | "wait"
  | "ask_user"
  | "stop"
  | "press_key";

export type UserProfile = {
  id: string;
  display_name: string;
  email_hint?: string | null;
  preferences: Record<string, unknown>;
  model_status: "untrained" | "training" | "ready" | "failed";
  model_checkpoint_uri?: string | null;
  model_artifact_id?: string | null;
  created_at: string;
  updated_at: string;
};

export type UserSkill = {
  id: string;
  user_id: string;
  session_id: string;
  name: string;
  goal: string;
  description: string;
  preferred_sites: string[];
  status: "draft" | "collecting" | "training" | "ready" | "failed";
  task_count: number;
  trajectory_count: number;
  training_job_id?: string | null;
  model_checkpoint_uri?: string | null;
  model_artifact_id?: string | null;
  created_at: string;
  updated_at: string;
};

export type SkillChatMessage = {
  role: Actor;
  content: string;
  created_at: string;
};

export type SkillChatSession = {
  id: string;
  user_id: string;
  status: "chatting" | "ready_for_tasks" | "completed";
  messages: SkillChatMessage[];
  inferred_goal: string;
  inferred_sites: string[];
  created_at: string;
  updated_at: string;
};

export type BoundingBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type DomNode = {
  selector: string;
  role?: string | null;
  name?: string | null;
  text?: string | null;
  tag?: string | null;
  is_sensitive?: boolean;
  attributes?: Record<string, unknown>;
  bbox?: BoundingBox | null;
};

export type BrowserObservation = {
  url: string;
  title: string;
  visible_text: string;
  focused_selector?: string | null;
  dom_nodes: DomNode[];
  screenshot_id?: string | null;
  metadata?: Record<string, unknown>;
};

export type BrowserAction = {
  type: ActionType;
  selector?: string | null;
  text?: string | null;
  direction?: "up" | "down" | "left" | "right" | null;
  url?: string | null;
  query?: string | null;
  question?: string | null;
  key?: string | null;
  confidence?: number | null;
  requires_confirmation?: boolean;
  metadata?: Record<string, unknown>;
};

export type OnboardingTask = {
  id: string;
  user_id: string;
  skill_id?: string | null;
  title: string;
  prompt: string;
  success_hint: string;
  risk_level: "low" | "medium" | "high";
  tags: string[];
  order: number;
  metadata: Record<string, unknown>;
  created_at: string;
};

export type TrajectoryEvent = {
  id: string;
  trajectory_id: string;
  user_id: string;
  task_id?: string | null;
  actor: Actor;
  event_type: BrowserEventType;
  observation?: BrowserObservation | null;
  action?: BrowserAction | null;
  question?: string | null;
  answer?: string | null;
  success?: boolean | null;
  created_at: string;
};

export type Trajectory = {
  id: string;
  user_id: string;
  skill_id?: string | null;
  task_id?: string | null;
  task: string;
  source: "onboarding" | "question_takeover" | "manual" | "agent_run";
  status: "recording" | "completed" | "abandoned";
  success?: boolean | null;
  event_count: number;
  events?: TrajectoryEvent[];
  created_at: string;
  updated_at: string;
};
