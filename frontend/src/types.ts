export type AgentProvider = "clod" | "gemini";
export type JobStatus = "queued" | "assigned" | "running" | "completed" | "failed" | "cancelled";
export type WorkerStatus = "idle" | "assigned" | "running" | "offline";

export interface AgentMessage {
  role: "assistant" | "user" | "system";
  content: string;
}

export interface DatasetResult {
  id: string;
  title: string;
  source: string;
  rows?: number | null;
  license?: string | null;
  match_reason: string;
  url?: string | null;
}

export interface TrainingReport {
  id: string;
  goal: string;
  base_model: string;
  mode: "short" | "max";
  task_type: string;
  dataset_query: string;
  dataset_candidates: DatasetResult[];
  training_method: string;
  eval_prompts: string[];
  hardware_requirement: string;
  provider: AgentProvider;
  notes: string[];
  created_at: string;
}

export interface Job {
  id: string;
  training_report_id: string;
  training_report: TrainingReport;
  priority: number;
  status: JobStatus;
  assigned_worker_id?: string | null;
  adapter_uri?: string | null;
  metrics: Record<string, unknown>;
  progress?: number;
  scheduler_score?: number;
  created_at: string;
  updated_at: string;
  error?: string | null;
}

export interface WorkerCapabilities {
  hostname: string;
  platform: string;
  cpu_count: number;
  memory_gb?: number | null;
  gpu_name?: string | null;
  cuda_available: boolean;
  vram_gb?: number | null;
  supports_cpu: boolean;
  tags: string[];
}

export interface Worker {
  id: string;
  name: string;
  capabilities: WorkerCapabilities;
  status: WorkerStatus;
  current_job_id?: string | null;
  metrics: Record<string, unknown>;
  reliability: number;
  created_at: string;
  updated_at: string;
  last_seen_at: string;
}

export interface JobEvent {
  id: string;
  job_id: string;
  kind: string;
  message: string;
  progress?: number | null;
  metrics: Record<string, unknown>;
  created_at: string;
}
