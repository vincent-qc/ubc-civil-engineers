// Chat interface for conversing with agent

import React, { useState, useEffect, useRef } from 'react';
import type { SkillChatSession } from '../shared/types';

interface ChatViewProps {
  session: SkillChatSession;
  onSendMessage: (content: string) => void;
  onStartRecording: () => void;
}

export function ChatView({ session, onSendMessage, onStartRecording }: ChatViewProps) {
  const [input, setInput] = useState('');
  const [isSending, setIsSending] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const isReadyToRecord = session.status === 'ready_for_tasks';

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [session.messages]);

  const handleSend = async () => {
    if (input.trim() && !isSending) {
      setIsSending(true);
      onSendMessage(input.trim());
      setInput('');
      // Reset sending state after a delay (message should update via state)
      setTimeout(() => setIsSending(false), 500);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="popup-container">
      <div className="header">
        <h2>Skill Chat</h2>
        <p className="subtitle">Describe the workflow you want to automate</p>
      </div>

      <div className="chat-view">
        <div className="messages">
          {session.messages.map((msg, idx) => (
            <div key={idx} className={`message message-${msg.role}`}>
              <div className="message-header">
                <strong>{msg.role === 'agent' ? '🤖 Agent' : '👤 You'}</strong>
                <span className="timestamp">
                  {new Date(msg.created_at).toLocaleTimeString()}
                </span>
              </div>
              <div className="message-content">{msg.content}</div>
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>

        {isReadyToRecord ? (
          <div className="ready-section">
            <div className="ready-message">
              ✓ Ready to create your skill and start recording demonstrations
            </div>
            <button onClick={onStartRecording} className="btn-primary btn-large">
              Create Skill & View Tasks
            </button>
          </div>
        ) : (
          <div className="input-area">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyPress={handleKeyPress}
              placeholder="Type your response..."
              rows={3}
              disabled={isSending}
            />
            <button
              onClick={handleSend}
              disabled={!input.trim() || isSending}
              className="btn-primary"
            >
              {isSending ? 'Sending...' : 'Send'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
