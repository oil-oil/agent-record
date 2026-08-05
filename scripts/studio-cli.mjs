#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_PROJECT = {
  schemaVersion: 1,
  name: '未命名演示',
  video: '',
  timeline: '',
  style: {
    backgroundPreset: 'glass-sunrise',
    backgroundColor: '#e7e7e2',
    shell: 'browser',
    browserUrl: 'example.com',
    padding: 40,
    radius: 18,
    shadow: 24,
    zoom: 1.2,
    cursor: 'studio',
    cursorSize: 30,
    exportResolution: '2k',
  },
  captions: [],
};

const PRESETS = new Set([
  'apple-cream-blue',
  'apple-coral-pink',
  'apple-coastal-blue',
  'apple-warm-silver',
  'apple-prismatic',
  'glass-sunrise',
  'cosmic-orbit',
  'desktop-coast',
  'abstract-ribbon',
  'solid',
]);
const SHELLS = new Set(['browser', 'card', 'none']);
const CURSORS = new Set(['studio', 'dot', 'ring', 'highlight']);
const RESOLUTIONS = new Set(['720p', '1080p', '2k', '4k']);
const CAPTION_POSITIONS = new Set(['top-left', 'top-center', 'top-right', 'bottom-left', 'bottom-center', 'bottom-right']);

function usage(exitCode = 0) {
  console.log(`Agent Record Studio CLI

用法：
  npm run studio:cli -- init --video <文件或 URL> [选项]
  npm run studio:cli -- set --file <项目.json> [选项]
  npm run studio:cli -- show --file <项目.json>
  npm run studio:cli -- validate --file <项目.json>
  npm run studio:cli -- caption-add --file <项目.json> --text <文案> --start <秒> [--duration 3.0] [--position bottom-center]
  npm run studio:cli -- caption-remove --file <项目.json> --id <说明 ID>
  npm run studio:cli -- caption-clear --file <项目.json>
  npm run studio:cli -- url --file <项目.json> [--origin http://127.0.0.1:4173]

常用选项：
  --out <文件>          init 的输出文件，默认 artifacts/demo-project.json
  --name <名称>         项目名称
  --video <路径或 URL>  录制文件
  --motion <路径或 URL> 操作轨迹
  --background <名称>   glass-sunrise | cosmic-orbit | desktop-coast | abstract-ribbon | solid
  --color <#RRGGBB>     自定义背景色
  --shell <样式>        browser | card | none
  --address <网址或文字> 浏览器地址栏显示内容
  --zoom <倍数>         1.00–2.20
  --cursor <样式>       studio | dot | ring | highlight
  --resolution <清晰度> 720p | 1080p | 2k | 4k
  --cursor-size <数字>  10–52
  --padding <数字>      24–150
  --radius <数字>       0–56
  --shadow <数字>       0–70

说明位置：
  top-left | top-center | top-right | bottom-left | bottom-center | bottom-right`);
  process.exit(exitCode);
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const options = {};
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (!token.startsWith('--')) throw new Error(`无法识别参数：${token}`);
    const key = token.slice(2);
    const value = rest[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`参数 --${key} 缺少值`);
    options[key] = value;
    index += 1;
  }
  return { command, options };
}

function numberOption(value, label, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max) {
    throw new Error(`${label} 必须在 ${min}–${max} 之间`);
  }
  return number;
}

