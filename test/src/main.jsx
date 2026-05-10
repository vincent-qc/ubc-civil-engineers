import React, { Component, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

const computerUse = window.computerUse || {
  config: async () => ({ model: 'GPT 5.4', criticModel: 'GPT 5.4', maxTurns: 8, hasApiKey: false, baseUrl: '' }),
  run: async () => ({ ok: false, error: 'Electron preload API is unavailable.' }),
  stop: async () => ({ ok: false }),
  suggestTrajectories: async () => ({ ok: false, error: 'Electron preload API is unavailable.' }),
  startRecording: async () => ({ ok: false, error: 'Electron preload API is unavailable.' }),
  stopRecording: async () => ({ ok: false, error: 'Electron preload API is unavailable.' }),
  skills: async () => ({ ok: true, skills: [] }),
  toggleSkill: async () => ({ ok: true, skills: [] }),
  onEvent: () => () => {},
  onRecordingEvent: () => () => {}
};

class AppErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error) {
    console.error(error);
  }

  render() {
    if (this.state.error) {
      return (
        <main className="page-shell">
          <section className="boot-error">
            <h1>Renderer Error</h1>
            <p>{this.state.error.message}</p>
          </section>
        </main>
      );
    }

    return this.props.children;
  }
}

function useHashRoute() {
  const [route, setRoute] = useState(() => window.location.hash.slice(1) || '/');

  useEffect(() => {
    const updateRoute = () => setRoute(window.location.hash.slice(1) || '/');
    window.addEventListener('hashchange', updateRoute);
    return () => window.removeEventListener('hashchange', updateRoute);
  }, []);

  return route;
}

function NavLink({ href, children }) {
  return <a href={href}>{children}</a>;
}

