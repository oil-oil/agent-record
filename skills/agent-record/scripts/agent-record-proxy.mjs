#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { ensureCompanion } from './bootstrap.mjs';

function help() {
  process.stdout.write(`Agent Record 代理\n\n用法：\n  node <skill>/scripts/agent-record-proxy.mjs bootstrap\n  node <skill>/scripts/agent-record-proxy.mjs doctor|extension\n  node <skill>/scripts/agent-record-proxy.mjs start|status|stop\n  node <skill>/scripts/agent-record-proxy.mjs process [参数]\n  node <skill>/scripts/agent-record-proxy.mjs studio|render [参数]\n  node <skill>/scripts/agent-record-proxy.mjs auth status|device|install|logout\n`);
}

const [command = 'help', ...args] = process.argv.slice(2);
if (command === 'help' || command === '--help') {
  help();
} else {
  try {
    const companion = await ensureCompanion();
    if (command === 'bootstrap') {
      process.stdout.write(`${JSON.stringify({ ok: true, version: companion.version, ...companion }, null, 2)}\n`);
      process.exit(0);
    }
    const child = spawn(companion.binary, [command, ...args], {
      cwd: process.cwd(),
      stdio: 'inherit',
      env: process.env,
    });
    child.on('error', (error) => {
      process.stderr.write(`${error.message}\n`);
      process.exitCode = 1;
    });
    child.on('exit', (code, signal) => {
      process.exitCode = signal ? 1 : (code ?? 1);
    });
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ ok: false, error: error?.message || String(error) }, null, 2)}\n`);
    process.exitCode = 1;
  }
}
