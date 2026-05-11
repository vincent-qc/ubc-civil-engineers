// Backend API client

import { API_BASE_URL, MAX_RETRIES, INITIAL_RETRY_DELAY_MS } from '../shared/constants';
import type {
  UserProfile,
  SkillChatSession,
  UserSkill,
  OnboardingTask,
  Trajectory,
  BrowserObservation,
} from '../shared/types';

interface CreateTrajectoryRequest {
  user_id: string;
  task: string;
  source: 'manual' | 'onboarding' | 'question_takeover' | 'agent_run';
  skill_id?: string;
  task_id?: string;
  initial_observation?: BrowserObservation;
  metadata?: Record<string, unknown>;
}

interface BulkRecordingRequest {
  user_id: string;
  task: string;
  source: 'manual' | 'onboarding' | 'question_takeover' | 'agent_run';
  skill_id?: string;
  task_id?: string;
  events: any[];
  initial_observation?: BrowserObservation;
}

interface FinalizeSkillResponse {
  session: SkillChatSession;
  skill: UserSkill;
  tasks: OnboardingTask[];
}

export class BackendAPIClient {
  private baseUrl: string;

  constructor(baseUrl: string = API_BASE_URL) {
    this.baseUrl = baseUrl;
  }

  // Authentication APIs

  async login(displayName: string, emailHint?: string): Promise<UserProfile> {
    return this.fetch('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({
        display_name: displayName,
        email_hint: emailHint,
      }),
    });
  }

  // Skill Chat APIs

  async createSkillSession(userId: string): Promise<SkillChatSession> {
    return this.fetch('/api/skills/sessions', {
      method: 'POST',
      body: JSON.stringify({ user_id: userId }),
    });
  }

  async sendChatMessage(sessionId: string, content: string): Promise<SkillChatSession> {
    return this.fetch(`/api/skills/sessions/${sessionId}/messages`, {
      method: 'POST',
      body: JSON.stringify({ content }),
    });
  }

  async finalizeSkillSession(sessionId: string): Promise<FinalizeSkillResponse> {
    return this.fetch(`/api/skills/sessions/${sessionId}/finalize`, {
      method: 'POST',
    });
  }

  // Trajectory APIs

  async createTrajectory(request: CreateTrajectoryRequest): Promise<Trajectory> {
    return this.fetch('/api/trajectories', {
      method: 'POST',
      body: JSON.stringify(request),
    });
  }

  async addEvent(trajectoryId: string, event: any): Promise<void> {
    await this.fetchWithRetry(`/api/trajectories/${trajectoryId}/events`, {
      method: 'POST',
      body: JSON.stringify(event),
    });
  }

  async bulkAddEvents(trajectoryId: string, events: any[]): Promise<void> {
    await this.fetchWithRetry(`/api/trajectories/${trajectoryId}/events/bulk`, {
      method: 'POST',
      body: JSON.stringify({ events }),
    });
  }

  async bulkRecording(request: BulkRecordingRequest): Promise<Trajectory> {
    return this.fetchWithRetry('/api/recordings/bulk', {
      method: 'POST',
      body: JSON.stringify(request),
    });
  }

  // Helper methods

  private async fetchWithRetry(
    url: string,
    options: RequestInit,
    retries: number = MAX_RETRIES
  ): Promise<any> {
    for (let i = 0; i <= retries; i++) {
      try {
        const response = await fetch(this.baseUrl + url, {
          ...options,
          headers: {
            'Content-Type': 'application/json',
            ...options.headers,
          },
        });

        if (response.ok) {
          // Check if response has content
          const text = await response.text();
          return text ? JSON.parse(text) : null;
        }

        // Don't retry client errors (4xx)
        if (response.status >= 400 && response.status < 500) {
          const errorText = await response.text();
          throw new Error(`HTTP ${response.status}: ${errorText}`);
        }

        // Retry server errors (5xx)
        if (i < retries) {
          console.warn(`[APIClient] Request failed with ${response.status}, retrying...`);
          await this.delay(INITIAL_RETRY_DELAY_MS * Math.pow(2, i));
          continue;
        }

        throw new Error(`HTTP ${response.status}`);
      } catch (error) {
        if (i === retries) {
          console.error('[APIClient] Request failed after retries:', error);
          throw error;
        }
        console.warn(`[APIClient] Request failed, retrying (${i + 1}/${retries})...`, error);
        await this.delay(INITIAL_RETRY_DELAY_MS * Math.pow(2, i));
      }
    }
  }

  private async fetch(url: string, options: RequestInit): Promise<any> {
    return this.fetchWithRetry(url, options, 0); // No retries for regular fetch
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

export const apiClient = new BackendAPIClient();
