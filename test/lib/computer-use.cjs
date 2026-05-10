const { execFile } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const { promisify } = require('node:util');

const DEFAULT_BASE_URL = 'https://api.clod.io/v1';
const DEFAULT_MODEL = 'GPT 5.4';
const MAX_ACTIONS_PER_TURN = 8;
const execFileAsync = promisify(execFile);

let lastDesktopGeometry = { originX: 0, originY: 0, scaleX: 1, scaleY: 1 };

const SYSTEM_PROMPT = `You are a barebones computer-use model controlling the user's full macOS desktop.
You receive the user's task and a screenshot of the whole visible desktop.
Respond with JSON only. Do not use Markdown.

Schema:
{
  "thought": "short private note for the operator",
  "actions": [
    {"type":"click","x":100,"y":200},
    {"type":"double_click","x":100,"y":200},
    {"type":"move","x":100,"y":200},
    {"type":"scroll","x":100,"y":200,"deltaX":0,"deltaY":-450},
    {"type":"type","text":"hello"},
    {"type":"keypress","keys":["CTRL","L"]},
    {"type":"drag","from":{"x":100,"y":200},"to":{"x":300,"y":250}},
    {"type":"wait","ms":1000},
    {"type":"screenshot"}
  ],
  "done": false,
  "answer": ""
}

Use screenshot pixel coordinates with (0, 0) at the top-left of the screenshot. You may interact with any visible app or desktop element. Keep actions small and observable. Set done true with a concise answer when the task is complete or blocked.`;

const ACTION_CRITIC_SYSTEM_PROMPT = `You are a strict desktop computer-use action critic.
You receive the user's overall task, one requested action, a screenshot from immediately before the action, and a screenshot from immediately after the action.

Return exactly TRUE or FALSE.
Return TRUE only when the after screenshot shows the requested action was successfully completed or had the expected immediate visible effect.
For actions with no reliable visible effect in screenshots, such as wait, screenshot, or mouse move, return TRUE when the after screenshot was captured and there is no visible evidence of a failure or unexpected disruption.
Return FALSE when the action appears to have missed, targeted the wrong place, failed to change the UI when a change was expected, or the screenshots do not provide enough evidence.`;

const TRAJECTORY_SYSTEM_PROMPT = `You design desktop RL data-collection trajectories for teaching a computer-use agent new skills.
Respond with JSON only. Do not use Markdown.

Given a user's requested skill, create exactly 3 short, concrete desktop tasks a human can record.
Each task should be useful as a standalone trajectory, observable on screen, and phrased as an instruction to the recorder.
Prefer tasks that cover different parts of the workflow. Do not ask the user to send real messages, reveal secrets, make purchases, or take irreversible actions.

Schema:
{
  "tasks": [
    {
      "title": "short task name",
      "instruction": "one concrete desktop instruction",
      "why": "brief reason this trajectory helps RL training"
    }
  ]
}`;

const TRAJECTORY_ANALYSIS_SYSTEM_PROMPT = `You convert recorded desktop trajectories into compact in-context learning material for a computer-use agent.
You receive a label, a time series of user input events, and a screenshot for each event.
Respond with JSON only. Do not use Markdown.

Identify stable, useful locations and visual anchors that would help a future CUA model perform the labeled task from screenshots.
Use screenshot pixel coordinates with x=0, y=0 at the top-left. Prefer coordinates at the center of the visible target.
Mention app icons, buttons, fields, menus, sidebars, tabs, and other reusable UI landmarks when visible.
Avoid sensitive content transcription. Focus on navigation and interaction affordances.

Schema:
{
  "summary": "brief description of the demonstrated workflow",
  "useful_locations": [
    {
      "name": "visible UI target or app",
      "kind": "app|button|field|menu|list|window|other",
      "x": 100,
      "y": 200,
      "area": {"x": 90, "y": 190, "width": 20, "height": 20},
      "confidence": 0.8,
      "evidence_event": 0,
      "why": "why this location matters"
    }
  ],
  "interaction_patterns": [
    {
      "pattern": "short reusable behavior",
      "evidence_events": [0, 1],
      "cua_hint": "instruction useful to a computer-use model"
    }
  ],
  "in_context_example": {
    "user_goal": "the original label",
    "observation_hints": ["what to look for visually"],
    "action_hints": ["concrete action hints with coordinates when reliable"]
  }
}`;

