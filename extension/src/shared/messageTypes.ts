// Message schemas for chrome.runtime.sendMessage communication

import type {
  BrowserObservation,
  BrowserAction,
  Actor,
  BrowserEventType,
  SkillChatSession,
  UserSkill,
  OnboardingTask,
  Trajectory,
  UserProfile,
} from './types';

// Content script -> Background messages
export type CaptureEventMessage = {
  type: 'CAPTURE_EVENT';
  payload: {
    actor: Actor;
    event_type: BrowserEventType;
    observation?: BrowserObservation;
    action?: BrowserAction;
    question?: string;
    answer?: string;
  };
};

export type ContentReadyMessage = {
  type: 'CONTENT_READY';
};

// Background -> Content script messages
export type StartCaptureMessage = {
  type: 'START_CAPTURE';
  payload: {
    trajectoryId: string;
    userId: string;
    taskId?: string;
  };
};

export type StopCaptureMessage = {
  type: 'STOP_CAPTURE';
};

export type PauseCaptureMessage = {
  type: 'PAUSE_CAPTURE';
};

export type ResumeCaptureMessage = {
  type: 'RESUME_CAPTURE';
};

// Popup -> Background messages
export type InitializePopupMessage = {
  type: 'INITIALIZE_POPUP';
};

export type StartChatMessage = {
  type: 'START_CHAT';
};

export type SendChatMessageMessage = {
  type: 'SEND_CHAT_MESSAGE';
  payload: {
    content: string;
  };
};

export type FinalizeSkillMessage = {
  type: 'FINALIZE_SKILL';
};

export type StartRecordingMessage = {
  type: 'START_RECORDING';
  payload: {
    taskId: string;
  };
};

export type StopRecordingMessage = {
  type: 'STOP_RECORDING';
};

export type PauseRecordingMessage = {
  type: 'PAUSE_RECORDING';
};

export type ResumeRecordingMessage = {
  type: 'RESUME_RECORDING';
};

export type GetRecordingStatusMessage = {
  type: 'GET_RECORDING_STATUS';
};

// Background -> Popup messages
export type ChatSessionUpdatedMessage = {
  type: 'CHAT_SESSION_UPDATED';
  payload: SkillChatSession;
};

export type SkillFinalizedMessage = {
  type: 'SKILL_FINALIZED';
  payload: {
    session: SkillChatSession;
    skill: UserSkill;
    tasks: OnboardingTask[];
  };
};

export type RecordingStartedMessage = {
  type: 'RECORDING_STARTED';
  payload: {
    trajectory: Trajectory;
  };
};

export type RecordingStoppedMessage = {
  type: 'RECORDING_STOPPED';
};

export type RecordingStatusMessage = {
  type: 'RECORDING_STATUS';
  payload: {
    isRecording: boolean;
    trajectory: Trajectory | null;
    currentTask: OnboardingTask | null;
    bufferSize: number;
    lastSyncTimestamp: number | null;
  };
};

export type PopupStateMessage = {
  type: 'POPUP_STATE';
  payload: {
    user: UserProfile | null;
    chatSession: SkillChatSession | null;
    skill: UserSkill | null;
    tasks: OnboardingTask[];
    currentTask: OnboardingTask | null;
    trajectory: Trajectory | null;
    isRecording: boolean;
    bufferSize: number;
    lastSyncTimestamp: number | null;
  };
};

export type ErrorMessage = {
  type: 'ERROR';
  payload: {
    message: string;
    error?: string;
  };
};

// Union types for type safety
export type ContentToBackgroundMessage = CaptureEventMessage | ContentReadyMessage;

export type BackgroundToContentMessage =
  | StartCaptureMessage
  | StopCaptureMessage
  | PauseCaptureMessage
  | ResumeCaptureMessage;

export type PopupToBackgroundMessage =
  | InitializePopupMessage
  | StartChatMessage
  | SendChatMessageMessage
  | FinalizeSkillMessage
  | StartRecordingMessage
  | StopRecordingMessage
  | PauseRecordingMessage
  | ResumeRecordingMessage
  | GetRecordingStatusMessage;

export type BackgroundToPopupMessage =
  | ChatSessionUpdatedMessage
  | SkillFinalizedMessage
  | RecordingStartedMessage
  | RecordingStoppedMessage
  | RecordingStatusMessage
  | PopupStateMessage
  | ErrorMessage;

export type ExtensionMessage =
  | ContentToBackgroundMessage
  | BackgroundToContentMessage
  | PopupToBackgroundMessage
  | BackgroundToPopupMessage;
