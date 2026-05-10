# Debugging & Viewing Events

## Real-Time Event Monitoring

### 1. Background Service Worker Console

**Best for**: Seeing events as they're captured and synced

```bash
# Open Chrome
1. Go to chrome://extensions
2. Find "Personal Browser Agent Recorder"
3. Click "Service worker" link
4. Console will show:
   - [EventBuffer] Added event: { type, action, bufferSize, selector }
   - [EventBuffer] Flushing buffer: X events
   - [MessageHandler] messages
```

**What you'll see:**
```javascript
[EventBuffer] Added event: {
  type: 'action',
  action: 'click',
  bufferSize: 3,
  selector: '#submit-button'
}
[EventBuffer] Flushing buffer: 10 events
[EventBuffer] Flush successful
```

### 2. Content Script Console

**Best for**: Debugging event capture on web pages

```bash
# On any webpage while recording:
1. Open DevTools (F12)
2. Go to Console tab
3. Look for:
   - [EventCapture] Starting capture
   - [EventCapture] Skipping click on sensitive field
   - [Content Script] messages
```

### 3. Extension Popup Console

**Best for**: UI state and React debugging

```bash
# Right-click extension icon → "Inspect popup"
# Console shows React state updates
```

## Viewing Stored Events

### Chrome Storage (Local Buffer)

```bash
# View buffered events before sync:
1. chrome://extensions
2. Click "Service worker" under extension
3. Go to "Application" tab
4. Left sidebar: Storage → Local Storage → chrome-extension://...
5. Look for keys:
   - bufferedEvents: Array of pending events
   - eventCount: Total captured
   - lastSyncTimestamp: Last sync time
   - currentTrajectory: Active recording
```

**Inspect specific data:**
```javascript
// In Service Worker console:
chrome.storage.local.get(['bufferedEvents', 'eventCount'], (result) => {
  console.log('Buffered Events:', result.bufferedEvents);
  console.log('Event Count:', result.eventCount);
});
```

### Backend Database

**Query all events for a trajectory:**

```bash
# Using curl:
curl http://localhost:8000/api/trajectories/{trajectory_id}

# Response includes:
{
  "id": "traj_abc123",
  "event_count": 45,
  "events": [
    {
      "id": "evt_xyz789",
      "actor": "user",
      "event_type": "action",
      "action": {
        "type": "click",
        "selector": "#login-button"
      },
      "observation": {
        "url": "https://example.com",
        "title": "Example Site"
      }
    }
  ]
}
```

**Using Python:**
```python
import requests

response = requests.get('http://localhost:8000/api/trajectories/traj_abc123')
trajectory = response.json()

print(f"Total events: {trajectory['event_count']}")
for event in trajectory['events']:
    print(f"- {event['event_type']}: {event['action']['type']}")
```

## Event Counter Updates

The extension now tracks events in real-time:

**Popup Display:**
- **Events Captured**: Total events sent (updates every second)
- **Buffered**: Events waiting to sync
- **Last Sync**: Time since last successful sync

**Update Flow:**
```
User Action
  ↓
Content Script captures event
  ↓
Sends to Background Script
  ↓
Event Counter increments (+1)
  ↓
Added to buffer
  ↓
Popup polls status (every 1 second)
  ↓
UI updates with new count
```

## Troubleshooting Event Capture

### Events not being captured?

**Check 1: Is recording active?**
```javascript
// In Service Worker console:
chrome.storage.local.get(['isRecording'], (result) => {
  console.log('Recording active:', result.isRecording);
});
```

**Check 2: Is content script loaded?**
```javascript
// In page console:
console.log('Content script loaded:', typeof eventCapture !== 'undefined');
```

**Check 3: Are events being sent?**
```javascript
// In page console (look for):
[EventCapture] Skipping click on sensitive field
// OR
[EventCapture] Failed to send event: [error]
```

### Events captured but not syncing?

**Check buffer:**
```javascript
// In Service Worker console:
chrome.storage.local.get(['bufferedEvents'], (result) => {
  console.log('Buffer size:', result.bufferedEvents.length);
  console.log('Events:', result.bufferedEvents);
});
```

**Check backend connection:**
```bash
curl http://localhost:8000/api/health
```

**Check sync errors:**
```javascript
// Service Worker console will show:
[EventBuffer] Flush failed: [error message]
```

### Counter stuck at 0?

**Verify event flow:**
1. Start recording
2. Click something on a page
3. Check Service Worker console for:
   ```
   [EventBuffer] Added event: ...
   ```
4. If no message appears, check Content Script console
5. If Content Script shows errors, check browser permissions

## Network Debugging

**Monitor API calls:**
```bash
# Service Worker → DevTools → Network tab
# Look for:
POST /api/trajectories/{id}/events/bulk
  Status: 200 OK
  Payload: { events: [...] }
```

## Performance Monitoring

**Event capture rate:**
```javascript
// In Service Worker console:
let eventCount = 0;
let startTime = Date.now();

// After recording for a minute:
chrome.storage.local.get(['eventCount'], (result) => {
  const elapsed = (Date.now() - startTime) / 1000;
  const rate = result.eventCount / elapsed;
  console.log(`Event rate: ${rate.toFixed(2)} events/sec`);
});
```

## Common Issues

### Issue: "No events captured"
- **Solution**: Content script might not be injected. Reload the page after enabling recording.

### Issue: "Events captured but count shows 0"
- **Solution**: Reload the extension popup to see updated counts.

### Issue: "Buffer growing but not flushing"
- **Solution**: Check backend is running. Buffer flushes every 30 seconds or 10 events.

### Issue: "Service worker terminated"
- **Solution**: Normal behavior. Events should persist in storage and resume when worker wakes.

## Quick Debug Commands

**View current state:**
```javascript
// Service Worker console:
chrome.storage.local.get(null, (data) => console.table(data));
```

**Force flush buffer:**
```javascript
// Service Worker console (if exposed):
eventBuffer.flush();
```

**Clear all data:**
```javascript
chrome.storage.local.clear(() => console.log('Cleared'));
```

## Event Examples

**Click Event:**
```json
{
  "event_type": "action",
  "actor": "user",
  "action": {
    "type": "click",
    "selector": "#submit-btn",
    "text": "Submit",
    "confidence": 1.0
  },
  "observation": {
    "url": "https://example.com/form",
    "title": "Contact Form",
    "dom_nodes": [...]
  }
}
```

**Type Event:**
```json
{
  "event_type": "action",
  "actor": "user",
  "action": {
    "type": "type",
    "selector": "input[name='email']",
    "text": "user@example.com"
  }
}
```

**Scroll Event:**
```json
{
  "event_type": "action",
  "actor": "user",
  "action": {
    "type": "scroll",
    "direction": "down",
    "metadata": { "scroll_y": 1234 }
  }
}
```
