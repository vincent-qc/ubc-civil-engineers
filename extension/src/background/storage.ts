// Chrome storage wrapper for persistent state

import type {
  UserProfile,
  SkillChatSession,
  UserSkill,
  OnboardingTask,
  Trajectory,
} from '../shared/types';

export interface StorageState {
  user: UserProfile | null;
  currentChatSession: SkillChatSession | null;
  currentSkill: UserSkill | null;
  currentTasks: OnboardingTask[];
  currentTask: OnboardingTask | null;
  currentTrajectory: Trajectory | null;
  isRecording: boolean;
  bufferedEvents: any[];
  lastSyncTimestamp: number | null;
  eventCount: number; // Total events captured in current recording
}

const DEFAULT_STATE: StorageState = {
  user: null,
  currentChatSession: null,
  currentSkill: null,
  currentTasks: [],
  currentTask: null,
  currentTrajectory: null,
  isRecording: false,
  bufferedEvents: [],
  lastSyncTimestamp: null,
  eventCount: 0,
};

class Storage {
  /**
   * Gets a value from storage
   */
  async get<K extends keyof StorageState>(key: K): Promise<StorageState[K]> {
    const result = await chrome.storage.local.get(key);
    return result[key] !== undefined ? result[key] : DEFAULT_STATE[key];
  }

  /**
   * Gets multiple values from storage
   */
  async getMultiple<K extends keyof StorageState>(
    keys: K[]
  ): Promise<Pick<StorageState, K>> {
    const result = await chrome.storage.local.get(keys);
    const values: any = {};
    for (const key of keys) {
      values[key] = result[key] !== undefined ? result[key] : DEFAULT_STATE[key];
    }
    return values;
  }

  /**
   * Gets all state from storage
   */
  async getAll(): Promise<StorageState> {
    const result = await chrome.storage.local.get(null);
    return { ...DEFAULT_STATE, ...result };
  }

  /**
   * Sets a value in storage
   */
  async set<K extends keyof StorageState>(
    data: Partial<StorageState>
  ): Promise<void> {
    await chrome.storage.local.set(data);
  }

  /**
   * Removes values from storage
   */
  async remove(keys: (keyof StorageState)[]): Promise<void> {
    await chrome.storage.local.remove(keys as string[]);
  }

  /**
   * Clears all storage
   */
  async clear(): Promise<void> {
    await chrome.storage.local.clear();
  }

  /**
   * Updates buffered events
   */
  async addBufferedEvent(event: any): Promise<void> {
    const bufferedEvents = await this.get('bufferedEvents');
    bufferedEvents.push(event);
    await this.set({ bufferedEvents });
  }

  /**
   * Clears buffered events
   */
  async clearBufferedEvents(): Promise<void> {
    await this.set({ bufferedEvents: [] });
  }

  /**
   * Gets buffer size
   */
  async getBufferSize(): Promise<number> {
    const bufferedEvents = await this.get('bufferedEvents');
    return bufferedEvents.length;
  }

  /**
   * Increments event count
   */
  async incrementEventCount(): Promise<void> {
    const currentCount = await this.get('eventCount');
    await this.set({ eventCount: currentCount + 1 });
  }

  /**
   * Resets event count
   */
  async resetEventCount(): Promise<void> {
    await this.set({ eventCount: 0 });
  }
}

export const storage = new Storage();
