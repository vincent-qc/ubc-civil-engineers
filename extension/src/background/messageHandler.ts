// Message routing and handling for background script

import { apiClient } from './apiClient';
import { storage } from './storage';
import { skillChatManager } from './skillChatManager';
import { eventBuffer } from './eventBuffer';
import { DEFAULT_USER_DISPLAY_NAME } from '../shared/constants';
import type {
  ExtensionMessage,
  PopupToBackgroundMessage,
  ContentToBackgroundMessage,
  PopupStateMessage,
  RecordingStatusMessage,
} from '../shared/messageTypes';
import type { Trajectory, OnboardingTask } from '../shared/types';

export class MessageHandler {
  /**
   * Handles incoming messages from popup and content scripts
   */
  async handleMessage(
    message: ExtensionMessage,
    sender: chrome.runtime.MessageSender
  ): Promise<any> {
    console.log('[MessageHandler] Received message:', message.type, 'from:', sender.tab?.id || 'popup');

    try {
      // Route based on sender and message type
      if (sender.tab) {
        // Message from content script
        return await this.handleContentMessage(message as ContentToBackgroundMessage);
      } else {
        // Message from popup
        return await this.handlePopupMessage(message as PopupToBackgroundMessage);
      }
    } catch (error) {
      console.error('[MessageHandler] Error handling message:', error);
      return {
        type: 'ERROR',
        payload: {
          message: 'Failed to handle message',
          error: error instanceof Error ? error.message : String(error),
        },
      };
    }
  }

  /**
   * Handles messages from content scripts
   */
  private async handleContentMessage(message: ContentToBackgroundMessage): Promise<any> {
    switch (message.type) {
      case 'CAPTURE_EVENT':
        return await this.handleCaptureEvent(message);

      case 'CONTENT_READY':
        console.log('[MessageHandler] Content script ready');
        return { success: true };

      default:
        throw new Error(`Unknown content message type: ${(message as any).type}`);
    }
  }

  /**
   * Handles messages from popup
   */
  private async handlePopupMessage(message: PopupToBackgroundMessage): Promise<any> {
    switch (message.type) {
      case 'INITIALIZE_POPUP':
        return await this.handleInitializePopup();

      case 'START_CHAT':
        return await this.handleStartChat();

      case 'SEND_CHAT_MESSAGE':
        return await this.handleSendChatMessage(message);

      case 'FINALIZE_SKILL':
        return await this.handleFinalizeSkill();

      case 'START_RECORDING':
        return await this.handleStartRecording(message);

      case 'STOP_RECORDING':
        return await this.handleStopRecording();

      case 'PAUSE_RECORDING':
        return await this.handlePauseRecording();

      case 'RESUME_RECORDING':
        return await this.handleResumeRecording();

      case 'GET_RECORDING_STATUS':
        return await this.handleGetRecordingStatus();

      default:
        throw new Error(`Unknown popup message type: ${(message as any).type}`);
    }
  }

  // Content script message handlers

  private async handleCaptureEvent(message: any): Promise<void> {
    const { actor, event_type, observation, action, question, answer } = message.payload;

    const state = await storage.getMultiple(['currentTrajectory', 'user', 'currentTask']);

    if (!state.currentTrajectory || !state.user) {
      console.warn('[MessageHandler] No active trajectory or user');
      return;
    }

    await eventBuffer.add({
      trajectory_id: state.currentTrajectory.id,
      user_id: state.user.id,
      task_id: state.currentTask?.id,
      actor,
      event_type,
      observation,
      action,
      question,
      answer,
      metadata: {},
    });
  }

  // Popup message handlers

  private async handleInitializePopup(): Promise<PopupStateMessage> {
    const state = await storage.getAll();

    // Auto-login if no user exists
    if (!state.user) {
      const user = await apiClient.login(DEFAULT_USER_DISPLAY_NAME);
      await storage.set({ user });
      state.user = user;
    }

    const bufferSize = await storage.getBufferSize();

    return {
      type: 'POPUP_STATE',
      payload: {
        user: state.user,
        chatSession: state.currentChatSession,
        skill: state.currentSkill,
        tasks: state.currentTasks,
        currentTask: state.currentTask,
        trajectory: state.currentTrajectory,
        isRecording: state.isRecording,
        bufferSize,
        lastSyncTimestamp: state.lastSyncTimestamp,
      },
    };
  }