function RunPage() {
  const [config, setConfig] = useState({ model: 'GPT 5.4', criticModel: 'GPT 5.4', maxTurns: 8, hasApiKey: false, baseUrl: '' });
  const [skills, setSkills] = useState([]);
  const [goal, setGoal] = useState('');
  const [model, setModel] = useState('GPT 5.4');
  const [maxTurns, setMaxTurns] = useState(8);
  const [running, setRunning] = useState(false);
  const [events, setEvents] = useState([]);
  const [screenshot, setScreenshot] = useState('');
  const unsubscribeRef = useRef(null);

  useEffect(() => {
    computerUse
      .config()
      .then((nextConfig) => {
        setConfig(nextConfig);
        setModel(nextConfig.model);
        setMaxTurns(nextConfig.maxTurns);
      })
      .catch((error) => {
        setEvents((previous) => [...previous, { type: 'error', text: error.message }]);
      });

    computerUse
      .skills()
      .then((result) => {
        if (result.ok && Array.isArray(result.skills)) {
          setSkills(result.skills);
        }
      })
      .catch((error) => {
        setEvents((previous) => [...previous, { type: 'error', text: error.message }]);
      });

    unsubscribeRef.current = computerUse.onEvent((event) => {
      setEvents((previous) => [...previous, event].slice(-200));
      if (event.type === 'screenshot') {
        setScreenshot(event.dataUrl);
      }
      if (event.type === 'idle') {
        setRunning(false);
      }
    });

    return () => unsubscribeRef.current?.();
  }, []);

  async function toggleSkill(skill) {
    const result = await computerUse.toggleSkill(skill.id);
    if (result.ok) {
      setSkills(result.skills);
    }
  }

  async function runTask() {
    const trimmedGoal = goal.trim();
    if (!trimmedGoal || running) {
      return;
    }

    setEvents([]);
    setRunning(true);
    const result = await computerUse.run({
      goal: trimmedGoal,
      model,
      maxTurns: Number(maxTurns || 8)
    });

    if (!result.ok) {
      setEvents((previous) => [...previous, { type: 'error', text: result.error }]);
      setRunning(false);
    }
  }

  async function stopTask() {
    await computerUse.stop();
  }

  return (
    <section className="workspace">
      <aside className="skill-sidebar" aria-label="Skills">
        <div>
          <h2>Skills</h2>
          <p>{skills.filter((skill) => skill.enabled !== false).length} enabled</p>
        </div>
        <div className="skill-list">
          {skills.length ? (
            skills.map((skill) => (
              <button
                key={skill.id}
                type="button"
                className={`skill-toggle ${skill.enabled === false ? 'disabled' : ''}`}
                onClick={() => toggleSkill(skill)}
                title={skill.enabled === false ? 'Disabled' : 'Enabled'}
              >
                <span>{skill.name || skill.label}</span>
                <small>{skill.enabled === false ? 'disabled' : 'enabled'}</small>
              </button>
            ))
          ) : (
            <p className="empty-state">No skills yet</p>
          )}
        </div>
      </aside>

      <div className="control-panel">
        <div className="brand-row">
          <div>
            <h2>Run</h2>
            <p>
              {config.hasApiKey
                ? `Configured for ${config.baseUrl}. Enabled skills are added as in-context examples.`
                : 'Set CLOD_API_KEY before starting the app.'}
            </p>
          </div>
          <div className={`state-pill ${running ? 'running' : ''}`}>{running ? 'Running' : 'Idle'}</div>
        </div>

        <label>
          <span>Task</span>
          <textarea
            value={goal}
            disabled={running}
            rows={6}
            placeholder="Ask the model to operate your desktop..."
            onChange={(event) => setGoal(event.target.value)}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                event.preventDefault();
                runTask();
              }
            }}
          />
        </label>

        <div className="settings-grid">
          <label>
            <span>Model</span>
            <input value={model} disabled={running} onChange={(event) => setModel(event.target.value)} />
          </label>
          <label>
            <span>Turns</span>
            <input
              type="number"
              min="1"
              max="20"
              value={maxTurns}
              disabled={running}
              onChange={(event) => setMaxTurns(event.target.value)}
            />
          </label>
        </div>

        <div className="actions">
          <button type="button" onClick={runTask} disabled={running || !goal.trim()}>
            Run
          </button>
          <button type="button" onClick={stopTask} disabled={!running}>
            Stop
          </button>
        </div>
      </div>

      <div className="screenshot-panel">
        <div className="screenshot-frame">
          {screenshot ? <img src={screenshot} alt="Latest desktop screenshot" /> : <div className="empty-state">No screenshot yet</div>}
        </div>
      </div>

      <div className="activity-panel">
        <h2>Activity</h2>
        <pre>
          {events
            .map((event) => {
              if (event.type === 'screenshot') {
                return `screenshot: ${event.width}x${event.height}`;
              }
              if (event.type === 'action') {
                return `action: ${JSON.stringify(event.action)}`;
              }
              if (event.type === 'critic') {
                return `critic: ${event.verdict}`;
              }
              if (event.type === 'assistant') {
                return `assistant: ${event.text}`;
              }
              if (event.type === 'error') {
                return `error: ${event.text}`;
              }
              if (event.type === 'done') {
                return `done: ${event.answer}`;
              }
              return `${event.type}${event.turn ? ` ${event.turn}` : ''}`;
            })
            .join('\n')}
        </pre>
      </div>
    </section>
  );
}

function SettingsPage() {
  return (
    <section className="settings-page">
      <div className="settings-list">
        <div>
          <span>API key</span>
          <code>CLOD_API_KEY</code>
        </div>
        <div>
          <span>Base URL</span>
          <code>CLOD_BASE_URL=https://api.clod.io/v1</code>
        </div>
        <div>
          <span>Model</span>
          <code>CLOD_MODEL=&quot;GPT 5.4&quot;</code>
        </div>
        <div>
          <span>Critic model</span>
          <code>CLOD_CRITIC_MODEL=&quot;GPT 5.4&quot;</code>
        </div>
        <div>
          <span>Turn limit</span>
          <code>CLOD_MAX_TURNS=8</code>
        </div>
      </div>

      <div className="settings-note">
        <h2>Desktop Permissions</h2>
        <p>
          Grant Screen Recording and Accessibility permission to the app or terminal that launches Electron. The
          main process calls the native desktop driver directly.
        </p>
      </div>
    </section>
  );
}

