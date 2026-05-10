// Recording status and task steps

import React, { useState } from 'react';
import type { Trajectory, OnboardingTask } from '../shared/types';

interface RecordingViewProps {
  trajectory: Trajectory;
  currentTask: OnboardingTask;
  bufferSize: number;
  lastSyncTimestamp: number | null;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
}

export function RecordingView({
  trajectory,
  currentTask,
  bufferSize,
  lastSyncTimestamp,
  onPause,
  onResume,
  onStop,
}: RecordingViewProps) {
  const [isPaused, setIsPaused] = useState(false);

  const handlePause = () => {
    setIsPaused(true);
    onPause();
  };

  const handleResume = () => {
    setIsPaused(false);
    onResume();
  };

  const handleStop = () => {
    if (confirm('Are you sure you want to stop recording? This will save the current demonstration.')) {
      onStop();
    }
  };

  const getTimeSinceSync = () => {
    if (!lastSyncTimestamp) return 'Never';
    const seconds = Math.floor((Date.now() - lastSyncTimestamp) / 1000);
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    return `${minutes}m ago`;
  };

  return (
    <div className="popup-container">
      <div className="recording-view">
        <div className="status-indicator">
          <span className={`status-dot ${isPaused ? 'paused' : 'recording'}`}>
            {isPaused ? '⏸' : '●'}
          </span>
          <span className="status-text">
            {isPaused ? 'Paused' : 'Recording...'}
          </span>
        </div>

        <div className="task-instructions">
          <h3>{currentTask.title}</h3>
          <p className="task-prompt">{currentTask.prompt}</p>
          {currentTask.success_hint && (
            <div className="success-hint">
              <strong>Success:</strong> {currentTask.success_hint}
            </div>
          )}
          {currentTask.risk_level !== 'low' && (
            <div className={`risk-warning risk-${currentTask.risk_level}`}>
              ⚠️ {currentTask.risk_level.toUpperCase()} RISK - Be careful with this task
            </div>
          )}
        </div>

        <div className="stats">
          <div className="stat-item">
            <span className="stat-label">Events Captured</span>
            <span className="stat-value">{trajectory.event_count}</span>
          </div>
          <div className="stat-item">
            <span className="stat-label">Buffered</span>
            <span className="stat-value">{bufferSize}</span>
          </div>
          <div className="stat-item">
            <span className="stat-label">Last Sync</span>
            <span className="stat-value">{getTimeSinceSync()}</span>
          </div>
        </div>

        <div className="controls">
          {isPaused ? (
            <button onClick={handleResume} className="btn-secondary">
              Resume
            </button>
          ) : (
            <button onClick={handlePause} className="btn-secondary">
              Pause
            </button>
          )}
          <button onClick={handleStop} className="btn-danger">
            Stop Recording
          </button>
        </div>

        <div className="recording-tips">
          <h4>Tips:</h4>
          <ul>
            <li>Follow the task instructions above</li>
            <li>Perform actions naturally as you normally would</li>
            <li>The extension captures your clicks, typing, and navigation</li>
            <li>Sensitive fields (passwords, payment info) are automatically skipped</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
