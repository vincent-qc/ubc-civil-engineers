import { useEffect, useState, useCallback, useRef } from "react";
import { checkHealth, getRecorderStatus, getPendingSafetyConfirmations } from "../shared/api-client";
import type { ConnectionState, RecorderStatus, SafetyConfirmation } from "../shared/types";
import { ConnectionStatus } from "./components/ConnectionStatus";
import { RecorderControls } from "./components/RecorderControls";
import { GregoryChat } from "./components/GregoryChat";
import { AddSkillFlow } from "./components/AddSkillFlow";
import { ActiveTaskPanel } from "./components/ActiveTaskPanel";
import { SafetyConfirmations } from "./components/SafetyConfirmations";

type Tab = "status" | "record" | "gregory" | "skills" | "tasks";

const POLL_MS = 3000;

export function App() {
  const [activeTab, setActiveTab] = useState<Tab>("status");
  const [connectionState, setConnectionState] = useState<ConnectionState>("connecting");
  const [recorderStatus, setRecorderStatus] = useState<RecorderStatus | null>(null);
  const [pendingSafety, setPendingSafety] = useState<SafetyConfirmation[]>([]);
  const [isPolling, setIsPolling] = useState(false);

  // Elapsed timer for recording state
  const [elapsed, setElapsed] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const poll = useCallback(async () => {
    if (isPolling) return;
    setIsPolling(true);
    try {
      const health = await checkHealth();
      setConnectionState(health.recorder_available ? "connected" : "recorder_unavailable");
      const rec = await getRecorderStatus();
      setRecorderStatus(rec);
      const safety = await getPendingSafetyConfirmations();
      setPendingSafety(safety);
    } catch {
      setConnectionState("backend_unavailable");
      setRecorderStatus(null);
    } finally {
      setIsPolling(false);
    }
  }, [isPolling]);

  useEffect(() => {
    poll();
    const id = setInterval(poll, POLL_MS);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Drive the elapsed timer from recorder start time
  useEffect(() => {
    if (timerRef.current) clearInterval(timerRef.current);

    if (recorderStatus?.state === "recording" && recorderStatus.started_at) {
      const start = new Date(recorderStatus.started_at).getTime();
      const tick = () => setElapsed(Math.floor((Date.now() - start) / 1000));
      tick();
      timerRef.current = setInterval(tick, 1000);
    } else if (recorderStatus?.state === "paused" && recorderStatus.started_at) {
      const start = new Date(recorderStatus.started_at).getTime();
      setElapsed(Math.floor((Date.now() - start) / 1000));
    } else {
      setElapsed(0);
    }

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [recorderStatus?.state, recorderStatus?.started_at]);

  useEffect(() => {
    function onMessage(msg: { type: string; payload?: Partial<{ connection_state: ConnectionState }> }) {
      if (msg.type === "STATUS_UPDATE" && msg.payload?.connection_state) {
        setConnectionState(msg.payload.connection_state);
      }
    }
    chrome.runtime.onMessage.addListener(onMessage);
    return () => chrome.runtime.onMessage.removeListener(onMessage);
  }, []);

  const hasPendingSafety = pendingSafety.length > 0;
  const recState = recorderStatus?.state ?? "idle";

  return (
    <div className="panel">
      {/* ---- Header ---- */}
      <div className="panel-header">
        <div className="panel-logo">
          <div className="panel-logo-mark">G</div>
          <div>
            <div className="panel-logo-name">Gregory</div>
            <div className="panel-logo-tag">v0.1 · alpha</div>
          </div>
        </div>

        <RecIndicator
          connectionState={connectionState}
          recState={recState}
          elapsed={elapsed}
        />
      </div>

      {/* ---- Safety banner ---- */}
      {hasPendingSafety && (
        <div className="safety-banner" onClick={() => setActiveTab("tasks")}>
          <div className="rec-dot" />
          {pendingSafety.length} confirmation{pendingSafety.length > 1 ? "s" : ""} require your approval
        </div>
      )}

      {/* ---- Tabs ---- */}
      <div className="tabs">
        {(["status", "record", "gregory", "skills", "tasks"] as Tab[]).map((id) => (
          <button
            key={id}
            className={`tab-btn${activeTab === id ? " active" : ""}`}
            onClick={() => setActiveTab(id)}
          >
            {id}
            {id === "record" && recState === "recording" && (
              <span className="badge">●</span>
            )}
            {id === "tasks" && hasPendingSafety && (
              <span className="badge">{pendingSafety.length}</span>
            )}
          </button>
        ))}
      </div>

      {/* ---- Content ---- */}
      <div className="panel-content">
        {activeTab === "status" && (
          <ConnectionStatus
            connectionState={connectionState}
            recorderStatus={recorderStatus}
            onRefresh={poll}
          />
        )}
        {activeTab === "record" && (
          <RecorderControls
            connectionState={connectionState}
            recorderStatus={recorderStatus}
            onStatusChange={setRecorderStatus}
          />
        )}
        {activeTab === "gregory" && (
          <GregoryChat connectionState={connectionState} />
        )}
        {activeTab === "skills" && (
          <AddSkillFlow connectionState={connectionState} />
        )}
        {activeTab === "tasks" && (
          <>
            {hasPendingSafety && (
              <SafetyConfirmations
                confirmations={pendingSafety}
                onResolved={() => getPendingSafetyConfirmations().then(setPendingSafety)}
              />
            )}
            <ActiveTaskPanel connectionState={connectionState} />
          </>
        )}
      </div>
    </div>
  );
}

// ---- Recording indicator (top-right header) ----

function formatElapsed(s: number): string {
  const m = Math.floor(s / 60).toString().padStart(2, "0");
  const sec = (s % 60).toString().padStart(2, "0");
  return `${m}:${sec}`;
}

function RecIndicator({
  connectionState,
  recState,
  elapsed,
}: {
  connectionState: ConnectionState;
  recState: string;
  elapsed: number;
}) {
  if (recState === "recording") {
    return (
      <div className="panel-rec-indicator recording">
        <div className="rec-dot pulse" />
        REC · {formatElapsed(elapsed)}
      </div>
    );
  }
  if (recState === "paused") {
    return (
      <div className="panel-rec-indicator paused">
        <div className="rec-dot" />
        PAUSED · {formatElapsed(elapsed)}
      </div>
    );
  }
  if (recState === "starting" || recState === "stopping") {
    return (
      <div className="panel-rec-indicator">
        <div className="rec-dot" style={{ opacity: 0.4 }} />
        {recState.toUpperCase()}
      </div>
    );
  }
  if (connectionState === "connected") {
    return (
      <div className="panel-rec-indicator connected">
        <div className="rec-dot" />
        LOCAL
      </div>
    );
  }
  if (connectionState === "connecting") {
    return (
      <div className="panel-rec-indicator">
        <div className="rec-dot pulse" style={{ background: "var(--amber)" }} />
        CONNECTING
      </div>
    );
  }
  return (
    <div className="panel-rec-indicator idle">
      <div className="rec-dot" />
      OFFLINE
    </div>
  );
}
