#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { access, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(await readFile(path.join(skillRoot, 'version.json'), 'utf8'));
const COMPLETE_FILES = [
  'package.json',
  'extension/manifest.json',
  'scripts/agent-record.mjs',
  'scripts/studio-cli.mjs',
  'scripts/render-project.mjs',
  'studio',
];

function homeSupportRoot() {
  if (process.env.AGENT_RECORD_APP_SUPPORT) return path.resolve(process.env.AGENT_RECORD_APP_SUPPORT);
  if (process.env.AGENT_RECORD_HOME) return path.resolve(process.env.AGENT_RECORD_HOME);
  if (process.platform === 'darwin') return path.join(homedir(), 'Library', 'Application Support', 'Agent Record');
  return path.join(process.env.XDG_DATA_HOME || path.join(homedir(), '.local', 'share'), 'agent-record');
}

async function isCompleteRoot(candidate) {
  if (!candidate) return false;
  const root = path.resolve(candidate);
  try {
    await Promise.all(COMPLETE_FILES.map((file) => access(path.join(root, file))));
    return true;
  } catch {
    return false;
  }
}

async function findSourceRoot() {
  const configured = process.env.AGENT_RECORD_ROOT;
  if (configured && await isCompleteRoot(configured)) return { root: path.resolve(configured), source: 'AGENT_RECORD_ROOT' };

  let current = path.resolve(process.cwd());
  while (true) {
    if (await isCompleteRoot(current)) return { root: current, source: 'current-or-ancestor' };
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return null;
}

async function runNativeBuild(root) {
  const binaries = [
    path.join(root, 'bin', 'agent-record-capture'),
    path.join(root, 'native', 'macos', '.build', 'release', 'agent-record-capture'),
  ];
  const available = await Promise.all(binaries.map((binary) => access(binary).then(() => true).catch(() => false)));
  if (available.some(Boolean)) return false;
  const packageFile = path.join(root, 'native', 'macos', 'Package.swift');
  if (!(await access(packageFile).then(() => true).catch(() => false))) return false;
  const npm = process.env.npm_execpath ? process.execPath : 'npm';
  const args = process.env.npm_execpath ? [process.env.npm_execpath, 'run', 'native:build'] : ['run', 'native:build'];
  const result = spawnSync(npm, args, { cwd: root, stdio: 'inherit' });
  if (result.error || result.status !== 0) {
    throw new Error(`native:build 失败（${result.error?.message || `退出码 ${result.status}`}）`);
  }
  return true;
}

function releaseBaseUrl() {
  const explicit = process.env.AGENT_RECORD_RELEASE_BASE_URL || process.env.RELEASE_BASE_URL;
  return (explicit || `https://github.com/${manifest.repo}/releases/download/${manifest.releaseTag}`).replace(/\/$/, '');
}

function screenRecordingStatus(root) {
  const binary = [
    path.join(root, 'bin', 'agent-record-capture'),
    path.join(root, 'native', 'macos', '.build', 'release', 'agent-record-capture'),
  ].find((candidate) => spawnSync('test', ['-x', candidate]).status === 0);
  if (!binary) {
    return {
      status: 'unavailable',
      granted: false,
      message: '未找到 macOS 捕获程序',
    };
  }
  const result = spawnSync(binary, ['permission'], { encoding: 'utf8' });
  try {
    const granted = result.status === 0 && JSON.parse(result.stdout).granted === true;
    return {
      status: granted ? 'ready' : 'user-confirmation-required',
      granted,
      message: granted ? '屏幕录制权限已就绪' : '仅首次缺少权限时，请在 macOS 系统设置中允许屏幕录制',
    };
  } catch {
    return {
      status: 'unknown',
      granted: false,
      message: '无法读取屏幕录制权限，请运行 doctor 复核',
    };
  }
}

function environmentStatus(root) {
  return {
    extension: {
      path: path.join(root, 'extension'),
      status: 'verify-in-browser',
      setupCommand: 'node <当前 Skill 目录>/scripts/agent-record-proxy.mjs extension',
      message: '在普通网页检查 ready；连续两次缺失时运行 extension 命令，再请用户在已经运行的 Chrome 或 Ego Lite 中完成首次确认',
    },
    screenRecording: screenRecordingStatus(root),
  };
}

async function fetchBytes(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`下载失败：${url}（HTTP ${response.status}）`);
  return Buffer.from(await response.arrayBuffer());
}