function configFromEnvironment() {
  return {
    baseUrl: process.env.CLOD_BASE_URL || DEFAULT_BASE_URL,
    hasApiKey: Boolean(process.env.CLOD_API_KEY),
    model: process.env.CLOD_MODEL || DEFAULT_MODEL,
    criticModel: process.env.CLOD_CRITIC_MODEL || process.env.CLOD_MODEL || DEFAULT_MODEL,
    maxTurns: Number.parseInt(process.env.CLOD_MAX_TURNS || '8', 10)
  };
}

function chatCompletionsUrl(baseUrl) {
  return `${baseUrl.replace(/\/$/, '')}/chat/completions`;
}

function parseAssistantJson(content) {
  const trimmed = String(content || '').trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const jsonText = fenced ? fenced[1].trim() : trimmed;

  try {
    return JSON.parse(jsonText);
  } catch (error) {
    const extracted = extractJsonValue(jsonText);
    if (extracted) {
      return JSON.parse(extracted);
    }
    throw error;
  }
}

function extractJsonValue(text) {
  const start = text.search(/[\[{]/);
  if (start === -1) {
    return null;
  }

  const opener = text[start];
  const closer = opener === '{' ? '}' : ']';
  let depth = 0;
  let inString = false;
  let escaping = false;

  for (let index = start; index < text.length; index += 1) {
    const char = text[index];

    if (escaping) {
      escaping = false;
      continue;
    }

    if (char === '\\') {
      escaping = true;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      continue;
    }

    if (inString) {
      continue;
    }

    if (char === opener) {
      depth += 1;
    } else if (char === closer) {
      depth -= 1;
      if (depth === 0) {
        return text.slice(start, index + 1);
      }
    }
  }

  return null;
}

function toArray(value) {
  return Array.isArray(value) ? value : value === undefined || value === null ? [] : [value];
}

function firstNumber(...values) {
  for (const value of values) {
    const number = Number(value);
    if (Number.isFinite(number)) {
      return number;
    }
  }
  return undefined;
}

function pointFrom(value = {}) {
  const coordinate = value.coordinate || value.coordinates || value.point || value.position;
  const coordinateX = Array.isArray(coordinate) ? coordinate[0] : coordinate?.x;
  const coordinateY = Array.isArray(coordinate) ? coordinate[1] : coordinate?.y;

  return {
    x: firstNumber(value.x, value.left, coordinateX),
    y: firstNumber(value.y, value.top, coordinateY)
  };
}

function normalizeAction(rawAction) {
  if (!rawAction || typeof rawAction !== 'object') {
    return null;
  }

  const action = rawAction.action && typeof rawAction.action === 'object' ? rawAction.action : rawAction;
  const rawType = String(action.type || action.action || action.name || '').toLowerCase();
  const typeAliases = {
    mouse_move: 'move',
    mousemove: 'move',
    move_mouse: 'move',
    left_click: 'click',
    mouse_click: 'click',
    doubleclick: 'double_click',
    double_click: 'double_click',
    key_press: 'keypress',
    press_key: 'keypress',
    hotkey: 'keypress',
    write: 'type',
    input_text: 'type',
    type_text: 'type',
    scroll_wheel: 'scroll'
  };

  const type = typeAliases[rawType] || rawType;
  const point = pointFrom(action);

  if (type === 'click' || type === 'double_click' || type === 'move') {
    return { ...action, type, ...point };
  }

  if (type === 'scroll') {
    return {
      ...action,
      type,
      ...point,
      deltaX: firstNumber(action.deltaX, action.dx, action.scrollX, action.scroll_x, 0),
      deltaY: firstNumber(action.deltaY, action.dy, action.scrollY, action.scroll_y, 0)
    };
  }

  if (type === 'type') {
    return { ...action, type, text: String(action.text ?? action.value ?? action.input ?? '') };
  }

  if (type === 'keypress') {
    return { ...action, type, keys: toArray(action.keys ?? action.key ?? action.text).map(String) };
  }

  if (type === 'drag') {
    const from = pointFrom(action.from || action.start || action);
    const to = pointFrom(action.to || action.end || action.destination || {});
    return { ...action, type, from, to };
  }

  if (type === 'wait') {
    return { ...action, type, ms: firstNumber(action.ms, action.duration, action.delay, 1000) };
  }

  if (type === 'screenshot') {
    return { ...action, type };
  }

  return { ...action, type };
}

function normalizeActions(result) {
  const source =
    Array.isArray(result)
      ? result
      : result.actions ??
        result.action ??
        result.computer_calls ??
        result.output ??
        result.tool_calls ??
        [];

  return toArray(source)
    .flatMap((item) => {
      if (item?.type === 'computer_call' && item.action) {
        return [item.action];
      }
      if (item?.function?.arguments) {
        try {
          return [JSON.parse(item.function.arguments)];
        } catch {
          return [];
        }
      }
      if (item?.actions) {
        return toArray(item.actions);
      }
      return [item];
    })
    .map(normalizeAction)
    .filter(Boolean);
}

function driverPath() {
  return path.join(process.cwd(), 'bin', 'desktop-driver');
}

async function runDesktopDriver(args) {
  const binary = driverPath();
  if (!fs.existsSync(binary)) {
    throw new Error('Missing desktop driver. Run npm run build:driver before starting Electron.');
  }

  const { stdout } = await execFileAsync(binary, args, {
    cwd: process.cwd(),
    maxBuffer: 120 * 1024 * 1024
  });

  return stdout;
}

async function captureScreenshot() {
  const stdout = await runDesktopDriver(['screenshot']);
  const screenshot = JSON.parse(stdout);
  lastDesktopGeometry = {
    originX: Number(screenshot.originX || 0),
    originY: Number(screenshot.originY || 0),
    scaleX: Number(screenshot.scaleX || 1),
    scaleY: Number(screenshot.scaleY || 1)
  };

  return {
    dataUrl: `data:image/png;base64,${screenshot.pngBase64}`,
    width: screenshot.width,
    height: screenshot.height
  };
}

function formatEnabledSkillsForPrompt(enabledSkills = []) {
  const skills = toArray(enabledSkills).filter((skill) => skill?.enabled !== false);
  if (skills.length === 0) {
    return '';
  }

  return skills
    .map((skill, index) => {
      const analysis = skill.cuaAnalysis || {};
      const locations = toArray(analysis.useful_locations)
        .slice(0, 8)
        .map((location) => {
          const area = location.area ? ` area=${JSON.stringify(location.area)}` : '';
          return `- ${location.name || 'location'} (${location.kind || 'unknown'}): x=${location.x}, y=${location.y}${area}. ${location.why || ''}`;
        })
        .join('\n');
      const patterns = toArray(analysis.interaction_patterns)
        .slice(0, 5)
        .map((pattern) => `- ${pattern.pattern || ''}${pattern.cua_hint ? ` Hint: ${pattern.cua_hint}` : ''}`)
        .join('\n');
      const observations = toArray(analysis.in_context_example?.observation_hints)
        .slice(0, 6)
        .map((hint) => `- ${hint}`)
        .join('\n');
      const actions = toArray(analysis.in_context_example?.action_hints)
        .slice(0, 6)
        .map((hint) => `- ${hint}`)
        .join('\n');

      return [
        `Skill ${index + 1}: ${skill.name || skill.label || 'Untitled skill'}`,
        `Original trajectory label: ${skill.label || ''}`,
        analysis.summary ? `Workflow summary: ${analysis.summary}` : '',
        locations ? `Useful locations:\n${locations}` : '',
        patterns ? `Interaction patterns:\n${patterns}` : '',
        observations ? `Observation hints:\n${observations}` : '',
        actions ? `Action hints:\n${actions}` : ''
      ]
        .filter(Boolean)
        .join('\n');
    })
    .join('\n\n');
}

function buildMessages(goal, screenshot, history, enabledSkills) {
  const priorTurns = history
    .slice(-6)
    .map((turn, index) => `Turn ${index + 1}: ${turn}`)
    .join('\n');
  const centerX = Math.round(Number(screenshot.width || 0) / 2);
  const centerY = Math.round(Number(screenshot.height || 0) / 2);
  const skillContext = formatEnabledSkillsForPrompt(enabledSkills);

  return [
    { role: 'system', content: SYSTEM_PROMPT },
    {
      role: 'user',
      content: [
        {
          type: 'text',
          text:
            `Task: ${goal}\n\n` +
            `Screenshot size: ${screenshot.width}x${screenshot.height} pixels. Coordinates target the full desktop screenshot, not just this app.\n` +
            `Coordinate guide: top-left is x=0, y=0. The middle of the screen is x=${centerX}, y=${centerY}. The bottom-right is x=${screenshot.width}, y=${screenshot.height}.\n` +
            (skillContext
              ? `Enabled in-context skills from prior demonstrations:\n${skillContext}\n\nUse these as soft guidance when they match the current screen or task. Prefer current screenshot evidence when it conflicts with saved skill context.\n`
              : '') +
            (priorTurns ? `Recent observations:\n${priorTurns}` : 'No prior observations yet.')
        },
        {
          type: 'image_url',
          image_url: {
            url: screenshot.dataUrl,
            detail: 'high'
          }
        }
      ]
    }
  ];
}

function buildActionCriticMessages(goal, action, beforeScreenshot, afterScreenshot) {
  return [
    { role: 'system', content: ACTION_CRITIC_SYSTEM_PROMPT },
    {
      role: 'user',
      content: [
        {
          type: 'text',
          text:
            `Task: ${goal}\n\n` +
            `Action JSON:\n${JSON.stringify(action, null, 2)}\n\n` +
            `Screenshot size: ${afterScreenshot.width}x${afterScreenshot.height} pixels.\n` +
            'Decide whether this action completed successfully. Output exactly TRUE or FALSE.\n\n' +
            'Before screenshot:'
        },
        {
          type: 'image_url',
          image_url: {
            url: beforeScreenshot.dataUrl,
            detail: 'high'
          }
        },
        {
          type: 'text',
          text: 'After screenshot:'
        },
        {
          type: 'image_url',
          image_url: {
            url: afterScreenshot.dataUrl,
            detail: 'high'
          }
        }
      ]
    }
  ];
}

async function askClod({ goal, model, maxTokens, temperature, signal, history, emit, enabledSkills }) {
  const apiKey = process.env.CLOD_API_KEY;
  if (!apiKey) {
    throw new Error('Missing CLOD_API_KEY. Set it in your shell before starting the app.');
  }

  const baseUrl = process.env.CLOD_BASE_URL || DEFAULT_BASE_URL;
  const screenshot = await captureScreenshot();
  emit({ type: 'screenshot', dataUrl: screenshot.dataUrl, width: screenshot.width, height: screenshot.height });

  const response = await fetch(chatCompletionsUrl(baseUrl), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    signal,
    body: JSON.stringify({
      model,
      messages: buildMessages(goal, screenshot, history, enabledSkills),
      temperature,
      max_completion_tokens: maxTokens
    })
  });

  const bodyText = await response.text();
  if (!response.ok) {
    throw new Error(`CLOD request failed (${response.status}): ${bodyText}`);
  }

  const body = JSON.parse(bodyText);
  const content = body.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error('CLOD returned no assistant message content.');
  }

  emit({ type: 'assistant', text: content });
  return { result: parseAssistantJson(content), screenshot };
}

