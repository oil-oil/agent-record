#!/usr/bin/env node

import { access, cp, mkdir, mkdtemp, readFile, rename, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceDirectory = path.join(root, 'extension');
const sourceManifestPath = path.join(sourceDirectory, 'manifest.json');
const supportRoot = process.env.AGENT_RECORD_APP_SUPPORT
  ? path.resolve(process.env.AGENT_RECORD_APP_SUPPORT)
  : process.platform === 'darwin'
    ? path.join(homedir(), 'Library', 'Application Support', 'Agent Record')
    : path.join(process.env.XDG_DATA_HOME || path.join(homedir(), '.local', 'share'), 'agent-record');
const extensionDirectory = path.join(supportRoot, 'extension');
const manifestPath = path.join(extensionDirectory, 'manifest.json');
const noOpen = process.argv.includes('--no-open');

await access(sourceManifestPath);
const manifest = JSON.parse(await readFile(sourceManifestPath, 'utf8'));

function run(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8' });
  return result.status === 0;
}

async function installExtension() {
  await mkdir(supportRoot, { recursive: true });
  const staging = await mkdtemp(path.join(supportRoot, '.extension-'));
  const backup = path.join(supportRoot, '.extension-backup');
  try {
    await cp(sourceDirectory, staging, { recursive: true, force: true });
    await rm(backup, { recursive: true, force: true });
    await rename(extensionDirectory, backup).catch((error) => {
      if (error?.code !== 'ENOENT') throw error;
    });
    await rename(staging, extensionDirectory);
    await rm(backup, { recursive: true, force: true });
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    const hasBackup = await access(backup).then(() => true).catch(() => false);
    const hasCurrent = await access(extensionDirectory).then(() => true).catch(() => false);
    if (hasBackup && !hasCurrent) await rename(backup, extensionDirectory);
    throw error;
  }
}

await installExtension();

if (process.platform === 'darwin' && !noOpen) {
  const copied = spawnSync('pbcopy', [], { input: extensionDirectory, encoding: 'utf8' });
  const chromeOpened = run('open', ['-a', 'Google Chrome', 'chrome://extensions/']);
  run('open', ['-R', manifestPath]);

  process.stdout.write([
    `${manifest.name} 扩展已准备好。`,
    `目录：${extensionDirectory}`,
    copied.status === 0 ? '目录已复制到剪贴板。' : '',
    chromeOpened ? 'Chrome 扩展管理页已打开。' : '请手动打开 chrome://extensions/。',
    '开启开发者模式，点击“加载已解压的扩展程序”，选择上面的目录。',
  ].filter(Boolean).join('\n') + '\n');
} else {
  process.stdout.write([
    `${manifest.name} 扩展目录：${extensionDirectory}`,
    noOpen ? '扩展文件已同步到固定目录。' : '打开 chrome://extensions/，开启开发者模式，点击“加载已解压的扩展程序”，选择该目录。',
  ].join('\n') + '\n');
}
