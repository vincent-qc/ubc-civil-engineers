require('dotenv').config();

const { app, BrowserWindow, ipcMain, shell } = require('electron');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const clodCua = require('../lib/computer-use.cjs');
const gptCua = require('../lib/gptcua.cjs');

let mainWindow;
let activeRun = null;
let activeRecording = null;
let stoppingRecording = null;
const completedRecordings = [];

function skillsFilePath() {
  return path.join(app.getPath('userData'), 'skills.json');
}

function readSkills() {
  try {
    const parsed = JSON.parse(fs.readFileSync(skillsFilePath(), 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeSkills(skills) {
  fs.mkdirSync(path.dirname(skillsFilePath()), { recursive: true });
  fs.writeFileSync(skillsFilePath(), `${JSON.stringify(skills, null, 2)}\n`);
}

function compactSkill(skill) {
  return {
    id: skill.id,
    name: skill.name,
    label: skill.label,
    enabled: skill.enabled !== false,
    createdAt: skill.createdAt,
    cuaAnalysis: skill.cuaAnalysis
  };
}

function saveSkillFromDatapoint(datapoint) {
  const skills = readSkills();
  const label = String(datapoint.label || 'Untitled skill');
  const skill = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: datapoint.cuaAnalysis?.in_context_example?.user_goal || label,
    label,
    enabled: true,
    createdAt: new Date().toISOString(),
    cuaAnalysis: datapoint.cuaAnalysis
  };

  skills.push(skill);
  writeSkills(skills);
  return compactSkill(skill);
}

function toggleSkillEnabled(id) {
  const skills = readSkills();
  const nextSkills = skills.map((skill) =>
    skill.id === id ? { ...skill, enabled: skill.enabled === false } : skill
  );
  writeSkills(nextSkills);
  return nextSkills.map(compactSkill);
}

function enabledSkillsForPrompt() {
  return readSkills().filter((skill) => skill.enabled !== false).map(compactSkill);
}

function routeForEnabledSkills(enabledSkills = enabledSkillsForPrompt()) {
  if (enabledSkills.length === 0) {
    return {
      provider: 'clod',
      backend: clodCua,
      config: clodCua.configFromEnvironment()
    };
  }

  return {
    provider: 'openai',
    backend: gptCua,
    config: gptCua.configFromEnvironment()
  };
}

function routedConfig() {
  const route = routeForEnabledSkills();
  return {
    ...route.config,
    provider: route.provider
  };
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 760,
    minWidth: 1000,
    minHeight: 560,
    title: 'GPT Computer Use',
    backgroundColor: '#f7f7f2',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }

  mainWindow.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    console.log(`[renderer:${level}] ${message} (${sourceId}:${line})`);
  });

  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    console.error(`[renderer:load-failed] ${errorCode} ${errorDescription} ${validatedURL}`);
  });

  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    console.error(`[renderer:gone] ${details.reason}`);
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

function sendEvent(payload) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  mainWindow.webContents.send('computer:event', payload);
}

function sendRecordingEvent(payload) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  mainWindow.webContents.send('recording:event', payload);
}

function waitForChildClose(child, timeoutMs = 1500) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    let forceTimeout;
    const timeout = setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGKILL');
      }
      forceTimeout = setTimeout(resolve, 1000);
    }, timeoutMs);

    child.once('close', () => {
      clearTimeout(timeout);
      clearTimeout(forceTimeout);
      resolve();
    });
  });
}

function desktopDriverPath() {
  return path.join(process.cwd(), 'bin', 'desktop-driver');
}

function compactDatapoint(datapoint) {
  return {
    ...datapoint,
    trajectory: datapoint.trajectory.map((event) => ({
      ...event,
      screenshot: event.screenshot
        ? {
            width: event.screenshot.width,
            height: event.screenshot.height,
            capturedAt: event.screenshot.capturedAt,
            hasDataUrl: Boolean(event.screenshot.dataUrl),
            error: event.screenshot.error
          }
        : undefined
    }))
  };
}

