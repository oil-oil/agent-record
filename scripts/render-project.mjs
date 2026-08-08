#!/usr/bin/env node

import {
  access,
  copyFile,
  link,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { availableParallelism, tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import path from 'node:path';
import { timelineDurationMs } from '../shared/timeline-duration.mjs';

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith('--') || !value) throw new Error(`参数不完整：${key || ''}`);
    options[key.slice(2)] = value;
  }
  return options;
}

async function resolveProjectPath(root, value) {
  if (!value) throw new Error('项目缺少视频或时间轴路径');
  if (/^https?:\/\//.test(value)) throw new Error('离线渲染请先把远程文件下载到项目内');
  const candidates = path.isAbsolute(value)
    ? [value, path.join(root, value.slice(1))]
    : [path.resolve(root, value)];
  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // 继续尝试项目根目录形式的绝对 URL 路径。
    }
  }
  throw new Error(`找不到项目资源：${value}`);
}

function resolutionOf(value) {
  if (value === '4k') return { width: 3840, height: 2160 };
  if (value === '2k') return { width: 2560, height: 1440 };
  if (value === '1080p') return { width: 1920, height: 1080 };
  if (value === '720p') return { width: 1280, height: 720 };
  throw new Error(`不支持的导出清晰度：${String(value)}`);
}

async function run(command, args, cwd) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`渲染失败，退出码 ${code}`)));
  });
}

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function processExists(pid) {
  if (!Number.isInteger(pid) || pid < 1) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === 'EPERM';
  }
}

async function acquireRenderLock(root, timeoutMs = 30 * 60 * 1000) {
  const rootHash = createHash('sha256').update(root).digest('hex').slice(0, 12);
  const lockFile = path.join(tmpdir(), `agent-record-render-${rootHash}.lock`);
  const startedAt = Date.now();
  let announced = false;
  for (;;) {
    try {
      const handle = await open(lockFile, 'wx');
      await handle.writeFile(JSON.stringify({
        pid: process.pid,
        root,
        startedAt: new Date().toISOString(),
      }));
      return async () => {
        await handle.close().catch(() => {});
        await rm(lockFile, { force: true });
      };
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      let stale = false;
      try {
        const lock = JSON.parse(await readFile(lockFile, 'utf8'));
        stale = !processExists(Number(lock.pid));
      } catch {
        const info = await stat(lockFile).catch(() => null);
        stale = Boolean(info && Date.now() - info.mtimeMs > 30_000);
      }
      if (stale) {
        await rm(lockFile, { force: true });
        continue;
      }
      if (Date.now() - startedAt > timeoutMs) {
        throw new Error('等待其他烧录任务超时，请稍后重试');
      }
      if (!announced) {
        console.log('已有烧录任务运行，当前任务排队等待…');
        announced = true;
      }
      await sleep(500);
    }
  }
}

function resolveConcurrency(requested) {
  const available = Math.max(1, availableParallelism());
  if (requested !== undefined) {
    const parsed = Number(requested);
    if (!Number.isInteger(parsed) || parsed < 1) {
      throw new Error('concurrency 必须是大于 0 的整数');
    }
    return Math.min(available, parsed);
  }
  return Math.max(1, Math.min(4, Math.ceil(available / 2)));
}

function bitrateFor(width, height, fps, preview) {
  if (preview) return '6M';
  const pixelsPerSecond = width * height * fps;
  if (pixelsPerSecond >= 3840 * 2160 * 50) return '48M';
  if (pixelsPerSecond >= 2560 * 1440 * 50) return '20M';
  if (pixelsPerSecond >= 1920 * 1080 * 50) return '12M';
  return '8M';
}

async function prepareCachedVideo(videoFile, inputDir) {
  const source = await stat(videoFile);
  const identity = `${path.resolve(videoFile)}\0${source.size}\0${source.mtimeMs}`;
  const inputHash = createHash('sha256').update(identity).digest('hex').slice(0, 16);
  const cachedName = `${inputHash}${path.extname(videoFile).toLowerCase()}`;
  const cachedVideoFile = path.join(inputDir, cachedName);
  try {
    await access(cachedVideoFile);
  } catch {
    try {
      await link(videoFile, cachedVideoFile);
    } catch {
      await copyFile(videoFile, cachedVideoFile);
    }
  }
  const cachedFiles = await readdir(inputDir, { withFileTypes: true });
  const ranked = await Promise.all(cachedFiles
    .filter((entry) => entry.isFile() && entry.name !== cachedName)
    .map(async (entry) => ({
      file: path.join(inputDir, entry.name),
      mtimeMs: await stat(path.join(inputDir, entry.name)).then((info) => info.mtimeMs),
    })));
  ranked.sort((left, right) => right.mtimeMs - left.mtimeMs);
  await Promise.all(ranked.slice(1).map(({ file }) => rm(file, { force: true })));
  return { cachedName, cachedVideoFile };
}

