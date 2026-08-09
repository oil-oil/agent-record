#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { access, chmod, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(await readFile(path.join(skillRoot, 'version.json'), 'utf8'));
const REQUIRED_FILES = [
  'bin/agent-record',
  'resources/release.json',
  'resources/runtime/package.json',
  'resources/runtime/package-lock.json',
];

function supportRoot() {
  if (process.env.AGENT_RECORD_APP_SUPPORT) return path.resolve(process.env.AGENT_RECORD_APP_SUPPORT);
  if (process.platform === 'darwin') return path.join(homedir(), 'Library', 'Application Support', 'Agent Record');
  return path.join(process.env.XDG_DATA_HOME || path.join(homedir(), '.local', 'share'), 'agent-record');
}

async function isExecutable(file) {
  try {
    await access(file, 1);
    return true;
  } catch {
    return false;
  }
}

async function companionAt(root) {
  if (!root) return null;
  const resolved = path.resolve(root);
  try {
    await Promise.all(REQUIRED_FILES.map((file) => access(path.join(resolved, file))));
    const binary = path.join(resolved, 'bin', 'agent-record');
    return await isExecutable(binary) ? { root: resolved, binary } : null;
  } catch {
    return null;
  }
}

async function locateInstalledCompanion() {
  const configuredBinary = process.env.AGENT_RECORD_BIN;
  if (configuredBinary && await isExecutable(path.resolve(configuredBinary))) {
    return { root: path.dirname(path.dirname(path.resolve(configuredBinary))), binary: path.resolve(configuredBinary), source: 'AGENT_RECORD_BIN' };
  }
  const applicationBinary = '/Applications/Agent Record.app/Contents/MacOS/agent-record';
  if (await isExecutable(applicationBinary)) {
    return { root: '/Applications/Agent Record.app/Contents/Resources', binary: applicationBinary, source: 'application' };
  }
  const cached = await companionAt(path.join(supportRoot(), 'versions', manifest.version));
  return cached ? { ...cached, source: 'cache' } : null;
}

function releaseBaseUrl() {
  const explicit = process.env.AGENT_RECORD_RELEASE_BASE_URL;
  return (explicit || `https://github.com/${manifest.repo}/releases/download/${manifest.releaseTag}`).replace(/\/$/, '');
}

async function fetchBytes(url) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(url, { redirect: 'follow' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return Buffer.from(await response.arrayBuffer());
    } catch (error) {
      lastError = error;
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, attempt * 750));
    }
  }
  throw new Error(`下载失败：${url}（${lastError?.cause?.message || lastError?.message || '网络错误'}）`);
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
  if (result.error || result.status !== 0) throw new Error(`无法读取桌面伴侣：${result.error?.message || result.stderr}`);
  const names = result.stdout.split(/\r?\n/).filter(Boolean);
  for (const name of names) {
    const normalized = path.posix.normalize(name.replaceAll('\\', '/'));
    if (normalized.startsWith('/') || normalized === '..' || normalized.startsWith('../')) {
      throw new Error(`桌面伴侣包含不安全路径：${name}`);
    }
    if (!['bin/', 'resources/'].some((prefix) => normalized.startsWith(prefix))) {
      throw new Error(`桌面伴侣包含未声明目录：${name}`);
    }
  }
}

async function installCompanion() {
  if (process.platform !== 'darwin') throw new Error('Agent Record 桌面伴侣首版只支持 macOS');
  const versionRoot = path.join(supportRoot(), 'versions', manifest.version);
  const existing = await companionAt(versionRoot);
  if (existing) return { ...existing, source: 'cache', installed: false, version: manifest.version };

  const staging = await mkdtemp(path.join(tmpdir(), `agent-record-${manifest.version}-`));
  const zipPath = path.join(staging, manifest.companionAsset);
  try {
    const [archive, sums] = await Promise.all([
      fetchBytes(`${releaseBaseUrl()}/${manifest.companionAsset}`),
      fetchBytes(`${releaseBaseUrl()}/SHA256SUMS`).then((value) => value.toString('utf8')),
    ]);
    const expected = expectedSha256(sums, manifest.companionAsset);
    const actual = createHash('sha256').update(archive).digest('hex');
    if (actual !== expected) throw new Error(`桌面伴侣 SHA256 校验失败：期望 ${expected}，实际 ${actual}`);
    await writeFile(zipPath, archive, { mode: 0o600 });
    verifyZipNames(zipPath);
    const extracted = path.join(staging, 'extracted');
    const unzip = spawnSync('unzip', ['-q', zipPath, '-d', extracted], { encoding: 'utf8' });
    if (unzip.error || unzip.status !== 0) throw new Error(`解压桌面伴侣失败：${unzip.error?.message || unzip.stderr}`);
    await chmod(path.join(extracted, 'bin', 'agent-record'), 0o755);
    if (!(await companionAt(extracted))) throw new Error('桌面伴侣缺少签名的 agent-record 入口');
    await rm(versionRoot, { recursive: true, force: true });
    await mkdir(path.dirname(versionRoot), { recursive: true });
    await rename(extracted, versionRoot);
    return { ...(await companionAt(versionRoot)), source: 'downloaded', installed: true, version: manifest.version };
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

async function ensureRuntime(companion) {
  const developmentRemotion = path.join(companion.root, 'node_modules', '.bin', 'remotion');
  if (await isExecutable(developmentRemotion)) return;
  const runtimeRoot = path.join(companion.root, 'resources', 'runtime');
  const remotion = path.join(runtimeRoot, 'node_modules', '.bin', 'remotion');
  if (await isExecutable(remotion)) return;
  const result = spawnSync('npm', ['ci', '--omit=dev', '--no-audit', '--no-fund'], {
    cwd: runtimeRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  if (result.error || result.status !== 0) {
    throw new Error(`安装桌面伴侣运行时失败：${result.error?.message || `npm 退出码 ${result.status}`}`);
  }
}

export async function ensureCompanion() {
  const companion = await locateInstalledCompanion() || await installCompanion();
  await ensureRuntime(companion);
  return { ...companion, version: manifest.version };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await ensureCompanion();
    process.stdout.write(`${JSON.stringify({ ok: true, version: manifest.version, ...result }, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ ok: false, error: error?.message || String(error) }, null, 2)}\n`);
    process.exitCode = 1;
  }
}
