import * as React from 'react';
import { Component, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

const computerUse = window.computerUse || {
  config: async () => ({ provider: 'openai', model: 'gpt-5.5', maxTurns: 8, hasApiKey: false, baseUrl: '' }),
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

function normalizeActionKeys(value) {
  if (Array.isArray(value)) {
    return value;
  }
  if (value === undefined || value === null) {
    return [];
  }
  return [value];
}

function conciseText(value) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (text.length <= 80) {
    return text;
  }
  return `${text.slice(0, 77)}...`;
}

function typedTextFromKeypress(action) {
  const keys = normalizeActionKeys(action.keys ?? action.key ?? action.text);
  if (keys.length === 0) {
    return '';
  }

  const characters = keys.map((key) => {
    const value = String(key);
    if (value.toLowerCase() === 'space') {
      return ' ';
    }
    return value.length === 1 ? value : null;
  });

  return characters.every((character) => character !== null) ? characters.join('') : '';
}

function formatAction(action = {}) {
  const type = String(action.type || '').toLowerCase();

  if (type === 'click') {
    return 'click';
  }
  if (type === 'double_click') {
    return 'double click';
  }
  if (type === 'type') {
    return `typed: ${conciseText(action.text)}`;
  }
  if (type === 'keypress') {
    const typedText = typedTextFromKeypress(action);
    if (typedText) {
      return `typed: ${conciseText(typedText)}`;
    }
    const keys = normalizeActionKeys(action.keys ?? action.key ?? action.text).map(String);
    return keys.length ? `keypress: ${keys.join(' + ')}` : 'keypress';
  }
  if (type === 'scroll') {
    return 'scroll';
  }
  if (type === 'drag') {
    return 'drag';
  }
  if (type === 'move') {
    return 'move';
  }
  if (type === 'wait') {
    return 'wait';
  }
  if (type === 'screenshot') {
    return 'cua event';
  }

  return type || 'action';
}

function formatActivityEvent(event) {
  if (event.type === 'start') {
    return 'start';
  }
  if (event.type === 'screenshot') {
    return 'cua event';
  }
  if (event.type === 'action') {
    return formatAction(event.action);
  }
  if (event.type === 'error') {
    return `error: ${event.text}`;
  }
  if (event.type === 'done') {
    return 'done';
  }

  return null;
}

function RunPage() {
  const [config, setConfig] = useState({ provider: 'openai', model: 'gpt-5.5', maxTurns: 8, hasApiKey: false, baseUrl: '' });
  const [skills, setSkills] = useState([]);
  const [goal, setGoal] = useState('');
  const [model, setModel] = useState('gpt-5.5');
  const [maxTurns, setMaxTurns] = useState(8);
  const [running, setRunning] = useState(false);
  const [events, setEvents] = useState([]);
  const [screenshot, setScreenshot] = useState('');
  const unsubscribeRef = useRef(null);

  async function refreshConfig() {
    const nextConfig = await computerUse.config();
    setConfig(nextConfig);
    setModel(nextConfig.model);
    setMaxTurns(nextConfig.maxTurns);
  }

  useEffect(() => {
    refreshConfig()
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
      refreshConfig().catch((error) => {
        setEvents((previous) => [...previous, { type: 'error', text: error.message }]);
      });
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
            .map(formatActivityEvent)
            .filter(Boolean)
            .join('\n')}
        </pre>
      </div>
    </section>
  );
}

function SettingsPage() {
  const [config, setConfig] = useState({ provider: 'openai', model: 'gpt-5.5', maxTurns: 8, baseUrl: 'https://api.openai.com/v1' });

  useEffect(() => {
    computerUse.config().then(setConfig).catch(() => {});
  }, []);

  const usesClod = config.provider === 'clod';
  const apiKeyName = usesClod ? 'CLOD_API_KEY' : 'OPENAI_API_KEY';
  const baseUrlName = usesClod ? 'CLOD_BASE_URL' : 'OPENAI_BASE_URL';
  const modelName = usesClod ? 'CLOD_MODEL' : 'CUA_MODEL';
  const turnLimitName = usesClod ? 'CLOD_MAX_TURNS' : 'CUA_MAX_TURNS';

  return (
    <section className="settings-page">
      <div className="settings-list">
        <div>
          <span>API key</span>
          <code>{apiKeyName}</code>
        </div>
        <div>
          <span>Base URL</span>
          <code>
            {baseUrlName}={config.baseUrl}
          </code>
        </div>
        <div>
          <span>Active route</span>
          <code>{usesClod ? '0 enabled skills -> clod' : '1+ enabled skills -> openai'}</code>
        </div>
        <div>
          <span>Model</span>
          <code>
            {modelName}={config.model}
          </code>
        </div>
        <div>
          <span>Turn limit</span>
          <code>
            {turnLimitName}={config.maxTurns}
          </code>
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
  const [activeTaskIndex, setActiveTaskIndex] = useState(0);
  const [loadingTrajectories, setLoadingTrajectories] = useState(false);
  const [trajectoryError, setTrajectoryError] = useState('');
  const [activeRecordingTaskId, setActiveRecordingTaskId] = useState(null);
  const activeRecordingTaskIdRef = useRef(null);
  const returnedToMainRef = useRef(false);

  function setActiveRecordingTask(taskId) {
    activeRecordingTaskIdRef.current = taskId;
    setActiveRecordingTaskId(taskId);
  }

  function taskWithState(task, index) {
    return {
      ...task,
      id: task.id || `trajectory-${Date.now()}-${index}`,
      status: 'ready',
      recordingCount: 0,
      datapoint: null,
      reportStatus: 'idle',
      analysisStatus: '',
      analysisError: '',
      recordingError: ''
    };
  }

  function updateTaskAt(index, updater) {
    if (index === null || index === undefined || index < 0) {
      return;
    }

    setTrajectoryTasks((previous) =>
      previous.map((task, taskIndex) => (taskIndex === index ? updater(task) : task))
    );
  }

  function updateTaskById(taskId, updater) {
    if (!taskId) {
      return;
    }

    setTrajectoryTasks((previous) =>
      previous.map((task) => (task.id === taskId ? updater(task) : task))
    );
  }

  function nextReadyTaskIndex(tasks, currentIndex) {
    for (let index = currentIndex + 1; index < tasks.length; index += 1) {
      if (tasks[index].status === 'ready') {
        return index;
      }
    }
    return currentIndex;
  }

  useEffect(() => {
    return computerUse.onRecordingEvent((event) => {
      const taskId = event.taskId || activeRecordingTaskIdRef.current;
      if (event.type === 'started') {
        updateTaskById(taskId, (task) => ({
          ...task,
          status: task.status === 'stopping' || task.status === 'completed' ? task.status : 'recording',
          recordingCount: 0,
          recordingError: '',
          analysisStatus: '',
          analysisError: ''
        }));
      }
      if (event.type === 'sample') {
        updateTaskById(taskId, (task) => ({ ...task, recordingCount: event.count }));
      }
      if (event.type === 'stopped') {
        updateTaskById(taskId, (task) => ({
          ...task,
          status: 'completed',
          recordingCount: event.datapoint.trajectory.length,
          datapoint: event.datapoint,
          reportStatus: 'pending',
          analysisStatus: 'Waiting for GPT CUA report'
        }));
        if (activeRecordingTaskIdRef.current === taskId) {
          setActiveRecordingTask(null);
        }
      }
      if (event.type === 'analyzing') {
        updateTaskById(taskId, (task) => ({
          ...task,
          reportStatus: 'pending',
          analysisStatus: 'Analyzing trajectory with GPT CUA',
          analysisError: ''
        }));
      }
      if (event.type === 'analyzed') {
        updateTaskById(taskId, (task) => ({
          ...task,
          datapoint: event.datapoint,
          reportStatus: 'done',
          analysisStatus: 'CUA in-context material ready'
        }));
      }
      if (event.type === 'skill_saved') {
        updateTaskById(taskId, (task) => ({
          ...task,
          reportStatus: task.reportStatus === 'done' ? 'done' : task.reportStatus,
          analysisStatus: 'Skill saved. Review the raw data and GPT CUA summary below.'
        }));
      }
      if (event.type === 'discarded') {
        updateTaskById(taskId, (task) => ({
          ...task,
          status: 'ready',
          recordingCount: 0,
          analysisStatus: event.reason || 'Previous recording discarded.'
        }));
        if (activeRecordingTaskIdRef.current === taskId) {
          setActiveRecordingTask(null);
        }
      }
      if (event.type === 'analysis_error') {
        updateTaskById(taskId, (task) => ({
          ...task,
          datapoint: event.datapoint || task.datapoint,
          reportStatus: 'error',
          analysisStatus: '',
          analysisError: event.text
        }));
      }
      if (event.type === 'error') {
        updateTaskById(taskId, (task) => ({
          ...task,
          status: 'ready',
          recordingError: event.text
        }));
        if (activeRecordingTaskIdRef.current === taskId) {
          setActiveRecordingTask(null);
        }
      }
    });
  }, []);

  useEffect(() => {
    if (returnedToMainRef.current || !submittedMessage || trajectoryTasks.length === 0) {
      return;
    }

    const allRecordingsComplete = trajectoryTasks.every((task) => task.status === 'completed');
    const allReportsFinished = trajectoryTasks.every((task) => task.reportStatus === 'done' || task.reportStatus === 'error');
    if (!allRecordingsComplete || !allReportsFinished) {
      return;
    }

    returnedToMainRef.current = true;
    window.setTimeout(() => {
      window.location.hash = '#/';
    }, 800);
  }, [submittedMessage, trajectoryTasks]);

  async function submitMessage(event) {
    event.preventDefault();

    const trimmedMessage = message.trim();
    if (!trimmedMessage) {
      return;
    }

    setSubmittedMessage(trimmedMessage);
    returnedToMainRef.current = false;
    setTrajectoryTasks([]);
    setActiveTaskIndex(0);
    setTrajectoryError('');
    setActiveRecordingTask(null);
    setLoadingTrajectories(true);

    const result = await computerUse.suggestTrajectories({ skillPrompt: trimmedMessage });
    if (result.ok) {
      setTrajectoryTasks(result.tasks.map(taskWithState));
    } else {
      setTrajectoryError(result.error || 'Could not generate trajectory tasks.');
    }
    setLoadingTrajectories(false);
  }

  async function startRecording(taskIndex) {
    const activeTask = trajectoryTasks[taskIndex];
    if (
      !activeTask ||
      activeRecordingTaskId === activeTask.id ||
      activeTask.status === 'completed'
    ) {
      return;
    }

    setActiveRecordingTask(activeTask.id);
    updateTaskAt(taskIndex, (task) => ({
      ...task,
      status: 'starting',
      recordingError: '',
      analysisStatus: '',
      analysisError: '',
      recordingCount: 0
    }));
    const result = await computerUse.startRecording({ label: activeTask.instruction, taskId: activeTask.id });
    if (!result.ok) {
      updateTaskAt(taskIndex, (task) => ({
        ...task,
        status: 'ready',
        recordingError: result.error || 'Could not start recording.'
      }));
      if (activeRecordingTaskIdRef.current === activeTask.id) {
        setActiveRecordingTask(null);
      }
      return;
    }

    updateTaskAt(taskIndex, (task) => ({
      ...task,
      status: 'recording',
      recordingError: '',
      analysisStatus: '',
      analysisError: ''
    }));
  }

  async function endRecording() {
    const taskId = activeRecordingTaskIdRef.current;
    const taskIndex = taskId ? trajectoryTasks.findIndex((task) => task.id === taskId) : activeTaskIndex;
    const activeTask = trajectoryTasks[taskIndex];
    if (activeTask?.status !== 'recording') {
      return;
    }

    updateTaskAt(taskIndex, (task) => ({ ...task, status: 'stopping', analysisStatus: 'Stopping recording' }));
    if (activeRecordingTaskIdRef.current === taskId) {
      setActiveRecordingTask(null);
    }
    setActiveTaskIndex((index) => nextReadyTaskIndex(trajectoryTasks, index));
    const result = await computerUse.stopRecording();
    if (!result.ok) {
      updateTaskAt(taskIndex, (task) => ({
        ...task,
        status: 'ready',
        recordingError: result.error || 'Could not stop recording.'
      }));
      return;
    }
  }

  if (submittedMessage) {
    const activeTask = trajectoryTasks[activeTaskIndex];
    const latestDatapoint = activeTask?.datapoint;
    const isActiveRecordingTask = activeTask?.id === activeRecordingTaskId;
    const isStarting = isActiveRecordingTask && activeTask?.status === 'starting';
    const isRecording = isActiveRecordingTask && activeTask?.status === 'recording';
    const isStopping = isActiveRecordingTask && activeTask?.status === 'stopping';
    const isCompleted = activeTask?.status === 'completed';

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
              <p>Asking GPT CUA for three recording tasks that cover the skill from different angles.</p>
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
              <div className={`recording-status ${isRecording ? 'running' : ''}`}>
                <span>
                  {isRecording ? 'Recording' : isStarting ? 'Starting' : isStopping ? 'Stopping' : isCompleted ? 'Complete' : 'Ready'}
                </span>
                <span>{activeTask.recordingCount} datapoints</span>
              </div>
              {activeTask.recordingError ? <p className="recording-error">{activeTask.recordingError}</p> : null}
              {activeTask.analysisStatus ? <p className="analysis-status">{activeTask.analysisStatus}</p> : null}
              {activeTask.analysisError ? <p className="recording-error">{activeTask.analysisError}</p> : null}
              <div className="recording-actions">
                <button
                  type="button"
                  onClick={() => startRecording(activeTaskIndex)}
                  disabled={isActiveRecordingTask || isCompleted}
                >
                  start
                </button>
                <button type="button" onClick={endRecording} disabled={!isRecording}>
                  end recording
                </button>
              </div>
              {latestDatapoint?.cuaAnalysis ? (
                <div className="cua-analysis">
                  <span className="trajectory-kicker">GPT CUA summary</span>
                  <p className="summary-text">{latestDatapoint.cuaAnalysis.summary}</p>
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
                  <span className="trajectory-kicker">Raw trajectory data</span>
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
    <section className="skill-prompt-interface" aria-label="Add skill prompt">
      <form className="skill-prompt-form" onSubmit={submitMessage}>
        <h2>What do you want me to learn?</h2>
        <label className="skill-chat-input">
          <span>Prompt</span>
          <textarea
            value={message}
            rows={8}
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
            Generate tasks
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
          <p>Your self-learning CUA companion.</p>
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
