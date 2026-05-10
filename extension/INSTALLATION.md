# Chrome Extension Installation Guide

## Quick Start

### 1. Build the Extension

```bash
cd extension
npm install
npm run build
```

This will:
- Install all dependencies
- Generate placeholder icon files
- Build the extension to the `dist/` directory
- Copy manifest and assets

### 2. Load in Chrome

1. Open Chrome and navigate to `chrome://extensions`
2. Enable **Developer mode** (toggle in top right)
3. Click **Load unpacked**
4. Select the `extension/dist/` directory
5. The extension icon should appear in your toolbar

### 3. Verify Installation

- Click the extension icon - the popup should open
- Check the browser console for any errors
- The agent should greet you with an initial question

## Backend Setup

The extension requires the backend API to be running:

```bash
# In the backend directory
cd ../backend
python -m uvicorn app.main:app --reload
```

The backend should be accessible at `http://localhost:8000`

## Troubleshooting

### Extension won't load

**Issue**: "Failed to load extension"
- Check build output for errors: `npm run build`
- Verify `dist/` directory exists and contains files
- Check Chrome DevTools console for specific errors

### Popup doesn't open

**Issue**: Clicking icon does nothing
- Right-click extension icon → "Inspect popup"
- Check console for JavaScript errors
- Verify `dist/popup/index.html` exists

### Backend connection fails

**Issue**: "Failed to connect to backend"
- Verify backend is running: `curl http://localhost:8000/api/health`
- Check browser console for CORS errors
- Update API_BASE_URL in `src/shared/constants.ts` if needed

### Events not being captured

**Issue**: Recording but no events logged
- Check content script is loaded: Open DevTools on any page, look for "[Content Script]" logs
- Verify recording is active: popup should show "Recording..." status
- Check background service worker logs:
  1. Go to `chrome://extensions`
  2. Click "Service worker" under the extension
  3. Look for "[EventBuffer]" and "[MessageHandler]" logs

### Service worker errors

**Issue**: Background service worker terminated
- This is normal behavior (Manifest V3 terminates after 30s)
- State should be persisted to storage and rehydrated
- Check Application → Storage → Local Storage in DevTools

## Development Mode

For active development with auto-rebuild:

```bash
npm run dev
```

Then reload the extension in Chrome after each change:
1. Go to `chrome://extensions`
2. Click the refresh icon on the extension card

## Testing Checklist

Before using the extension:

- [ ] Backend is running on `http://localhost:8000`
- [ ] Extension loads without errors
- [ ] Popup opens when clicking icon
- [ ] Chat interface displays agent's greeting
- [ ] Can send messages to agent
- [ ] Content script loads on web pages (check DevTools console)

## Next Steps

Once installed:

1. **Start a skill chat** - Click the extension icon
2. **Describe your workflow** - Tell the agent what you want to automate
3. **Answer follow-up questions** - The agent will ask 2-3 questions
4. **Review generated tasks** - The agent creates demonstration tasks
5. **Record demonstrations** - Follow task instructions while recording

## Uninstallation

To remove the extension:

1. Go to `chrome://extensions`
2. Find "Personal Browser Agent Recorder"
3. Click "Remove"
4. All stored data will be deleted

## Support

For issues or questions:
- Check the main [README.md](README.md) for detailed documentation
- Review backend logs for API errors
- Check browser console for JavaScript errors
