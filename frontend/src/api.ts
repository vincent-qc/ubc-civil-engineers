import type { AgentMessage, AgentProvider, DatasetResult, Job, TrainingReport, Worker } from "./types";

const API_BASE = import.meta.env.VITE_API_BASE ?? "";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {})
    }
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || response.statusText);
  }
  return response.json() as Promise<T>;
}

export function createTrainingReport(
  messages: AgentMessage[],
  provider: AgentProvider,
  searchDatasets = true
): Promise<TrainingReport> {
  return request<TrainingReport>("/api/agent/training-report", {
    method: "POST",
    body: JSON.stringify({ messages, provider, search_datasets: searchDatasets })
  });
}

export function createJob(reportId: string, priority: number): Promise<Job> {
  return request<Job>("/api/jobs", {
    method: "POST",
    body: JSON.stringify({ report_id: reportId, priority })
  });
}

export function listJobs(): Promise<Job[]> {
  return request<Job[]>("/api/jobs");
}

export function listReports(): Promise<TrainingReport[]> {
  return request<TrainingReport[]>("/api/reports");
}

export function listWorkers(): Promise<Worker[]> {
  return request<Worker[]>("/api/workers");
}

export function searchDatasets(query: string): Promise<DatasetResult[]> {
  return request<DatasetResult[]>("/api/datasets/search", {
    method: "POST",
    body: JSON.stringify({ query, limit: 5 })
  });
}

export function eventSource(): EventSource {
  return new EventSource(`${API_BASE}/api/events`);
}
