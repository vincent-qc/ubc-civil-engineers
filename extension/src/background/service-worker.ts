// ============================================================
// Background Service Worker — CUA Gregory Control Panel
//
// Responsibilities:
//   - Health polling (GET /api/health every 2 s while active)
//   - Recorder-status polling (GET /api/recorder/status)
//   - Badge text/color reflecting connection and recording state
//   - Opening the side panel when the toolbar icon is clicked
//   - Routing messages between popup ↔ sidepanel ↔ this worker
//   - Reading active tab metadata for recording context
//
// What this does NOT do:
//   - Capture DOM events (no content script in v1)
//   - Drive the recorder itself (Electron owns that)
//   - Store business logic (backend is source of truth)
// ============================================================

import { checkHealth, getRecorderStatus } from "../shared/api-client";
import type { ConnectionState, ExtensionLocalState, RecordingState } from "../shared/types";

// ----------------------------------------------------------------
// State
// ----------------------------------------------------------------

const state: ExtensionLocalState = {
  backend_url: "http://localhost:8000",
  connection_state: "connecting",
  last_health_check: null,
  recorder_status: null,
  pending_safety_count: 0,
};

// ----------------------------------------------------------------
// Badge helpers
// ----------------------------------------------------------------

function setBadge(connectionState: ConnectionState, recordingState: RecordingState): void {
  let text = "";
  let color = "#6b7280"; // gray — disconnected

  if (connectionState === "connected") {
    switch (recordingState) {
      case "recording":
        text = "REC";
        color = "#ef4444"; // red
        break;
      case "paused":
        text = "||";
        color = "#f59e0b"; // amber
        break;
      case "starting":
      case "stopping":
        text = "…";
        color = "#3b82f6"; // blue
        break;
      default:
        text = "";
        color = "#22c55e"; // green — connected, idle
    }
  } else if (connectionState === "connecting") {
    text = "…";
    color = "#3b82f6";
  }

  chrome.action.setBadgeText({ text });
  chrome.action.setBadgeBackgroundColor({ color });
}

// ----------------------------------------------------------------
// Health polling
// ----------------------------------------------------------------

async function pollHealth(): Promise<void> {
  try {
    const health = await checkHealth();
    state.last_health_check = Date.now();

    if (!health.recorder_available) {
      state.connection_state = "recorder_unavailable";
    } else {
      state.connection_state = "connected";
    }

    // TODO: Also poll GET /api/safety/pending here and update state.pending_safety_count.
    //       Then badge or notification can alert the user to pending confirmations.

    const recStatus = await getRecorderStatus();
    state.recorder_status = recStatus;

    setBadge(state.connection_state, recStatus.state);
    await persistState();
    broadcastStatusUpdate();
  } catch {
    state.connection_state = "backend_unavailable";
    state.recorder_status = null;
    setBadge("backend_unavailable", "idle");
    await persistState();
    broadcastStatusUpdate();
  }
}

// ----------------------------------------------------------------
// Chrome storage persistence
// ----------------------------------------------------------------

async function persistState(): Promise<void> {
  await chrome.storage.local.set(state);
}

async function loadState(): Promise<void> {
  const stored = await chrome.storage.local.get(null);
  if (stored.backend_url) state.backend_url = stored.backend_url as string;
  if (stored.connection_state) state.connection_state = stored.connection_state as ConnectionState;
}

// ----------------------------------------------------------------
// Messaging
// ----------------------------------------------------------------

function broadcastStatusUpdate(): void {
  // Notify all extension pages (sidepanel, popup) that state changed.
  chrome.runtime.sendMessage({
    type: "STATUS_UPDATE",
    payload: { ...state },
  }).catch(() => {
    // Ignore "no listeners" errors — pages may not be open.
  });
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  handleMessage(message).then(sendResponse).catch((err) => {
    console.error("[SW] Message error:", err);
    sendResponse({ error: String(err) });
  });
  return true; // keep channel open for async response
});

async function handleMessage(message: { type: string; payload?: unknown }): Promise<unknown> {
  switch (message.type) {
    case "GET_STATUS":
      return { ...state };

    case "OPEN_SIDE_PANEL": {
      // TODO: chrome.sidePanel.open requires a windowId in MV3.
      // Get the current window and open the panel.
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.windowId) {
        await (chrome.sidePanel as unknown as { open: (opts: { windowId: number }) => Promise<void> }).open({
          windowId: tab.windowId,
        });
      }
      return { ok: true };
    }

    case "START_RECORDING":
    case "STOP_RECORDING":
    case "TOGGLE_RECORDING":
      // Delegate to sidepanel or call the API client directly.
      // The sidepanel owns the recording UX; the popup just forwards commands here.
      // TODO: forward to sidepanel via chrome.runtime.sendMessage if it's open,
      //       otherwise call api-client directly.
      console.log("[SW] Recording command received:", message.type);
      return { ok: true };

    default:
      throw new Error(`Unknown message type: ${message.type}`);
  }
}

// ----------------------------------------------------------------
// Toolbar icon click — open side panel
// ----------------------------------------------------------------

chrome.action.onClicked.addListener(async (tab) => {
  if (tab.windowId) {
    await (chrome.sidePanel as unknown as { open: (opts: { windowId: number }) => Promise<void> }).open({
      windowId: tab.windowId,
    });
  }
});

// ----------------------------------------------------------------
// Periodic health poll
// ----------------------------------------------------------------

// Poll every 2 seconds while the service worker is alive.
// The SW may be suspended by Chrome; polling resumes on next wake.
const POLL_INTERVAL_MS = 2000;
let pollIntervalId: ReturnType<typeof setInterval> | null = null;

function startPolling(): void {
  if (pollIntervalId !== null) return;
  pollIntervalId = setInterval(() => {
    pollHealth().catch((e) => console.error("[SW] Poll error:", e));
  }, POLL_INTERVAL_MS);
}

// ----------------------------------------------------------------
// Init
// ----------------------------------------------------------------

chrome.runtime.onInstalled.addListener(() => {
  console.log("[SW] Extension installed / updated.");
  init();
});

chrome.runtime.onStartup.addListener(() => {
  console.log("[SW] Browser started.");
  init();
});

// Also run on first load of this module (covers dev reloads).
init();

async function init(): Promise<void> {
  await loadState();
  await pollHealth();
  startPolling();
}
