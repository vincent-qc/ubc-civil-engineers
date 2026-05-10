// Skill chat session lifecycle management

import { apiClient } from './apiClient';
import { storage } from './storage';
import type { SkillChatSession, UserSkill, OnboardingTask } from '../shared/types';

class SkillChatManager {
  private currentSessionId: string | null = null;

  /**
   * Initializes the manager from storage
   */
  async initialize(): Promise<void> {
    const session = await storage.get('currentChatSession');
    if (session) {
      this.currentSessionId = session.id;
      console.log('[SkillChatManager] Restored session from storage:', this.currentSessionId);
    }
  }

  /**
   * Starts a new chat session
   */
  async startNewChat(userId: string): Promise<SkillChatSession> {
    console.log('[SkillChatManager] Starting new chat session');

    const session = await apiClient.createSkillSession(userId);
    this.currentSessionId = session.id;

    await storage.set({
      currentChatSession: session,
      currentSkill: null,
      currentTasks: [],
    });

    console.log('[SkillChatManager] Created chat session:', session.id);
    return session;
  }

  /**
   * Sends a message to the current chat session
   */
  async sendMessage(content: string): Promise<SkillChatSession> {
    if (!this.currentSessionId) {
      throw new Error('No active chat session');
    }

    console.log('[SkillChatManager] Sending message:', content);

    const updatedSession = await apiClient.sendChatMessage(this.currentSessionId, content);

    await storage.set({ currentChatSession: updatedSession });

    console.log('[SkillChatManager] Session updated, status:', updatedSession.status);
    return updatedSession;
  }

  /**
   * Finalizes the skill session and generates tasks
   */
  async finalizeSkill(): Promise<{
    session: SkillChatSession;
    skill: UserSkill;
    tasks: OnboardingTask[];
  }> {
    if (!this.currentSessionId) {
      throw new Error('No active chat session');
    }

    console.log('[SkillChatManager] Finalizing skill session');

    const result = await apiClient.finalizeSkillSession(this.currentSessionId);

    await storage.set({
      currentChatSession: result.session,
      currentSkill: result.skill,
      currentTasks: result.tasks,
    });

    console.log('[SkillChatManager] Skill finalized:', result.skill.id);
    console.log('[SkillChatManager] Generated tasks:', result.tasks.length);

    return result;
  }

  /**
   * Checks if the current session is ready for recording
   */
  isReadyToRecord(session: SkillChatSession): boolean {
    return session.status === 'ready_for_tasks';
  }

  /**
   * Gets the current session
   */
  async getCurrentSession(): Promise<SkillChatSession | null> {
    return await storage.get('currentChatSession');
  }

  /**
   * Resets the chat session
   */
  async reset(): Promise<void> {
    console.log('[SkillChatManager] Resetting chat session');
    this.currentSessionId = null;
    await storage.set({
      currentChatSession: null,
      currentSkill: null,
      currentTasks: [],
    });
  }
}

export const skillChatManager = new SkillChatManager();
