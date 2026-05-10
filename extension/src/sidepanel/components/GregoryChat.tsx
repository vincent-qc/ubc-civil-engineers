import { useState, useEffect, useRef } from "react";
import { getCurrentConversation, sendGregoryMessage } from "../../shared/api-client";
import type { ConnectionState, GregoryConversation, GregoryMessage } from "../../shared/types";

export function GregoryChat({ connectionState }: { connectionState: ConnectionState }) {
  const [conversation, setConversation] = useState<GregoryConversation | null>(null);
  const [messages, setMessages] = useState<GregoryMessage[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const isConnected = connectionState === "connected";

  useEffect(() => {
    if (!isConnected) return;
    getCurrentConversation()
      .then((conv) => {
        if (conv) {
          setConversation(conv);
          setMessages(conv.messages);
          setConversationId(conv.id);
        }
      })
      .catch(() => {});
  }, [isConnected]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  async function handleSend() {
    if (!draft.trim() || loading) return;
    setError(null);
    const text = draft.trim();
    setDraft("");

    const optimistic: GregoryMessage = {
      id: `opt-${Date.now()}`,
      role: "user",
      content: text,
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, optimistic]);
    setLoading(true);

    try {
      const res = await sendGregoryMessage({
        source: "extension",
        conversation_id: conversationId,
        message: text,
      });
      setConversationId(res.conversation_id);
      setMessages(res.messages);

      // TODO: If res.pending_question is set, render an inline question widget
      //       and call submitUserAnswer() (POST /api/user-answers) with the answer.
    } catch (e) {
      setError(String(e));
      setMessages((prev) => prev.filter((m) => m.id !== optimistic.id));
    } finally {
      setLoading(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  return (
    <div>
      <div className="section">
        <div className="section-label">
          Gregory
          {conversation && (
            <span className="mono" style={{ fontSize: 9, color: "var(--text-3)", marginLeft: 4 }}>
              {conversation.id.slice(0, 8)}
            </span>
          )}
        </div>

        {!isConnected && (
          <div className="disconnected-notice">
            <span style={{ color: "var(--text-3)" }}>◌</span>
            Connect to the backend to chat with Gregory.
          </div>
        )}

        {/* Chat history */}
        <div
          className="chat-history"
          style={{ minHeight: 80, maxHeight: 340, overflowY: "auto" }}
        >
          {messages.length === 0 && !loading && isConnected && (
            <div className="empty-state" style={{ padding: "24px 0" }}>
              Tell Gregory what you want<br />the agent to learn.
            </div>
          )}

          {messages.map((msg) => (
            <Bubble key={msg.id} msg={msg} />
          ))}

          {loading && (
            <div className="msg-thinking">
              <div className="thinking-dot" />
              <div className="thinking-dot" />
              <div className="thinking-dot" />
            </div>
          )}

          <div ref={bottomRef} />
        </div>

        {error && <div className="error-msg">{error}</div>}

        {/* Input */}
        <div className="chat-input-row">
          <textarea
            className="textarea"
            placeholder={
              isConnected
                ? "Message Gregory… ↵ to send"
                : "Backend not connected"
            }
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={!isConnected || loading}
            rows={2}
          />
          <button
            className="chat-send-btn"
            disabled={!isConnected || loading || !draft.trim()}
            onClick={handleSend}
          >
            →
          </button>
        </div>
      </div>
    </div>
  );
}

function Bubble({ msg }: { msg: GregoryMessage }) {
  const cls =
    msg.role === "user"
      ? "msg msg-user"
      : msg.role === "system"
      ? "msg msg-system"
      : "msg msg-assistant";
  return <div className={cls}>{msg.content}</div>;
}
