# Web Extension Criteria: Personal Browser-Use Agent

## Goal

Build a Chrome-based web extension that records one user's browser workflows as structured trajectories for training a personal browser-use agent.

The extension should observe real browser interactions, convert them into safe structured events, and send them to the local FastAPI backend.

---

## Core Requirements

### 1. Chrome Extension Architecture

Use Manifest V3.

The extension should include:

- Content script
- Background service worker
- Popup UI
- Shared event/types utilities

Recommended structure:

```txt
extension/
├─ manifest.json
├─ src/
│  ├─ content/
│  ├─ background/
│  ├─ popup/
│  └─ shared/
```

---

### 2. Content Script Responsibilities

The content script should run on configured pages and listen for user browser events.

It should record:

- Clicks
- Typing/input events
- Form changes
- Form submissions
- Scrolling
- Key presses
- Focus changes
- URL/page observations

The content script should not own long-term storage, training logic, or backend business logic.

---

### 3. Event Capture

Each captured event should include:

- `event_id`
- `trajectory_id`
- `user_id`, if available
- `timestamp`
- `actor`: `"user" | "agent" | "system"`
- `event_type`
- Current URL
- Page title
- Viewport dimensions
- Target element metadata
- Action payload
- Observation payload

For DOM targets, capture safe metadata such as:

- Tag name
- Element ID
- Classes
- Role
- `aria-label`
- `name` attribute
- Input type
- Safe visible text
- DOM path / selector
- Bounding box, if useful

---

### 4. Privacy and Redaction

The extension must avoid collecting sensitive values by default.

Do not record raw values from:

- Password fields
- Payment fields
- Credit card fields
- Security-code fields
- Hidden inputs
- Auth/token fields

For normal text inputs, prefer recording that input occurred rather than storing the full typed value unless explicitly enabled for local demos.

Sensitive actions should be flagged for confirmation.

Examples:

- Send email
- Submit form
- Delete item
- Purchase
- Share private data
- Change account settings

---

### 5. Messaging and Backend Sync

The content script should send normalized events to the background service worker.

The background service worker should:

- Receive content script events
- Buffer events
- Batch-send events to backend
- Retry failed local API calls
- Support offline/local-first demos where possible

Backend targets:

```txt
POST /api/trajectories/{trajectory_id}/events
POST /api/recordings/bulk
```

---

### 6. Popup UI

The popup should provide basic recording controls:

- Start recording
- Stop recording
- Pause/resume recording
- Show current recording state
- Show current user/profile
- Show current trajectory/task ID

Nice-to-have:

- Clear local buffer
- Force sync
- Show last sync status
- Toggle debug logging

---

### 7. Trajectory Support

The extension should support recording browser activity as part of a specific trajectory.

It should be able to attach events to:

- `user_id`
- `task_id`
- `trajectory_id`
- `session_id`

A trajectory should begin when the user starts a recording or onboarding task and end when the task is stopped, completed, or labeled.

---

### 8. Special Event Types

Support higher-level events in addition to DOM events:

- `ask_user`
- `user_answer`
- `control_returned`
- `success_state`

Example:

```json
{
  "actor": "user",
  "event_type": "control_returned",
  "timestamp": 1730000000000
}
```

---

### 9. Performance Requirements

The extension should not noticeably slow down normal browsing.

Use throttling or batching for noisy events:

- `scroll`
- `mousemove`
- `pointermove`
- `input`

Default recommendation:

- Do not record `mousemove` unless explicitly enabled
- Throttle scroll events
- Batch backend writes

---

### 10. Permissions

Use the narrowest possible permissions.

Prefer configured host permissions over `<all_urls>` when possible.

For early local demos, `<all_urls>` is acceptable only if clearly marked as demo/development mode.

---

## Acceptance Criteria

The extension is acceptable when:

- It loads successfully as a Chrome MV3 extension.
- The popup can start and stop a recording.
- The content script captures click, input, scroll, key, focus, and submit events.
- Events include safe DOM metadata and page context.
- Sensitive fields are redacted or skipped.
- Events are sent to the background service worker.
- Events are batched and sent to the FastAPI backend.
- Events are associated with the correct `user_id` and `trajectory_id`.
- The extension does not collect passwords, payment values, or hidden input values.
- The extension works on common websites and single-page apps.
- The extension does not break normal page behavior.

---

## Non-Goals for Version 1

Do not implement these in v1 unless already easy:

- Full session replay
- Screen recording
- Raw keystroke logging
- Universal Shadow DOM support
- Autonomous browser control
- Training inside the extension
- Complex auth flows

---

## Summary

The extension should act as the browser observation and recording layer.

It should safely capture user browser workflows, normalize them into trajectory events, and send them to the local backend for storage and later per-user policy training.
