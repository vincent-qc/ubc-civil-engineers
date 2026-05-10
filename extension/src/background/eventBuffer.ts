// Event buffering and batching for efficient API calls

import { apiClient } from './apiClient';
import { storage } from './storage';
import {
  MAX_BUFFER_SIZE,
  BATCH_SIZE,
  FLUSH_INTERVAL_MS,
  MAX_BUFFER_AGE_MS,
} from '../shared/constants';
import type { Actor, BrowserEventType, BrowserObservation, BrowserAction } from '../shared/types';

export interface BufferedEvent {
  id: string;
  trajectory_id: string;
  user_id: string;
  task_id?: string;
  timestamp: number;
  actor: Actor;
  event_type: BrowserEventType;
  observation?: BrowserObservation;
  action?: BrowserAction;
  question?: string;
  answer?: string;
  metadata: Record<string, unknown>;
}

class EventBuffer {
  private buffer: BufferedEvent[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private currentTrajectoryId: string | null = null;

  /**
   * Initializes the buffer from storage
   */
  async initialize(): Promise<void> {
    const bufferedEvents = await storage.get('bufferedEvents');
    if (bufferedEvents.length > 0) {
      this.buffer = bufferedEvents;
      console.log('[EventBuffer] Restored buffer from storage:', this.buffer.length, 'events');

      // Try to flush restored events
      await this.flush();
    }
  }

  /**
   * Sets the current trajectory ID
   */
  setTrajectoryId(trajectoryId: string): void {
    this.currentTrajectoryId = trajectoryId;
  }

  /**
   * Adds an event to the buffer
   */
  async add(event: Omit<BufferedEvent, 'id' | 'timestamp'>): Promise<void> {
    const bufferedEvent: BufferedEvent = {
      ...event,
      id: this.generateEventId(),
      timestamp: Date.now(),
    };

    this.buffer.push(bufferedEvent);
    await this.saveToStorage();

    console.log('[EventBuffer] Added event, buffer size:', this.buffer.length);

    // Check if we should flush
    if (this.buffer.length >= BATCH_SIZE) {
      console.log('[EventBuffer] Buffer reached batch size, flushing');
      await this.flush();
    } else if (!this.flushTimer) {
      this.scheduleFlush();
    }

    // Check buffer size limit
    if (this.buffer.length >= MAX_BUFFER_SIZE) {
      console.warn('[EventBuffer] Buffer size limit reached, forcing flush');
      await this.flush();
    }

    // Check buffer age
    const oldestEvent = this.buffer[0];
    if (oldestEvent && Date.now() - oldestEvent.timestamp > MAX_BUFFER_AGE_MS) {
      console.warn('[EventBuffer] Buffer age limit reached, forcing flush');
      await this.flush();
    }
  }

  /**
   * Flushes the buffer to the backend
   */
  async flush(): Promise<void> {
    if (this.buffer.length === 0) {
      return;
    }

    console.log('[EventBuffer] Flushing buffer:', this.buffer.length, 'events');

    // Cancel scheduled flush
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }

    // Copy buffer and clear it
    const eventsToFlush = [...this.buffer];
    this.buffer = [];

    try {
      // Get trajectory ID
      const trajectoryId = this.currentTrajectoryId || eventsToFlush[0]?.trajectory_id;

      if (!trajectoryId) {
        console.error('[EventBuffer] No trajectory ID available');
        // Re-add events to buffer
        this.buffer.unshift(...eventsToFlush);
        return;
      }

      // Format events for API
      const formattedEvents = eventsToFlush.map(event => ({
        actor: event.actor,
        event_type: event.event_type,
        observation: event.observation,
        action: event.action,
        question: event.question,
        answer: event.answer,
        metadata: event.metadata,
      }));

      // Send to backend
      await apiClient.bulkAddEvents(trajectoryId, formattedEvents);

      // Clear storage and update last sync time
      await storage.set({
        bufferedEvents: [],
        lastSyncTimestamp: Date.now(),
      });

      console.log('[EventBuffer] Flush successful');
    } catch (error) {
      console.error('[EventBuffer] Flush failed:', error);

      // Re-add events to buffer for retry
      this.buffer.unshift(...eventsToFlush);
      await this.saveToStorage();

      // Schedule retry
      this.scheduleFlush();
    }
  }

  /**
   * Schedules a flush after the flush interval
   */
  private scheduleFlush(): void {
    if (this.flushTimer) {
      return;
    }

    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      this.flush().catch(error => {
        console.error('[EventBuffer] Scheduled flush failed:', error);
      });
    }, FLUSH_INTERVAL_MS);
  }

  /**
   * Gets the current buffer size
   */
  getSize(): number {
    return this.buffer.length;
  }

  /**
   * Clears the buffer
   */
  async clear(): Promise<void> {
    console.log('[EventBuffer] Clearing buffer');

    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }

    this.buffer = [];
    this.currentTrajectoryId = null;
    await storage.clearBufferedEvents();
  }

  /**
   * Saves buffer to storage
   */
  private async saveToStorage(): Promise<void> {
    await storage.set({ bufferedEvents: this.buffer });
  }

  /**
   * Generates a unique event ID
   */
  private generateEventId(): string {
    return `evt_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}

export const eventBuffer = new EventBuffer();