async function askActionCritic({
  goal,
  action,
  beforeScreenshot,
  afterScreenshot,
  criticModel,
  maxTokens = 32,
  temperature = 0,
  signal
}) {
  const apiKey = process.env.CLOD_API_KEY;
  if (!apiKey) {
    throw new Error('Missing CLOD_API_KEY. Set it in your shell before starting the app.');
  }

  const baseUrl = process.env.CLOD_BASE_URL || DEFAULT_BASE_URL;
  const response = await fetch(chatCompletionsUrl(baseUrl), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    signal,
    body: JSON.stringify({
      model: criticModel || process.env.CLOD_CRITIC_MODEL || process.env.CLOD_MODEL || DEFAULT_MODEL,
      messages: buildActionCriticMessages(goal, action, beforeScreenshot, afterScreenshot),
      temperature,
      max_completion_tokens: maxTokens
    })
  });

  const bodyText = await response.text();
  if (!response.ok) {
    throw new Error(`CLOD critic request failed (${response.status}): ${bodyText}`);
  }

  const body = JSON.parse(bodyText);
  const content = String(body.choices?.[0]?.message?.content || '').trim().toUpperCase();
  if (content === 'TRUE' || content.startsWith('TRUE')) {
    return 'TRUE';
  }
  if (content === 'FALSE' || content.startsWith('FALSE')) {
    return 'FALSE';
  }

  return 'FALSE';
}