function expectedSha256(sums, file) {
  for (const line of sums.split(/\r?\n/)) {
    const match = line.trim().match(/^([a-f0-9]{64})\s+\*?(.+)$/i);
    if (match && path.basename(match[2].trim()) === file) return match[1].toLowerCase();
  }
  throw new Error(`SHA256SUMS 中没有 ${file}`);
}

function verifyZipNames(zipPath) {
  const result = spawnSync('unzip', ['-Z1', zipPath], { encoding: 'utf8' });
  if (result.error || result.status !== 0) throw new Error(`无法读取桌面包：${result.error?.message || result.stderr}`);
  for (const name of result.stdout.split(/\r?\n/).filter(Boolean)) {
    const normalized = path.posix.normalize(name.replaceAll('\\', '/'));
    if (normalized.startsWith('/') || normalized === '..' || normalized.startsWith('../')) {
      throw new Error(`桌面包包含不安全路径：${name}`);
    }
  }
}

async function installDesktop() {
  const versionRoot = path.join(homeSupportRoot(), 'versions', manifest.version);
  if (await isCompleteRoot(versionRoot)) return { root: versionRoot, installed: false };

  const staging = await mkdtemp(path.join(tmpdir(), `agent-record-${manifest.version}-`));
  const zipName = manifest.desktopAsset;
  const zipPath = path.join(staging, zipName);
  try {
    const [zip, sums] = await Promise.all([
      fetchBytes(`${releaseBaseUrl()}/${zipName}`),
      fetchBytes(`${releaseBaseUrl()}/SHA256SUMS`).then((value) => value.toString('utf8')),
    ]);
    const expected = expectedSha256(sums, zipName);
    const actual = createHash('sha256').update(zip).digest('hex');
    if (actual !== expected) throw new Error(`桌面包 SHA256 校验失败：期望 ${expected}，实际 ${actual}`);
    await writeFile(zipPath, zip, { mode: 0o600 });
    verifyZipNames(zipPath);
    const extracted = path.join(staging, 'extracted');
    const unzip = spawnSync('unzip', ['-q', zipPath, '-d', extracted], { encoding: 'utf8' });
    if (unzip.error || unzip.status !== 0) throw new Error(`解压桌面包失败：${unzip.error?.message || unzip.stderr}`);
    if (!(await isCompleteRoot(extracted))) throw new Error('桌面包缺少完整的 Agent Record 根目录');

    await rm(versionRoot, { recursive: true, force: true });
    await mkdir(path.dirname(versionRoot), { recursive: true });
    await rename(extracted, versionRoot);
    const npm = process.env.npm_execpath ? process.execPath : 'npm';
    const args = process.env.npm_execpath ? [process.env.npm_execpath, 'ci'] : ['ci'];
    const install = spawnSync(npm, args, { cwd: versionRoot, stdio: 'inherit' });
    if (install.error || install.status !== 0) {
      await rm(versionRoot, { recursive: true, force: true });
      throw new Error(`桌面包 npm ci 失败（${install.error?.message || `退出码 ${install.status}`}）`);
    }
    await writeFile(path.join(versionRoot, '.agent-record-bootstrap.json'), `${JSON.stringify({ ...manifest, installedAt: new Date().toISOString() }, null, 2)}\n`);
    return { root: versionRoot, installed: true };
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

export async function ensureRoot() {
  const source = await findSourceRoot();
  if (source) {
    const built = await runNativeBuild(source.root);
    return { ...source, version: manifest.version, installed: false, nativeBuilt: built, ...environmentStatus(source.root) };
  }
  const installed = await installDesktop();
  return { ...installed, source: 'downloaded', version: manifest.version, nativeBuilt: false, ...environmentStatus(installed.root) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await ensureRoot();
    process.stdout.write(`${JSON.stringify({ ok: true, ...result }, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ ok: false, error: error?.message || String(error) }, null, 2)}\n`);
    process.exitCode = 1;
  }
}
