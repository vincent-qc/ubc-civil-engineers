/**
 * MV3 service worker: tab sync (URL/title) + relays recording toggle and content-script events to the API.
 */

const DEFAULT_BACKEND = "http://127.0.0.1:8001";

async function getConfig() {
  const stored = await chrome.storage.local.get([
    "backendUrl",
    "userId",
    "trajectoryId",
    "recording",
    "extensionToken"
  ]);
  return {
    backendUrl: (stored.backendUrl || DEFAULT_BACKEND).replace(/\/$/, ""),
    userId: stored.userId || "",
    trajectoryId: stored.trajectoryId || "",
    recording: Boolean(stored.recording),
    extensionToken: stored.extensionToken || ""
  };
}

function ingestHeaders(cfg) {
  const headers = { "Content-Type": "application/json" };
  if (cfg.extensionToken) {
    headers["X-Extension-Token"] = cfg.extensionToken;
  }
  return headers;
}

async function postIngest(cfg, body) {
  const url = `${cfg.backendUrl}/api/extension/ingest`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: ingestHeaders(cfg),
      body: JSON.stringify(body),
      credentials: "omit"
    });
    if (!res.ok) {
      const t = await res.text();
      console.warn("[browser-agent] ingest failed", res.status, t);
    }
  } catch (e) {
    console.warn("[browser-agent] ingest error", e);
  }
}

async function reportTabChangeForTabId(tabId) {
  const cfg = await getConfig();
  try {
    const tab = await chrome.tabs.get(tabId);
    if (!tab.url) return;
    if (tab.url.startsWith("chrome://") || tab.url.startsWith("chrome-extension://")) return;
    await postIngest(cfg, {
      type: "tab_change",
      url: tab.url,
      title: tab.title || "",
      tab_id: tab.id,
      user_id: cfg.userId || null
    });
  } catch {
    // tab may have closed
  }
}

async function broadcastRecording(recording) {
  const cfg = await getConfig();
  await postIngest(cfg, {
    type: "recording_state",
    recording: recording,
    user_id: cfg.userId || null,
    trajectory_id: cfg.trajectoryId || null
  });

  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (!tab.id || !tab.url) continue;
    if (tab.url.startsWith("chrome://")) continue;
    chrome.tabs.sendMessage(tab.id, { type: "SET_RECORDING", recording: recording }).catch(() => {});
  }
}

chrome.tabs.onActivated.addListener((activeInfo) => {
  reportTabChangeForTabId(activeInfo.tabId);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, _tab) => {
  if (!(changeInfo.status === "complete" || changeInfo.url || changeInfo.title)) return;
  chrome.tabs.query({ active: true, currentWindow: true }).then((active) => {
    const cur = active[0];
    if (cur && cur.id === tabId) {
      reportTabChangeForTabId(tabId);
    }
  });
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.set({ backendUrl: DEFAULT_BACKEND, recording: false });
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "EXTENSION_EVENT") {
    getConfig().then(async (cfg) => {
      if (!cfg.recording) {
        sendResponse({ ok: false, skipped: true });
        return;
      }
      const body = {
        type: "interaction",
        user_id: cfg.userId,
        trajectory_id: cfg.trajectoryId || null,
        interaction_kind: message.event.interaction_kind,
        url: message.event.url,
        title: message.event.title,
        observation: message.event.observation,
        action: message.event.action ?? null,
        metadata: message.event.metadata || {}
      };
      await postIngest(cfg, body);
      sendResponse({ ok: true });
    });
    return true;
  }

  if (message?.type === "POPUP_SET_RECORDING") {
    broadcastRecording(Boolean(message.recording)).then(() => sendResponse({ ok: true }));
    return true;
  }

  if (message?.type === "REPORT_ACTIVE_TAB") {
    chrome.tabs.query({ active: true, currentWindow: true }).then((tabs) => {
      const t = tabs[0];
      if (t?.id) {
        reportTabChangeForTabId(t.id).then(() => sendResponse({ ok: true }));
      } else {
        sendResponse({ ok: false });
      }
    });
    return true;
  }

  return undefined;
});