  private async handleStartChat(): Promise<any> {
    const user = await storage.get('user');

    if (!user) {
      throw new Error('No user logged in');
    }

    const session = await skillChatManager.startNewChat(user.id);

    return {
      type: 'CHAT_SESSION_UPDATED',
      payload: session,
    };
  }

  private async handleSendChatMessage(message: any): Promise<any> {
    const { content } = message.payload;
    const session = await skillChatManager.sendMessage(content);

    return {
      type: 'CHAT_SESSION_UPDATED',
      payload: session,
    };
  }

  private async handleFinalizeSkill(): Promise<any> {
    const result = await skillChatManager.finalizeSkill();

    return {
      type: 'SKILL_FINALIZED',
      payload: result,
    };
  }

  private async handleStartRecording(message: any): Promise<any> {
    const { taskId } = message.payload;

    const state = await storage.getMultiple(['user', 'currentSkill', 'currentTasks']);

    if (!state.user) {
      throw new Error('No user logged in');
    }

    const task = state.currentTasks.find(t => t.id === taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }

    // Create trajectory
    const trajectory: Trajectory = await apiClient.createTrajectory({
      user_id: state.user.id,
      task: task.prompt,
      source: 'manual',
      skill_id: state.currentSkill?.id,
      task_id: task.id,
    });

    await storage.set({
      currentTrajectory: trajectory,
      currentTask: task,
      isRecording: true,
    });

    // Set trajectory ID in event buffer
    eventBuffer.setTrajectoryId(trajectory.id);

    // Broadcast to all tabs to start capturing
    await this.broadcastToAllTabs({
      type: 'START_CAPTURE',
      payload: {
        trajectoryId: trajectory.id,
        userId: state.user.id,
        taskId: task.id,
      },
    });

    return {
      type: 'RECORDING_STARTED',
      payload: { trajectory },
    };
  }

  private async handleStopRecording(): Promise<any> {
    const state = await storage.getMultiple(['currentTrajectory', 'isRecording']);

    if (!state.isRecording || !state.currentTrajectory) {
      console.warn('[MessageHandler] Not recording');
      return { type: 'RECORDING_STOPPED' };
    }

    // Flush any remaining events
    await eventBuffer.flush();

    // Mark trajectory as completed
    try {
      await apiClient.completeTrajectory(state.currentTrajectory.id, true);
    } catch (error) {
      console.error('[MessageHandler] Failed to complete trajectory:', error);
    }

    // Clear recording state
    await storage.set({
      currentTrajectory: null,
      currentTask: null,
      isRecording: false,
    });

    await eventBuffer.clear();

    // Broadcast to all tabs to stop capturing
    await this.broadcastToAllTabs({ type: 'STOP_CAPTURE' });

    return { type: 'RECORDING_STOPPED' };
  }

  private async handlePauseRecording(): Promise<any> {
    await storage.set({ isRecording: false });

    // Broadcast to all tabs to pause capturing
    await this.broadcastToAllTabs({ type: 'PAUSE_CAPTURE' });

    return { success: true };
  }

  private async handleResumeRecording(): Promise<any> {
    await storage.set({ isRecording: true });

    // Broadcast to all tabs to resume capturing
    await this.broadcastToAllTabs({ type: 'RESUME_CAPTURE' });

    return { success: true };
  }

  private async handleGetRecordingStatus(): Promise<RecordingStatusMessage> {
    const state = await storage.getMultiple([
      'isRecording',
      'currentTrajectory',
      'currentTask',
      'lastSyncTimestamp',
    ]);

    const bufferSize = await storage.getBufferSize();

    return {
      type: 'RECORDING_STATUS',
      payload: {
        isRecording: state.isRecording,
        trajectory: state.currentTrajectory,
        currentTask: state.currentTask,
        bufferSize,
        lastSyncTimestamp: state.lastSyncTimestamp,
      },
    };
  }

  // Helper methods

  private async broadcastToAllTabs(message: any): Promise<void> {
    const tabs = await chrome.tabs.query({});
    const promises = tabs.map(tab => {
      if (tab.id) {
        return chrome.tabs.sendMessage(tab.id, message).catch(() => {
          // Ignore errors for tabs without content script
        });
      }
    });
    await Promise.all(promises);
  }
}

export const messageHandler = new MessageHandler();
