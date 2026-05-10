/* global chrome */

let recording = false;

function throttle(fn, wait) {
  let last = 0;
  let timeout = null;
  return function (...args) {
    const now = Date.now();
    const remaining = wait - (now - last);
    if (remaining <= 0) {
      if (timeout) {
        clearTimeout(timeout);
        timeout = null;
      }
      last = now;
      fn.apply(null, args);
    } else if (!timeout) {
      timeout = setTimeout(() => {
        last = Date.now();
        timeout = null;
        fn.apply(null, args);
      }, remaining);
    }
  };
}

chrome.storage.local.get({ recording: false }, (r) => {
  recording = Boolean(r.recording);
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && Object.prototype.hasOwnProperty.call(changes, "recording")) {
    recording = Boolean(changes.recording.newValue);
  }
});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === "SET_RECORDING") {
    recording = Boolean(msg.recording);
  }
});

function visibleTextSlice() {
  try {
    const t = document.body?.innerText || "";
    return t.slice(0, 6000);
  } catch {
    return "";
  }
}

function selectorFor(el) {
  if (!el || el.nodeType !== 1) return "node";
  if (el.id) return `#${CSS.escape(el.id)}`;
  const tag = el.tagName.toLowerCase();
  if (el.name) return `${tag}[name="${CSS.escape(el.name)}"]`;
  if (typeof el.className === "string" && el.className.trim()) {
    const parts = el.className.trim().split(/\s+/).filter(Boolean).slice(0, 2);
    if (parts.length) {
      return `${tag}${parts.map((c) => `.${CSS.escape(c)}`).join("")}`;
    }
  }
  return tag;
}

function domNodeFrom(el) {
  if (!el || el === document.body) {
    return { selector: "body", tag: "body", text: "", is_sensitive: false };
  }
  const tag = el.tagName.toLowerCase();
  const isSensitive =
    el.type === "password" ||
    /password|secret|token/i.test(el.autocomplete || "") ||
    /password/i.test(el.name || "") ||
    /password/i.test(el.id || "");
  let text = "";
  if (tag === "input" || tag === "textarea") {
    text = isSensitive ? "[redacted]" : (el.value || "").slice(0, 500);
  } else {
    text = (el.innerText || "").slice(0, 400);
  }
  return {
    selector: selectorFor(el),
    role: el.getAttribute("role"),
    name: el.getAttribute("aria-label") || el.name || null,
    text,
    tag,
    is_sensitive: Boolean(isSensitive)
  };
}

function buildObservation(targetEl, extraMeta) {
  const focused = document.activeElement;
  return {
    url: location.href,
    title: document.title,
    visible_text: visibleTextSlice(),
    focused_selector: focused ? selectorFor(focused) : null,
    dom_nodes: [domNodeFrom(targetEl || focused || document.body)],
    metadata: Object.assign({}, extraMeta || {})
  };
}

function sendInteraction(kind, targetEl, action, metadata) {
  if (!recording) return;
  const observation = buildObservation(targetEl, metadata);
  chrome.runtime.sendMessage({
    type: "EXTENSION_EVENT",
    event: {
      interaction_kind: kind,
      url: location.href,
      title: document.title,
      observation,
      action: action || null,
      metadata: metadata || {}
    }
  });
}

const onMouseMove = throttle((ev) => {
  sendInteraction(
    "cursor",
    ev.target,
    null,
    {
      clientX: ev.clientX,
      clientY: ev.clientY
    }
  );
}, 350);

const onScroll = throttle(() => {
  sendInteraction(
    "scroll",
    document.documentElement,
    null,
    {
      scrollX: window.scrollX,
      scrollY: window.scrollY
    }
  );
}, 250);

let inputTimer = null;
function onInput(ev) {
  if (!recording) return;
  const el = ev.target;
  clearTimeout(inputTimer);
  inputTimer = setTimeout(() => {
    sendInteraction("input", el, null, { phase: "input" });
  }, 400);
}

document.addEventListener(
  "click",
  (ev) => {
    if (!recording) return;
    sendInteraction("click", ev.target, null, { button: ev.button });
  },
  true
);

document.addEventListener(
  "focusin",
  (ev) => {
    if (!recording) return;
    sendInteraction("focus", ev.target, null, {});
  },
  true
);

document.addEventListener("input", onInput, true);
document.addEventListener("scroll", onScroll, true);
window.addEventListener("scroll", onScroll, true);
document.addEventListener("mousemove", onMouseMove, true);
