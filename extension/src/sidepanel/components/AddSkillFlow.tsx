import { useState, useEffect } from "react";
import { listSkills, createSkill, activateSkill, sendGregoryMessage } from "../../shared/api-client";
import type { ConnectionState, Skill } from "../../shared/types";

type FlowStage = "list" | "describe" | "done";

export function AddSkillFlow({ connectionState }: { connectionState: ConnectionState }) {
  const [stage, setStage] = useState<FlowStage>("list");
  const [skills, setSkills] = useState<Skill[]>([]);
  const [description, setDescription] = useState("");
  const [newSkill, setNewSkill] = useState<Skill | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isConnected = connectionState === "connected";

  useEffect(() => {
    if (!isConnected) return;
    listSkills().then(setSkills).catch(() => setSkills([]));
  }, [isConnected]);

  async function handleDescribe() {
    if (!description.trim()) return;
    setError(null);
    setLoading(true);
    try {
      // TODO: Replace with a proper Gregory-driven flow:
      //   1. POST /api/gregory/messages with the description
      //   2. Render clarifying questions inline
      //   3. Once Gregory confirms, call createSkill() with the inferred name/description
      await sendGregoryMessage({ source: "extension", conversation_id: null, message: description });
      const skill = await createSkill({ name: description.slice(0, 60), description });
      setNewSkill(skill);
      setSkills((prev) => [skill, ...prev]);
      setStage("done");
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  async function handleActivate(skillId: string) {
    setError(null);
    setLoading(true);
    try {
      await activateSkill(skillId);
      // TODO: Navigate to the Record tab after activation.
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      {/* Skills list */}
      {stage === "list" && (
        <div className="section">
          <div className="section-label">Skills</div>

          {!isConnected && (
            <div className="disconnected-notice">
              <span style={{ color: "var(--text-3)" }}>◌</span>
              Connect to the backend to manage skills.
            </div>
          )}

          {isConnected && skills.length === 0 && (
            <div className="empty-state">
              No skills yet.<br />
              Add one to start teaching the agent.
            </div>
          )}

          {skills.map((skill) => (
            <div key={skill.id} className="skill-row">
              <div className="skill-info">
                <div className="skill-name">{skill.name}</div>
                <div className="skill-meta">
                  {skill.status} · {skill.task_count} tasks · {skill.trajectory_count} trajectories
                </div>
              </div>
              <button
                className="btn btn-ghost"
                style={{ padding: "4px 10px", fontSize: 9 }}
                onClick={() => handleActivate(skill.id)}
                disabled={loading}
              >
                use
              </button>
            </div>
          ))}

          <div className="btn-row">
            <button
              className="btn btn-primary"
              disabled={!isConnected}
              onClick={() => setStage("describe")}
            >
              + add skill
            </button>
          </div>

          {error && <div className="error-msg">{error}</div>}
        </div>
      )}

      {/* Describe new skill */}
      {stage === "describe" && (
        <div className="section">
          <div className="section-label">New Skill</div>
          <p style={{ fontSize: 12, color: "var(--text-2)", lineHeight: 1.6, marginBottom: 12 }}>
            Describe what you want the agent to learn. Gregory will ask clarifying questions.
          </p>

          <div className="flow-step-label">Skill description</div>
          <textarea
            className="textarea"
            rows={4}
            placeholder="e.g. I want the agent to triage my email inbox every morning."
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            disabled={loading}
            style={{ marginBottom: 12 }}
          />

          {error && <div className="error-msg">{error}</div>}

          <div className="btn-row">
            <button className="btn btn-ghost" onClick={() => setStage("list")} disabled={loading}>
              cancel
            </button>
            <button
              className="btn btn-primary"
              disabled={!description.trim() || loading}
              onClick={handleDescribe}
            >
              {loading ? "creating…" : "continue →"}
            </button>
          </div>
        </div>
      )}

      {/* Success */}
      {stage === "done" && newSkill && (
        <div className="section">
          <div className="section-label">Created</div>

          <div style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 15, fontFamily: "var(--font-display)", fontWeight: 700, letterSpacing: "-0.2px", marginBottom: 4 }}>
              {newSkill.name}
            </div>
            <div style={{ fontSize: 12, color: "var(--text-2)", lineHeight: 1.6 }}>
              {newSkill.description}
            </div>
          </div>

          <div className="data-row">
            <div className="data-key">status</div>
            <div className="data-val">{newSkill.status}</div>
          </div>
          <div className="data-row">
            <div className="data-key">id</div>
            <div className="data-val">{newSkill.id}</div>
          </div>

          {/* TODO: Fetch tasks for this skill via GET /api/skills/{skill_id}/tasks
                    and render them here so the user can pick a task to record. */}

          <div className="btn-row">
            <button className="btn btn-primary" onClick={() => handleActivate(newSkill.id)} disabled={loading}>
              activate &amp; record →
            </button>
            <button className="btn btn-ghost" onClick={() => { setStage("list"); setDescription(""); setNewSkill(null); }}>
              done
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