const options = parseArgs(process.argv.slice(2));
const root = path.resolve(options.root || '.');
const preview = options.quality === 'preview';
const projectFile = path.resolve(root, options.project || 'artifacts/demo-project.json');
const project = JSON.parse(await readFile(projectFile, 'utf8'));
if (project.schemaVersion !== 1 || !project.style) {
  throw new Error('项目配置格式不受支持');
}
const videoFile = await resolveProjectPath(root, project.video);
const timelineFile = await resolveProjectPath(root, project.timeline);
const timeline = JSON.parse(await readFile(timelineFile, 'utf8'));
if (!Array.isArray(timeline.events)) throw new Error('时间轴缺少 events 数组');
const durationMs = timelineDurationMs(timeline);
if (!durationMs) {
  throw new Error('时间轴缺少有效时长');
}
const fps = Number(options.fps) || 60;
if (!Number.isFinite(fps) || fps < 1 || fps > 120) {
  throw new Error('fps 必须在 1–120 之间');
}
const durationInFrames = Math.max(1, Math.ceil(durationMs / 1000 * fps));
const { width, height } = resolutionOf(project.style.exportResolution);

const inputDir = path.join(root, 'studio/public/agent-record-input');
await mkdir(inputDir, { recursive: true });
const releaseRenderLock = await acquireRenderLock(root);
const lockAcquiredAt = performance.now();
let tempDir;
try {
  const { cachedName } = await prepareCachedVideo(videoFile, inputDir);
  tempDir = await mkdtemp(path.join(tmpdir(), 'agent-record-render-'));
  const propsFile = path.join(tempDir, 'props.json');
  await writeFile(propsFile, JSON.stringify({
    src: `agent-record-input/${cachedName}`,
    style: project.style,
    events: timeline.events,
    sourceSegments: Array.isArray(timeline.sourceSegments) ? timeline.sourceSegments : [],
    captions: project.captions ?? [],
    durationInFrames,
    fps,
    width,
    height,
  }));

  const output = path.resolve(root, options.out || 'artifacts/agent-record-final.mp4');
  await mkdir(path.dirname(output), { recursive: true });
  const concurrency = resolveConcurrency(options.concurrency);
  const encoder = options.encoder || 'auto';
  if (!['auto', 'software', 'hardware'].includes(encoder)) {
    throw new Error('encoder 只支持 auto、software 或 hardware');
  }
  const useHardware = encoder === 'hardware' || (encoder === 'auto' && preview);
  const args = [
    '--no-install', 'remotion', 'render', 'studio/src/remotion-entry.tsx', 'EasyDemo4K', output,
    '--public-dir=studio/public', `--props=${propsFile}`, '--codec=h264',
    '--pixel-format=yuv420p', `--concurrency=${concurrency}`,
  ];
  if (useHardware) {
    args.push(
      '--hardware-acceleration=if-possible',
      `--video-bitrate=${bitrateFor(width, height, fps, preview)}`,
    );
  } else {
    args.push(
      `--crf=${preview ? 18 : 16}`,
      `--x264-preset=${preview ? 'veryfast' : 'faster'}`,
    );
  }
  if (preview) {
    const previewEndFrame = Math.min(durationInFrames - 1, 359);
    args.push('--scale=0.5', `--frames=0-${previewEndFrame}`);
    console.log(
      `快速预览：仅渲染前 ${((previewEndFrame + 1) / fps).toFixed(1)} 秒；源视频与最终导出不会截断`,
    );
  }
  const renderStartedAt = performance.now();
  console.log(
    `烧录配置：${width}×${height} · ${fps}fps · 并发 ${concurrency} · ${useHardware ? '硬件编码' : '软件编码'}`,
  );
  await run('npx', args, root);
  console.log(`烧录耗时：${((performance.now() - renderStartedAt) / 1000).toFixed(1)} 秒`);
  console.log(output);
} finally {
  if (tempDir) await rm(tempDir, { recursive: true, force: true });
  await releaseRenderLock();
  const total = ((performance.now() - lockAcquiredAt) / 1000).toFixed(1);
  console.log(`任务总耗时：${total} 秒`);
}
