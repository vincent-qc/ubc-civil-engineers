// Background service worker entry point

import { skillChatManager } from './skillChatManager';
import { eventBuffer } from './eventBuffer';
import { messageHandler } from './messageHandler';
import { storage } from './storage';

console.log('[Background] Service worker loaded');

// Initialize on startup
initialize().catch(error => {
  console.error('[Background] Initialization failed:', error);
});

async function initialize() {
  console.log('[Background] Initializing...');

  // Restore state from storage
  await skillChatManager.initialize();
  await eventBuffer.initialize();

  console.log('[Background] Initialization complete');
}

// Listen for messages
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Handle message asynchronously
  messageHandler
    .handleMessage(message, sender)
    .then(response => {
      sendResponse(response);
    })
    .catch(error => {
      console.error('[Background] Message handling error:', error);
      sendResponse({
        type: 'ERROR',
        payload: {
          message: 'Internal error',
          error: error instanceof Error ? error.message : String(error),
        },
      });
    });

  // Keep message channel open for async response
  return true;
});

// Handle service worker shutdown
chrome.runtime.onSuspend.addListener(async () => {
  console.log('[Background] Service worker suspending, flushing buffer...');

  try {
    // Flush any remaining events before shutdown
    await eventBuffer.flush();
    console.log('[Background] Buffer flushed successfully');
  } catch (error) {
    console.error('[Background] Failed to flush buffer on suspend:', error);
  }
});

// Handle extension installation/update
chrome.runtime.onInstalled.addListener(details => {
  console.log('[Background] Extension installed/updated:', details.reason);

  if (details.reason === 'install') {
    console.log('[Background] First time installation');
  } else if (details.reason === 'update') {
    console.log('[Background] Extension updated');
  }
});

// Periodic check to ensure events are flushed (in case service worker stays alive)
setInterval(() => {
  eventBuffer.flush().catch(error => {
    console.error('[Background] Periodic flush failed:', error);
  });
}, 60000); // Every minute
