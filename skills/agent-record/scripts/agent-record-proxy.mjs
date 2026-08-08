#!/usr/bin/env node

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureRoot } from './bootstrap.mjs';

const commandMap = {
  extension: ['scripts/setup-extension.mjs'],
  'setup-extension': ['scripts/setup-extension.mjs'],
  doctor: ['scripts/agent-record.mjs', 'doctor'],
  start: ['scripts/agent-record.mjs', 'start'],
  status: ['scripts/agent-record.mjs', 'status'],
  stop: ['scripts/agent-record.mjs', 'stop'],
  process: ['scripts/process-video.mjs'],
  check: ['__npm__', 'run', 'check'],
  studio: ['scripts/studio-cli.mjs'],
  'studio-cli': ['scripts/studio-cli.mjs'],
  render: ['scripts/render-project.mjs'],
  'studio:cli': ['scripts/studio-cli.mjs'],
  'studio:render': ['scripts/render-project.mjs'],
};

function help() {
  process.stdout.write(`Agent Record 代理\n\n用法：\n  node <skill>/scripts/agent-record-proxy.mjs bootstrap|doctor\n  node <skill>/scripts/agent-record-proxy.mjs extension\n  node <skill>/scripts/agent-record-proxy.mjs start|status|stop\n  node <skill>/scripts/agent-record-proxy.mjs process [参数]\n  node <skill>/scripts/agent-record-proxy.mjs studio|render [参数]\n  node <skill>/scripts/agent-record-proxy.mjs check\n`);
}

const [command = 'help', ...args] = process.argv.slice(2);
if (command === 'help' || command === '--help') {
  help();
} else {
  try {
    const located = await ensureRoot();
    if (command === 'bootstrap') {
      process.stdout.write(`${JSON.stringify({ ok: true, ...located }, null, 2)}\n`);
      process.exit(0);
    }
    const target = commandMap[command];
    if (!target) throw new Error(`不支持的代理命令：${command}`);
    const [script, ...fixed] = target;
    const npmCommand = script === '__npm__';
    const executable = npmCommand
      ? (process.env.npm_execpath ? process.execPath : 'npm')
      : process.execPath;
    const commandArgs = npmCommand
      ? (process.env.npm_execpath ? [process.env.npm_execpath, ...fixed, ...args] : [...fixed, ...args])
      : [path.join(located.root, script), ...fixed, ...args];
    const child = spawn(executable, commandArgs, {
      cwd: located.root,
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
