import { useState, useEffect } from "react";
import { getActiveTask, startTask, completeTask, failTask } from "../../shared/api-client";
import type { ConnectionState, Task } from "../../shared/types";

export function ActiveTaskPanel({ connectionState }: { connectionState: ConnectionState }) {
  const [task, setTask] = useState<Task | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isConnected = connectionState === "connected";

  useEffect(() => {
    if (!isConnected) return;
    let cancelled = false;

    async function fetch() {
      try {
        const t = await getActiveTask();
        if (!cancelled) setTask(t);
      } catch { /* ignore */ }
    }

    fetch();
    const id = setInterval(fetch, 3000);
    return () => { cancelled = true; clearInterval(id); };
  }, [isConnected]);

  async function handle(action: "start" | "complete" | "fail") {
    if (!task) return;
    setError(null);
    setLoading(true);
    try {
      if (action === "start")    await startTask(task.id);
      if (action === "complete") await completeTask(task.id);
      if (action === "fail")     await failTask(task.id);
      setTask(await getActiveTask());
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="section">
      <div className="section-label">Active Task</div>

      {!isConnected && (
        <div className="disconnected-notice">
          <span style={{ color: "var(--text-3)" }}>◌</span>
          Connect to the backend to see the active task.
        </div>
      )}

      {isConnected && !task && (
        <div className="empty-state">No active task.</div>
      )}

      {task && (
        <div>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8, marginBottom: 8 }}>
            <div className="task-title">{task.title}</div>
            <span className={`risk-badge ${task.risk_level}`}>{task.risk_level}</span>
          </div>

          <p className="task-prompt">{task.prompt}</p>

          {task.success_hint && (
            <p style={{ fontSize: 11, color: "var(--text-3)", lineHeight: 1.6, marginBottom: 8 }}>
              ✓ {task.success_hint}
            </p>
          )}

          {task.current_step && (
            <div className="task-step">
              step {task.step_number ?? "?"}/{task.step_count ?? "?"} — {task.current_step}
            </div>
          )}

          <div className="data-row" style={{ marginBottom: 0 }}>
            <div className="data-key">status</div>
            <div className="data-val">{task.status}</div>
          </div>
          {task.skill_id && (
            <div className="data-row">
              <div className="data-key">skill</div>
              <div className="data-val">{task.skill_id}</div>
            </div>
          )}

          <div className="btn-row">
            {task.status === "pending" && (
              <button className="btn btn-primary" onClick={() => handle("start")} disabled={loading}>
                {loading ? "…" : "▶  start task"}
              </button>
            )}
            {task.status === "active" && (
              <>
                <button className="btn btn-primary" onClick={() => handle("complete")} disabled={loading}>
                  {loading ? "…" : "✓  complete"}
                </button>
                <button className="btn btn-danger" onClick={() => handle("fail")} disabled={loading}>
                  {loading ? "…" : "✗  fail"}
                </button>
              </>
            )}
          </div>

          {error && <div className="error-msg">{error}</div>}
        </div>
      )}
    </div>
  );
}