function compactSample(event) {
  return {
    ...event,
    screenshot: event.screenshot
      ? {
          width: event.screenshot.width,
          height: event.screenshot.height,
          capturedAt: event.screenshot.capturedAt,
          hasDataUrl: Boolean(event.screenshot.dataUrl),
          error: event.screenshot.error
        }
      : undefined
  };
}

function appendRecordingSample(recording, event) {
  const sequence = recording.nextSequence;
  recording.nextSequence += 1;

  const datapoint = {
    sequence,
    ...event
  };
  recording.trajectory.push(datapoint);
  sendRecordingEvent({
    type: 'sample',
    label: recording.label,
    taskId: recording.taskId,
    sample: compactSample(datapoint),
    count: recording.trajectory.length
  });

  recording.sampleQueue = recording.sampleQueue.then(async () => {
    try {
      const screenshot = await gptCua.captureScreenshot();
      datapoint.screenshot = {
        ...screenshot,
        capturedAt: new Date().toISOString()
      };
    } catch (error) {
      datapoint.screenshot = {
        error: error.message,
        capturedAt: new Date().toISOString()
      };
    }
    sendRecordingEvent({
      type: 'sample_updated',
      label: recording.label,
      taskId: recording.taskId,
      sample: compactSample(datapoint),
      count: recording.trajectory.length
    });
  });
}

async function analyzeRecordingDatapoint(datapoint, label, taskId) {
  try {
    sendRecordingEvent({ type: 'analyzing', label, taskId, datapoint: compactDatapoint(datapoint) });
    datapoint.cuaAnalysis = await gptCua.analyzeTrajectoryDatapoint({
      datapoint,
      model: gptCua.configFromEnvironment().model
    });
    const skill = saveSkillFromDatapoint(datapoint);
    sendRecordingEvent({ type: 'analyzed', taskId, datapoint: compactDatapoint(datapoint), analysis: datapoint.cuaAnalysis });
    sendRecordingEvent({ type: 'skill_saved', taskId, skill });
  } catch (error) {
    datapoint.cuaAnalysisError = error.message;
    sendRecordingEvent({ type: 'analysis_error', taskId, text: error.message, datapoint: compactDatapoint(datapoint) });
  }
}

async function stopActiveRecording({ discardEmpty = false, analyzeInBackground = false } = {}) {
  if (stoppingRecording) {
    return stoppingRecording;
  }

  if (!activeRecording) {
    return { ok: false, error: 'No recording is active.' };
  }

  const recording = activeRecording;
  activeRecording = null;

  stoppingRecording = (async () => {
    if (!recording.child.killed) {
      recording.child.kill('SIGTERM');
    }

    await waitForChildClose(recording.child);

    if (recording.trajectory.length === 0 && discardEmpty) {
    sendRecordingEvent({ type: 'discarded', label: recording.label, taskId: recording.taskId, reason: 'No datapoints captured.' });
      return { ok: true, discarded: true, recordings: completedRecordings.map(compactDatapoint) };
    }

    const datapoint = {
      label: recording.label,
      taskId: recording.taskId,
      trajectory: recording.trajectory,
      startedAt: recording.startedAt,
      endedAt: new Date().toISOString(),
      metadata: recording.metadata
    };

    completedRecordings.push(datapoint);
    sendRecordingEvent({ type: 'stopped', taskId: recording.taskId, datapoint: compactDatapoint(datapoint) });

    const finishDatapoint = async () => {
      await recording.sampleQueue;
      if (analyzeInBackground) {
        await analyzeRecordingDatapoint(datapoint, recording.label, recording.taskId);
      }
    };

    if (analyzeInBackground) {
      finishDatapoint().catch((error) => {
        sendRecordingEvent({ type: 'analysis_error', taskId: recording.taskId, text: error.message, datapoint: compactDatapoint(datapoint) });
      });
    } else {
      await recording.sampleQueue;
      await analyzeRecordingDatapoint(datapoint, recording.label, recording.taskId);
    }

    return { ok: true, datapoint: compactDatapoint(datapoint), recordings: completedRecordings.map(compactDatapoint) };
  })();

  try {
    return await stoppingRecording;
  } finally {
    if (stoppingRecording) {
      stoppingRecording = null;
    }
  }
}

ipcMain.handle('computer:config', () => routedConfig());

