# Extension Frontend Client Criteria

## One-Line Goal

Build a Chrome extension whose primary role is to provide an extension viewport version of the existing app UI. The extension is another frontend client that talks to the same local backend as the Electron app and web app.

The extension should **not** implement computer-use recording, CUA orchestration, Gregory logic, trajectory persistence, model training, or backend business logic. It should provide a browser-native UI surface that lets users access the same core workflows without keeping the web app open in a browser tab.

---

## Product Context

The product is a personal computer-use-agent learning system.

The main system includes:

- An Electron CUA harness that runs the computer-use model.
- A local FastAPI backend that manages sessions, skills, trajectories, training jobs, and model state.
- Gregory, a chatbot that helps the user add or improve skills.
- A web/Electron UI where users can start recordings, add skills, answer Gregory’s questions, review tasks, and approve safety-sensitive actions.
- A training pipeline that turns labeled trajectories into immediate skill summaries and later SFT/LoRA training data.

The Chrome extension should become an additional UI surface for the same system.

---

## Desired Extension Role

The extension should function as:

> A lightweight browser-side frontend client for Gregory, skill-building, recording controls, active task state, and safety confirmations.

It should communicate with the same local backend used by the Electron app.

Recommended architecture:

```txt
Chrome extension side panel / popup
        ↓
Same API client used by app
        ↓
Local FastAPI backend
        ↓
Electron CUA harness / recorder / training system
```

The extension is not responsible for privileged recording itself. Electron and the local backend own that.

---

## Primary UX Goal

The user should be able to interact with the system from inside Chrome without opening the web app tab.

From the extension viewport, the user should be able to:

- See backend connection status.
- See whether a recording session is active.
- Start, stop, pause, and resume recording.
- Start an “Add Skill” flow.
- Chat with Gregory.
- See the current active task or generated practice step.
- Answer Gregory’s questions.
- Approve or reject safety-sensitive actions.
- See basic model/skill/training status where relevant.

---

## Recommended UI Surface

Use the Chrome **side panel** as the main extension viewport.

Reasoning:

- A popup closes when the user clicks away.
- Gregory chat and recording workflows are long-running.
- A side panel can stay open alongside the active browser tab.
- The side panel better matches the “same app UI, but inside Chrome” goal.

The popup can still exist as a minimal launcher.

Suggested split:

```txt
Side panel:
- Main Gregory interface
- Add Skill flow
- Active task view
- Recording controls
- Safety confirmations
- Backend connection state

Popup:
- Open side panel
- Quick start/stop recording toggle
- Backend connected/disconnected badge
```

---

## Non-Goals

The extension should not implement:

- Full-screen recording.
- Global cursor/click/keyboard telemetry.
- OS-level permissions.
- Computer-use-agent orchestration.
- Gregory reasoning or task generation logic.
- Training queue management.
- PyTorch/LoRA/SFT logic.
- Trajectory database logic.
- A separate skill system.
- A separate user profile system.
- A duplicate backend.

All of the above should remain in Electron, FastAPI, or the training stack.

---

## Core Architecture

Recommended monorepo layout:

```txt
repo/
├─ apps/
│  ├─ electron/
│  │  └─ Electron CUA harness and desktop UI
│  ├─ web/
│  │  └─ Next.js web dashboard
│  └─ extension/
│     ├─ manifest.json
│     ├─ src/
│     │  ├─ background/
│     │  │  └─ service-worker.ts
│     │  ├─ sidepanel/
│     │  │  ├─ sidepanel.html
│     │  │  └─ sidepanel.tsx
│     │  ├─ popup/
│     │  │  ├─ popup.html
│     │  │  └─ popup.tsx
│     │  └─ shared/
│     │     └─ extension-state.ts
│     └─ package.json
│
├─ packages/
│  ├─ ui/
│  │  ├─ GregoryChat.tsx
│  │  ├─ AddSkillFlow.tsx
│  │  ├─ RecorderControls.tsx
│  │  ├─ ActiveTaskPanel.tsx
│  │  ├─ SafetyConfirmation.tsx
│  │  └─ StatusBadge.tsx
│  ├─ api-client/
│  │  └─ client.ts
│  └─ shared/
│     ├─ types.ts
│     └─ constants.ts
│
└─ backend/
   └─ FastAPI app, storage, training, recorder APIs
```

The extension should reuse shared UI and API packages where possible.

Target principle:

```txt
Same components.
Same API client.
Same backend state.
Different shell.
```

