// Main popup component with view routing

import React, { useState, useEffect } from 'react';
import { ChatView } from './ChatView';
import { TaskListView } from './TaskListView';
import { RecordingView } from './RecordingView';
import type {
  SkillChatSession,
  UserSkill,
  OnboardingTask,
  Trajectory,
  UserProfile,
} from '../shared/types';

type View = 'loading' | 'chat' | 'tasks' | 'recording';

export function Popup() {
  const [view, setView] = useState<View>('loading');
  const [user, setUser] = useState<UserProfile | null>(null);
  const [chatSession, setChatSession] = useState<SkillChatSession | null>(null);
  const [skill, setSkill] = useState<UserSkill | null>(null);
  const [tasks, setTasks] = useState<OnboardingTask[]>([]);
  const [currentTask, setCurrentTask] = useState<OnboardingTask | null>(null);
  const [trajectory, setTrajectory] = useState<Trajectory | null>(null);
  const [bufferSize, setBufferSize] = useState(0);
  const [lastSyncTimestamp, setLastSyncTimestamp] = useState<number | null>(null);

  // Initialize popup state
  useEffect(() => {
    initializePopup();
  }, []);

  const initializePopup = async () => {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'INITIALIZE_POPUP' });

      if (response.type === 'POPUP_STATE') {
        const { payload } = response;
        setUser(payload.user);
        setChatSession(payload.chatSession);
        setSkill(payload.skill);
        setTasks(payload.tasks);
        setCurrentTask(payload.currentTask);
        setTrajectory(payload.trajectory);
        setBufferSize(payload.bufferSize);
        setLastSyncTimestamp(payload.lastSyncTimestamp);

        // Determine initial view
        if (payload.isRecording && payload.trajectory) {
          setView('recording');
        } else if (payload.skill && payload.tasks.length > 0) {
          setView('tasks');
        } else if (payload.chatSession) {
          setView('chat');
        } else {
          // Start a new chat session
          await handleStartChat();
        }
      }
    } catch (error) {
      console.error('Failed to initialize popup:', error);
      setView('chat');
    }
  };

  const handleStartChat = async () => {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'START_CHAT' });

      if (response.type === 'CHAT_SESSION_UPDATED') {
        setChatSession(response.payload);
        setView('chat');
      }
    } catch (error) {
      console.error('Failed to start chat:', error);
    }
  };

  const handleSendMessage = async (content: string) => {
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'SEND_CHAT_MESSAGE',
        payload: { content },
      });

      if (response.type === 'CHAT_SESSION_UPDATED') {
        setChatSession(response.payload);
      }
    } catch (error) {
      console.error('Failed to send message:', error);
    }
  };

  const handleFinalizeSkill = async () => {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'FINALIZE_SKILL' });

      if (response.type === 'SKILL_FINALIZED') {
        const { session, skill, tasks } = response.payload;
        setChatSession(session);
        setSkill(skill);
        setTasks(tasks);
        setView('tasks');
      }
    } catch (error) {
      console.error('Failed to finalize skill:', error);
    }
  };

  const handleStartTask = async (task: OnboardingTask) => {
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'START_RECORDING',
        payload: { taskId: task.id },
      });

      if (response.type === 'RECORDING_STARTED') {
        setCurrentTask(task);
        setTrajectory(response.payload.trajectory);
        setView('recording');

        // Poll for recording status
        startStatusPolling();
      }
    } catch (error) {
      console.error('Failed to start recording:', error);
    }
  };

  const handleStopRecording = async () => {
    try {
      await chrome.runtime.sendMessage({ type: 'STOP_RECORDING' });

      // Stop polling
      stopStatusPolling();

      setCurrentTask(null);
      setTrajectory(null);
      setBufferSize(0);
      setView('tasks');
    } catch (error) {
      console.error('Failed to stop recording:', error);
    }
  };

  const handlePauseRecording = async () => {
    try {
      await chrome.runtime.sendMessage({ type: 'PAUSE_RECORDING' });
    } catch (error) {
      console.error('Failed to pause recording:', error);
    }
  };

  const handleResumeRecording = async () => {
    try {
      await chrome.runtime.sendMessage({ type: 'RESUME_RECORDING' });
    } catch (error) {
      console.error('Failed to resume recording:', error);
    }
  };

  // Status polling
  let statusInterval: ReturnType<typeof setInterval> | null = null;

  const startStatusPolling = () => {
    if (statusInterval) return;

    statusInterval = setInterval(async () => {
      try {
        const response = await chrome.runtime.sendMessage({ type: 'GET_RECORDING_STATUS' });

        if (response.type === 'RECORDING_STATUS') {
          const { payload } = response;
          setBufferSize(payload.bufferSize);
          setLastSyncTimestamp(payload.lastSyncTimestamp);

          if (payload.trajectory) {
            setTrajectory(payload.trajectory);
          }
        }
      } catch (error) {
        console.error('Failed to get recording status:', error);
      }
    }, 1000); // Poll every second
  };

  const stopStatusPolling = () => {
    if (statusInterval) {
      clearInterval(statusInterval);
      statusInterval = null;
    }
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopStatusPolling();
    };
  }, []);

  // Render appropriate view
  if (view === 'loading') {
    return (
      <div className="popup-container">
        <div className="loading">Loading...</div>
      </div>
    );
  }

  if (view === 'chat' && chatSession) {
    return (
      <ChatView
        session={chatSession}
        onSendMessage={handleSendMessage}
        onStartRecording={handleFinalizeSkill}
      />
    );
  }

  if (view === 'tasks' && skill && tasks.length > 0) {
    return (
      <TaskListView
        skill={skill}
        tasks={tasks}
        onStartTask={handleStartTask}
        onNewSkill={handleStartChat}
      />
    );
  }

  if (view === 'recording' && trajectory && currentTask) {
    return (
      <RecordingView
        trajectory={trajectory}
        currentTask={currentTask}
        bufferSize={bufferSize}
        lastSyncTimestamp={lastSyncTimestamp}
        onPause={handlePauseRecording}
        onResume={handleResumeRecording}
        onStop={handleStopRecording}
      />
    );
  }

  return (
    <div className="popup-container">
      <div className="error">Something went wrong. Please reload the extension.</div>
    </div>
  );
}
