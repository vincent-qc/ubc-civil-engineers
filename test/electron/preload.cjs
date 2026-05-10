const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('computerUse', {
  config() {
    return ipcRenderer.invoke('computer:config');
  },
  run(request) {
    return ipcRenderer.invoke('computer:run', request);
  },
  stop() {
    return ipcRenderer.invoke('computer:stop');
  },
  suggestTrajectories(request) {
    return ipcRenderer.invoke('skill:suggest-trajectories', request);
  },
  startRecording(request) {
    return ipcRenderer.invoke('recording:start', request);
  },
  stopRecording() {
    return ipcRenderer.invoke('recording:stop');
  },
  recordings() {
    return ipcRenderer.invoke('recording:list');
  },
  skills() {
    return ipcRenderer.invoke('skills:list');
  },
  toggleSkill(id) {
    return ipcRenderer.invoke('skills:toggle', { id });
  },
  onEvent(callback) {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('computer:event', listener);
    return () => ipcRenderer.removeListener('computer:event', listener);
  },
  onRecordingEvent(callback) {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('recording:event', listener);
    return () => ipcRenderer.removeListener('recording:event', listener);
  }
});