function normalizeTrajectoryTask(task, index) {
  if (typeof task === 'string') {
    return {
      title: `Trajectory ${index + 1}`,
      instruction: task,
      why: 'Covers a useful part of the requested skill.'
    };
  }

  return {
    title: String(task?.title || task?.name || `Trajectory ${index + 1}`).trim(),
    instruction: String(task?.instruction || task?.task || task?.description || '').trim(),
    why: String(task?.why || task?.rationale || task?.reason || '').trim()
  };
}

function fallbackTrajectoryTasks(skillPrompt) {
  const topic = String(skillPrompt || 'this skill').trim() || 'this skill';
  return [
    {
      title: 'Open the relevant app',
      instruction: `Open the desktop app or website you would normally use for: ${topic}.`,
      why: 'Teaches the agent how to reach the starting context for the skill.'
    },
    {
      title: 'Find a common workspace',
      instruction: `Navigate to the main area where you perform: ${topic}.`,
      why: 'Captures menu, sidebar, and navigation patterns for the workflow.'
    },
    {
      title: 'Prepare a safe example',
      instruction: `Set up a harmless example for: ${topic}, stopping before any irreversible action.`,
      why: 'Shows the agent the core interaction while avoiding real-world side effects.'
    }
  ];
}

async function suggestTrajectoryTasks({ skillPrompt, model, maxTokens = 700, temperature = 0.35, signal }) {
  const trimmedPrompt = String(skillPrompt || '').trim();
  if (!trimmedPrompt) {
    throw new Error('Enter what you would like the app to learn first.');
  }

  const apiKey = process.env.CLOD_API_KEY;
  if (!apiKey) {
    throw new Error('Missing CLOD_API_KEY. Set it in your shell before starting the app.');
  }

  const baseUrl = process.env.CLOD_BASE_URL || DEFAULT_BASE_URL;
  const response = await fetch(chatCompletionsUrl(baseUrl), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    signal,
    body: JSON.stringify({
      model: model || process.env.CLOD_MODEL || DEFAULT_MODEL,
      messages: [
        { role: 'system', content: TRAJECTORY_SYSTEM_PROMPT },
        {
          role: 'user',
          content:
            `The user wants the app to learn this skill:\n${trimmedPrompt}\n\n` +
            'Generate exactly 3 useful RL trajectory-recording tasks for this skill.'
        }
      ],
      temperature,
      max_completion_tokens: maxTokens
    })
  });

  const bodyText = await response.text();
  if (!response.ok) {
    throw new Error(`CLOD request failed (${response.status}): ${bodyText}`);
  }

  const body = JSON.parse(bodyText);
  const content = body.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error('CLOD returned no assistant message content.');
  }

  const parsed = parseAssistantJson(content);
  const tasks = toArray(parsed.tasks || parsed.trajectories || parsed)
    .map(normalizeTrajectoryTask)
    .filter((task) => task.instruction)
    .slice(0, 3);

  return tasks.length === 3 ? tasks : fallbackTrajectoryTasks(trimmedPrompt);
}