ipcMain.handle('skill:suggest-trajectories', async (_event, request) => {
  const skillPrompt = String(request?.skillPrompt || '').trim();
  if (!skillPrompt) {
    return { ok: false, error: 'Enter what you would like the app to learn first.' };
  }

  try {
    const config = gptCua.configFromEnvironment();
    const tasks = await gptCua.suggestTrajectoryTasks({
      skillPrompt,
      model: String(request?.model || config.model).trim()
    });
    return { ok: true, tasks };
  } catch (error) {
    return { ok: false, error: error.message };
  }
});

ipcMain.handle('recording:start', async (_event, request) => {
  const label = String(request?.label || '').trim();
  const taskId = String(request?.taskId || '').trim();
  if (!label) {
    return { ok: false, error: 'Missing recording label.' };
  }

  if (stoppingRecording) {
    await stoppingRecording;
  }

  if (activeRecording) {
    const stopResult = await stopActiveRecording({ discardEmpty: true, analyzeInBackground: true });
    if (!stopResult.ok) {
      return { ok: false, error: stopResult.error || 'Could not stop the previous recording.' };
    }
  }

  const child = spawn(desktopDriverPath(), ['record'], {
    cwd: process.cwd(),
    stdio: ['ignore', 'pipe', 'pipe']
  });

  const recording = {
    child,
    label,
    taskId,
    trajectory: [],
    metadata: null,
    startedAt: new Date().toISOString(),
    stdoutBuffer: '',
    nextSequence: 0,
    sampleQueue: Promise.resolve()
  };
  activeRecording = recording;

  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    recording.stdoutBuffer += chunk;
    const lines = recording.stdoutBuffer.split('\n');
    recording.stdoutBuffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.trim()) {
        continue;
      }

      try {
        const event = JSON.parse(line);
        if (event.kind === 'recording_started') {
          recording.metadata = event;
          sendRecordingEvent({ type: 'started', label, taskId, metadata: event });
          continue;
        }

        appendRecordingSample(recording, event);
      } catch (error) {
        sendRecordingEvent({ type: 'error', text: `Unable to parse recording event: ${error.message}` });
      }
    }
  });

  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => {
    sendRecordingEvent({ type: 'error', text: chunk.trim() });
  });

  child.on('error', (error) => {
    if (activeRecording === recording) {
      activeRecording = null;
    }
    sendRecordingEvent({ type: 'error', text: error.message });
  });

  child.on('close', (code, signal) => {
    if (activeRecording === recording) {
      activeRecording = null;
      sendRecordingEvent({
        type: 'error',
        text: `Recording stopped unexpectedly${signal ? ` (${signal})` : code ? ` (${code})` : ''}.`
      });
    }
  });

  return { ok: true, label };
});

ipcMain.handle('recording:stop', async () => stopActiveRecording({ analyzeInBackground: true }));

ipcMain.handle('recording:list', async () => ({ ok: true, recordings: completedRecordings.map(compactDatapoint) }));

ipcMain.handle('skills:list', async () => ({ ok: true, skills: readSkills().map(compactSkill) }));

ipcMain.handle('skills:toggle', async (_event, request) => {
  const id = String(request?.id || '').trim();
  if (!id) {
    return { ok: false, error: 'Missing skill id.' };
  }

  return { ok: true, skills: toggleSkillEnabled(id) };
});

ipcMain.handle('computer:run', async (_event, request) => {
  const goal = String(request?.goal || '').trim();
  if (!goal) {
    return { ok: false, error: 'Enter a task first.' };
  }

  if (activeRun) {
    return { ok: false, error: 'A run is already active.' };
  }

  const enabledSkills = enabledSkillsForPrompt();
  const route = routeForEnabledSkills(enabledSkills);
  const config = route.config;
  const controller = new AbortController();
  activeRun = controller;

  const options = {
    goal,
    model: String(request?.model || config.model).trim(),
    maxTurns: Math.max(1, Math.min(20, Number(request?.maxTurns || config.maxTurns || 8))),
    signal: controller.signal,
    enabledSkills,
    emit: sendEvent
  };

  sendEvent({ type: 'start', model: options.model, provider: route.provider, baseUrl: config.baseUrl });

  route.backend.runComputerUse(options)
    .catch((error) => {
      sendEvent({ type: 'error', text: error.message });
    })
    .finally(() => {
      activeRun = null;
      sendEvent({ type: 'idle' });
    });

  return { ok: true };
});

