import type { ConnectionState, RecorderStatus } from "../../shared/types";

const STATUS_MSG: Record<ConnectionState, string> = {
  connected:            "Backend reachable.",
  connecting:           "Connecting to local backend…",
  disconnected:         "Disconnected.",
  backend_unavailable:  "Local backend not reachable. Start the Electron app to use Gregory and recording controls.",
  recorder_unavailable: "Backend is running but the Electron recorder is unavailable. Open the desktop app to enable recording.",
};

export function ConnectionStatus({
  connectionState,
  recorderStatus,
  onRefresh,
}: {
  connectionState: ConnectionState;
  recorderStatus: RecorderStatus | null;
  onRefresh: () => void;
}) {
  const isOk = connectionState === "connected";

  return (
    <div>
      {/* Connection */}
      <div className="section">
        <div className="section-label">Backend</div>

        <div className="conn-status-row">
          <div className="conn-label">status</div>
          <div className="conn-value" style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span className={`status-dot ${connectionState}`} />
            <span className="mono" style={{ fontSize: 10, color: "var(--text-2)" }}>
              {connectionState.replace("_", " ")}
            </span>
          </div>
        </div>

        {!isOk && (
          <p style={{ fontSize: 11, color: "var(--text-2)", lineHeight: 1.6, marginTop: 10 }}>
            {STATUS_MSG[connectionState]}
          </p>
        )}

        <div className="btn-row">
          <button className="btn btn-ghost" onClick={onRefresh} style={{ fontSize: 9 }}>
            ↻ refresh
          </button>
        </div>
      </div>

      {/* Recorder */}
      {recorderStatus && (
        <div className="section">
          <div className="section-label">Recorder</div>
          <DataRow k="state"       v={recorderStatus.state} highlight={recorderStatus.state === "recording"} />
          <DataRow k="session"     v={recorderStatus.session_id ?? "—"} />
          <DataRow k="trajectory"  v={recorderStatus.trajectory_id ?? "—"} />
          <DataRow k="skill"       v={recorderStatus.skill_id ?? "—"} />
          <DataRow k="task"        v={recorderStatus.task_id ?? "—"} />
          {recorderStatus.started_at && (
            <DataRow k="started" v={new Date(recorderStatus.started_at).toLocaleTimeString()} />
          )}
        </div>
      )}

      {/* TODO: Add model / training status section here.
               Import getModelStatus() and listTrainingJobs() from api-client,
               fetch them on mount, and render a similar DataRow list. */}
    </div>
  );
}

function DataRow({ k, v, highlight }: { k: string; v: string; highlight?: boolean }) {
  return (
    <div className="data-row">
      <div className="data-key">{k}</div>
      <div className="data-val" style={highlight ? { color: "var(--red)" } : undefined}>{v}</div>
    </div>
  );
}
