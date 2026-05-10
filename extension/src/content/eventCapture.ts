// Event capture and forwarding to background script

import { buildObservation, buildMinimalObservation } from './observationBuilder';
import { generateSelector } from './domExtractor';
import { isSensitiveField, requiresConfirmation } from '../shared/privacy';
import { EventThrottler } from './throttle';
import type { BrowserAction, BrowserObservation } from '../shared/types';
import type { CaptureEventMessage } from '../shared/messageTypes';

class EventCapture {
  private isRecording = false;
  private throttler = new EventThrottler();
  private trajectoryId: string | null = null;
  private userId: string | null = null;
  private taskId: string | null = null;

  /**
   * Starts capturing events
   */
  start(trajectoryId: string, userId: string, taskId?: string): void {
    if (this.isRecording) {
      console.warn('[EventCapture] Already recording');
      return;
    }

    this.isRecording = true;
    this.trajectoryId = trajectoryId;
    this.userId = userId;
    this.taskId = taskId || null;

    console.log('[EventCapture] Starting capture', { trajectoryId, userId, taskId });

    // Register event listeners
    document.addEventListener('click', this.handleClick, true);
    document.addEventListener('input', this.createThrottledInputHandler(), true);
    document.addEventListener('change', this.handleChange, true);
    document.addEventListener('submit', this.handleSubmit, true);
    document.addEventListener('keydown', this.handleKeydown, true);
    document.addEventListener('focus', this.handleFocus, true);

    // Throttled scroll handler
    const scrollHandler = this.throttler.createScrollHandler(this.handleScroll.bind(this));
    document.addEventListener('scroll', scrollHandler, { passive: true });

    // Navigation events
    window.addEventListener('popstate', this.handleNavigation);

    // Send initial observation
    this.captureObservation();
  }

  /**
   * Stops capturing events
   */
  stop(): void {
    if (!this.isRecording) {
      return;
    }

    console.log('[EventCapture] Stopping capture');

    this.isRecording = false;

    // Remove event listeners
    document.removeEventListener('click', this.handleClick, true);
    document.removeEventListener('change', this.handleChange, true);
    document.removeEventListener('submit', this.handleSubmit, true);
    document.removeEventListener('keydown', this.handleKeydown, true);
    document.removeEventListener('focus', this.handleFocus, true);
    window.removeEventListener('popstate', this.handleNavigation);

    // Cancel throttled handlers
    this.throttler.cancelAll();

    this.trajectoryId = null;
    this.userId = null;
    this.taskId = null;
  }

  /**
   * Pauses event capture
   */
  pause(): void {
    this.isRecording = false;
  }

  /**
   * Resumes event capture
   */
  resume(): void {
    this.isRecording = true;
  }

  /**
   * Creates throttled input handler
   */
  private createThrottledInputHandler() {
    return this.throttler.createInputHandler(this.handleInput.bind(this));
  }

  /**
   * Handles click events
   */
  private handleClick = async (event: MouseEvent): Promise<void> => {
    if (!this.isRecording) return;

    const target = event.target as Element;
    if (!target) return;

    // Skip sensitive fields
    if (isSensitiveField(target as HTMLElement)) {
      console.log('[EventCapture] Skipping click on sensitive field');
      return;
    }

    const observation = buildObservation();
    const action: BrowserAction = {
      type: 'click',
      selector: generateSelector(target),
      text: target.textContent?.trim().slice(0, 100) || null,
      confidence: 1.0,
      requires_confirmation: requiresConfirmation({ type: 'click', selector: generateSelector(target), text: target.textContent?.trim() || null }, observation),
      metadata: {
        x: event.clientX,
        y: event.clientY,
        button: event.button,
      },
    };

    await this.sendEvent('action', observation, action);
  };

  /**
   * Handles input events (typing)
   */
  private handleInput = async (event: Event): Promise<void> => {
    if (!this.isRecording) return;

    const target = event.target as HTMLInputElement;
    if (!target) return;

    // Skip sensitive fields
    if (isSensitiveField(target)) {
      console.log('[EventCapture] Skipping input on sensitive field');
      return;
    }

    const observation = buildObservation();
    const action: BrowserAction = {
      type: 'type',
      selector: generateSelector(target),
      text: target.value,
      confidence: 1.0,
      metadata: {
        input_type: target.type,
      },
    };

    await this.sendEvent('action', observation, action);
  };

