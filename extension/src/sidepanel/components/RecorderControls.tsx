import { useState } from "react";
import {
  startRecording,
  pauseRecording,
  resumeRecording,
  stopRecording,
} from "../../shared/api-client";
import type { ConnectionState, RecorderStatus } from "../../shared/types";

const STUB_USER_ID = "user_placeholder";

export function RecorderControls({
  connectionState,
  recorderStatus,
  onStatusChange,
}: {
  connectionState: ConnectionState;
  recorderStatus: RecorderStatus | null;
  onStatusChange: (s: RecorderStatus) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const isConnected = connectionState === "connected";
  const state = recorderStatus?.state ?? "idle";

  async function handleStart() {
    setError(null);
    setLoading(true);
    try {
      // TODO: Get active tab context via chrome.tabs.query({ active: true, currentWindow: true })
      //       and pass it as `context` in the request body.
      // TODO: Wire skill_id and task_id from a skill/task selector.
      const res = await startRecording({ source: "extension", user_id: STUB_USER_ID });
      onStatusChange({
        state: res.recording_state,
        session_id: res.session_id,
        trajectory_id: res.trajectory_id,
        skill_id: null,
        task_id: null,
        started_at: new Date().toISOString(),
        paused_at: null,
      });
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  async function handlePause() {
    setError(null);
    setLoading(true);
    try {
      await pauseRecording();
      onStatusChange({ ...recorderStatus!, state: "paused", paused_at: new Date().toISOString() });
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  async function handleResume() {
    setError(null);
    setLoading(true);
    try {
      await resumeRecording();
      onStatusChange({ ...recorderStatus!, state: "recording", paused_at: null });
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  async function handleStop() {
    setError(null);
    setLoading(true);
    try {
      await stopRecording();
      onStatusChange({ state: "idle", session_id: null, trajectory_id: null, skill_id: null, task_id: null, started_at: null, paused_at: null });
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  const isIdle      = state === "idle" || state === "error";
  const isRecording = state === "recording";
  const isPaused    = state === "paused";

  return (
    <div>
      <div className="section">
        <div className="section-label">Recording</div>

        <div className={`rec-state-pill ${state}`}>
          {isRecording && <span style={{ fontSize: 8 }}>●</span>}
          {state.toUpperCase()}
        </div>

        {recorderStatus?.session_id && (
          <div className="data-row">
            <div className="data-key">session</div>
            <div className="data-val">{recorderStatus.session_id}</div>
          </div>
        )}
        {recorderStatus?.trajectory_id && (
          <div className="data-row">
            <div className="data-key">trajectory</div>
            <div className="data-val">{recorderStatus.trajectory_id}</div>
          </div>
        )}

        {/* TODO: Add skill / task selectors here — call listSkills() and render
                  a <select> so the user can pick context before starting a recording. */}

        {!isConnected && (
          <p className="muted" style={{ fontSize: 11, marginTop: 8, lineHeight: 1.6 }}>
            Connect to the backend to control recording.
          </p>
        )}

        <div className="btn-row">
          {isIdle && (
            <button className="btn btn-primary" disabled={!isConnected || loading} onClick={handleStart}>
              {loading ? "…" : "▶  start"}
            </button>
          )}
          {isRecording && (
            <>
              <button className="btn btn-warning" disabled={loading} onClick={handlePause}>
                {loading ? "…" : "⏸  pause"}
              </button>
              <button className="btn btn-danger" disabled={loading} onClick={handleStop}>
                {loading ? "…" : "■  stop"}
              </button>
            </>
          )}
          {isPaused && (
            <>
              <button className="btn btn-primary" disabled={loading} onClick={handleResume}>
                {loading ? "…" : "▶  resume"}
              </button>
              <button className="btn btn-danger" disabled={loading} onClick={handleStop}>
                {loading ? "…" : "■  stop"}
              </button>
            </>
          )}
        </div>

        {error && <div className="error-msg">{error}</div>}
      </div>
    </div>
  );
}
