import http from 'node:http';
import { spawn } from 'node:child_process';

const host = '127.0.0.1';
const port = 1420;

function isDevServerRunning() {
  return new Promise((resolve) => {
    const request = http.get(
      {
        host,
        port,
        path: '/',
        timeout: 750
      },
      (response) => {
        response.resume();
        resolve(response.statusCode !== undefined && response.statusCode < 500);
      }
    );

    request.on('error', () => resolve(false));
    request.on('timeout', () => {
      request.destroy();
      resolve(false);
    });
  });
}

function holdOpen() {
  const timer = setInterval(() => {}, 1 << 30);

  const shutdown = () => {
    clearInterval(timer);
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

async function main() {
  if (await isDevServerRunning()) {
    console.log(`Using existing dev server at http://${host}:${port}`);
    holdOpen();
    return;
  }

  const child = spawn('npm', ['run', 'dev:raw'], {
    stdio: 'inherit',
    shell: true
  });

  const forwardSignal = (signal) => {
    if (!child.killed) {
      child.kill(signal);
    }
  };

  process.on('SIGINT', () => forwardSignal('SIGINT'));
  process.on('SIGTERM', () => forwardSignal('SIGTERM'));

  child.on('exit', (code) => {
    process.exit(code ?? 0);
  });
}

void main();