---

## Extension Responsibilities

The extension should own only the Chrome-specific shell behavior:

- Render the app-like UI inside the side panel.
- Render a small popup launcher.
- Call the local backend API.
- Store minimal local extension state if needed.
- Show backend connectivity status.
- Optionally read active tab metadata for context.
- Optionally pass current tab URL/title to backend when starting a skill or recording.

The extension may include a background service worker for:

- Keeping extension-level state.
- Routing popup and side panel messages.
- Checking local backend health.
- Managing badge text/color.
- Opening the side panel.
- Reading active tab metadata.

The extension does not need a content script for v1 unless active-page DOM instrumentation is later required.

---

## Backend Responsibilities

The local backend remains the source of truth.

The backend should own:

- Current user/session state.
- Recording state.
- Active trajectory ID.
- Active skill ID.
- Active task ID.
- Gregory chat state.
- Skill creation flow.
- Agent questions.
- User answers.
- Safety confirmation requests.
- Training job queue.
- Model and adapter status.

The extension should query and mutate this state through existing or new API endpoints.

---

## Electron Responsibilities

Electron remains responsible for privileged local capabilities:

- Running the CUA harness.
- Starting/stopping full-computer recording.
- Capturing screenshots or screen frames.
- Capturing global cursor/click/keyboard telemetry where allowed.
- Running or coordinating the computer-use model.
- Executing agent actions.
- Handling takeover/return-control flows.
- Communicating recording events to the backend.

The extension can request recording actions, but Electron/backend executes them.

---

## Suggested API Contract

The extension should use a local backend URL, typically:

```txt
http://localhost:8000
```

This should be configurable through environment/build config or extension settings.

### Health and Status

```http
GET /api/health
GET /api/recorder/status
GET /api/session/current
```

Expected use:

- Detect whether the backend is running.
- Show connected/disconnected status.
- Fetch current session, trajectory, skill, task, and recording state.

### Recording Controls

```http
POST /api/recorder/start
POST /api/recorder/pause
POST /api/recorder/resume
POST /api/recorder/stop
```

Example request:

```json
{
  "source": "extension",
  "user_id": "user_123",
  "skill_id": "skill_456",
  "task_id": "task_789",
  "context": {
    "active_tab_url": "https://mail.google.com/",
    "active_tab_title": "Inbox"
  }
}
```

Example response:

```json
{
  "ok": true,
  "session_id": "session_abc",
  "trajectory_id": "traj_def",
  "recording_state": "recording"
}
```

### Gregory Chat

```http
POST /api/gregory/messages
GET /api/gregory/conversations/current
```

Example request:

```json
{
  "source": "extension",
  "conversation_id": "conv_123",
  "message": "I want the agent to get better at triaging my email."
}
```

### Skills

```http
POST /api/skills
GET /api/skills
GET /api/skills/{skill_id}
POST /api/skills/{skill_id}/activate
```

### Tasks

```http
GET /api/tasks/active
POST /api/tasks/{task_id}/start
POST /api/tasks/{task_id}/complete
POST /api/tasks/{task_id}/fail
```

### User Answers and Clarifications

```http
POST /api/user-answers
```

Example:

```json
{
  "source": "extension",
  "session_id": "session_abc",
  "trajectory_id": "traj_def",
  "question_id": "question_123",
  "answer": "Search all mail, not just the inbox."
}
```

### Safety Confirmations

```http
GET /api/safety/pending
POST /api/safety/{confirmation_id}/approve
POST /api/safety/{confirmation_id}/reject
```

### Training and Model Status

```http
GET /api/training/jobs
GET /api/model/status
GET /api/skills/{skill_id}/training-status
```

---

## UI Requirements

### 1. Connection State

The side panel should clearly show whether the local backend is available.

States:

- Connected.
- Connecting.
- Disconnected.
- Backend unavailable.
- Electron recorder unavailable.

When disconnected, show a useful message such as:

```txt
Local backend not reachable. Start the Electron app to use Gregory and recording controls.
```

### 2. Recording Controls

The extension UI should show:

- Current recording state.
- Current session ID or friendly session name.
- Current skill/task context if available.
- Start recording button.
- Pause/resume button.
- Stop recording button.

Recording states:

```txt
idle
starting
recording
paused
stopping
error
```

### 3. Add Skill Flow

The extension should let the user start the same Add Skill flow available in the web/Electron app.

Minimum flow:

1. User clicks “Add Skill.”
2. User describes what they want the CUA model to learn.
3. Gregory asks clarifying questions.
4. Gregory generates practice tasks or demonstrations.
5. User starts a task/recording from the panel.

### 4. Gregory Chat

The side panel should support a compact Gregory chat experience:

- Display conversation messages.
- Let user send messages.
- Show generated tasks/questions.
- Show loading/error states.
- Support continuing the current conversation from another app surface.

### 5. Active Task View

The side panel should show:

- Current task title.
- Task instructions.
- Current step, if applicable.
- Success/failure controls.
- Start/complete/fail task buttons.

### 6. Safety Confirmations

When the backend/agent requires confirmation, the extension side panel should display the pending confirmation.

Examples:

- Send email.
- Delete item.
- Submit form.
- Make purchase.
- Share private data.
- Change account settings.

The user should be able to approve or reject from the extension viewport.

### 7. Minimal Popup

The popup should be small and optional.

It should include:

- Backend status.
- Open side panel button.
- Quick start/stop recording button if safe.

Do not put the full Gregory UI in the popup.

---

## Active Tab Context

When the user starts a recording, skill task, or Gregory flow from the extension, the extension should optionally include active tab context:

```json
{
  "active_tab": {
    "url": "https://example.com/path",
    "title": "Page Title",
    "tab_id": 123,
    "window_id": 456
  }
}
```

This is not required for the extension to be useful, but it helps Gregory understand the user’s current browser context.

The extension should not scrape page DOM in v1 unless explicitly requested later.

---

## Permissions

Use the narrowest reasonable permissions for v1.

Recommended permissions:

```json
{
  "permissions": [
    "storage",
    "sidePanel",
    "tabs"
  ],
  "host_permissions": [
    "http://localhost:8000/*",
    "http://127.0.0.1:8000/*"
  ]
}
```

If active tab metadata only needs to be read after user action, consider `activeTab` instead of broad `tabs`, depending on implementation.

Avoid `<all_urls>` unless content scripts or broad page instrumentation become necessary.

---

## Manifest Requirements

Use Manifest V3.

The extension should include:

- A background service worker.
- A side panel page.
- A popup page if desired.
- Host permissions for the local backend.

Example skeleton:

```json
{
  "manifest_version": 3,
  "name": "CUA Gregory Control Panel",
  "version": "0.1.0",
  "permissions": [
    "storage",
    "sidePanel",
    "tabs"
  ],
  "host_permissions": [
    "http://localhost:8000/*",
    "http://127.0.0.1:8000/*"
  ],
  "background": {
    "service_worker": "background/service-worker.js",
    "type": "module"
  },
  "side_panel": {
    "default_path": "sidepanel/sidepanel.html"
  },
  "action": {
    "default_popup": "popup/popup.html"
  }
}
```

---

## Backend CORS Requirements

The FastAPI backend must allow requests from the extension origin.

Chrome extension origins look like:

```txt
chrome-extension://<extension-id>
```

For local development, support either:

- A configured extension ID in `.env`.
- A development mode CORS allowlist.
- Explicit local dev CORS handling.

Do not rely on unrestricted CORS in production.

---

## Shared UI Guidance

Prefer shared UI components instead of rebuilding extension-only screens.

Use shared components such as:

```txt
packages/ui/GregoryChat.tsx
packages/ui/AddSkillFlow.tsx
packages/ui/RecorderControls.tsx
packages/ui/ActiveTaskPanel.tsx
packages/ui/SafetyConfirmation.tsx
packages/ui/StatusBadge.tsx
```

The extension should import these components and render them in its side panel.

If the existing web UI is currently tightly coupled to Next.js routing/server features, refactor reusable pieces into a framework-light package.

Recommended pattern:

```txt
packages/ui = pure React components
packages/api-client = fetch client and typed API helpers
apps/web = Next.js shell
apps/electron = Electron shell
apps/extension = Chrome extension shell
```

---

## State Management

The backend should be the source of truth.

The extension should not maintain independent long-lived business state beyond:

- Cached backend URL.
- Last known connection status.
- Current selected user/profile ID if necessary.
- UI preferences.
- Temporary optimistic UI state.

For session/task/recording state, prefer polling or subscription from backend.

Suggested v1 approach:

- Poll `/api/session/current` or `/api/recorder/status` every 1–3 seconds while the side panel is open.
- Immediately refetch after mutations.

Suggested later approach:

- WebSocket or Server-Sent Events for live backend state updates.

---

## Error Handling

The extension should handle these cases gracefully:

- Backend is not running.
- Electron app is not running.
- Backend is running but recorder is unavailable.
- Recording start fails.
- Gregory request fails.
- Safety confirmation request expires.
- Network request times out.
- User has no active session.
- User has no selected profile.

User-facing errors should be clear and actionable.

Example:

```txt
Could not start recording because the Electron recorder is unavailable. Open the desktop app and try again.
```

---

## Security and Safety

The extension should not expose privileged local controls to arbitrary websites.

Do not use `externally_connectable` unless there is a specific need for the web app tab to initiate extension actions.

Do not allow arbitrary origins to command the extension.

Do not store sensitive tokens in plain extension storage unless unavoidable.

For local demo mode, keep auth simple but make the trust boundary explicit:

```txt
The extension is allowed to control the local CUA backend only when the user has installed the extension and is running the local Electron/FastAPI app.
```

Safety-sensitive actions must still require explicit user approval through the backend safety system.

---

## Build Requirements

The extension should be buildable independently.

Recommended stack:

- TypeScript.
- React.
- Vite or equivalent extension-friendly bundler.
- Manifest V3.
- Shared packages for UI, API client, and types.

Build output should look like:

```txt
dist/
├─ manifest.json
├─ background/
│  └─ service-worker.js
├─ sidepanel/
│  ├─ sidepanel.html
│  └─ sidepanel.js
├─ popup/
│  ├─ popup.html
│  └─ popup.js
└─ assets/
```

---

## Acceptance Criteria

The extension is acceptable when:

1. It loads as a Chrome Manifest V3 extension.
2. It provides a side panel UI.
3. The side panel can connect to the local FastAPI backend.
4. The side panel shows connected/disconnected backend state.
5. The side panel can start, pause, resume, and stop recording through backend API calls.
6. Recording state stays consistent with the Electron/web app because all clients read from the same backend state.
7. The side panel can start or continue the Add Skill flow.
8. The side panel can send and receive Gregory chat messages.
9. The side panel can display active tasks and allow the user to start/complete/fail tasks.
10. The side panel can display pending safety confirmations and approve/reject them.
11. The extension does not duplicate backend business logic.
12. The extension does not implement OS-level recording.
13. The extension does not require the web app to be open in a Chrome tab.
14. The extension handles backend unavailable states gracefully.
15. The popup, if included, is only a launcher or quick-control surface.

---

## Nice-To-Have Criteria

These are useful but not required for v1:

- Badge indicator showing recording state.
- Active tab URL/title attached to recording start requests.
- “Open desktop app” deep link.
- WebSocket/SSE live updates.
- Local backend URL configuration screen.
- Debug panel showing recent API calls.
- Manual refresh button.
- Theme parity with web/Electron UI.
- Keyboard shortcut to open side panel.

---

## Implementation Notes for Claude Code

Implement the extension as a frontend client, not as a recorder.

Prioritize these files first:

```txt
apps/extension/manifest.json
apps/extension/src/sidepanel/sidepanel.html
apps/extension/src/sidepanel/sidepanel.tsx
apps/extension/src/popup/popup.html
apps/extension/src/popup/popup.tsx
apps/extension/src/background/service-worker.ts
packages/api-client/client.ts
packages/shared/types.ts
```

Initial UI can be simple and functional.

Recommended first milestone:

```txt
1. Extension loads in Chrome.
2. Side panel opens.
3. Side panel calls GET /api/health.
4. Side panel displays connected/disconnected state.
5. Side panel calls GET /api/recorder/status.
6. Side panel can call POST /api/recorder/start and POST /api/recorder/stop.
```

Second milestone:

```txt
1. Add Gregory chat UI.
2. Add Add Skill flow.
3. Add active task panel.
4. Add safety confirmation panel.
```

Third milestone:

```txt
1. Reuse shared UI components from the web/Electron app.
2. Add live state updates.
3. Add active tab context.
4. Polish extension-specific layout.
```

---

## Final Summary

The Chrome extension should be a browser-side viewport for the existing CUA/Gregory system.

It should let the user access the same core workflows as the web/Electron UI without opening the web app in a browser tab.

It should talk to the same local FastAPI backend, reuse shared UI and API code where possible, and delegate all privileged recording, CUA orchestration, Gregory logic, trajectory persistence, and training work to the existing backend/Electron system.