function AddSkillPage() {
  const [message, setMessage] = useState('');
  const [submittedMessage, setSubmittedMessage] = useState('');
  const [trajectoryTasks, setTrajectoryTasks] = useState([]);
  const [activeTaskIndex] = useState(0);
  const [loadingTrajectories, setLoadingTrajectories] = useState(false);
  const [trajectoryError, setTrajectoryError] = useState('');
  const [recording, setRecording] = useState(false);
  const [recordingCount, setRecordingCount] = useState(0);
  const [recordingError, setRecordingError] = useState('');
  const [trajectoryDatapoints, setTrajectoryDatapoints] = useState([]);
  const [analysisStatus, setAnalysisStatus] = useState('');
  const [analysisError, setAnalysisError] = useState('');

  useEffect(() => {
    return computerUse.onRecordingEvent((event) => {
      if (event.type === 'started') {
        setRecording(true);
        setRecordingCount(0);
        setRecordingError('');
        setAnalysisStatus('');
        setAnalysisError('');
      }
      if (event.type === 'sample') {
        setRecordingCount(event.count);
      }
      if (event.type === 'stopped') {
        setRecording(false);
        setRecordingCount(event.datapoint.trajectory.length);
        setTrajectoryDatapoints((previous) => [...previous, event.datapoint]);
      }
      if (event.type === 'analyzing') {
        setAnalysisStatus('Analyzing trajectory with CLOD');
        setAnalysisError('');
      }
      if (event.type === 'analyzed') {
        setAnalysisStatus('CUA in-context material ready');
        setTrajectoryDatapoints((previous) => {
          const next = [...previous];
          const lastIndex = next.length - 1;
          if (lastIndex >= 0) {
            next[lastIndex] = event.datapoint;
          } else {
            next.push(event.datapoint);
          }
          return next;
        });
      }
      if (event.type === 'skill_saved') {
        setAnalysisStatus('Skill saved. Returning to chat.');
        window.setTimeout(() => {
          window.location.hash = '#/';
        }, 800);
      }
      if (event.type === 'analysis_error') {
        setAnalysisStatus('');
        setAnalysisError(event.text);
      }
      if (event.type === 'error') {
        setRecordingError(event.text);
        setRecording(false);
      }
    });
  }, []);

  async function submitMessage(event) {
    event.preventDefault();

    const trimmedMessage = message.trim();
    if (!trimmedMessage) {
      return;
    }

    setSubmittedMessage(trimmedMessage);
    setTrajectoryTasks([]);
    setTrajectoryError('');
    setRecordingError('');
    setRecordingCount(0);
    setTrajectoryDatapoints([]);
    setAnalysisStatus('');
    setAnalysisError('');
    setLoadingTrajectories(true);

    const result = await computerUse.suggestTrajectories({ skillPrompt: trimmedMessage });
    if (result.ok) {
      setTrajectoryTasks(result.tasks);
    } else {
      setTrajectoryError(result.error || 'Could not generate trajectory tasks.');
    }
    setLoadingTrajectories(false);
  }

  async function startRecording(activeTask) {
    if (!activeTask || recording) {
      return;
    }

    setRecordingError('');
    setAnalysisStatus('');
    setAnalysisError('');
    setRecordingCount(0);
    const result = await computerUse.startRecording({ label: activeTask.instruction });
    if (!result.ok) {
      setRecordingError(result.error || 'Could not start recording.');
      setRecording(false);
    }
  }

  async function endRecording() {
    if (!recording) {
      return;
    }

    const result = await computerUse.stopRecording();
    if (!result.ok) {
      setRecordingError(result.error || 'Could not stop recording.');
      setRecording(false);
    }
  }

  if (submittedMessage) {
    const activeTask = trajectoryTasks[activeTaskIndex];
    const latestDatapoint = trajectoryDatapoints.at(-1);

    return (
      <section className="trajectory-interface" aria-label="Trajectory tasks">
        <aside className="trajectory-context">
          <span>Learning goal</span>
          <h2>{submittedMessage}</h2>
        </aside>

        <div className="trajectory-stage">
          {loadingTrajectories ? (
            <div className="trajectory-card">
              <span className="trajectory-kicker">Generating</span>
              <h2>Choosing useful trajectories</h2>
              <p>Asking CLOD for three recording tasks that cover the skill from different angles.</p>
            </div>
          ) : trajectoryError ? (
            <div className="trajectory-card">
              <span className="trajectory-kicker">Needs attention</span>
              <h2>Could not generate tasks</h2>
              <p>{trajectoryError}</p>
            </div>
          ) : activeTask ? (
            <div className="trajectory-card">
              <div className="trajectory-card-header">
                <span className="trajectory-kicker">Task {activeTaskIndex + 1} of {trajectoryTasks.length}</span>
              </div>
              <h2>{activeTask.title}</h2>
              <p className="trajectory-instruction">{activeTask.instruction}</p>
              {activeTask.why ? <p className="trajectory-why">{activeTask.why}</p> : null}
              <div className={`recording-status ${recording ? 'running' : ''}`}>
                <span>{recording ? 'Recording' : 'Ready'}</span>
                <span>{recordingCount} datapoints</span>
              </div>
              {recordingError ? <p className="recording-error">{recordingError}</p> : null}
              {analysisStatus ? <p className="analysis-status">{analysisStatus}</p> : null}
              {analysisError ? <p className="recording-error">{analysisError}</p> : null}
              <div className="recording-actions">
                <button type="button" onClick={() => startRecording(activeTask)} disabled={recording}>
                  start
                </button>
                <button type="button" onClick={endRecording} disabled={!recording}>
                  end recording
                </button>
              </div>
              {latestDatapoint?.cuaAnalysis ? (
                <div className="cua-analysis">
                  <span className="trajectory-kicker">CUA in-context material</span>
                  <p>{latestDatapoint.cuaAnalysis.summary}</p>
                  {latestDatapoint.cuaAnalysis.useful_locations?.length ? (
                    <div className="location-list">
                      {latestDatapoint.cuaAnalysis.useful_locations.slice(0, 5).map((location, index) => (
                        <div key={`${location.name}-${index}`} className="location-row">
                          <span>{location.name}</span>
                          <code>x={location.x}, y={location.y}</code>
                        </div>
                      ))}
                    </div>
                  ) : null}
                  <pre>{JSON.stringify(latestDatapoint.cuaAnalysis, null, 2)}</pre>
                </div>
              ) : null}
              {latestDatapoint ? (
                <div className="trajectory-datapoint">
                  <span className="trajectory-kicker">Stored datapoint</span>
                  <pre>{JSON.stringify(latestDatapoint, null, 2)}</pre>
                </div>
              ) : null}
            </div>
          ) : (
            <div className="trajectory-card">
              <span className="trajectory-kicker">No tasks</span>
              <h2>No trajectories were generated</h2>
              <p>Try a more specific skill prompt.</p>
            </div>
          )}
        </div>
      </section>
    );
  }

  return (
    <section className="skill-chat-interface" aria-label="Add skill chat">
      <aside className="skill-prompt">
        <h2>what would you like me to learn</h2>
      </aside>

      <form className="skill-chat" onSubmit={submitMessage}>
        <div className="skill-chat-thread" aria-live="polite">
          <div className="assistant-bubble">Tell me the skill you want to add.</div>
        </div>

        <label className="skill-chat-input">
          <span>Message</span>
          <textarea
            value={message}
            rows={5}
            placeholder="Describe what you want the app to learn..."
            onChange={(event) => setMessage(event.target.value)}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                submitMessage(event);
              }
            }}
          />
        </label>

        <div className="actions">
          <button type="submit" disabled={!message.trim()}>
            Send
          </button>
        </div>
      </form>
    </section>
  );
}

function App() {
  const route = useHashRoute();
  const page = route === '/settings' ? <SettingsPage /> : route === '/add-skill' ? <AddSkillPage /> : <RunPage />;

  return (
    <main className="page-shell">
      <header className="topbar">
        <div>
          <h1>Gregory</h1>
          <p>Electron main process, React renderer, native desktop control.</p>
        </div>
        <nav aria-label="Routes">
          <NavLink href="#/">Run</NavLink>
          <NavLink href="#/settings">Settings</NavLink>
          <NavLink href="#/add-skill">Add Skill</NavLink>
        </nav>
      </header>
      {page}
    </main>
  );
}

createRoot(document.querySelector('#root')).render(
  <AppErrorBoundary>
    <App />
  </AppErrorBoundary>
);
