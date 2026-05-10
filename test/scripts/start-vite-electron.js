const { spawn } = require('node:child_process');
const http = require('node:http');
const path = require('node:path');

const root = path.join(__dirname, '..');

function electronBin() {
  return require('electron');
}

function waitForUrl(url) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();

    function check() {
      const request = http.get(url, (response) => {
        response.resume();
        resolve();
      });

      request.on('error', (error) => {
        if (Date.now() - startedAt > 30000) {
          reject(error);
          return;
        }
        setTimeout(check, 250);
      });
    }

    check();
  });
}

async function main() {
  const url = `http://127.0.0.1:${process.env.PORT || 5173}`;
  const viteProcess = spawn(
    process.platform === 'win32' ? 'npx.cmd' : 'npx',
    ['vite', '--host', '127.0.0.1', '--port', String(process.env.PORT || 5173)],
    {
      cwd: root,
      env: process.env,
      stdio: 'inherit'
    }
  );

  const stopVite = () => {
    if (!viteProcess.killed) {
      viteProcess.kill('SIGTERM');
    }
  };

  process.on('SIGINT', () => {
    stopVite();
    process.exit(130);
  });

  process.on('SIGTERM', () => {
    stopVite();
    process.exit(143);
  });

  await waitForUrl(url);

  const electronProcess = spawn(electronBin(), ['.'], {
    cwd: root,
    env: { ...process.env, VITE_DEV_SERVER_URL: url },
    stdio: 'inherit'
  });

  electronProcess.on('exit', (code, signal) => {
    stopVite();
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code || 0);
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