function eventTextForVlm(event) {
  const parts = [
    `Event ${event.sequence ?? '?'}: ${event.kind || 'input'}`,
    `timestampMs=${event.timestampMs ?? 'unknown'}`
  ];

  if (event.key !== undefined || event.keyCode !== undefined) {
    parts.push(`key=${JSON.stringify(event.key || '')}`);
    parts.push(`keyCode=${event.keyCode ?? 'unknown'}`);
  }

  if (event.button || event.pixelPoint || event.pixelArea) {
    parts.push(`button=${event.button || 'unknown'}`);
    if (event.pixelPoint) {
      parts.push(`pixelPoint=(${event.pixelPoint.x}, ${event.pixelPoint.y})`);
    }
    if (event.pixelArea) {
      parts.push(
        `pixelArea={x:${event.pixelArea.x}, y:${event.pixelArea.y}, width:${event.pixelArea.width}, height:${event.pixelArea.height}}`
      );
    }
  }

  if (event.modifiers) {
    parts.push(`modifiers=${event.modifiers}`);
  }

  return parts.join('\n');
}

function trajectoryForPrompt(datapoint) {
  return toArray(datapoint?.trajectory).map((event) => {
    const { screenshot, ...rest } = event || {};
    return rest;
  });
}

async function analyzeTrajectoryDatapoint({ datapoint, model, maxTokens = 1800, temperature = 0.2, signal }) {
  if (!datapoint?.label) {
    throw new Error('Missing trajectory label.');
  }

  const apiKey = process.env.CLOD_API_KEY;
  if (!apiKey) {
    throw new Error('Missing CLOD_API_KEY. Set it in your shell before starting the app.');
  }

  const events = toArray(datapoint.trajectory);
  if (events.length === 0) {
    return {
      summary: 'No input events were captured for this trajectory.',
      useful_locations: [],
      interaction_patterns: [],
      in_context_example: {
        user_goal: datapoint.label,
        observation_hints: [],
        action_hints: []
      }
    };
  }

  const content = [
    {
      type: 'text',
      text:
        `Label: ${datapoint.label}\n\n` +
        `Trajectory JSON without screenshot payloads:\n${JSON.stringify(trajectoryForPrompt(datapoint), null, 2)}\n\n` +
        'Each following screenshot corresponds to the event text immediately before it. Use these screenshots and event coordinates to identify useful reusable UI locations for CUA in-context learning.'
    }
  ];

  for (const event of events) {
    content.push({ type: 'text', text: eventTextForVlm(event) });
    if (event.screenshot?.dataUrl) {
      content.push({
        type: 'image_url',
        image_url: {
          url: event.screenshot.dataUrl,
          detail: 'high'
        }
      });
    }
  }

  const baseUrl = process.env.CLOD_BASE_URL || DEFAULT_BASE_URL;
  const response = await fetch(chatCompletionsUrl(baseUrl), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    signal,
    body: JSON.stringify({
      model: model || process.env.CLOD_MODEL || DEFAULT_MODEL,
      messages: [
        { role: 'system', content: TRAJECTORY_ANALYSIS_SYSTEM_PROMPT },
        { role: 'user', content }
      ],
      temperature,
      max_completion_tokens: maxTokens
    })
  });

  const bodyText = await response.text();
  if (!response.ok) {
    throw new Error(`CLOD request failed (${response.status}): ${bodyText}`);
  }

  const body = JSON.parse(bodyText);
  const assistantContent = body.choices?.[0]?.message?.content;
  if (!assistantContent) {
    throw new Error('CLOD returned no assistant message content.');
  }

  return parseAssistantJson(assistantContent);
}

