import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  Activity,
  Cpu,
  Database,
  Download,
  FileText,
  Play,
  RefreshCw,
  Search,
  Send,
  Sparkles
} from "lucide-react";
import {
  createJob,
  createTrainingReport,
  eventSource,
  listJobs,
  listReports,
  listWorkers,
  searchDatasets
} from "./api";
import type { AgentMessage, AgentProvider, DatasetResult, Job, JobEvent, TrainingReport, Worker } from "./types";

const starterGoal =
  "Fine-tune a small model to answer Python debugging questions. Use a short run and include eval prompts for traceback repair, off-by-one loops, and test suggestions.";

function App() {
  const [provider, setProvider] = useState<AgentProvider>("clod");
  const [goal, setGoal] = useState(starterGoal);
  const [reports, setReports] = useState<TrainingReport[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [datasetResults, setDatasetResults] = useState<DatasetResult[]>([]);
  const [events, setEvents] = useState<JobEvent[]>([]);
  const [selectedReportId, setSelectedReportId] = useState<string>("");
  const [priority, setPriority] = useState(5);
  const [busy, setBusy] = useState<string>("");
  const [error, setError] = useState<string>("");

  const selectedReport = useMemo(
    () => reports.find((report) => report.id === selectedReportId) ?? reports[0],
    [reports, selectedReportId]
  );

  async function refresh() {
    const [nextReports, nextJobs, nextWorkers] = await Promise.all([listReports(), listJobs(), listWorkers()]);
    setReports(nextReports);
    setJobs(nextJobs);
    setWorkers(nextWorkers);
    if (!selectedReportId && nextReports.length > 0) {
      setSelectedReportId(nextReports[0].id);
    }
  }

  useEffect(() => {
    refresh().catch((refreshError: Error) => setError(refreshError.message));
    const source = eventSource();
    source.onmessage = (message) => {
      const payload = JSON.parse(message.data);
      if (payload.type === "job_event") {
        setEvents((current) => [payload.event, ...current].slice(0, 16));
      }
      refresh().catch(() => undefined);
    };
    source.onerror = () => source.close();
    return () => source.close();
  }, []);

  async function runAction<T>(label: string, action: () => Promise<T>): Promise<T | undefined> {
    setBusy(label);
    setError("");
    try {
      return await action();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : String(actionError));
      return undefined;
    } finally {
      setBusy("");
    }
  }

  async function handleCreateReport() {
    const messages: AgentMessage[] = [{ role: "user", content: goal }];
    const report = await runAction("report", () => createTrainingReport(messages, provider, true));
    if (report) {
      setReports((current) => [report, ...current.filter((item) => item.id !== report.id)]);
      setDatasetResults(report.dataset_candidates);
      setSelectedReportId(report.id);
    }
  }

  async function handleDatasetSearch() {
    const query = selectedReport?.dataset_query ?? goal;
    const results = await runAction("datasets", () => searchDatasets(query));
    if (results) {
      setDatasetResults(results);
    }
  }

  async function handleCreateJob() {
    if (!selectedReport) return;
    const job = await runAction("job", () => createJob(selectedReport.id, priority));
    if (job) {
      setJobs((current) => [job, ...current.filter((item) => item.id !== job.id)]);
      await refresh();
    }
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">UBC Civil Engineers</p>
          <h1>Fine-Tuning Marketplace</h1>
        </div>
        <button className="icon-button" onClick={() => refresh()} aria-label="Refresh">
          <RefreshCw size={18} />
        </button>
      </header>

      {error && <div className="alert">{error}</div>}

      <main className="workspace">
        <section className="composer panel">
          <div className="panel-title">
            <Sparkles size={18} />
            <h2>Training Agent</h2>
          </div>

          <div className="segmented" aria-label="Agent provider">
            <button className={provider === "clod" ? "active" : ""} onClick={() => setProvider("clod")}>
              CLōD
            </button>
            <button className={provider === "gemini" ? "active" : ""} onClick={() => setProvider("gemini")}>
              Gemini
            </button>
          </div>

          <label className="field">
            <span>Goal</span>
            <textarea value={goal} onChange={(event) => setGoal(event.target.value)} rows={8} />
          </label>

          <button className="primary-action" onClick={handleCreateReport} disabled={busy === "report"}>
            <Send size={18} />
            {busy === "report" ? "Generating" : "Generate Report"}
          </button>
        </section>

        <section className="report panel">
          <div className="panel-title">
            <FileText size={18} />
            <h2>Training Report</h2>
          </div>

          {selectedReport ? (
            <>
              <select
                className="report-select"
                value={selectedReport.id}
                onChange={(event) => setSelectedReportId(event.target.value)}
              >
                {reports.map((report) => (
                  <option key={report.id} value={report.id}>
                    {report.goal.slice(0, 80)}
                  </option>
                ))}
              </select>

              <div className="summary-grid">
                <Metric label="Model" value={selectedReport.base_model} />
                <Metric label="Mode" value={selectedReport.mode} />
                <Metric label="Method" value={selectedReport.training_method} />
                <Metric label="Task" value={selectedReport.task_type} />
              </div>

              <div className="report-block">
                <h3>Goal</h3>
                <p>{selectedReport.goal}</p>
              </div>

              <div className="report-block">
                <h3>Eval Prompts</h3>
                <ol>
                  {selectedReport.eval_prompts.map((prompt) => (
                    <li key={prompt}>{prompt}</li>
                  ))}
                </ol>
              </div>

              <div className="job-controls">
                <label className="inline-field">
                  <span>Priority</span>
                  <input
                    type="number"
                    min={1}
                    max={10}
                    value={priority}
                    onChange={(event) => setPriority(Number(event.target.value))}
                  />
                </label>
                <button className="primary-action" onClick={handleCreateJob} disabled={busy === "job"}>
                  <Play size={18} />
                  {busy === "job" ? "Queueing" : "Queue Job"}
                </button>
              </div>
            </>
          ) : (
            <EmptyState icon={<FileText size={24} />} title="No Reports" />
          )}
        </section>

        <section className="datasets panel">
          <div className="panel-title">
            <Database size={18} />
            <h2>Nia Datasets</h2>
          </div>
          <button className="secondary-action" onClick={handleDatasetSearch} disabled={busy === "datasets"}>
            <Search size={17} />
            {busy === "datasets" ? "Searching" : "Search"}
          </button>
          <div className="list">
            {(datasetResults.length ? datasetResults : selectedReport?.dataset_candidates ?? []).map((dataset) => (
              <article className="list-row" key={dataset.id}>
                <div>
                  <h3>{dataset.title}</h3>
                  <p>{dataset.match_reason}</p>
                </div>
                <div className="row-meta">
                  <span>{dataset.source}</span>
                  <span>{dataset.license ?? "license pending"}</span>
                  {dataset.rows ? <span>{dataset.rows.toLocaleString()} rows</span> : null}
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="jobs panel">
          <div className="panel-title">
            <Activity size={18} />
            <h2>Jobs</h2>
          </div>
          <div className="list">
            {jobs.length ? (
              jobs.map((job) => <JobRow key={job.id} job={job} />)
            ) : (
              <EmptyState icon={<Activity size={24} />} title="No Jobs" />
            )}
          </div>
        </section>

        <section className="workers panel">
          <div className="panel-title">
            <Cpu size={18} />
            <h2>Workers</h2>
          </div>
          <div className="list">
            {workers.length ? (
              workers.map((worker) => <WorkerRow key={worker.id} worker={worker} />)
            ) : (
              <EmptyState icon={<Cpu size={24} />} title="No Workers" />
            )}
          </div>
        </section>

        <section className="events panel">
          <div className="panel-title">
            <Activity size={18} />
            <h2>Live Events</h2>
          </div>
          <div className="event-list">
            {events.length ? (
              events.map((event) => (
                <div className="event-row" key={event.id}>
                  <span>{event.kind}</span>
                  <p>{event.message}</p>
                </div>
              ))
            ) : (
              <EmptyState icon={<Activity size={24} />} title="Waiting" />
            )}
          </div>
        </section>
      </main>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function JobRow({ job }: { job: Job }) {
  const progress = Math.round((job.progress ?? (job.status === "completed" ? 1 : 0)) * 100);
  return (
    <article className="list-row job-row">
      <div className="row-heading">
        <h3>{job.training_report.goal}</h3>
        <StatusPill value={job.status} />
      </div>
      <div className="progress-track" aria-label={`${progress}% complete`}>
        <div style={{ width: `${progress}%` }} />
      </div>
      <div className="row-meta">
        <span>{job.training_report.base_model}</span>
        <span>Priority {job.priority}</span>
        <span>{progress}%</span>
        {job.adapter_uri ? (
          <span className="artifact">
            <Download size={14} />
            {job.adapter_uri}
          </span>
        ) : null}
      </div>
    </article>
  );
}

function WorkerRow({ worker }: { worker: Worker }) {
  const caps = worker.capabilities;
  return (
    <article className="list-row worker-row">
      <div className="row-heading">
        <h3>{worker.name}</h3>
        <StatusPill value={worker.status} />
      </div>
      <div className="row-meta">
        <span>{caps.gpu_name ?? "CPU"}</span>
        <span>{caps.vram_gb ? `${caps.vram_gb}GB VRAM` : "CPU fallback"}</span>
        <span>{Math.round(worker.reliability * 100)}% reliability</span>
      </div>
    </article>
  );
}

function StatusPill({ value }: { value: string }) {
  return <span className={`status-pill ${value}`}>{value}</span>;
}

function EmptyState({ icon, title }: { icon: ReactNode; title: string }) {
  return (
    <div className="empty-state">
      {icon}
      <span>{title}</span>
    </div>
  );
}

export default App;
