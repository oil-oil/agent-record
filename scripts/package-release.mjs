#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { chmod, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const releaseDir = path.join(root, 'release');
const packageJson = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const manifest = JSON.parse(await readFile(path.join(root, 'extension/manifest.json'), 'utf8'));
const skillManifest = JSON.parse(await readFile(path.join(root, 'skills/agent-record/version.json'), 'utf8'));
const EXTENSION_FILES = new Set([
  'background.js',
  'content.js',
  'icons/icon16.png',
  'icons/icon32.png',
  'icons/icon48.png',
  'icons/icon128.png',
  'manifest.json',
  'popup.css',
  'popup.html',
  'popup.js',
]);
if (packageJson.version !== manifest.version) {
  throw new Error(`版本不一致：package=${packageJson.version}，extension=${manifest.version}`);
}
if (skillManifest.version !== packageJson.version) {
  throw new Error(`版本不一致：package=${packageJson.version}，skill=${skillManifest.version}`);
}
if (skillManifest.releaseTag !== `v${packageJson.version}`) {
  throw new Error(`Skill releaseTag 不一致：期望 v${packageJson.version}，实际 ${skillManifest.releaseTag}`);
}
if (skillManifest.desktopAsset !== `agent-record-desktop-${packageJson.version}.zip`) {
  throw new Error(`Skill desktopAsset 不一致：期望 agent-record-desktop-${packageJson.version}.zip，实际 ${skillManifest.desktopAsset}`);
}

const crcTable = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = (value & 1) ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  return value >>> 0;
});

function crc32(buffer) {
  let value = 0xffffffff;
  for (const byte of buffer) value = crcTable[(value ^ byte) & 0xff] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

async function collectFiles(directory, { exclude = () => false, include = () => true, allowedFiles } = {}) {
  const output = [];
  async function walk(current, prefix = '') {
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      if (entry.name === '.DS_Store') continue;
      const absolute = path.join(current, entry.name);
      const relative = path.posix.join(prefix, entry.name);
      if (exclude(relative)) continue;
      if (entry.isDirectory()) await walk(absolute, relative);
      else if (entry.isFile() && include(relative)) output.push({ absolute, relative });
    }
  }
  await walk(directory);
  if (allowedFiles) {
    const actual = new Set(output.map(({ relative }) => relative));
    const unexpected = [...actual].filter((file) => !allowedFiles.has(file));
    const missing = [...allowedFiles].filter((file) => !actual.has(file));
    if (unexpected.length || missing.length) {
      throw new Error(
        `发布文件白名单不匹配：多余 ${unexpected.join(', ') || '无'}；缺少 ${missing.join(', ') || '无'}`,
      );
    }
  }
  return output;
}

async function createStoredZip(target, files) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const file of files) {
    const name = Buffer.from(file.relative);
    const data = await readFile(file.absolute);
    const fileInfo = await stat(file.absolute);
    const archiveMode = fileInfo.mode & 0o111 ? 0o100755 : 0o100644;
    const checksum = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0x21, 12);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, name, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(0x0314, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0x21, 14);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE((archiveMode << 16) >>> 0, 38);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += local.length + name.length + data.length;
  }

  const centralSize = centrals.reduce((total, item) => total + item.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  await writeFile(target, Buffer.concat([...locals, ...centrals, end]));
}

async function packageArtifact(name, source, options) {
  const { extraFiles = [], ...collectOptions } = options ?? {};
  const files = await collectFiles(source, collectOptions);
  for (const extra of extraFiles) {
    files.push({
      absolute: path.join(root, extra.source),
      relative: extra.target ?? extra.source,
    });
  }
  if (!files.length) throw new Error(`${name} 没有可打包文件`);
  const target = path.join(releaseDir, name);
  await createStoredZip(target, files);
  const data = await readFile(target);
  return {
    file: name,
    files: files.length,
    bytes: data.length,
    sha256: createHash('sha256').update(data).digest('hex'),
  };
}

