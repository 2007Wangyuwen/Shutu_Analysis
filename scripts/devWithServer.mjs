import { spawn } from 'node:child_process';

function run(cmd, args) {
  const child = spawn(cmd, args, {
    stdio: 'inherit',
    shell: true,
    windowsHide: true,
    env: process.env,
  });
  return child;
}

const vite = run('npm', ['run', 'dev:vite']);
const server = run('npm', ['run', 'dev:server']);

const shutdown = () => {
  vite?.kill?.('SIGINT');
  server?.kill?.('SIGINT');
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

vite.on('exit', (code) => {
  if (code !== 0) shutdown();
});
server.on('exit', (code) => {
  if (code !== 0) shutdown();
});

