# Personal Browser Agent Chrome Extension

A Chrome Manifest V3 extension that integrates skill chat and browser interaction recording for training personal browser agents.

## Features

- **Skill Chat Interface**: Converse with an AI agent to define workflows you want to automate
- **Guided Task Generation**: Agent generates demonstration tasks based on your conversation
- **Browser Event Recording**: Automatically captures user interactions (clicks, typing, navigation)
- **Privacy-First**: Automatically filters out sensitive fields (passwords, payment info)
- **Event Buffering**: Efficient batching and syncing of recorded events to backend
- **Manifest V3 Compliant**: Built for the latest Chrome extension platform

## Architecture

### Components

1. **Content Script** (`src/content/`)
   - Runs on all web pages
   - Captures DOM events (click, input, scroll, etc.)
   - Extracts page context (selectors, metadata, visible text)
   - Applies privacy filtering
   - Sends events to background worker

2. **Background Service Worker** (`src/background/`)
   - Manages skill chat sessions
   - Buffers and batches events
   - Syncs with backend API
   - Handles state persistence
   - Manages trajectory lifecycle

3. **Popup UI** (`src/popup/`)
   - Chat interface for skill definition
   - Task list view
   - Recording controls and status
   - Built with React

### Data Flow

```
User Opens Extension
  ↓
Chat with Agent (define workflow)
  ↓
Agent Generates Tasks
  ↓
User Starts Recording Task
  ↓
Content Script Captures Events
  ↓
Background Worker Buffers & Syncs
  ↓
Events Stored in Backend
  ↓
User Stops Recording
  ↓
Repeat for Next Task
```

## Setup

### Prerequisites

- Node.js 20+
- npm or yarn
- Chrome browser
- Backend API running on `http://localhost:8000`

### Installation

1. Install dependencies:
   ```bash
   cd extension
   npm install
   ```

2. Build the extension:
   ```bash
   npm run build
   ```

3. Load in Chrome:
   - Open `chrome://extensions`
   - Enable "Developer mode"
   - Click "Load unpacked"
   - Select the `extension/dist/` directory

4. (Optional) For development with auto-reload:
   ```bash
   npm run dev
   ```
   This watches for file changes and rebuilds automatically.

### Icon Assets

Replace placeholder icon files in `public/assets/` with actual PNG images:
- `icon-16.png` - 16x16 pixels
- `icon-48.png` - 48x48 pixels
- `icon-128.png` - 128x128 pixels

## Usage

### 1. Start a New Skill Chat

1. Click the extension icon in your browser toolbar
2. The agent will greet you and ask: "What browser workflow should this new skill learn?"
3. Describe the workflow you want to automate (e.g., "Check my Gmail inbox for unread messages")

### 2. Answer Follow-up Questions

The agent will ask 2-3 follow-up questions to understand:
- Which websites/accounts to use
- Examples of success and failure
- Any actions that need confirmation

### 3. Review Generated Tasks

After the conversation, the agent generates 5-10 demonstration tasks. Each task shows:
- Task title and description
- Success criteria
- Risk level (low/medium/high)

### 4. Record Demonstrations

1. Click "Record" on a task
2. Follow the task instructions in your browser
3. The extension automatically captures your interactions
4. Click "Stop Recording" when done
5. Repeat for remaining tasks

### 5. Privacy & Safety

The extension automatically skips:
- Password fields
- Payment information
- Credit card inputs
- Hidden fields
- Any field with sensitive autocomplete attributes

Actions requiring confirmation (submit, delete, purchase) are flagged in the recordings.

## Development

### Project Structure

```
extension/
├── public/
│   ├── manifest.json          # Extension manifest
│   └── assets/                # Icons
├── src/
│   ├── content/               # Content script (runs on pages)
│   │   ├── index.ts
│   │   ├── eventCapture.ts
│   │   ├── domExtractor.ts
│   │   ├── observationBuilder.ts
│   │   └── throttle.ts
│   ├── background/            # Background service worker
│   │   ├── index.ts
│   │   ├── apiClient.ts
│   │   ├── skillChatManager.ts
│   │   ├── eventBuffer.ts
│   │   ├── messageHandler.ts
│   │   └── storage.ts
│   ├── popup/                 # Popup UI (React)
│   │   ├── index.html
│   │   ├── index.tsx
│   │   ├── Popup.tsx
│   │   ├── ChatView.tsx
│   │   ├── TaskListView.tsx
│   │   ├── RecordingView.tsx
│   │   └── styles.css
│   └── shared/                # Shared utilities
│       ├── types.ts
│       ├── constants.ts
│       ├── messageTypes.ts
│       └── privacy.ts
├── vite.config.ts             # Build configuration
├── tsconfig.json              # TypeScript config
└── package.json
```

