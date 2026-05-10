require('dotenv').config();

const { app, BrowserWindow, ipcMain, shell } = require('electron');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const {
  analyzeTrajectoryDatapoint,
  captureScreenshot,
  configFromEnvironment,
  runComputerUse,
  suggestTrajectoryTasks
} = require('../lib/computer-use.cjs');

let mainWindow;
let activeRun = null;
let activeRecording = null;
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

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 760,
    minWidth: 1000,
    minHeight: 560,
    title: 'CLOD Computer Use',
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
  sendRecordingEvent({ type: 'sample', label: recording.label, sample: compactSample(datapoint), count: recording.trajectory.length });

  recording.sampleQueue = recording.sampleQueue.then(async () => {
    try {
      const screenshot = await captureScreenshot();
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
    sendRecordingEvent({ type: 'sample_updated', label: recording.label, sample: compactSample(datapoint), count: recording.trajectory.length });
  });
}

async function stopActiveRecording() {
  if (!activeRecording) {
    return { ok: false, error: 'No recording is active.' };
  }

  const recording = activeRecording;
  activeRecording = null;

  if (!recording.child.killed) {
    recording.child.kill('SIGTERM');
  }

  await recording.sampleQueue;

  const datapoint = {
    label: recording.label,
    trajectory: recording.trajectory,
    startedAt: recording.startedAt,
    endedAt: new Date().toISOString(),
    metadata: recording.metadata
  };

  completedRecordings.push(datapoint);
  sendRecordingEvent({ type: 'stopped', datapoint: compactDatapoint(datapoint) });

  try {
    sendRecordingEvent({ type: 'analyzing', label: recording.label });
    datapoint.cuaAnalysis = await analyzeTrajectoryDatapoint({
      datapoint,
      model: configFromEnvironment().model
    });
    const skill = saveSkillFromDatapoint(datapoint);
    sendRecordingEvent({ type: 'analyzed', datapoint: compactDatapoint(datapoint), analysis: datapoint.cuaAnalysis });
    sendRecordingEvent({ type: 'skill_saved', skill });
  } catch (error) {
    datapoint.cuaAnalysisError = error.message;
    sendRecordingEvent({ type: 'analysis_error', text: error.message, datapoint: compactDatapoint(datapoint) });
  }

  return { ok: true, datapoint: compactDatapoint(datapoint), recordings: completedRecordings.map(compactDatapoint) };
}

ipcMain.handle('computer:config', () => configFromEnvironment());

ipcMain.handle('skill:suggest-trajectories', async (_event, request) => {
  const skillPrompt = String(request?.skillPrompt || '').trim();
  if (!skillPrompt) {
    return { ok: false, error: 'Enter what you would like the app to learn first.' };
  }

  try {
    const config = configFromEnvironment();
    const tasks = await suggestTrajectoryTasks({
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
  if (!label) {
    return { ok: false, error: 'Missing recording label.' };
  }

  if (activeRecording) {
    return { ok: false, error: 'A recording is already active.' };
  }

  const child = spawn(desktopDriverPath(), ['record'], {
    cwd: process.cwd(),
    stdio: ['ignore', 'pipe', 'pipe']
  });

  const recording = {
    child,
    label,
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
          sendRecordingEvent({ type: 'started', label, metadata: event });
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

ipcMain.handle('recording:stop', async () => stopActiveRecording());

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

  const config = configFromEnvironment();
  const controller = new AbortController();
  activeRun = controller;

  const options = {
    goal,
    model: String(request?.model || config.model).trim(),
    criticModel: String(request?.criticModel || config.criticModel || request?.model || config.model).trim(),
    maxTurns: Math.max(1, Math.min(20, Number(request?.maxTurns || config.maxTurns || 8))),
    maxTokens: Math.max(256, Math.min(4096, Number(request?.maxTokens || 900))),
    temperature: Math.max(0, Math.min(2, Number(request?.temperature || 0.2))),
    signal: controller.signal,
    enabledSkills: enabledSkillsForPrompt(),
    emit: sendEvent
  };

  sendEvent({ type: 'start', model: options.model, criticModel: options.criticModel, baseUrl: config.baseUrl });

  runComputerUse(options)
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
