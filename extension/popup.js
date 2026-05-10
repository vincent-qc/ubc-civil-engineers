const $ = (id) => document.getElementById(id);

async function load() {
  const data = await chrome.storage.local.get({
    backendUrl: "http://127.0.0.1:8001",
    userId: "",
    trajectoryId: "",
    recording: false,
    extensionToken: ""
  });
  $("backendUrl").value = data.backendUrl;
  $("userId").value = data.userId;
  $("trajectoryId").value = data.trajectoryId;
  $("extensionToken").value = data.extensionToken;
  $("recording").checked = Boolean(data.recording);
  $("status").textContent = "Ready.";
}

async function save() {
  const backendUrl = $("backendUrl").value.trim().replace(/\/$/, "") || "http://127.0.0.1:8001";
  const userId = $("userId").value.trim();
  const trajectoryId = $("trajectoryId").value.trim();
  const recording = $("recording").checked;
  const extensionToken = $("extensionToken").value.trim();

  await chrome.storage.local.set({
    backendUrl,
    userId,
    trajectoryId,
    recording,
    extensionToken
  });

  chrome.runtime.sendMessage({
    type: "POPUP_SET_RECORDING",
    recording: recording
  });

  $("status").textContent = "Saved.";
  setTimeout(() => {
    $("status").textContent = "Ready.";
  }, 1500);
}

$("save").addEventListener("click", () => {
  save();
});

$("recording").addEventListener("change", () => {
  save();
});

$("syncTab").addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "REPORT_ACTIVE_TAB" }, () => {
    $("status").textContent = "Active tab sent to backend.";
    setTimeout(load, 500);
  });
});

load().then(() => {
  chrome.runtime.sendMessage({ type: "REPORT_ACTIVE_TAB" });
});
