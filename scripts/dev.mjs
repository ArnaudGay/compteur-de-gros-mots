// Lance le serveur (rechargé à chaque modification) et l'interface Vite en parallèle.
import { spawn } from 'node:child_process';

const env = {
  ...process.env,
  PORT: process.env.PORT ?? '8787',
  PUBLIC_ORIGIN: process.env.PUBLIC_ORIGIN ?? 'http://localhost:5173',
  DATA_DIR: process.env.DATA_DIR ?? 'data',
  NODE_ENV: 'development',
};

const children = [
  spawn('npx', ['tsx', 'watch', '--clear-screen=false', 'src/server/main.ts'], { stdio: 'inherit', env }),
  spawn('npx', ['vite'], { stdio: 'inherit', env }),
];

const stop = () => {
  for (const child of children) child.kill('SIGTERM');
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
for (const child of children) child.on('exit', stop);