  /**
   * Handles change events (select, checkbox, radio)
   */
  private handleChange = async (event: Event): Promise<void> => {
    if (!this.isRecording) return;

    const target = event.target as HTMLElement;
    if (!target) return;

    if (isSensitiveField(target)) {
      return;
    }

    const observation = buildObservation();
    let text: string | null = null;

    if (target instanceof HTMLSelectElement) {
      text = target.options[target.selectedIndex]?.text || null;
    } else if (target instanceof HTMLInputElement && target.type === 'checkbox') {
      text = target.checked ? 'checked' : 'unchecked';
    } else if (target instanceof HTMLInputElement && target.type === 'radio') {
      text = target.value;
    }

    const action: BrowserAction = {
      type: 'click', // Change events are modeled as clicks
      selector: generateSelector(target),
      text,
      confidence: 1.0,
    };

    await this.sendEvent('action', observation, action);
  };

  /**
   * Handles form submit events
   */
  private handleSubmit = async (event: Event): Promise<void> => {
    if (!this.isRecording) return;

    const target = event.target as HTMLFormElement;
    if (!target) return;

    const observation = buildObservation();
    const action: BrowserAction = {
      type: 'click',
      selector: generateSelector(target),
      text: 'submit',
      confidence: 1.0,
      requires_confirmation: true, // Always require confirmation for form submits
    };

    await this.sendEvent('action', observation, action);
  };

  /**
   * Handles keydown events
   */
  private handleKeydown = async (event: KeyboardEvent): Promise<void> => {
    if (!this.isRecording) return;

    // Only capture special keys (Enter, Escape, Tab)
    const specialKeys = ['Enter', 'Escape', 'Tab'];
    if (!specialKeys.includes(event.key)) {
      return;
    }

    const target = event.target as Element;
    if (isSensitiveField(target as HTMLElement)) {
      return;
    }

    const observation = buildObservation();
    const action: BrowserAction = {
      type: 'press_key',
      key: event.key,
      selector: target ? generateSelector(target) : null,
      confidence: 1.0,
      metadata: {
        ctrl: event.ctrlKey,
        shift: event.shiftKey,
        alt: event.altKey,
        meta: event.metaKey,
      },
    };

    await this.sendEvent('action', observation, action);
  };

  /**
   * Handles focus events
   */
  private handleFocus = async (event: FocusEvent): Promise<void> => {
    if (!this.isRecording) return;

    const target = event.target as Element;
    if (!target || target === document.body) return;

    if (isSensitiveField(target as HTMLElement)) {
      return;
    }

    // Just capture observation when focus changes
    const observation = buildObservation();
    await this.sendEvent('observation', observation);
  };

  /**
   * Handles scroll events (throttled)
   */
  private handleScroll = async (): Promise<void> => {
    if (!this.isRecording) return;

    const observation = buildMinimalObservation();
    const action: BrowserAction = {
      type: 'scroll',
      direction: window.scrollY > (this.lastScrollY || 0) ? 'down' : 'up',
      confidence: 1.0,
      metadata: {
        scroll_y: window.scrollY,
      },
    };

    this.lastScrollY = window.scrollY;
    await this.sendEvent('action', observation, action);
  };

  private lastScrollY = 0;

  /**
   * Handles navigation events
   */
  private handleNavigation = async (): Promise<void> => {
    if (!this.isRecording) return;

    const observation = buildObservation();
    const action: BrowserAction = {
      type: 'open_url',
      url: window.location.href,
      confidence: 1.0,
    };

    await this.sendEvent('action', observation, action);
  };

  /**
   * Captures current page observation
   */
  private async captureObservation(): Promise<void> {
    if (!this.isRecording) return;

    const observation = buildObservation();
    await this.sendEvent('observation', observation);
  }

  /**
   * Sends event to background script
   */
  private async sendEvent(
    eventType: 'observation' | 'action',
    observation?: BrowserObservation,
    action?: BrowserAction
  ): Promise<void> {
    try {
      const message: CaptureEventMessage = {
        type: 'CAPTURE_EVENT',
        payload: {
          actor: 'user',
          event_type: eventType,
          observation,
          action,
        },
      };

      await chrome.runtime.sendMessage(message);
    } catch (error) {
      console.error('[EventCapture] Failed to send event:', error);
    }
  }
}

// Export singleton instance
export const eventCapture = new EventCapture();
