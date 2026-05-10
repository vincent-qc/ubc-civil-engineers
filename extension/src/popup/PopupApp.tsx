import { useState, useEffect } from "react";
import type { ConnectionState, ExtensionLocalState, RecordingState } from "../shared/types";

const GREEN  = "#157a50";
const RED    = "#b02e2e";
const AMBER  = "#8f5c12";
const BG     = "#f7f7f4";
const BG1    = "#ffffff";
const BORDER = "rgba(0,0,0,0.08)";
const TEXT   = "#111110";
const MUTED  = "#9a9a92";

const STATE_COLOR: Record<ConnectionState, string> = {
  connected:            GREEN,
  connecting:           AMBER,
  disconnected:         RED,
  backend_unavailable:  RED,
  recorder_unavailable: AMBER,
};

const STATE_LABEL: Record<ConnectionState, string> = {
  connected:            "connected",
  connecting:           "connecting",
  disconnected:         "disconnected",
  backend_unavailable:  "backend unavailable",
  recorder_unavailable: "recorder unavailable",
};

export function PopupApp() {
  const [connectionState, setConnectionState] = useState<ConnectionState>("connecting");
  const [recordingState, setRecordingState] = useState<RecordingState>("idle");
  const [pendingSafety, setPendingSafety] = useState(0);
  const [actionLoading, setActionLoading] = useState(false);

  useEffect(() => {
    chrome.runtime.sendMessage({ type: "GET_STATUS" }, (res: Partial<ExtensionLocalState>) => {
      if (!res) return;
      if (res.connection_state) setConnectionState(res.connection_state);
      if (res.recorder_status?.state) setRecordingState(res.recorder_status.state);
      if (res.pending_safety_count !== undefined) setPendingSafety(res.pending_safety_count);
    });

    function onMessage(msg: { type: string; payload?: Partial<ExtensionLocalState> }) {
      if (msg.type === "STATUS_UPDATE" && msg.payload) {
        if (msg.payload.connection_state) setConnectionState(msg.payload.connection_state);
        if (msg.payload.recorder_status?.state) setRecordingState(msg.payload.recorder_status.state);
        if (msg.payload.pending_safety_count !== undefined)
          setPendingSafety(msg.payload.pending_safety_count);
      }
    }
    chrome.runtime.onMessage.addListener(onMessage);
    return () => chrome.runtime.onMessage.removeListener(onMessage);
  }, []);

  function openSidePanel() {
    chrome.runtime.sendMessage({ type: "OPEN_SIDE_PANEL" });
    window.close();
  }

  function toggleRecording() {
    setActionLoading(true);
    const type = recordingState === "recording" ? "STOP_RECORDING" : "START_RECORDING";
    chrome.runtime.sendMessage({ type }, () => setActionLoading(false));
  }

  const isRecording = recordingState === "recording";
  const isConnected = connectionState === "connected";
  const dotColor    = STATE_COLOR[connectionState];

  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      {/* Safety banner */}
      {pendingSafety > 0 && (
        <button
          onClick={openSidePanel}
          style={{
            background: "rgba(176,46,46,0.07)",
            border: "none",
            borderBottom: "1px solid rgba(176,46,46,0.14)",
            color: RED,
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 9,
            letterSpacing: "0.08em",
            padding: "8px 14px",
            textAlign: "left",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          <span style={{ width: 5, height: 5, borderRadius: "50%", background: RED, flexShrink: 0, display: "inline-block" }} />
          {pendingSafety} CONFIRMATION{pendingSafety > 1 ? "S" : ""} PENDING
        </button>
      )}

      {/* Main content */}
      <div style={{ padding: "14px 14px 12px" }}>
        {/* Logo + status row */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{
              width: 22, height: 22, borderRadius: 5,
              border: `1.5px solid ${GREEN}`,
              display: "flex", alignItems: "center", justifyContent: "center",
              fontFamily: "'Bricolage Grotesque', system-ui",
              fontWeight: 800, fontSize: 12, color: GREEN,
            }}>
              G
            </div>
            <span style={{ fontFamily: "'Bricolage Grotesque', system-ui", fontWeight: 700, fontSize: 13, letterSpacing: "-0.3px" }}>
              Gregory
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <span style={{
              width: 6, height: 6, borderRadius: "50%",
              background: dotColor, flexShrink: 0, display: "inline-block",
            }} />
            <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9, color: MUTED, letterSpacing: "0.06em" }}>
              {STATE_LABEL[connectionState]}
            </span>
          </div>
        </div>

        {/* Open side panel */}
        <button
          onClick={openSidePanel}
          style={{
            display: "flex",
            width: "100%",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "9px 12px",
            marginBottom: 8,
            background: GREEN,
            color: "#fff",
            border: "none",
            borderRadius: 4,
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 10,
            fontWeight: 500,
            letterSpacing: "0.06em",
            cursor: "pointer",
          }}
        >
          open gregory
          <span style={{ opacity: 0.7 }}>→</span>
        </button>

        {/* Quick recording toggle */}
        <button
          onClick={toggleRecording}
          disabled={!isConnected || actionLoading}
          style={{
            display: "flex",
            width: "100%",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "8px 12px",
            background: isRecording ? "rgba(194,53,53,0.10)" : BG1,
            color: isRecording ? RED : MUTED,
            border: `1px solid ${isRecording ? "rgba(194,53,53,0.25)" : BORDER}`,
            borderRadius: 4,
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 10,
            fontWeight: 500,
            letterSpacing: "0.06em",
            cursor: isConnected ? "pointer" : "not-allowed",
            opacity: isConnected ? 1 : 0.4,
          }}
        >
          {actionLoading ? "…" : isRecording ? "■  stop recording" : "▶  start recording"}
          {isRecording && (
            <span style={{ width: 5, height: 5, borderRadius: "50%", background: RED, display: "inline-block", animation: "pulse 1.1s ease-in-out infinite" }} />
          )}
        </button>

        {/* Offline hint */}
        {!isConnected && (
          <p style={{ marginTop: 10, fontFamily: "'JetBrains Mono', monospace", fontSize: 9, color: MUTED, letterSpacing: "0.05em", lineHeight: 1.7 }}>
            Start the Electron app to connect.
          </p>
        )}
      </div>

      {/* Footer */}
      <div style={{ borderTop: `1px solid ${BORDER}`, padding: "7px 14px", display: "flex", justifyContent: "space-between" }}>
        <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9, color: MUTED, letterSpacing: "0.04em" }}>
          v0.1 · alpha
        </span>
        <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9, color: MUTED, letterSpacing: "0.04em" }}>
          local
        </span>
      </div>

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.2; }
        }
      `}</style>
    </div>
  );
}
