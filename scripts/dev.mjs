// Local development: run the server (tsx watch, :3001) and the client (Vite, :5173)
// together without an extra dependency. Ctrl+C stops both.
import { spawn } from 'node:child_process';

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const children = ['server', 'client'].map(ws =>
  spawn(npm, ['run', 'dev', '-w', ws], { stdio: 'inherit', shell: process.platform === 'win32' }),
);

let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) if (child.exitCode === null) child.kill();
  process.exitCode = code;
}
for (const child of children) child.on('exit', code => stop(code ?? 0));
process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));