function toDesktopPoint(point) {
  const x = Number(point.x || 0);
  const y = Number(point.y || 0);

  return {
    x: Math.round(x / Math.max(lastDesktopGeometry.scaleX, 0.0001) + lastDesktopGeometry.originX),
    y: Math.round(y / Math.max(lastDesktopGeometry.scaleY, 0.0001) + lastDesktopGeometry.originY)
  };
}

function normalizeKey(key) {
  const value = String(key || '').toLowerCase();
  const aliases = {
    ctrl: 'Control',
    control: 'Control',
    cmd: 'Command',
    command: 'Command',
    meta: 'Command',
    alt: 'Alt',
    option: 'Alt',
    shift: 'Shift',
    enter: 'Enter',
    return: 'Enter',
    esc: 'Escape',
    escape: 'Escape',
    tab: 'Tab',
    space: 'Space',
    backspace: 'Backspace',
    delete: 'Delete',
    arrowup: 'Up',
    arrowdown: 'Down',
    arrowleft: 'Left',
    arrowright: 'Right'
  };

  return aliases[value] || String(key);
}

async function performAction(action) {
  const type = String(action.type || '').toLowerCase();

  if (type === 'click' || type === 'double_click') {
    const point = toDesktopPoint(action);
    await runDesktopDriver([type, String(point.x), String(point.y)]);
    return;
  }

  if (type === 'move') {
    const point = toDesktopPoint(action);
    await runDesktopDriver(['move', String(point.x), String(point.y)]);
    return;
  }

  if (type === 'scroll') {
    if (action.x !== undefined && action.y !== undefined) {
      const point = toDesktopPoint(action);
      await runDesktopDriver(['move', String(point.x), String(point.y)]);
    }
    await runDesktopDriver([
      'scroll',
      String(Math.round(Number(action.deltaX || 0))),
      String(Math.round(Number(action.deltaY || 0)))
    ]);
    return;
  }

  if (type === 'type') {
    await runDesktopDriver(['type', String(action.text || '')]);
    return;
  }

  if (type === 'keypress') {
    const keys = Array.isArray(action.keys) ? action.keys.map(normalizeKey) : [normalizeKey(action.key)];
    await runDesktopDriver(['keypress', ...keys]);
    return;
  }

  if (type === 'drag') {
    const from = toDesktopPoint(action.from || action);
    const to = toDesktopPoint(action.to || action);
    await runDesktopDriver(['drag', String(from.x), String(from.y), String(to.x), String(to.y)]);
    return;
  }

  if (type === 'wait') {
    await delay(Math.max(0, Number(action.ms || 1000)));
    return;
  }

  if (type === 'screenshot') {
    return;
  }

  throw new Error(`Unsupported action type: ${action.type}`);
}

