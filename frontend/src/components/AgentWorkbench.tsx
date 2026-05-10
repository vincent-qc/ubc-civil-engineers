"use client";

import {
  ArrowRight,
  Bot,
  Brain,
  Check,
  Loader2,
  LogOut,
  MousePointerClick,
  Plus,
  Send,
  ShieldCheck,
  Sparkles,
  Wrench
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { api } from "@/lib/api";
import type {
  ActionType,
  BrowserAction,
  BrowserObservation,
  OnboardingTask,
  SkillChatSession,
  Trajectory,
  TrainingJob,
  UserProfile,
  UserSkill
} from "@/lib/types";

type View = "login" | "agent" | "skillChat" | "tasks" | "training";
type AgentMessage = {
  role: "user" | "agent" | "tool";
  content: string;
};

const defaultAgentMessages: AgentMessage[] = [
  {
    role: "agent",
    content: "I can use trained browser skills once you add one. Tell me what you want done, or create a new skill."
  }
];

export function AgentWorkbench() {
  const [view, setView] = useState<View>("login");
  const [notice, setNotice] = useState("");
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [user, setUser] = useState<UserProfile | null>(null);
  const [skills, setSkills] = useState<UserSkill[]>([]);
  const [activeSkill, setActiveSkill] = useState<UserSkill | null>(null);
  const [loginName, setLoginName] = useState("Demo User");
  const [loginEmail, setLoginEmail] = useState("work email");

  const [agentMessages, setAgentMessages] = useState<AgentMessage[]>(defaultAgentMessages);
  const [agentInput, setAgentInput] = useState("Find my latest receipt and summarize who it is from.");

  const [skillSession, setSkillSession] = useState<SkillChatSession | null>(null);
  const [skillInput, setSkillInput] = useState("");
  const [tasks, setTasks] = useState<OnboardingTask[]>([]);
  const [taskIndex, setTaskIndex] = useState(0);
  const [trajectoriesByTask, setTrajectoriesByTask] = useState<Record<string, Trajectory>>({});

  const [trainingJob, setTrainingJob] = useState<TrainingJob | null>(null);

  const [url, setUrl] = useState("https://mail.google.com");
  const [title, setTitle] = useState("Inbox");
  const [visibleText, setVisibleText] = useState("Search mail Compose Inbox Receipts Calendar");
  const [selector, setSelector] = useState("input[name='q']");
  const [actionText, setActionText] = useState("from:uber receipt");
  const [actionType, setActionType] = useState<ActionType>("click");

  const readySkills = useMemo(() => skills.filter((skill) => skill.status === "ready"), [skills]);
  const currentTask = tasks[taskIndex] ?? null;

  useEffect(() => {
    api
      .listUsers()
      .then((fetchedUsers) => {
        setUsers(fetchedUsers);
        const storedUserId = window.localStorage.getItem("browser-agent-user-id");
        const storedUser = fetchedUsers.find((item) => item.id === storedUserId);
        if (storedUser) {
          setUser(storedUser);
          setView("agent");
          return loadUserWorkspace(storedUser);
        }
        return undefined;
      })
      .catch((error) => setNotice(error.message));
  }, []);

  useEffect(() => {
    if (!trainingJob || trainingJob.status === "completed" || trainingJob.status === "failed") {
      return;
    }
    const timer = window.setInterval(async () => {
      const updated = await api.getTrainingJob(trainingJob.id);
      setTrainingJob(updated);
      if (updated.status === "completed" && user) {
        const refreshedUser = await api.getUser(user.id);
        setUser(refreshedUser);
        await loadUserWorkspace(refreshedUser);
        setAgentMessages((messages) => [
          ...messages,
          {
            role: "agent",
            content: `Skill trained. I can now call ${activeSkill?.name ?? "the new skill"} when your request matches it.`
          }
        ]);
        setView("agent");
      }
      if (updated.status === "failed") {
        setNotice(updated.error ?? "Training failed.");
      }
    }, 1200);
    return () => window.clearInterval(timer);
  }, [activeSkill?.name, trainingJob, user]);

  async function loadUserWorkspace(nextUser: UserProfile) {
    const fetchedSkills = await api.listSkills(nextUser.id);
    setSkills(fetchedSkills);
    setActiveSkill(fetchedSkills.find((skill) => skill.status === "ready") ?? fetchedSkills[0] ?? null);
  }

  async function handleLogin() {
    const loggedIn = await api.login(loginName, loginEmail);
    window.localStorage.setItem("browser-agent-user-id", loggedIn.id);
    setUser(loggedIn);
    setView("agent");
    setNotice("");
    await loadUserWorkspace(loggedIn);
  }

  function handleLogout() {
    window.localStorage.removeItem("browser-agent-user-id");
    setUser(null);
    setSkills([]);
    setActiveSkill(null);
    setView("login");
  }

  async function handleStartSkill() {
    if (!user) return;
    const session = await api.startSkillSession(user.id);
    setSkillSession(session);
    setSkillInput("");
    setTasks([]);
    setTaskIndex(0);
    setTrajectoriesByTask({});
    setView("skillChat");
  }

  async function handleSendSkillMessage() {
    if (!skillSession || !skillInput.trim()) return;
    const updated = await api.sendSkillMessage(skillSession.id, skillInput.trim());
    setSkillSession(updated);
    setSkillInput("");
  }

  async function handleFinalizeSkill() {
    if (!skillSession) return;
    const result = await api.finalizeSkill(skillSession.id);
    setActiveSkill(result.skill);
    setTasks(result.tasks);
    setTaskIndex(0);
    setView("tasks");
    setNotice("Tasks generated. Run each task in your browser, return here, and click Done.");
  }

  async function ensureTrajectory(task: OnboardingTask) {
    const existing = trajectoriesByTask[task.id];
    if (existing) return existing;
    if (!user || !activeSkill) throw new Error("No active user or skill");
    const trajectory = await api.createTrajectory(user.id, activeSkill.id, task.prompt, task.id, observation(task));
    setTrajectoriesByTask((items) => ({ ...items, [task.id]: trajectory }));
    return trajectory;
  }

  async function handleRecordAction() {
    if (!currentTask) return;
    const trajectory = await ensureTrajectory(currentTask);
    await api.recordEvent(trajectory.id, {
      actor: "user",
      event_type: "action",
      observation: observation(currentTask),
      action: buildAction(),
      metadata: { task_order: currentTask.order, collection_flow: "skill_tasks" }
    });
    const updated = await api.getTrajectory(trajectory.id);
    setTrajectoriesByTask((items) => ({ ...items, [currentTask.id]: updated }));
    setNotice("Action recorded for this task.");
  }

  async function handleDoneTask() {
    if (!currentTask) return;
    const trajectory = await ensureTrajectory(currentTask);
    await api.recordEvent(trajectory.id, {
      actor: "system",
      event_type: "success_state",
      observation: observation(currentTask),
      action: { type: "stop", metadata: { reason: "user_clicked_done" } },
      success: true,
      metadata: { task_order: currentTask.order, collection_flow: "skill_tasks" }
    });

    if (taskIndex < tasks.length - 1) {
      setTaskIndex((index) => index + 1);
      setNotice("Saved. Continue with the next task.");
      return;
    }

    await handleStartTraining();
  }

  async function handleStartTraining() {
    if (!user || !activeSkill) return;
    const job = await api.trainSkillModel(user.id, activeSkill.id);
    setTrainingJob(job);
    setView("training");
    setNotice("Training started from the collected skill demonstrations.");
  }

  async function handleAgentSend() {
    if (!user || !agentInput.trim()) return;
    const prompt = agentInput.trim();
    const skill = activeSkill?.status === "ready" ? activeSkill : readySkills[0];
    setAgentMessages((messages) => [...messages, { role: "user", content: prompt }]);
    setAgentInput("");

    if (!skill) {
      setAgentMessages((messages) => [
        ...messages,
        { role: "agent", content: "I do not have a trained browser skill yet. Add a skill first so I can learn this workflow." }
      ]);
      return;
    }

    const prediction = await api.predictAction(user.id, skill.id, prompt, observationForAgent(prompt, skill), []);
    setAgentMessages((messages) => [
      ...messages,
      {
        role: "tool",
        content: `${skill.name}.predict_next_action(${JSON.stringify(prediction.action)})`
      },
      {
        role: "agent",
        content: prediction.action.requires_confirmation
          ? `I would use ${skill.name}, but the next action needs confirmation before execution.`
          : `I would use ${skill.name} and start with a ${prediction.action.type} action at ${Math.round(
              prediction.confidence * 100
            )}% confidence.`
      }
    ]);
  }

  function observation(task: OnboardingTask): BrowserObservation {
    return {
      url,
      title,
      visible_text: visibleText,
      focused_selector: selector,
      dom_nodes: [
        {
          selector,
          role: actionType === "type" ? "textbox" : "button",
          name: selector.replace(/[#.[\]'"]/g, " ").trim() || "Observed target",
          text: actionText,
          tag: actionType === "type" ? "input" : "button",
          is_sensitive: /password|card|delete|send|submit|purchase|bank/i.test(`${selector} ${actionText} ${task.prompt}`)
        }
      ],
      metadata: {
        task_id: task.id,
        skill_id: task.skill_id,
        captured_by: "skill_collection_flow"
      }
    };
  }

  function observationForAgent(prompt: string, skill: UserSkill): BrowserObservation {
    return {
      url: url || "about:blank",
      title: skill.name,
      visible_text: `${prompt} ${skill.goal}`,
      focused_selector: selector,
      dom_nodes: [
        {
          selector,
          role: "button",
          name: skill.name,
          text: prompt,
          tag: "button",
          is_sensitive: /send|submit|delete|purchase|bank|card|password/i.test(prompt)
        }
      ],
      metadata: { skill_id: skill.id, captured_by: "agent_chat" }
    };
  }

  function buildAction(): BrowserAction {
    if (actionType === "type") return { type: "type", selector, text: actionText };
    if (actionType === "scroll") return { type: "scroll", direction: "down" };
    if (actionType === "open_url") return { type: "open_url", url };
    if (actionType === "search") return { type: "search", query: actionText };
    if (actionType === "press_key") return { type: "press_key", key: actionText || "Enter" };
    return { type: actionType, selector };
  }

  if (view === "login" || !user) {
    return (
      <main className="authShell">
        <section className="authPanel">
          <p className="eyebrow">Local personalized browser-use training</p>
          <h1>Train your browser agent</h1>
          <label>
            Name
            <input value={loginName} onChange={(event) => setLoginName(event.target.value)} />
          </label>
          <label>
            Email hint
            <input value={loginEmail} onChange={(event) => setLoginEmail(event.target.value)} />
          </label>
          <button className="primary wide" type="button" onClick={handleLogin}>
            <ArrowRight size={17} />
            Log in
          </button>
          {users.length ? (
            <div className="quickUsers">
              {users.map((item) => (
                <button
                  type="button"
                  key={item.id}
                  onClick={async () => {
                    setUser(item);
                    window.localStorage.setItem("browser-agent-user-id", item.id);
                    setView("agent");
                    await loadUserWorkspace(item);
                  }}
                >
                  {item.display_name}
                </button>
              ))}
            </div>
          ) : null}
        </section>
      </main>
    );
  }

  return (
    <main className="appShell">
      <header className="appHeader">
        <div>
          <p className="eyebrow">Personal browser-use agent</p>
          <h1>{viewTitle(view)}</h1>
        </div>
        <div className="headerActions">
          {view === "agent" ? (
            <button className="primary" type="button" onClick={handleStartSkill}>
              <Plus size={17} />
              Add Skill
            </button>
          ) : null}
          <button type="button" onClick={handleLogout}>
            <LogOut size={17} />
            Logout
          </button>
        </div>
      </header>

      {notice ? <div className="notice">{notice}</div> : null}

      {view === "agent" ? (
        <AgentHome
          user={user}
          skills={skills}
          activeSkill={activeSkill}
          onSelectSkill={setActiveSkill}
          messages={agentMessages}
          input={agentInput}
          onInput={setAgentInput}
          onSend={handleAgentSend}
          onAddSkill={handleStartSkill}
        />
      ) : null}

      {view === "skillChat" && skillSession ? (
        <SkillChat
          session={skillSession}
          input={skillInput}
          onInput={setSkillInput}
          onSend={handleSendSkillMessage}
          onNext={handleFinalizeSkill}
        />
      ) : null}

      {view === "tasks" && currentTask ? (
        <TaskCollection
          task={currentTask}
          index={taskIndex}
          total={tasks.length}
          trajectory={trajectoriesByTask[currentTask.id]}
          url={url}
          title={title}
          visibleText={visibleText}
          selector={selector}
          actionText={actionText}
          actionType={actionType}
          onUrl={setUrl}
          onTitle={setTitle}
          onVisibleText={setVisibleText}
          onSelector={setSelector}
          onActionText={setActionText}
          onActionType={setActionType}
          onRecord={handleRecordAction}
          onDone={handleDoneTask}
        />
      ) : null}

      {view === "training" && trainingJob ? <TrainingProgress job={trainingJob} skill={activeSkill} /> : null}
    </main>
  );
}

function AgentHome({
  user,
  skills,
  activeSkill,
  onSelectSkill,
  messages,
  input,
  onInput,
  onSend,
  onAddSkill
}: {
  user: UserProfile;
  skills: UserSkill[];
  activeSkill: UserSkill | null;
  onSelectSkill: (skill: UserSkill) => void;
  messages: AgentMessage[];
  input: string;
  onInput: (value: string) => void;
  onSend: () => void;
  onAddSkill: () => void;
}) {
  return (
    <section className="agentLayout">
      <aside className="skillRail">
        <div className="panelHeader">
          <Wrench size={18} />
          <h2>Skills</h2>
        </div>
        {skills.length ? (
          skills.map((skill) => (
            <button
              className={`skillItem ${activeSkill?.id === skill.id ? "selected" : ""}`}
              type="button"
              key={skill.id}
              onClick={() => onSelectSkill(skill)}
            >
              <span>
                <strong>{skill.name}</strong>
                <small>{skill.status}</small>
              </span>
              {skill.status === "ready" ? <Check size={16} /> : <Loader2 size={16} />}
            </button>
          ))
        ) : (
          <button className="emptySkill" type="button" onClick={onAddSkill}>
            <Plus size={17} />
            Add your first skill
          </button>
        )}
      </aside>

      <section className="chatPanel">
        <div className="chatTitle">
          <Bot size={20} />
          <div>
            <strong>{user.display_name}'s agent</strong>
            <small>{activeSkill ? `Tool available: ${activeSkill.name}` : "No trained tool yet"}</small>
          </div>
        </div>
        <div className="chatLog">
          {messages.map((message, index) => (
            <ChatBubble key={`${message.role}-${index}`} role={message.role} content={message.content} />
          ))}
        </div>
        <div className="composer">
          <input value={input} onChange={(event) => onInput(event.target.value)} onKeyDown={(event) => event.key === "Enter" && onSend()} />
          <button className="primary" type="button" onClick={onSend}>
            <Send size={17} />
            Send
          </button>
        </div>
      </section>
    </section>
  );
}

function SkillChat({
  session,
  input,
  onInput,
  onSend,
  onNext
}: {
  session: SkillChatSession;
  input: string;
  onInput: (value: string) => void;
  onSend: () => void;
  onNext: () => void;
}) {
  return (
    <section className="flowGrid">
      <div className="chatPanel">
        <div className="chatTitle">
          <Sparkles size={20} />
          <div>
            <strong>Add Skill</strong>
            <small>Answer 2-3 prompts so the agent can design useful data collection tasks.</small>
          </div>
        </div>
        <div className="chatLog">
          {session.messages.map((message, index) => (
            <ChatBubble key={`${message.role}-${index}`} role={message.role === "system" ? "agent" : message.role} content={message.content} />
          ))}
        </div>
        <div className="composer">
          <input value={input} onChange={(event) => onInput(event.target.value)} onKeyDown={(event) => event.key === "Enter" && onSend()} />
          <button className="primary" type="button" onClick={onSend} disabled={!input.trim()}>
            <Send size={17} />
            Reply
          </button>
        </div>
      </div>
      <aside className="sideCard">
        <ShieldCheck size={22} />
        <h2>What happens next</h2>
        <p>The API turns this chat into 5-6 browser tasks that collect navigation, search, preference, recovery, and safety-boundary demonstrations.</p>
        <button className="primary wide" type="button" onClick={onNext} disabled={session.status !== "ready_for_tasks"}>
          Next
          <ArrowRight size={17} />
        </button>
      </aside>
    </section>
  );
}

function TaskCollection({
  task,
  index,
  total,
  trajectory,
  url,
  title,
  visibleText,
  selector,
  actionText,
  actionType,
  onUrl,
  onTitle,
  onVisibleText,
  onSelector,
  onActionText,
  onActionType,
  onRecord,
  onDone
}: {
  task: OnboardingTask;
  index: number;
  total: number;
  trajectory?: Trajectory;
  url: string;
  title: string;
  visibleText: string;
  selector: string;
  actionText: string;
  actionType: ActionType;
  onUrl: (value: string) => void;
  onTitle: (value: string) => void;
  onVisibleText: (value: string) => void;
  onSelector: (value: string) => void;
  onActionText: (value: string) => void;
  onActionType: (value: ActionType) => void;
  onRecord: () => void;
  onDone: () => void;
}) {
  return (
    <section className="collectionLayout">
      <div className="taskCard">
        <div className="stepBadge">
          Task {index + 1} of {total}
        </div>
        <h2>{task.title}</h2>
        <p className="taskPrompt">{task.prompt}</p>
        <p className="returnPrompt">Do this in your browser, return to this page, record any important actions, then click Done.</p>
        <small>Success: {task.success_hint}</small>
        <button className="primary wide" type="button" onClick={onDone}>
          Done
          <ArrowRight size={17} />
        </button>
      </div>

      <div className="recorderCard">
        <div className="panelHeader">
          <MousePointerClick size={18} />
          <h2>Action Recorder</h2>
          <span className="counter">{trajectory?.event_count ?? 0}</span>
        </div>
        <div className="formGrid">
          <label>
            URL
            <input value={url} onChange={(event) => onUrl(event.target.value)} />
          </label>
          <label>
            Page title
            <input value={title} onChange={(event) => onTitle(event.target.value)} />
          </label>
        </div>
        <label>
          Visible text
          <textarea value={visibleText} onChange={(event) => onVisibleText(event.target.value)} rows={3} />
        </label>
        <div className="formGrid">
          <label>
            Selector
            <input value={selector} onChange={(event) => onSelector(event.target.value)} />
          </label>
          <label>
            Action
            <select value={actionType} onChange={(event) => onActionType(event.target.value as ActionType)}>
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
          <input value={actionText} onChange={(event) => onActionText(event.target.value)} />
        </label>
        <button type="button" onClick={onRecord}>
          <MousePointerClick size={17} />
          Record observed action
        </button>
      </div>
    </section>
  );
}

function TrainingProgress({ job, skill }: { job: TrainingJob; skill: UserSkill | null }) {
  const events = Array.isArray(job.metrics.progress_events) ? job.metrics.progress_events : [];
  const latest = events.at(-1) as { message?: string } | undefined;
  return (
    <section className="trainingCard">
      <Brain size={28} />
      <h2>Training {skill?.name ?? "skill"} locally</h2>
      <div className="progressTrack">
        <span style={{ width: `${Math.round((job.progress || 0) * 100)}%` }} />
      </div>
      <div className="statsGrid">
        <Stat label="Status" value={job.status} />
        <Stat label="Progress" value={`${Math.round((job.progress || 0) * 100)}%`} />
        <Stat label="Examples" value={String(job.example_count || "collecting")} />
        <Stat label="Loss" value={job.metrics.loss == null ? "pending" : String(job.metrics.loss)} />
      </div>
      <p>{job.error ?? latest?.message ?? "The backend is fine-tuning a per-user action checkpoint from the recorded interactions."}</p>
    </section>
  );
}

function ChatBubble({ role, content }: AgentMessage) {
  return (
    <article className={`bubble ${role}`}>
      <strong>{role === "tool" ? "tool call" : role}</strong>
      <p>{content}</p>
    </article>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <small>{label}</small>
      <strong>{value}</strong>
    </div>
  );
}

function viewTitle(view: View) {
  if (view === "skillChat") return "Add Skill";
  if (view === "tasks") return "Collect Demonstrations";
  if (view === "training") return "Training Progress";
  return "Agent";
}
