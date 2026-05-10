// Content script entry point

import { eventCapture } from './eventCapture';
import type {
  StartCaptureMessage,
  StopCaptureMessage,
  PauseCaptureMessage,
  ResumeCaptureMessage,
  BackgroundToContentMessage,
} from '../shared/messageTypes';

console.log('[Content Script] Loaded');

// Listen for messages from background script
chrome.runtime.onMessage.addListener((message: BackgroundToContentMessage, sender, sendResponse) => {
  console.log('[Content Script] Received message:', message.type);

  switch (message.type) {
    case 'START_CAPTURE':
      handleStartCapture(message);
      sendResponse({ success: true });
      break;

    case 'STOP_CAPTURE':
      handleStopCapture(message);
      sendResponse({ success: true });
      break;

    case 'PAUSE_CAPTURE':
      handlePauseCapture(message);
      sendResponse({ success: true });
      break;

    case 'RESUME_CAPTURE':
      handleResumeCapture(message);
      sendResponse({ success: true });
      break;

    default:
      console.warn('[Content Script] Unknown message type:', (message as any).type);
      sendResponse({ success: false, error: 'Unknown message type' });
  }

  return true; // Keep message channel open for async response
});

function handleStartCapture(message: StartCaptureMessage): void {
  const { trajectoryId, userId, taskId } = message.payload;
  console.log('[Content Script] Starting capture', { trajectoryId, userId, taskId });
  eventCapture.start(trajectoryId, userId, taskId);
}

function handleStopCapture(_message: StopCaptureMessage): void {
  console.log('[Content Script] Stopping capture');
  eventCapture.stop();
}

function handlePauseCapture(_message: PauseCaptureMessage): void {
  console.log('[Content Script] Pausing capture');
  eventCapture.pause();
}

function handleResumeCapture(_message: ResumeCaptureMessage): void {
  console.log('[Content Script] Resuming capture');
  eventCapture.resume();
}

// Notify background that content script is ready
chrome.runtime.sendMessage({ type: 'CONTENT_READY' }).catch(() => {
  // Ignore errors if background script is not ready yet
});