async function stageDesktopSource() {
  const stage = path.join(releaseDir, '.desktop-stage');
  await rm(stage, { recursive: true, force: true });
  await mkdir(stage, { recursive: true });

  async function copyFile(sourceRelative, targetRelative = sourceRelative) {
    const source = path.join(root, sourceRelative);
    const target = path.join(stage, targetRelative);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, await readFile(source));
    const sourceInfo = await stat(source);
    if (sourceInfo.mode & 0o111) await chmod(target, 0o755);
  }

  async function copyDirectory(sourceRelative, targetRelative = sourceRelative, options = {}) {
    const source = path.join(root, sourceRelative);
    const files = await collectFiles(source, options);
    for (const file of files) {
      await copyFile(path.posix.join(sourceRelative, file.relative), path.posix.join(targetRelative, file.relative));
    }
  }

  // 桌面包使用发布专用元数据，不能把仓库根目录的 package.json/README 原样复制进去。
  await copyFile('distribution/desktop/package.json', 'package.json');
  await copyFile('distribution/desktop/README.md', 'README.md');
  // package-lock 保持与依赖清单一致，使解压后可以直接 npm ci。
  await copyFile('package-lock.json');
  await copyFile('LICENSE');
  await copyFile('TRADEMARKS.md');
  await copyFile('THIRD_PARTY_NOTICES.md');
  await copyFile('studio/index.html');
  await copyFile('studio/README.md');
  await copyFile('studio/tsconfig.json');
  await copyFile('studio/vite.config.ts');
  await copyDirectory('extension');
  await copyFile('native/macos/.build/release/agent-record-capture', 'bin/agent-record-capture');
  await copyDirectory('native/macos', 'native/macos', {
    exclude: (file) => file === '.build' || file.startsWith('.build/'),
  });
  await copyDirectory('skills/agent-record');
  await copyDirectory('scripts', 'scripts', {
    exclude: (file) => file.startsWith('node_modules/') || file.endsWith('.tsbuildinfo'),
  });
  await copyDirectory('shared');
  await copyDirectory('studio/src');
  await copyDirectory('studio/public', 'studio/public', {
    exclude: (file) => /\.(mp4|webm|mov)$/i.test(file) || file.startsWith('agent-record-input/'),
  });
  return stage;
}

await rm(releaseDir, { recursive: true, force: true });
await mkdir(releaseDir, { recursive: true });

const version = packageJson.version;
const artifacts = [];
const sourceExclude = (file) => file.startsWith('node_modules/') || file.startsWith('artifacts/') || file.startsWith('release/') || file.startsWith('.git/') || file.startsWith('.env') || /(?:\.pem|\.key|secret)/i.test(file);
const desktopInclude = (file) => file !== '.env.example'
  && !file.endsWith('.tsbuildinfo')
  && (file === 'package.json' || file === 'package-lock.json' || file === 'README.md' || file === 'LICENSE' || file === 'TRADEMARKS.md'
    || file.startsWith('extension/') || file.startsWith('skills/agent-record/') || file.startsWith('scripts/')
    || file.startsWith('bin/') || file.startsWith('native/macos/') || file.startsWith('shared/') || file.startsWith('studio/src/') || file.startsWith('studio/public/')
    || ['studio/index.html', 'studio/README.md', 'studio/tsconfig.json', 'studio/vite.config.ts', 'THIRD_PARTY_NOTICES.md'].includes(file));
artifacts.push(await packageArtifact(
  `agent-record-extension-${version}.zip`,
  path.join(root, 'extension'),
  { allowedFiles: EXTENSION_FILES, extraFiles: [{ source: 'LICENSE' }, { source: 'TRADEMARKS.md' }] },
));
artifacts.push(await packageArtifact(
  `agent-record-studio-${version}.zip`,
  path.join(root, 'studio/dist'),
  {
    exclude: (file) => (
      file.endsWith('.mp4')
      || file.startsWith('agent-record-input/')
    ),
    extraFiles: [{ source: 'LICENSE' }, { source: 'TRADEMARKS.md' }],
  },
));
artifacts.push(await packageArtifact(
  `agent-record-${version}.skill`,
  path.join(root, 'skills/agent-record'),
  { extraFiles: [{ source: 'LICENSE' }, { source: 'TRADEMARKS.md' }] },
));
artifacts.push(await packageArtifact(
  `agent-record-website-${version}.zip`,
  path.join(root, 'website'),
  {
    exclude: (file) => file.startsWith('node_modules/') || file.startsWith('.next/')
      || file.startsWith('artifacts/') || file.startsWith('release/')
      || file.endsWith('.tsbuildinfo')
      || (file.startsWith('.env') && file !== '.env.example'),
    extraFiles: [{ source: 'LICENSE' }, { source: 'TRADEMARKS.md' }],
  },
));
// 可安装的本地桌面源包：包含扩展、Skill、CLI、Studio 源码及其脚本依赖，排除产物和密钥。
const desktopStage = await stageDesktopSource();
artifacts.push(await packageArtifact(
  `agent-record-desktop-${version}.zip`,
  desktopStage,
  { exclude: sourceExclude, include: desktopInclude },
));
await rm(desktopStage, { recursive: true, force: true });

for (const artifact of artifacts) {
  const info = await stat(path.join(releaseDir, artifact.file));
  if (info.size > 100 * 1024 * 1024) {
    throw new Error(`发布包超过 100MB：${artifact.file}`);
  }
}

await writeFile(
  path.join(releaseDir, 'release-manifest.json'),
  `${JSON.stringify({ name: packageJson.name, version, artifacts }, null, 2)}\n`,
);
await writeFile(
  path.join(releaseDir, 'SHA256SUMS'),
  `${artifacts.map(({ sha256, file }) => `${sha256}  ${file}`).join('\n')}\n`,
);

console.log(`发布包已生成：${releaseDir}`);
for (const artifact of artifacts) {
  console.log(`${artifact.file} · ${artifact.files} 文件 · ${artifact.bytes} bytes`);
}
