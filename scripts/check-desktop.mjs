#!/usr/bin/env node

import { access } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

const required = [
  'LICENSE',
  'TRADEMARKS.md',
  'extension/manifest.json',
  'skills/glidetake/SKILL.md',
  'skills/glidetake/version.json',
  'skills/glidetake/scripts/bootstrap.mjs',
  'skills/glidetake/scripts/agent-record-proxy.mjs',
  'scripts/agent-record.mjs',
  'scripts/agent-record-daemon.mjs',
  'scripts/setup-extension.mjs',
  'scripts/lib/agent-record-runtime.mjs',
  'bin/agent-record-capture',
  'native/macos/Package.swift',
  'native/macos/Sources/AgentRecordCapture/main.swift',
  'scripts/studio-cli.mjs',
  'scripts/render-project.mjs',
  'studio/index.html',
  'studio/src/App.tsx',
];

for (const file of required) {
  await access(file);
}

for (const command of ['ffmpeg', 'ffprobe']) {
  const result = spawnSync(command, ['-version'], { stdio: 'ignore' });
  if (result.error || result.status !== 0) {
    throw new Error(`缺少 ${command}，请先安装 FFmpeg`);
  }
}

console.log('桌面包检查通过：扩展、Skill、Studio、CLI 与 FFmpeg 均可用。');
