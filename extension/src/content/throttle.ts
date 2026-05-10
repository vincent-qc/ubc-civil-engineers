// Event throttling to reduce noise and improve performance

import {
  THROTTLE_SCROLL_MS,
  THROTTLE_INPUT_MS,
  THROTTLE_RESIZE_MS,
} from '../shared/constants';

type ThrottledFunction<T extends (...args: any[]) => any> = {
  (...args: Parameters<T>): void;
  cancel: () => void;
};

/**
 * Creates a throttled version of a function
 */
function throttle<T extends (...args: any[]) => any>(
  func: T,
  wait: number
): ThrottledFunction<T> {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  let lastRan = 0;

  const throttled = function (this: any, ...args: Parameters<T>) {
    const now = Date.now();
    const timeSinceLastRan = now - lastRan;

    if (timeSinceLastRan >= wait) {
      func.apply(this, args);
      lastRan = now;
    } else if (!timeout) {
      timeout = setTimeout(() => {
        func.apply(this, args);
        lastRan = Date.now();
        timeout = null;
      }, wait - timeSinceLastRan);
    }
  };

  throttled.cancel = () => {
    if (timeout) {
      clearTimeout(timeout);
      timeout = null;
    }
  };

  return throttled as ThrottledFunction<T>;
}

/**
 * Event throttler class to manage multiple throttled event handlers
 */
export class EventThrottler {
  private throttledHandlers: Map<string, ThrottledFunction<any>> = new Map();

  /**
   * Creates a throttled handler for scroll events
   */
  createScrollHandler<T extends (...args: any[]) => any>(handler: T): ThrottledFunction<T> {
    const throttled = throttle(handler, THROTTLE_SCROLL_MS);
    this.throttledHandlers.set('scroll', throttled);
    return throttled;
  }

  /**
   * Creates a throttled handler for input events
   */
  createInputHandler<T extends (...args: any[]) => any>(handler: T): ThrottledFunction<T> {
    const throttled = throttle(handler, THROTTLE_INPUT_MS);
    this.throttledHandlers.set('input', throttled);
    return throttled;
  }

  /**
   * Creates a throttled handler for resize events
   */
  createResizeHandler<T extends (...args: any[]) => any>(handler: T): ThrottledFunction<T> {
    const throttled = throttle(handler, THROTTLE_RESIZE_MS);
    this.throttledHandlers.set('resize', throttled);
    return throttled;
  }

  /**
   * Cancels all throttled handlers
   */
  cancelAll(): void {
    this.throttledHandlers.forEach(handler => handler.cancel());
    this.throttledHandlers.clear();
  }

  /**
   * Cancels a specific throttled handler
   */
  cancel(eventType: string): void {
    const handler = this.throttledHandlers.get(eventType);
    if (handler) {
      handler.cancel();
      this.throttledHandlers.delete(eventType);
    }
  }
}