async function runComputerUse(options) {
  const history = [];
  const emit = options.emit || (() => {});

  for (let turn = 1; turn <= options.maxTurns; turn += 1) {
    if (options.signal?.aborted) {
      throw new Error('Run stopped.');
    }

    emit({ type: 'turn', turn });
    const { result, screenshot: turnScreenshot } = await askClod({ ...options, history, emit });
    const actions = normalizeActions(result).slice(0, MAX_ACTIONS_PER_TURN);
    history.push(result.thought || `Received ${actions.length} action(s).`);

    if (result.done) {
      emit({ type: 'done', answer: result.answer || 'Done.' });
      return;
    }

    if (actions.length === 0) {
      emit({ type: 'done', answer: result.answer || 'No action returned.' });
      return;
    }

    let beforeActionScreenshot = turnScreenshot;
    for (const action of actions) {
      emit({ type: 'action', action });
      await performAction(action);
      await delay(150);

      const afterActionScreenshot = await captureScreenshot();
      emit({
        type: 'screenshot',
        dataUrl: afterActionScreenshot.dataUrl,
        width: afterActionScreenshot.width,
        height: afterActionScreenshot.height
      });

      const verdict = await askActionCritic({
        ...options,
        action,
        beforeScreenshot: beforeActionScreenshot,
        afterScreenshot: afterActionScreenshot
      });
      emit({ type: 'critic', action, verdict });
      history.push(`Action ${JSON.stringify(action)} critic verdict: ${verdict}`);
      beforeActionScreenshot = afterActionScreenshot;
    }
  }

  emit({ type: 'done', answer: `Stopped after ${options.maxTurns} turns.` });
}

module.exports = {
  analyzeTrajectoryDatapoint,
  captureScreenshot,
  configFromEnvironment,
  suggestTrajectoryTasks,
  runComputerUse
};