ipcMain.handle('computer:stop', async () => {
  if (activeRun) {
    activeRun.abort();
  }
  return { ok: true };
});

// ---- HTTP REST server for the Chrome extension ----
const http = require('node:http');

const HTTP_PORT = 8000;

function jsonBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => { data += chunk; });
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}); }
      catch { reject(new Error('Invalid JSON')); }
    });
    req.on('error', reject);
  });
}

function send(res, status, body) {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(json);
}

function recorderStatusPayload() {
  if (activeRecording) {
    return {
      state: 'recording',
      session_id: activeRecording.label,
      trajectory_id: null,
      skill_id: null,
      task_id: null,
      started_at: activeRecording.startedAt,
      paused_at: null,
    };
  }
  return { state: 'idle', session_id: null, trajectory_id: null,
           skill_id: null, task_id: null, started_at: null, paused_at: null };
}

function mapSkill(skill) {
  return {
    id: skill.id,
    name: skill.name || skill.label,
    description: skill.cuaAnalysis?.summary || skill.label || '',
    status: skill.enabled !== false ? 'ready' : 'draft',
    task_count: skill.cuaAnalysis?.in_context_example ? 1 : 0,
    trajectory_count: 0,
    created_at: skill.createdAt,
    updated_at: skill.createdAt,
  };
}

