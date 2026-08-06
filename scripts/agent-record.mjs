#!/usr/bin/env node

import { randomUUID } from 'node:crypto';
import { openSync } from 'node:fs';
import { access, mkdir, readFile, rm } from 'node:fs/promises';
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  SERVICE_HOST,
  SERVICE_PORT,
  nativeCaptureBinary,
  runtimeDirectory,
  runtimeStatePath,
} from './lib/agent-record-runtime.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function parseArguments(values) {
  const [command = 'help', ...rest] = values;
  const options = {};
  for (let index = 0; index < rest.length; index += 1) {
    const value = rest[index];
    if (!value.startsWith('--')) continue;
    const key = value.slice(2);
    const next = rest[index + 1];
    options[key] = next && !next.startsWith('--') ? next : true;
    if (options[key] !== true) index += 1;
  }
  return { command, options };
}

function output(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

async function request(pathname, options = {}) {
  const response = await fetch(`http://${SERVICE_HOST}:${SERVICE_PORT}${pathname}`, {
    ...options,
    signal: AbortSignal.timeout(options.timeout ?? 30_000),
  });
  const value = await response.json();
  if (!response.ok) {
    const error = new Error(value.error || `本地录制服务响应失败：${response.status}`);
    error.code = value.errorCode;
    throw error;
  }
  return value;
}

async function currentStatus() {
  try {
    return await request('/v1/status', { timeout: 1_000 });
  } catch {
    try {
      return JSON.parse(await readFile(runtimeStatePath(), 'utf8'));
    } catch {
      return { state: 'idle', recording: false };
    }
  }
}

function commandExists(command, args = ['-version']) {
  const result = spawnSync(command, args, { encoding: 'utf8' });
  return result.status === 0;
}

async function doctor() {
  const checks = {
    platform: {
      ok: process.platform === 'darwin',
      value: process.platform,
      required: 'darwin',
    },
    node: {
      ok: Number(process.versions.node.split('.')[0]) >= 22,
      value: process.versions.node,
      required: '>=22',
    },
    ffmpeg: { ok: commandExists('ffmpeg'), required: true },
    ffprobe: { ok: commandExists('ffprobe'), required: true },
    nativeBinary: {
      ok: await access(nativeCaptureBinary(root)).then(() => true).catch(() => false),
      path: nativeCaptureBinary(root),
    },
  };
  if (checks.nativeBinary.ok) {
    const permission = spawnSync(nativeCaptureBinary(root), ['permission'], { encoding: 'utf8' });
    try {
      checks.screenRecordingPermission = {
        ok: permission.status === 0 && JSON.parse(permission.stdout).granted === true,
        required: true,
      };
    } catch {
      checks.screenRecordingPermission = { ok: false, required: true };
    }
  } else {
    checks.screenRecordingPermission = { ok: false, required: true };
  }
  const ok = Object.values(checks).every((check) => check.ok);
  output({ ok, checks });
  if (!ok) process.exitCode = 1;
}

async function start(options) {
  if (typeof options.url !== 'string' || !/^https?:\/\//i.test(options.url)) {
    throw new Error('start 必须提供目标网页 --url');
  }
  const existing = await currentStatus();
  if (!['idle', 'completed', 'failed'].includes(existing.state)) {
    throw new Error(`已有录制服务正在运行：${existing.state}`);
  }
  await access(nativeCaptureBinary(root)).catch(() => {
    throw new Error('缺少 macOS 录制程序，请先运行 npm run native:build');
  });

  const sessionId = options.session || `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`;
  const sessionDirectory = path.resolve(
    options.output || path.join(root, 'artifacts', 'sessions', sessionId),
  );
  await mkdir(path.dirname(sessionDirectory), { recursive: true });
  await mkdir(runtimeDirectory(), { recursive: true });
  await rm(runtimeStatePath(), { force: true });
  const logPath = path.join(runtimeDirectory(), 'daemon.log');
  const logFd = openSync(logPath, 'a');
  const child = spawn(process.execPath, [
    path.join(root, 'scripts', 'agent-record-daemon.mjs'),
    '--session', sessionId,
    '--output', sessionDirectory,
    '--owner', options.app || 'Google Chrome',
    '--url', options.url,
    ...(options.title ? ['--title', options.title] : []),
  ], {
    cwd: root,
    detached: true,
    stdio: ['ignore', logFd, logFd],
  });
  child.unref();

  const deadline = Date.now() + 15_000;
  let status = null;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    status = await currentStatus();
    if (status.state === 'recording') {
      output({ ok: true, ...status, sessionDirectory });
      return;
    }
    if (status.state === 'failed') {
      throw new Error(status.error || '本地录制服务启动失败');
    }
  }
  try {
    await request('/v1/stop', { method: 'POST', timeout: 5_000 });
  } catch {}
  throw new Error('浏览器扩展没有在 15 秒内连接本地录制服务');
}

async function stop() {
  const result = await request('/v1/stop', { method: 'POST', timeout: 60_000 });
  output(result);
}

function help() {
  process.stdout.write(`Agent Record

用法：
  agent-record doctor
  agent-record start --url <目标网页> [--app "Google Chrome"] [--title "窗口标题"] [--output <会话目录>]
  agent-record status
  agent-record stop
`);
}

const { command, options } = parseArguments(process.argv.slice(2));
try {
  if (command === 'doctor') await doctor();
  else if (command === 'start') await start(options);
  else if (command === 'status') output(await currentStatus());
  else if (command === 'stop') await stop();
  else help();
} catch (error) {
  output({ ok: false, error: error?.message || String(error), errorCode: error?.code });
  process.exitCode = 1;
}