### Scripts

- `npm run build` - Build for production
- `npm run dev` - Build and watch for changes
- `npm run typecheck` - Type checking without emitting

### Backend API Integration

The extension integrates with these backend endpoints:

**Authentication:**
- `POST /api/auth/login` - Login with display name

**Skill Chat:**
- `POST /api/skills/sessions` - Start new chat session
- `POST /api/skills/sessions/{id}/messages` - Send user message
- `POST /api/skills/sessions/{id}/finalize` - Finalize skill and generate tasks

**Trajectory Recording:**
- `POST /api/trajectories` - Create new trajectory
- `POST /api/trajectories/{id}/events/bulk` - Batch add events
- `POST /api/trajectories/{id}/complete` - Mark trajectory complete

### Configuration

Update `src/shared/constants.ts` to change:
- API base URL (default: `http://localhost:8000`)
- Event buffer settings
- Throttling intervals
- Privacy patterns

## Testing

### Manual Testing Checklist

1. **Chat Flow:**
   - [ ] Extension loads without errors
   - [ ] Agent's initial question displays
   - [ ] Can send messages
   - [ ] Agent asks follow-up questions
   - [ ] "Start Recording" button appears when ready

2. **Task Generation:**
   - [ ] Skill is finalized
   - [ ] Tasks are displayed
   - [ ] Task details are correct

3. **Recording:**
   - [ ] Can start recording
   - [ ] Events are captured (check browser console)
   - [ ] Sensitive fields are skipped
   - [ ] Events are batched and synced
   - [ ] Can stop recording
   - [ ] Trajectory is saved to backend

4. **Cross-Site Testing:**
   - [ ] Works on SPAs (Gmail, GitHub)
   - [ ] Works on multi-page sites (Wikipedia)
   - [ ] Works with forms and inputs
   - [ ] Recording persists across page navigations

5. **Service Worker Lifecycle:**
   - [ ] Recording continues after 30s (service worker termination)
   - [ ] Buffer is rehydrated on wake
   - [ ] No events lost

### Debugging

1. **Content Script Logs:**
   - Open DevTools on any page
   - Check Console for `[Content Script]` logs

2. **Background Worker Logs:**
   - Go to `chrome://extensions`
   - Click "Service worker" under extension
   - Check logs for `[Background]`, `[EventBuffer]`, `[SkillChatManager]`

3. **Popup Logs:**
   - Right-click extension icon → "Inspect popup"
   - Check Console

4. **Storage Inspection:**
   - Go to `chrome://extensions`
   - Click "Details" under extension
   - Scroll to "Inspect views" → "Service worker"
   - Go to Application tab → Storage → Local Storage

## Known Limitations

### V1 Scope

- No screen recording or visual replay
- No Shadow DOM support
- No cross-origin iframe capture
- Manual task start/stop (no automatic segmentation)
- Hardcoded default user (no multi-user support yet)

### Manifest V3 Constraints

- Service worker terminates after 30 seconds idle
- Must persist state aggressively to `chrome.storage`
- No global variables in background script
- Limited to 5MB storage

## Troubleshooting

### Extension won't load
- Check for build errors: `npm run build`
- Verify `dist/` directory exists and contains files
- Check Chrome console for errors

### Events not being captured
- Check content script is injected (DevTools → Console)
- Verify recording is active (popup should show recording status)
- Check background worker logs for errors

### Events not syncing to backend
- Verify backend is running on `http://localhost:8000`
- Check network tab for API errors
- Check background worker logs for sync errors
- Verify buffer is being flushed (check storage)

### Service worker terminated, lost state
- Check if state is persisted to storage before termination
- Verify buffer is rehydrated on wake
- Check background worker logs for restore messages

## Contributing

1. Follow existing code style
2. Run type checking before committing: `npm run typecheck`
3. Test across different websites
4. Update README for new features

## License

Part of the UBC Civil Engineers Personal Browser Agent project.
