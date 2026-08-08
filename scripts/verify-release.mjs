#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const releaseDirectory = path.join(root, 'release');
const packageJson = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const releaseManifest = JSON.parse(await readFile(path.join(releaseDirectory, 'release-manifest.json'), 'utf8'));
const sums = await readFile(path.join(releaseDirectory, 'SHA256SUMS'), 'utf8');
const version = packageJson.version;
const expectedArchives = new Map([
  [`agent-record-extension-${version}.zip`, ['manifest.json', 'background.js', 'content.js']],
  [`agent-record-studio-${version}.zip`, ['index.html']],
  [`agent-record-${version}.skill`, ['SKILL.md', 'version.json', 'scripts/bootstrap.mjs']],
  [`agent-record-website-${version}.zip`, ['package.json', 'app/page.tsx']],
  [`agent-record-desktop-${version}.zip`, [
    'package.json',
    'extension/manifest.json',
    'scripts/setup-extension.mjs',
    'skills/agent-record/SKILL.md',
    'bin/agent-record-capture',
  ]],
]);

if (releaseManifest.name !== packageJson.name || releaseManifest.version !== version) {
  throw new Error('发布清单名称或版本与 package.json 不一致');
}

const manifestArtifacts = new Map(releaseManifest.artifacts.map((artifact) => [artifact.file, artifact]));
const sumEntries = new Map(
  sums.split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^([a-f0-9]{64})\s+\*?(.+)$/i);
      if (!match) throw new Error(`SHA256SUMS 格式无效：${line}`);
      return [path.basename(match[2]), match[1].toLowerCase()];
    }),
);

for (const [archive, requiredFiles] of expectedArchives) {
  const artifact = manifestArtifacts.get(archive);
  if (!artifact) throw new Error(`发布清单缺少 ${archive}`);
  const archivePath = path.join(releaseDirectory, archive);
  const data = await readFile(archivePath);
  const checksum = createHash('sha256').update(data).digest('hex');
  if (checksum !== artifact.sha256 || checksum !== sumEntries.get(archive)) {
    throw new Error(`${archive} 校验值不一致`);
  }
  if (data.length !== artifact.bytes) throw new Error(`${archive} 文件大小与发布清单不一致`);

  const listing = spawnSync('unzip', ['-Z1', archivePath], { encoding: 'utf8' });
  if (listing.error || listing.status !== 0) {
    throw new Error(`无法检查 ${archive}：${listing.error?.message || listing.stderr}`);
  }
  const files = listing.stdout.split(/\r?\n/).filter(Boolean);
  for (const file of files) {
    const normalized = path.posix.normalize(file.replaceAll('\\', '/'));
    if (normalized.startsWith('/') || normalized === '..' || normalized.startsWith('../')) {
      throw new Error(`${archive} 包含不安全路径：${file}`);
    }
    if (
      normalized.startsWith('node_modules/')
      || normalized.startsWith('artifacts/')
      || normalized.startsWith('release/')
      || normalized.endsWith('.tsbuildinfo')
      || /(?:^|\/)\.env(?:\.|$)|(?:\.pem|\.key|secret)/i.test(normalized)
    ) {
      throw new Error(`${archive} 包含不应发布的文件：${file}`);
    }
  }
  for (const required of requiredFiles) {
    if (!files.includes(required)) throw new Error(`${archive} 缺少 ${required}`);
  }
}

for (const archive of manifestArtifacts.keys()) {
  if (!expectedArchives.has(archive)) throw new Error(`存在未声明的发布包：${archive}`);
}
for (const archive of sumEntries.keys()) {
  if (!expectedArchives.has(archive)) throw new Error(`SHA256SUMS 存在未声明文件：${archive}`);
}

console.log(`发布包检查通过：${expectedArchives.size} 个归档的版本、内容与 SHA256 均正确。`);