function validate(project) {
  const errors = [];
  if (!project || typeof project !== 'object') return ['项目内容必须是 JSON 对象'];
  if (project.schemaVersion !== 1) errors.push('schemaVersion 必须为 1');
  if (typeof project.name !== 'string' || !project.name.trim()) errors.push('name 不能为空');
  if (typeof project.video !== 'string' || !project.video.trim()) errors.push('video 不能为空');
  if (typeof project.timeline !== 'string' || !project.timeline.trim()) errors.push('timeline 不能为空');
  if (!project.style || typeof project.style !== 'object') return [...errors, 'style 不能为空'];
  if (!PRESETS.has(project.style.backgroundPreset)) errors.push('backgroundPreset 不受支持');
  if (!/^#[0-9a-f]{6}$/i.test(project.style.backgroundColor)) errors.push('backgroundColor 必须是 #RRGGBB');
  if (!SHELLS.has(project.style.shell)) errors.push('shell 不受支持');
  if (project.style.browserUrl !== undefined && (typeof project.style.browserUrl !== 'string' || project.style.browserUrl.length > 200)) errors.push('browserUrl 必须是不超过 200 字符的字符串');
  if (!CURSORS.has(project.style.cursor)) errors.push('cursor 不受支持');
  if (!RESOLUTIONS.has(project.style.exportResolution)) errors.push('exportResolution 不受支持');
  if (project.captions !== undefined && !Array.isArray(project.captions)) errors.push('captions 必须是数组');
  if (Array.isArray(project.captions)) {
    const captionIds = new Set();
    project.captions.forEach((caption, index) => {
      const label = `captions[${index}]`;
      if (!caption || typeof caption !== 'object') {
        errors.push(`${label} 必须是对象`);
        return;
      }
      if (typeof caption.id !== 'string' || !caption.id.trim()) errors.push(`${label}.id 不能为空`);
      else if (captionIds.has(caption.id)) errors.push(`${label}.id 不能重复`);
      else captionIds.add(caption.id);
      if (typeof caption.text !== 'string' || !caption.text.trim() || caption.text.length > 120) errors.push(`${label}.text 必须是 1–120 字符`);
      if (!Number.isFinite(caption.start) || caption.start < 0) errors.push(`${label}.start 必须是非负数字`);
      if (!Number.isFinite(caption.end) || caption.end <= caption.start) errors.push(`${label}.end 必须大于 start`);
      if (!CAPTION_POSITIONS.has(caption.position)) errors.push(`${label}.position 不受支持`);
    });
  }
  [
    ['padding', 24, 150],
    ['radius', 0, 56],
    ['shadow', 0, 70],
    ['zoom', 1, 2.2],
    ['cursorSize', 10, 52],
  ].forEach(([key, min, max]) => {
    const value = project.style[key];
    if (!Number.isFinite(value) || value < min || value > max) errors.push(`${key} 必须在 ${min}–${max} 之间`);
  });
  return errors;
}

function applyOptions(project, options) {
  const next = structuredClone(project);
  if (options.name !== undefined) next.name = options.name;
  if (options.video !== undefined) next.video = options.video;
  if (options.motion !== undefined) next.timeline = options.motion;
  if (options.background !== undefined) {
    if (!PRESETS.has(options.background)) throw new Error(`未知背景：${options.background}`);
    next.style.backgroundPreset = options.background;
  }
  if (options.color !== undefined) {
    if (!/^#[0-9a-f]{6}$/i.test(options.color)) throw new Error('颜色必须是 #RRGGBB');
    next.style.backgroundColor = options.color;
    next.style.backgroundPreset = 'solid';
  }
  if (options.shell !== undefined) {
    if (!SHELLS.has(options.shell)) throw new Error(`未知窗口样式：${options.shell}`);
    next.style.shell = options.shell;
  }
  if (options.address !== undefined) next.style.browserUrl = options.address;
  if (options.cursor !== undefined) {
    if (!CURSORS.has(options.cursor)) throw new Error(`未知指针样式：${options.cursor}`);
    next.style.cursor = options.cursor;
  }
  if (options.resolution !== undefined) {
    if (!RESOLUTIONS.has(options.resolution)) throw new Error(`未知导出清晰度：${options.resolution}`);
    next.style.exportResolution = options.resolution;
  }
  if (options.padding !== undefined) next.style.padding = numberOption(options.padding, '画面留白', 24, 150);
  if (options.radius !== undefined) next.style.radius = numberOption(options.radius, '圆角', 0, 56);
  if (options.shadow !== undefined) next.style.shadow = numberOption(options.shadow, '阴影', 0, 70);
  if (options.zoom !== undefined) next.style.zoom = numberOption(options.zoom, '聚焦倍数', 1, 2.2);
  if (options['cursor-size'] !== undefined) next.style.cursorSize = numberOption(options['cursor-size'], '指针尺寸', 10, 52);
  return next;
}

async function applyTimelineAddress(project, options) {
  if (options.address !== undefined || !project.timeline) return project;
  const root = path.resolve('.');
  const timelineFile = project.timeline.startsWith('/artifacts/')
    ? path.join(root, project.timeline.slice(1))
    : path.resolve(root, project.timeline);
  try {
    const timeline = JSON.parse(await readFile(timelineFile, 'utf8'));
    if (typeof timeline.source?.url === 'string' && timeline.source.url.trim()) {
      project.style.browserUrl = timeline.source.url.trim();
    }
  } catch {
    // 时间轴可能是远程 URL 或稍后才会生成，此时保留默认地址。
  }
  return project;
}

async function readProject(file) {
  if (!file) throw new Error('请提供 --file <项目.json>');
  return JSON.parse(await readFile(path.resolve(file), 'utf8'));
}

async function writeProject(file, project) {
  const target = path.resolve(file);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(project, null, 2)}\n`, 'utf8');
  console.log(target);
}

function studioUrl(projectFile, origin) {
  const root = path.resolve('.');
  const absolute = path.resolve(projectFile);
  const relative = path.relative(root, absolute).split(path.sep).join('/');
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('项目文件必须位于当前项目目录内');
  }
  const projectUrl = `/${relative}`;
  return `${origin.replace(/\/$/, '')}/studio/?project=${encodeURIComponent(projectUrl)}`;
}

async function main() {
  const { command, options } = parseArgs(process.argv.slice(2));
  if (!command || command === 'help' || command === '--help') usage();

  if (command === 'init') {
    const project = await applyTimelineAddress(applyOptions(DEFAULT_PROJECT, options), options);
    const errors = validate(project);
    if (errors.length) throw new Error(errors.join('\n'));
    await writeProject(options.out || 'artifacts/demo-project.json', project);
    return;
  }

  if (command === 'set') {
    const project = await applyTimelineAddress(applyOptions(await readProject(options.file), options), options);
    const errors = validate(project);
    if (errors.length) throw new Error(errors.join('\n'));
    await writeProject(options.file, project);
    return;
  }

  if (command === 'caption-add') {
    const project = await readProject(options.file);
    const text = options.text?.trim();
    if (!text) throw new Error('请提供 --text <说明文案>');
    if (text.length > 120) throw new Error('说明文案不能超过 120 字符');
    const start = numberOption(options.start, '开始时间', 0, 86_400);
    const duration = numberOption(options.duration ?? 3, '显示时长', .2, 30);
    const position = options.position ?? 'bottom-center';
    if (!CAPTION_POSITIONS.has(position)) throw new Error(`未知说明位置：${position}`);
    const caption = {
      id: options.id?.trim() || `caption-${Date.now()}`,
      text,
      start,
      end: Number((start + duration).toFixed(3)),
      position,
    };
    project.captions = [...(Array.isArray(project.captions) ? project.captions : []), caption];
    const errors = validate(project);
    if (errors.length) throw new Error(errors.join('\n'));
    await writeProject(options.file, project);
    return;
  }

  if (command === 'caption-remove') {
    const project = await readProject(options.file);
    if (!options.id) throw new Error('请提供 --id <说明 ID>');
    project.captions = (Array.isArray(project.captions) ? project.captions : []).filter((caption) => caption.id !== options.id);
    const errors = validate(project);
    if (errors.length) throw new Error(errors.join('\n'));
    await writeProject(options.file, project);
    return;
  }

  if (command === 'caption-clear') {
    const project = await readProject(options.file);
    project.captions = [];
    const errors = validate(project);
    if (errors.length) throw new Error(errors.join('\n'));
    await writeProject(options.file, project);
    return;
  }

  if (command === 'show' || command === 'validate') {
    const project = await readProject(options.file);
    const errors = validate(project);
    if (errors.length) throw new Error(errors.join('\n'));
    console.log(command === 'show' ? JSON.stringify(project, null, 2) : '配置有效');
    return;
  }

  if (command === 'url') {
    const project = await readProject(options.file);
    const errors = validate(project);
    if (errors.length) throw new Error(errors.join('\n'));
    console.log(studioUrl(options.file, options.origin || 'http://127.0.0.1:4173'));
    return;
  }

  throw new Error(`未知命令：${command}`);
}

main().catch((error) => {
  console.error(`错误：${error.message}`);
  process.exitCode = 1;
});