const httpServer = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${HTTP_PORT}`);
  const { pathname } = url;

  if (req.method === 'OPTIONS') return send(res, 204, {});

  try {
    if (req.method === 'GET' && pathname === '/api/health') {
      return send(res, 200, {
        status: 'ok',
        version: '0.1.0',
        recorder_available: true,
      });
    }

    if (req.method === 'GET' && pathname === '/api/recorder/status') {
      return send(res, 200, recorderStatusPayload());
    }

    if (req.method === 'GET' && pathname === '/api/session/current') {
      const rec = recorderStatusPayload();
      return send(res, 200, {
        user_id: 'local',
        user_display_name: 'Local User',
        active_skill_id: null,
        active_task_id: null,
        active_trajectory_id: null,
        recording_state: rec.state,
      });
    }

    if (req.method === 'POST' && pathname === '/api/recorder/start') {
      const body = await jsonBody(req);
      const label = String(body.task_id || body.skill_id || body.context?.title || 'recording').trim();
      if (activeRecording) return send(res, 409, { error: 'A recording is already active.' });

      const child = spawn(desktopDriverPath(), ['record'], {
        cwd: process.cwd(),
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      const recording = {
        child, label,
        trajectory: [],
        metadata: null,
        startedAt: new Date().toISOString(),
        stdoutBuffer: '',
        nextSequence: 0,
        sampleQueue: Promise.resolve(),
      };
      activeRecording = recording;

      child.stdout.setEncoding('utf8');
      child.stdout.on('data', chunk => {
        recording.stdoutBuffer += chunk;
        const lines = recording.stdoutBuffer.split('\n');
        recording.stdoutBuffer = lines.pop() || '';
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const event = JSON.parse(line);
            if (event.kind === 'recording_started') {
              recording.metadata = event;
              sendRecordingEvent({ type: 'started', label, metadata: event });
            } else {
              appendRecordingSample(recording, event);
            }
          } catch {}
        }
      });
      child.stderr.setEncoding('utf8');
      child.stderr.on('data', chunk => sendRecordingEvent({ type: 'error', text: chunk.trim() }));
      child.on('error', error => {
        if (activeRecording === recording) activeRecording = null;
        sendRecordingEvent({ type: 'error', text: error.message });
      });
      child.on('close', (code, signal) => {
        if (activeRecording === recording) {
          activeRecording = null;
          sendRecordingEvent({ type: 'error', text: `Stopped unexpectedly${signal ? ` (${signal})` : ''}` });
        }
      });

      return send(res, 200, {
        ok: true,
        session_id: label,
        trajectory_id: null,
        recording_state: 'recording',
      });
    }

    if (req.method === 'POST' && pathname === '/api/recorder/pause') {
      return send(res, 200, { ok: true });
    }

    if (req.method === 'POST' && pathname === '/api/recorder/resume') {
      return send(res, 200, { ok: true });
    }

    if (req.method === 'POST' && pathname === '/api/recorder/stop') {
      const result = await stopActiveRecording();
      return send(res, result.ok ? 200 : 400, { ok: result.ok, error: result.error });
    }

    if (req.method === 'GET' && pathname === '/api/skills') {
      return send(res, 200, readSkills().map(compactSkill).map(mapSkill));
    }

    const activateMatch = pathname.match(/^\/api\/skills\/([^/]+)\/activate$/);
    if (req.method === 'POST' && activateMatch) {
      const id = activateMatch[1];
      const skills = readSkills();
      const next = skills.map(s => s.id === id ? { ...s, enabled: true } : s);
      writeSkills(next);
      return send(res, 200, { ok: true });
    }

    if (req.method === 'GET' && pathname === '/api/gregory/conversations/current') {
      return send(res, 200, null);
    }

    if (req.method === 'POST' && pathname === '/api/gregory/messages') {
      const body = await jsonBody(req);
      const skillPrompt = String(body.message || '').trim();
      if (!skillPrompt) return send(res, 400, { error: 'message is required' });

      const config = configFromEnvironment();
      if (!config.hasApiKey) {
        const conversationId = body.conversation_id || `conv-${Date.now()}`;
        const now = new Date().toISOString();
        return send(res, 200, {
          conversation_id: conversationId,
          messages: [
            { id: `msg-u-${Date.now()}`, role: 'user', content: skillPrompt, created_at: now },
            { id: `msg-a-${Date.now()}`, role: 'assistant', content: 'No API key found. Set `CLOD_API_KEY` in your shell and restart the Electron app to use Gregory.', created_at: now },
          ],
          pending_question: null,
        });
      }

      const result = await suggestTrajectoryTasks({ skillPrompt, model: config.model });
      const conversationId = body.conversation_id || `conv-${Date.now()}`;
      const now = new Date().toISOString();

      let assistantContent;
      if (result && result.length > 0) {
        assistantContent = result
          .map((t, i) => `**Task ${i + 1}: ${t.title}**\n${t.instruction}${t.why ? `\n_Why: ${t.why}_` : ''}`)
          .join('\n\n');
      } else {
        assistantContent = "I couldn't generate task suggestions for that. Try being more specific.";
      }

      return send(res, 200, {
        conversation_id: conversationId,
        messages: [
          { id: `msg-u-${Date.now()}`, role: 'user', content: skillPrompt, created_at: now },
          { id: `msg-a-${Date.now()}`, role: 'assistant', content: assistantContent, created_at: now },
        ],
        pending_question: null,
      });
    }

    if (req.method === 'GET' && pathname === '/api/tasks/active') {
      return send(res, 200, null);
    }

    if (req.method === 'GET' && pathname === '/api/safety/pending') {
      return send(res, 200, []);
    }

    if (req.method === 'GET' && pathname === '/api/training/jobs') {
      return send(res, 200, []);
    }

    if (req.method === 'GET' && pathname === '/api/model/status') {
      const config = configFromEnvironment();
      return send(res, 200, {
        is_loaded: Boolean(config.hasApiKey),
        model_id: config.model || null,
        skill_id: null,
        last_trained_at: null,
      });
    }

    return send(res, 404, { error: 'Not found' });
  } catch (error) {
    console.error('[HTTP server]', error);
    return send(res, 500, { error: error.message });
  }
});

httpServer.on('error', (err) => {
  console.error('[HTTP server] Failed to start:', err.message);
});

httpServer.listen(HTTP_PORT, '127.0.0.1', () => {
  console.log(`[HTTP server] Listening on http://127.0.0.1:${HTTP_PORT}`);
});

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (activeRecording) {
    stopActiveRecording().catch((error) => {
      sendRecordingEvent({ type: 'error', text: error.message });
    });
  }

  if (process.platform !== 'darwin') {
    app.quit();
  }
});
