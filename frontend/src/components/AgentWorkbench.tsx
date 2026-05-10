"use client";

import {
  AlertTriangle,
  ArrowDown,
  Bot,
  Brain,
  Check,
  ChevronRight,
  Circle,
  HelpCircle,
  MousePointerClick,
  Play,
  Plus,
  RefreshCw,
  Search,
  Send,
  Square,
  UserRound
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { api } from "@/lib/api";
import type {
  ActionType,
  BrowserAction,
  BrowserEventType,
  BrowserObservation,
  OnboardingTask,
  PredictActionResponse,
  Trajectory,
  TrajectoryEvent,
  TrainingJob,
  UserProfile
} from "@/lib/types";

const sampleNode = {
  selector: "input[name='q']",
  role: "textbox",
  name: "Search",
  text: "",
  tag: "input",
  is_sensitive: false
};

export function AgentWorkbench() {
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [selectedUserId, setSelectedUserId] = useState("");
  const [tasks, setTasks] = useState<OnboardingTask[]>([]);
  const [trajectories, setTrajectories] = useState<Trajectory[]>([]);
  const [activeTrajectory, setActiveTrajectory] = useState<Trajectory | null>(null);
  const [trainingJob, setTrainingJob] = useState<TrainingJob | null>(null);
  const [prediction, setPrediction] = useState<PredictActionResponse | null>(null);
  const [notice, setNotice] = useState("");

  const [displayName, setDisplayName] = useState("Demo User");
  const [emailHint, setEmailHint] = useState("work email");
  const [preferredSites, setPreferredSites] = useState("Gmail, Google Calendar, Google Drive");
  const [selectedTask, setSelectedTask] = useState<OnboardingTask | null>(null);
  const [manualTask, setManualTask] = useState("Find my latest receipt from email");

  const [url, setUrl] = useState("https://mail.google.com");
  const [title, setTitle] = useState("Inbox");
  const [visibleText, setVisibleText] = useState("Search mail Compose Inbox Receipts Calendar");
  const [focusedSelector, setFocusedSelector] = useState("input[name='q']");
  const [selector, setSelector] = useState("input[name='q']");
  const [actionText, setActionText] = useState("from:uber receipt");
  const [question, setQuestion] = useState("Should I search all mail or only the inbox?");
  const [answer, setAnswer] = useState("All mail");
  const [actionType, setActionType] = useState<ActionType>("click");
  const [eventType, setEventType] = useState<BrowserEventType>("action");

  const selectedUser = useMemo(
    () => users.find((user) => user.id === selectedUserId) ?? null,
    [selectedUserId, users]
  );

  const observation = useCallback((): BrowserObservation => {
    const node = {
      ...sampleNode,
      selector,
      text: actionText,
      is_sensitive: /password|card|delete|send|submit|purchase/i.test(`${selector} ${actionText}`)
    };
    return {
      url,
      title,
      visible_text: visibleText,
      focused_selector: focusedSelector || null,
      dom_nodes: [node],
      metadata: {
        captured_by: "manual_next_workbench"
      }
    };
  }, [actionText, focusedSelector, selector, title, url, visibleText]);

  const refresh = useCallback(async () => {
    const fetchedUsers = await api.listUsers();
    setUsers(fetchedUsers);
    const userId = selectedUserId || fetchedUsers[0]?.id || "";
    setSelectedUserId(userId);
    if (userId) {
      const [fetchedTasks, fetchedTrajectories] = await Promise.all([
        api.listTasks(userId),
        api.listTrajectories(userId)
      ]);
      setTasks(fetchedTasks);
      setTrajectories(fetchedTrajectories);
      if (activeTrajectory?.id) {
        setActiveTrajectory(await api.getTrajectory(activeTrajectory.id));
      }
    }
  }, [activeTrajectory?.id, selectedUserId]);

  useEffect(() => {
    refresh().catch((error) => setNotice(error.message));
  }, [refresh]);

  useEffect(() => {
    if (!trainingJob || trainingJob.status === "completed" || trainingJob.status === "failed") {
      return;
    }
    const timer = window.setInterval(async () => {
      const updated = await api.getTrainingJob(trainingJob.id);
      setTrainingJob(updated);
      if (updated.status === "completed" || updated.status === "failed") {
        await refresh();
      }
    }, 1500);
    return () => window.clearInterval(timer);
  }, [refresh, trainingJob]);

  async function handleCreateUser() {
    const user = await api.createUser(displayName, emailHint, {
      browser_sites: preferredSites.split(",").map((site) => site.trim()).filter(Boolean),
      safety: "confirm before send, submit, purchase, delete, or financial pages"
    });
    setSelectedUserId(user.id);
    setNotice(`Created ${user.display_name}.`);
    await refresh();
  }

  async function handleCreateTasks() {
    if (!selectedUserId) return;
    const sites = preferredSites.split(",").map((site) => site.trim()).filter(Boolean);
    const created = await api.createTasks(selectedUserId, sites);
    setTasks(created);
    setSelectedTask(created[0] ?? null);
    setNotice("Generated onboarding tasks for this user's browser.");
  }

  async function handleStartTrajectory() {
    if (!selectedUserId) return;
    const taskText = selectedTask?.prompt || manualTask;
    const trajectory = await api.createTrajectory(selectedUserId, taskText, selectedTask?.id ?? null, observation());
    setActiveTrajectory(trajectory);
    await refresh();
    setNotice("Recording started. Each action is stored with the current browser observation.");
  }

  async function handleRecordEvent(kind: BrowserEventType, overrideAction?: BrowserAction) {
    if (!activeTrajectory) return;
    const payload = eventPayload(kind, overrideAction);
    await api.recordEvent(activeTrajectory.id, payload);
    const updated = await api.getTrajectory(activeTrajectory.id);
    setActiveTrajectory(updated);
    await refresh();
    setNotice(kind === "ask_user" ? "Question recorded as model supervision." : "Event recorded.");
  }

  async function handleTrain() {
    if (!selectedUserId) return;
    const job = await api.trainUserModel(selectedUserId);
    setTrainingJob(job);
    setNotice("Training queued. The backend will train a separate PyTorch checkpoint for this user.");
  }

  async function handlePredict() {
    if (!selectedUserId) return;
    const previousActions =
      activeTrajectory?.events?.flatMap((event) => (event.action ? [event.action] : [])) ?? [];
    const result = await api.predictAction(
      selectedUserId,
      selectedTask?.prompt || manualTask,
      observation(),
      previousActions
    );
    setPrediction(result);
  }

  function eventPayload(kind: BrowserEventType, overrideAction?: BrowserAction) {
    const base = {
      actor: actorFor(kind),
      event_type: kind,
      observation: observation(),
      metadata: {
        recorded_from: "next_workbench"
      }
    };
    if (kind === "ask_user") {
      return {
        ...base,
        actor: "agent" as const,
        question,
        action: {
          type: "ask_user" as const,
          question,
          confidence: 0.7
        }
      };
    }
    if (kind === "user_answer") {
      return {
        ...base,
        actor: "user" as const,
        answer
      };
    }
    if (kind === "control_returned") {
      return {
        ...base,
        actor: "system" as const
      };
    }
    if (kind === "success_state") {
      return {
        ...base,
        actor: "system" as const,
        success: true
      };
    }
    return {
      ...base,
      action: overrideAction ?? buildAction()
    };
  }

  function buildAction(): BrowserAction {
    if (actionType === "type") {
      return { type: "type", selector, text: actionText };
    }
    if (actionType === "scroll") {
      return { type: "scroll", direction: "down" };
    }
    if (actionType === "open_url") {
      return { type: "open_url", url };
    }
    if (actionType === "search") {
      return { type: "search", query: actionText };
    }
    if (actionType === "press_key") {
      return { type: "press_key", key: actionText || "Enter" };
    }
    return { type: actionType, selector };
  }

  const events = activeTrajectory?.events ?? [];
  const canRecord = Boolean(activeTrajectory);

  return (
    <main className="shell">
      <section className="topbar">
        <div>
          <p className="eyebrow">Local personalized browser-use training</p>
          <h1>Personal Browser Agent</h1>
        </div>
        <button className="iconButton" type="button" onClick={() => refresh()} aria-label="Refresh">
          <RefreshCw size={18} />
        </button>
      </section>

      {notice ? <div className="notice">{notice}</div> : null}

      <section className="grid">
        <aside className="panel sidePanel">
          <div className="panelHeader">
            <UserRound size={18} />
            <h2>User Model</h2>
          </div>
          <label>
            Name
            <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
          </label>
          <label>
            Email hint
            <input value={emailHint} onChange={(event) => setEmailHint(event.target.value)} />
          </label>
          <label>
            Common sites
            <textarea value={preferredSites} onChange={(event) => setPreferredSites(event.target.value)} rows={3} />
          </label>
          <button className="primary" type="button" onClick={handleCreateUser}>
            <Plus size={17} />
            Create user
          </button>

          <label>
            Active user
            <select value={selectedUserId} onChange={(event) => setSelectedUserId(event.target.value)}>
              <option value="">Select user</option>
              {users.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.display_name}
                </option>
              ))}
            </select>
          </label>

          {selectedUser ? (
            <div className="modelStatus">
              <span className={`statusDot ${selectedUser.model_status}`} />
              <div>
                <strong>{selectedUser.model_status}</strong>
                <small>{selectedUser.model_checkpoint_uri ?? "No checkpoint yet"}</small>
              </div>
            </div>
          ) : null}
        </aside>

        <section className="panel taskPanel">
          <div className="panelHeader">
            <Search size={18} />
            <h2>Onboarding Tasks</h2>
            <button className="subtle" type="button" onClick={handleCreateTasks} disabled={!selectedUserId}>
              <Plus size={16} />
              Generate
            </button>
          </div>
          <div className="taskList">
            {tasks.map((task) => (
              <button
                type="button"
                className={`taskItem ${selectedTask?.id === task.id ? "selected" : ""}`}
                key={task.id}
                onClick={() => {
                  setSelectedTask(task);
                  setManualTask(task.prompt);
                }}
              >
                <span>
                  <strong>{task.title}</strong>
                  <small>{task.prompt}</small>
                </span>
                <ChevronRight size={17} />
              </button>
            ))}
          </div>
          <label>
            Current task
            <textarea value={manualTask} onChange={(event) => setManualTask(event.target.value)} rows={3} />
          </label>
          <button className="primary" type="button" onClick={handleStartTrajectory} disabled={!selectedUserId}>
            <Play size={17} />
            Start recording
          </button>
        </section>

        <section className="panel recorderPanel">
          <div className="panelHeader">
            <MousePointerClick size={18} />
            <h2>Recorder</h2>
          </div>
          <div className="formGrid">
            <label>
              URL
              <input value={url} onChange={(event) => setUrl(event.target.value)} />
            </label>
            <label>
              Page title
              <input value={title} onChange={(event) => setTitle(event.target.value)} />
            </label>
            <label>
              Selector
              <input value={selector} onChange={(event) => setSelector(event.target.value)} />
            </label>
            <label>
              Focused selector
              <input value={focusedSelector} onChange={(event) => setFocusedSelector(event.target.value)} />
            </label>
          </div>
          <label>
            Visible text
            <textarea value={visibleText} onChange={(event) => setVisibleText(event.target.value)} rows={3} />
          </label>
          <div className="formGrid">
            <label>
              Event
              <select value={eventType} onChange={(event) => setEventType(event.target.value as BrowserEventType)}>
                <option value="action">Action</option>
                <option value="ask_user">Ask user</option>
                <option value="user_answer">User answer</option>
                <option value="control_returned">Control returned</option>
                <option value="success_state">Success state</option>
              </select>
            </label>
            <label>
              Action
              <select value={actionType} onChange={(event) => setActionType(event.target.value as ActionType)}>
                <option value="click">Click</option>
                <option value="type">Type</option>
                <option value="scroll">Scroll</option>
                <option value="open_url">Open URL</option>
                <option value="search">Search</option>
                <option value="press_key">Press key</option>
                <option value="wait">Wait</option>
                <option value="stop">Stop</option>
              </select>
            </label>
          </div>
          <label>
            Text, query, or key
            <input value={actionText} onChange={(event) => setActionText(event.target.value)} />
          </label>
          <label>
            Agent question
            <input value={question} onChange={(event) => setQuestion(event.target.value)} />
          </label>
          <label>
            User answer
            <input value={answer} onChange={(event) => setAnswer(event.target.value)} />
          </label>

          <div className="buttonRow">
            <button type="button" onClick={() => handleRecordEvent("action")} disabled={!canRecord}>
              <MousePointerClick size={16} />
              Record
            </button>
            <button type="button" onClick={() => handleRecordEvent("ask_user")} disabled={!canRecord}>
              <HelpCircle size={16} />
              Ask
            </button>
            <button type="button" onClick={() => handleRecordEvent("user_answer")} disabled={!canRecord}>
              <Send size={16} />
              Answer
            </button>
            <button type="button" onClick={() => handleRecordEvent("control_returned")} disabled={!canRecord}>
              <Bot size={16} />
              Return
            </button>
            <button type="button" onClick={() => handleRecordEvent("success_state")} disabled={!canRecord}>
              <Check size={16} />
              Success
            </button>
          </div>
        </section>

        <section className="panel timelinePanel">
          <div className="panelHeader">
            <Circle size={18} />
            <h2>Trajectory</h2>
            <span className="counter">{events.length}</span>
          </div>
          <div className="trajectoryMeta">
            <strong>{activeTrajectory?.task ?? "No active trajectory"}</strong>
            <small>{activeTrajectory?.id ?? "Start a recording to capture events."}</small>
          </div>
          <div className="timeline">
            {events.map((event) => (
              <EventRow key={event.id} event={event} />
            ))}
          </div>
        </section>

        <section className="panel trainPanel">
          <div className="panelHeader">
            <Brain size={18} />
            <h2>Train & Predict</h2>
          </div>
          <button className="primary" type="button" onClick={handleTrain} disabled={!selectedUserId}>
            <Brain size={17} />
            Train user checkpoint
          </button>
          {trainingJob ? (
            <div className="jobBox">
              <strong>{trainingJob.status}</strong>
              <small>{trainingJob.error ?? trainingJob.artifact_uri ?? `${trainingJob.example_count} examples`}</small>
            </div>
          ) : null}
          <button type="button" onClick={handlePredict} disabled={!selectedUserId}>
            <Bot size={17} />
            Predict next action
          </button>
          {prediction ? (
            <div className="prediction">
              <div className="predictionTop">
                <strong>{prediction.action.type}</strong>
                <span>{Math.round(prediction.confidence * 100)}%</span>
              </div>
              <code>{JSON.stringify(prediction.action, null, 2)}</code>
              {prediction.action.requires_confirmation ? (
                <p className="warning">
                  <AlertTriangle size={16} />
                  Confirmation required before executing this action.
                </p>
              ) : null}
              <small>{prediction.rationale}</small>
            </div>
          ) : null}
        </section>
      </section>
    </main>
  );
}

function actorFor(kind: BrowserEventType): "user" | "agent" | "system" {
  if (kind === "success_state" || kind === "observation" || kind === "control_returned") {
    return "system";
  }
  if (kind === "ask_user") {
    return "agent";
  }
  return "user";
}

function EventRow({ event }: { event: TrajectoryEvent }) {
  const icon = event.event_type === "ask_user" ? (
    <HelpCircle size={15} />
  ) : event.event_type === "user_answer" ? (
    <Send size={15} />
  ) : event.event_type === "success_state" ? (
    <Check size={15} />
  ) : event.action?.type === "scroll" ? (
    <ArrowDown size={15} />
  ) : event.event_type === "control_returned" ? (
    <Square size={15} />
  ) : (
    <MousePointerClick size={15} />
  );
  return (
    <article className="eventRow">
      <span className={`eventIcon ${event.actor}`}>{icon}</span>
      <div>
        <strong>
          {event.actor} · {event.event_type}
        </strong>
        <small>{event.action?.type ?? event.question ?? event.answer ?? event.observation?.title ?? "recorded"}</small>
      </div>
    </article>
  );
}
