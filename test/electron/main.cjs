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
