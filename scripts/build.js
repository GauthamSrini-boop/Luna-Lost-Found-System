// Convenience wrapper: build the React client (requires `npm install` first).
import { spawnSync } from 'node:child_process';
const r = spawnSync('npm', ['run', 'build', '--workspace', 'client'], { stdio: 'inherit', shell: true });
process.exit(r.status ?? 1);
