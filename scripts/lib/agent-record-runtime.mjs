import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { spawn, spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

export const SERVICE_HOST = '127.0.0.1';
export const SERVICE_PORT = 43127;
export const PROTOCOL_VERSION = 1;
export const MAX_EVENTS = 20_000;
export const MAX_EVENT_BYTES = 16 * 1024 * 1024;
export const API_PREFIX = '/v1';
export const API_PATHS = Object.freeze({
  status: `${API_PREFIX}/status`,
  target: `${API_PREFIX}/target`,
  events: `${API_PREFIX}/events`,
  fail: `${API_PREFIX}/fail`,
  stop: `${API_PREFIX}/stop`,
});
const EXTENSION_ORIGIN_PREFIX = 'chrome-extension://';
const EXTENSION_ORIGIN_PATTERN = /^chrome-extension:\/\/[a-p]{32}$/;
const ALLOWED_EVENT_KINDS = new Set([
  'page',
  'page-stable',
  'viewport',
  'move',
  'click',
  'focus',
  'input',
  'input-end',
  'scroll',
]);

export function runtimeDirectory() {
  if (process.env.AGENT_RECORD_RUNTIME_DIR) {
    return path.resolve(process.env.AGENT_RECORD_RUNTIME_DIR);
  }
  return path.join(os.homedir(), 'Library', 'Application Support', 'Agent Record');
}

export function runtimeStatePath() {
  return path.join(runtimeDirectory(), 'runtime.json');
}

export function nativeCaptureBinary(root) {
  if (process.env.AGENT_RECORD_CAPTURE_BINARY) {
    return path.resolve(process.env.AGENT_RECORD_CAPTURE_BINARY);
  }
  const packaged = path.join(root, 'bin', 'agent-record-capture');
  if (existsSync(packaged)) return packaged;
  return path.join(root, 'native', 'macos', '.build', 'release', 'agent-record-capture');
}

export function extensionOriginOf(request, allowedOrigin) {
  const claimedOrigin = claimedExtensionOrigin(request);
  return claimedOrigin && claimedOrigin === allowedOrigin ? claimedOrigin : '';
}

function claimedExtensionOrigin(request) {
  const extensionId = request.headers['x-agent-record-extension-id'];
  if (typeof extensionId !== 'string') {
    return '';
  }
  const claimedOrigin = `${EXTENSION_ORIGIN_PREFIX}${extensionId}`;
  if (!EXTENSION_ORIGIN_PATTERN.test(claimedOrigin)) return '';
  const rawOrigin = request.headers.origin;
  if (typeof rawOrigin === 'string' && rawOrigin !== claimedOrigin) return '';
  return claimedOrigin;
}

export function responseHeaders(extensionOrigin = '') {
  const headers = {
    'cache-control': 'no-store',
    'content-type': 'application/json; charset=utf-8',
  };
  if (extensionOrigin) {
    headers['access-control-allow-origin'] = '*';
    headers['access-control-allow-methods'] = 'GET, POST, OPTIONS';
    headers['access-control-allow-headers'] =
      'content-type, x-agent-record-extension-id, x-agent-record-session-token';
    headers['access-control-expose-headers'] = 'x-agent-record-extension-origin';
    headers['x-agent-record-extension-origin'] = extensionOrigin;
  }
  return headers;
}

export function sendJson(response, statusCode, value, extensionOrigin = '') {
  response.writeHead(statusCode, responseHeaders(extensionOrigin));
  response.end(`${JSON.stringify(value)}\n`);
}

async function readJsonBody(request, limit = 2_000_000) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) throw new Error('请求内容过大');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function sanitizeUrl(value) {
  if (typeof value !== 'string') return undefined;
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) return undefined;
    url.search = '';
    url.hash = '';
    return url.href;
  } catch {
    return undefined;
  }
}

export function sanitizeEvent(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('事件格式无效');
  }
  if (!ALLOWED_EVENT_KINDS.has(value.kind)) {
    throw new Error(`不支持的事件类型：${String(value.kind || '')}`);
  }
  const event = {
    kind: value.kind,
    timestamp: Number(value.timestamp) || Date.now(),
  };
  const numberKeys = [
    'x',
    'y',
    'nx',
    'ny',
    'viewportWidth',
    'viewportHeight',
    'scrollX',
    'scrollY',
    'frameDepth',
    'button',
    'buttons',
    'devicePixelRatio',
  ];
  for (const key of numberKeys) {
    const number = Number(value[key]);
    if (Number.isFinite(number)) event[key] = number;
  }
  const stringLimits = {
    title: 160,
    target: 100,
    inputType: 80,
    phase: 32,
    pointerType: 24,
  };
  for (const [key, limit] of Object.entries(stringLimits)) {
    if (typeof value[key] === 'string') event[key] = value[key].slice(0, limit);
  }
  if (typeof value.topFrame === 'boolean') event.topFrame = value.topFrame;
  if (value.targetRect && typeof value.targetRect === 'object') {
    const rect = {};
    for (const key of ['x', 'y', 'width', 'height']) {
      const number = Number(value.targetRect[key]);
      if (Number.isFinite(number)) rect[key] = number;
    }
    if (Object.keys(rect).length === 4) event.targetRect = rect;
  }
  if ('url' in value) {
    const url = sanitizeUrl(value.url);
    if (url) event.url = url;
  }
  if ('frameUrl' in value) {
    const frameUrl = sanitizeUrl(value.frameUrl);
    if (frameUrl) event.frameUrl = frameUrl;
  }
  return event;
}

function validBounds(value) {
  if (!value || typeof value !== 'object') return null;
  const bounds = {
    x: Number(value.x ?? value.left),
    y: Number(value.y ?? value.top),
    width: Number(value.width),
    height: Number(value.height),
  };
  if (
    !Object.values(bounds).every(Number.isFinite) ||
    bounds.width < 480 ||
    bounds.height < 320
  ) {
    return null;
  }
  return bounds;
}

function processResult(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8' });
  return {
    ok: result.status === 0,
    status: result.status,
    stdout: result.stdout?.trim() || '',
    stderr: result.stderr?.trim() || '',
    error: result.error?.message || '',
  };
}

function normalizedWindowText(value) {
  return String(value || '').normalize('NFKD').toLowerCase();
}

export function selectCaptureWindowDescriptor(windows, { owner, title = '', bounds }) {
  const ownerNeedle = normalizedWindowText(owner);
  const titleNeedle = normalizedWindowText(title);
  const candidates = (Array.isArray(windows) ? windows : []).filter((window) => {
    const frame = validBounds(window?.frame);
    return frame &&
      normalizedWindowText(window.owner).includes(ownerNeedle) &&
      (!titleNeedle || normalizedWindowText(window.title).includes(titleNeedle));
  });
  const matching = candidates.filter((window) => {
    const frame = validBounds(window.frame);
    return (
      Math.abs(frame.x - bounds.x) <= 12 &&
      Math.abs(frame.y - bounds.y) <= 12 &&
      Math.abs(frame.width - bounds.width) <= 12 &&
      Math.abs(frame.height - bounds.height) <= 12
    );
  });
  return matching.length === 1 ? matching[0] : null;
}

function runProcess(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr.trim() || `${command} 执行失败：${code}`));
    });
  });
}

export function calculateContentRect(target, capture) {
  const windowBounds = validBounds(target?.window);
  const screen = target?.page?.screen;
  const captureWidth = Number(capture?.width);
  const captureHeight = Number(capture?.height);
  if (
    !windowBounds ||
    !screen ||
    !Number.isFinite(captureWidth) ||
    !Number.isFinite(captureHeight) ||
    captureWidth < 2 ||
    captureHeight < 2
  ) {
    throw new Error('缺少网页内容区域校准信息');
  }
  const outerWidth = Number(screen.outerWidth);
  const outerHeight = Number(screen.outerHeight);
  const innerWidth = Number(screen.innerWidth);
  const innerHeight = Number(screen.innerHeight);
  if (
    ![outerWidth, outerHeight, innerWidth, innerHeight].every(Number.isFinite) ||
    innerWidth < 320 ||
    innerHeight < 240 ||
    innerWidth > outerWidth ||
    innerHeight > outerHeight
  ) {
    throw new Error('网页视口尺寸不适合校准');
  }
  const scaleX = captureWidth / windowBounds.width;
  const scaleY = captureHeight / windowBounds.height;
  const horizontalInset = Math.max(0, (outerWidth - innerWidth) / 2);
  const topInset = Math.max(0, outerHeight - innerHeight);
  const screenOffsetX = Number(screen.x) - windowBounds.x;
  const screenOffsetY = Number(screen.y) - windowBounds.y;
  let x = Math.round((screenOffsetX + horizontalInset) * scaleX);
  let y = Math.round((screenOffsetY + topInset) * scaleY);
  let width = Math.round(innerWidth * scaleX);
  let height = Math.round(innerHeight * scaleY);
  x = Math.max(0, Math.min(captureWidth - 2, x));
  y = Math.max(0, Math.min(captureHeight - 2, y));
  width = Math.max(2, Math.min(captureWidth - x, width));
  height = Math.max(2, Math.min(captureHeight - y, height));
  width -= width % 2;
  height -= height % 2;
  if (width < 640 || height < 360) throw new Error('校准后的网页内容区域过小');
  return {
    x,
    y,
    width,
    height,
    captureSize: { width: captureWidth, height: captureHeight },
    scale: { x: scaleX, y: scaleY },
  };
}

async function cropVideo(input, output, rect) {
  await runProcess('ffmpeg', [
    '-v', 'error',
    '-i', input,
    '-map', '0:v:0',
    '-vf', `crop=${rect.width}:${rect.height}:${rect.x}:${rect.y},fps=60`,
    '-an',
    '-c:v', 'h264_videotoolbox',
    '-b:v', '28M',
    '-maxrate', '36M',
    '-bufsize', '56M',
    '-profile:v', 'high',
    '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart',
    output,
  ]);
}

export function inspectVideo(videoPath) {
  const result = processResult('ffprobe', [
    '-v', 'error',
    '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height,avg_frame_rate,nb_frames:format=duration',
    '-of', 'json',
    videoPath,
  ]);
  if (!result.ok) {
    throw new Error(result.error || result.stderr || 'ffprobe 无法读取录制视频');
  }
  const probe = JSON.parse(result.stdout);
  const stream = probe.streams?.[0] || {};
  const [numerator, denominator] = String(stream.avg_frame_rate || '0/1')
    .split('/')
    .map(Number);
  return {
    width: Number(stream.width) || 0,
    height: Number(stream.height) || 0,
    frameRate: denominator ? numerator / denominator : 0,
    frameCount: Number(stream.nb_frames) || 0,
    durationMs: Math.round((Number(probe.format?.duration) || 0) * 1000),
  };
}

async function sha256(file) {
  const data = await readFile(file);
  return createHash('sha256').update(data).digest('hex');
}

function waitForChild(child) {
  return new Promise((resolve) => {
    child.once('exit', (code, signal) => resolve({ code, signal }));
  });
}

function readJsonLines(stream, onValue) {
  let buffer = '';
  stream.setEncoding('utf8');
  stream.on('data', (chunk) => {
    buffer += chunk;
    while (buffer.includes('\n')) {
      const index = buffer.indexOf('\n');
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      if (!line) continue;
      try {
        onValue(JSON.parse(line));
      } catch {
        onValue({ type: 'error', code: 'NATIVE_PROTOCOL_ERROR', message: line });
      }
    }
  });
}

export class RecordingDaemon {
  constructor({
    root,
    sessionId,
    sessionDirectory,
    owner = 'Google Chrome',
    title = '',
    port = SERVICE_PORT,
  }) {
    this.root = root;
    this.sessionId = sessionId;
    this.sessionDirectory = sessionDirectory;
    this.owner = owner;
    this.title = title;
    this.allowedExtensionOrigin = '';
    this.port = port;
    this.eventToken = randomBytes(24).toString('base64url');
    this.targetToken = randomBytes(24).toString('base64url');
    this.state = 'awaiting-target';
    this.startedAt = 0;
    this.stoppedAt = 0;
    this.events = [];
    this.eventBytes = 0;
    this.sequence = 0;
    this.source = null;
    this.target = null;
    this.nativeChild = null;
    this.nativeExitPromise = null;
    this.nativeReady = null;
    this.nativeResult = null;
    this.error = '';
    this.errorCode = '';
    this.server = null;
    this.stopPromise = null;
  }

  publicStatus(includeTokens = false) {
    return {
      protocolVersion: PROTOCOL_VERSION,
      state: this.state,
      recording: this.state === 'recording',
      startedAt: this.startedAt,
      sessionId: this.sessionId,
      eventCount: this.events.length,
      eventBytes: this.eventBytes,
      droppedEvents: 0,
      ...(includeTokens && this.state === 'awaiting-target'
        ? { targetToken: this.targetToken }
        : {}),
      ...(includeTokens && this.state === 'recording'
        ? { eventToken: this.eventToken }
        : {}),
      ...(this.error ? { error: this.error, errorCode: this.errorCode } : {}),
    };
  }

  async persistRuntime() {
    await mkdir(runtimeDirectory(), { recursive: true });
    await writeFile(runtimeStatePath(), `${JSON.stringify({
      pid: process.pid,
      port: this.port,
      sessionId: this.sessionId,
      sessionDirectory: this.sessionDirectory,
      state: this.state,
      startedAt: this.startedAt,
      error: this.error,
      errorCode: this.errorCode,
    }, null, 2)}\n`);
  }

  async startServer() {
    await mkdir(this.sessionDirectory, { recursive: false });
    this.server = createServer((request, response) => {
      void this.route(request, response).catch((error) => {
        sendJson(response, 500, {
          ok: false,
          error: error?.message || '本地录制服务异常',
        }, extensionOriginOf(request, this.allowedExtensionOrigin));
      });
    });
    await new Promise((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(this.port, SERVICE_HOST, resolve);
    });
    await this.persistRuntime();
  }

  async route(request, response) {
    const rawOrigin = request.headers.origin;
    const claimedOrigin = claimedExtensionOrigin(request);
    if (
      !this.allowedExtensionOrigin &&
      this.state === 'awaiting-target' &&
      request.method === 'GET' &&
      request.url === API_PATHS.status
    ) {
      this.allowedExtensionOrigin = claimedOrigin;
    }
    const extensionOrigin = extensionOriginOf(request, this.allowedExtensionOrigin);
    const hasUntrustedExtensionOrigin =
      Boolean(claimedOrigin || (
        typeof rawOrigin === 'string' &&
        rawOrigin.startsWith(EXTENSION_ORIGIN_PREFIX)
      )) &&
      !extensionOrigin;
    if (request.method === 'OPTIONS') {
      if (!extensionOrigin) return sendJson(response, 403, { ok: false, error: '来源无效' });
      return sendJson(response, 204, {}, extensionOrigin);
    }
    if (hasUntrustedExtensionOrigin) {
      return sendJson(response, 403, { ok: false, error: '扩展来源无效' });
    }
    if (request.method === 'GET' && request.url === API_PATHS.status) {
      return sendJson(response, 200, this.publicStatus(Boolean(extensionOrigin)), extensionOrigin);
    }
    if (request.method === 'POST' && request.url === API_PATHS.target) {
      if (!extensionOrigin) return sendJson(response, 403, { ok: false, error: '来源无效' });
      const body = await readJsonBody(request);
      await this.acceptTarget(body);
      return sendJson(response, 202, { ok: true, state: this.state }, extensionOrigin);
    }
    if (request.method === 'POST' && request.url === API_PATHS.events) {
      if (!extensionOrigin) return sendJson(response, 403, { ok: false, error: '来源无效' });
      const body = await readJsonBody(request);
      this.acceptEvents(body, request.headers['x-agent-record-session-token']);
      return sendJson(response, 202, {
        ok: true,
        acceptedSequence: this.sequence,
      }, extensionOrigin);
    }
    if (request.method === 'POST' && request.url === API_PATHS.fail) {
      if (!extensionOrigin) return sendJson(response, 403, { ok: false, error: '来源无效' });
      const body = await readJsonBody(request);
      if (request.headers['x-agent-record-session-token'] !== this.eventToken) {
        return sendJson(response, 403, { ok: false, error: '事件令牌无效' }, extensionOrigin);
      }
      await this.fail(
        typeof body.code === 'string' ? body.code : 'EXTENSION_EVENT_FAILURE',
        typeof body.message === 'string' ? body.message : '扩展事件管道失败',
      );
      return sendJson(response, 202, { ok: true, state: this.state }, extensionOrigin);
    }
    if (request.method === 'POST' && request.url === API_PATHS.stop) {
      if (extensionOrigin) return sendJson(response, 403, { ok: false, error: '停止录制只能由 CLI 发起' }, extensionOrigin);
      const result = await this.stop();
      sendJson(response, result.ok ? 200 : 500, result);
      setTimeout(() => this.close(), 50).unref();
      return;
    }
    return sendJson(response, 404, { ok: false, error: '接口不存在' }, extensionOrigin);
  }

  async acceptTarget(body) {
    if (this.state !== 'awaiting-target') {
      if (this.state === 'recording') return;
      throw new Error(`当前状态不能绑定目标窗口：${this.state}`);
    }
    if (body?.targetToken !== this.targetToken) throw new Error('目标窗口令牌无效');
    const bounds = validBounds(body.window);
    if (!bounds) throw new Error('目标窗口边界无效');
    const binary = nativeCaptureBinary(this.root);
    const listed = processResult(binary, ['list']);
    if (!listed.ok) throw new Error(listed.stderr || listed.error || '无法读取可录制窗口');
    const windows = JSON.parse(listed.stdout).windows;
    const captureWindow = selectCaptureWindowDescriptor(windows, {
      owner: this.owner,
      title: this.title,
      bounds,
    });
    if (!captureWindow) {
      throw new Error(`当前活动页面不属于指定的 ${this.owner} 窗口`);
    }
    this.captureWindow = captureWindow;
    this.target = {
      window: bounds,
      tab: body.tab && typeof body.tab === 'object' ? body.tab : {},
      page: body.page && typeof body.page === 'object'
        ? {
            title: String(body.page.title || '').slice(0, 160),
            url: sanitizeUrl(body.page.url),
            viewport: body.page.viewport,
            screen: body.page.screen,
          }
        : {},
    };
    this.source = {
      title: String(this.target.page.title || '').slice(0, 160),
      url: sanitizeUrl(this.target.page.url),
      viewport: this.target.page.viewport,
    };
    this.state = 'starting';
    await this.persistRuntime();
    await this.startNativeCapture(bounds);
  }

  async startNativeCapture(bounds) {
    const binary = nativeCaptureBinary(this.root);
    const partialVideo = path.join(this.sessionDirectory, 'capture.partial.mov');
    const args = [
      'record',
      '--output', partialVideo,
      '--owner', this.owner,
      '--window-id', String(this.captureWindow.windowId),
      '--fps', '60',
      '--x', String(this.captureWindow.frame.x),
      '--y', String(this.captureWindow.frame.y),
      '--width', String(this.captureWindow.frame.width),
      '--height', String(this.captureWindow.frame.height),
    ];
    if (this.title) args.push('--title', this.title);
    const child = spawn(binary, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    this.nativeChild = child;
    this.nativeExitPromise = waitForChild(child);
    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    const ready = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('等待 ScreenCaptureKit 首帧超时')), 15_000);
      readJsonLines(child.stdout, (message) => {
        if (message.type === 'ready') {
          clearTimeout(timeout);
          this.nativeReady = message;
          this.startedAt = Date.now();
          this.events = [{
            kind: 'recording-start',
            sequence: ++this.sequence,
            timestamp: this.startedAt,
            tMs: 0,
          }];
          this.state = 'recording';
          void this.persistRuntime();
          resolve(message);
        } else if (message.type === 'finished' && this.nativeResult?.type !== 'error') {
          this.nativeResult = message;
        } else if (message.type === 'error') {
          this.nativeResult = message;
          if (this.state === 'recording') {
            void this.fail(
              message.code || 'CAPTURE_RUNTIME_ERROR',
              message.message || 'ScreenCaptureKit 运行异常',
            );
          } else if (this.state !== 'stopping' && this.state !== 'failed') {
            clearTimeout(timeout);
            reject(new Error(message.message || 'ScreenCaptureKit 启动失败'));
          }
        }
      });
      child.once('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });
      child.once('exit', (code, signal) => {
        if (!this.nativeReady && code !== 0) {
          clearTimeout(timeout);
          reject(new Error(this.nativeResult?.message || stderr.trim() || `录制进程退出：${code}`));
        } else if (
          this.nativeReady &&
          this.state === 'recording' &&
          (code !== 0 || signal || this.nativeResult?.type !== 'finished')
        ) {
          void this.fail(
            this.nativeResult?.code || 'CAPTURE_RUNTIME_ERROR',
            this.nativeResult?.message || `录制进程意外退出：${code ?? signal ?? 'unknown'}`,
          );
        }
      });
    });
    try {
      await ready;
    } catch (error) {
      await this.fail('CAPTURE_START_FAILED', error.message);
      throw error;
    }
  }

  acceptEvents(body, token) {
    if (this.state !== 'recording') throw new Error('当前没有正在进行的录制');
    if (!token || token !== this.eventToken) throw new Error('事件令牌无效');
    if (!Array.isArray(body?.events) || !body.events.length) throw new Error('事件批次为空');
    if (this.events.length + body.events.length > MAX_EVENTS) {
      void this.fail('EVENT_BACKPRESSURE', '事件数量超过 20,000 条');
      throw new Error('事件数量超过上限，录制已经终止');
    }
    const prepared = body.events.map((value) => {
      const event = sanitizeEvent(value);
      return {
        ...event,
        tMs: Math.max(0, Math.round(event.timestamp - this.startedAt)),
      };
    });
    const batchBytes = Buffer.byteLength(JSON.stringify(prepared));
    if (this.eventBytes + batchBytes > MAX_EVENT_BYTES) {
      void this.fail('EVENT_BACKPRESSURE', '事件数据超过 16MB');
      throw new Error('事件数据超过上限，录制已经终止');
    }
    for (const event of prepared) {
      this.events.push({
        ...event,
        sequence: ++this.sequence,
      });
    }
    this.eventBytes += batchBytes;
  }

  async fail(code, message) {
    if (this.state === 'failed' || this.state === 'completed') return;
    this.errorCode = code;
    this.error = message;
    this.state = 'failed';
    this.nativeChild?.kill('SIGINT');
    await mkdir(this.sessionDirectory, { recursive: true });
    await Promise.all([
      rm(path.join(this.sessionDirectory, 'capture.partial.mov'), { force: true }),
      rm(path.join(this.sessionDirectory, 'capture.cropped.partial.mov'), { force: true }),
      rm(path.join(this.sessionDirectory, 'timeline.partial.json'), { force: true }),
    ]);
    await writeFile(path.join(this.sessionDirectory, 'failure.json'), `${JSON.stringify({
      schemaVersion: 1,
      sessionId: this.sessionId,
      status: 'failed',
      errorCode: code,
      message,
    }, null, 2)}\n`);
    await this.persistRuntime();
    setTimeout(() => {
      void this.close();
    }, 250).unref();
  }

  async stop() {
    if (this.stopPromise) return this.stopPromise;
    this.stopPromise = this.stopSession();
    return this.stopPromise;
  }

  async stopSession() {
    if (this.state === 'awaiting-target' || this.state === 'starting') {
      await this.fail('EXTENSION_NOT_READY', '浏览器扩展没有及时提供目标窗口');
      return { ok: false, error: this.error, errorCode: this.errorCode };
    }
    if (this.state === 'failed') {
      return { ok: false, error: this.error, errorCode: this.errorCode };
    }
    if (this.state !== 'recording') {
      return { ok: false, error: `当前状态不能停止录制：${this.state}` };
    }

    this.state = 'stopping';
    this.stoppedAt = Date.now();
    this.events.push({
      kind: 'recording-stop',
      sequence: ++this.sequence,
      timestamp: this.stoppedAt,
      tMs: Math.max(0, this.stoppedAt - this.startedAt),
    });
    await this.persistRuntime();
    this.nativeChild.kill('SIGINT');
    const { code } = await this.nativeExitPromise;
    if (code !== 0 || this.nativeResult?.type === 'error') {
      await this.fail(
        this.nativeResult?.code || 'CAPTURE_RUNTIME_ERROR',
        this.nativeResult?.message || `录制进程异常退出：${code}`,
      );
      return { ok: false, error: this.error, errorCode: this.errorCode };
    }

    const partialVideo = path.join(this.sessionDirectory, 'capture.partial.mov');
    const croppedPartialVideo = path.join(this.sessionDirectory, 'capture.cropped.partial.mov');
    const videoPath = path.join(this.sessionDirectory, 'capture.mov');
    let calibration;
    try {
      calibration = calculateContentRect(this.target, this.nativeReady);
      await cropVideo(partialVideo, croppedPartialVideo, calibration);
      await rename(croppedPartialVideo, videoPath);
      await rm(partialVideo, { force: true });
    } catch (error) {
      await this.fail('CALIBRATION_FAILED', error?.message || '网页内容区域校准失败');
      return { ok: false, error: this.error, errorCode: this.errorCode };
    }
    const video = inspectVideo(videoPath);
    const durationMs = Math.min(
      Math.max(0, this.stoppedAt - this.startedAt),
      video.durationMs || Number.MAX_SAFE_INTEGER,
    );
    const timeline = {
      schemaVersion: 3,
      sessionId: this.sessionId,
      startedAt: this.startedAt,
      stoppedAt: this.stoppedAt,
      durationMs,
      source: this.source,
      calibration: {
        mapping: 'normalized-content-rect',
        contentRectPx: { x: 0, y: 0, width: video.width, height: video.height },
        captureSize: { width: video.width, height: video.height },
        rawContentRectPx: calibration,
      },
      events: this.events.map((event) => ({
        ...event,
        tMs: Math.min(durationMs, event.tMs),
      })),
      capture: {
        provider: 'ScreenCaptureKit',
        width: video.width,
        height: video.height,
        frameRate: video.frameRate,
        frameCount: video.frameCount || this.nativeResult?.frameCount || 0,
        droppedFrames: this.nativeResult?.droppedFrames || 0,
        window: this.nativeReady?.window,
        showsCursor: false,
      },
    };
    const timelinePartial = path.join(this.sessionDirectory, 'timeline.partial.json');
    const timelinePath = path.join(this.sessionDirectory, 'timeline.json');
    await writeFile(timelinePartial, `${JSON.stringify(timeline, null, 2)}\n`);
    await rename(timelinePartial, timelinePath);

    const manifest = {
      schemaVersion: 1,
      protocolVersion: PROTOCOL_VERSION,
      sessionId: this.sessionId,
      status: 'completed',
      platform: 'macos',
      startedAt: this.startedAt,
      stoppedAt: this.stoppedAt,
      durationMs,
      capture: timeline.capture,
      calibration: timeline.calibration,
      target: this.target,
      files: {
        video: 'capture.mov',
        timeline: 'timeline.json',
      },
    };
    const manifestPath = path.join(this.sessionDirectory, 'manifest.json');
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    const checksums = {
      'capture.mov': await sha256(videoPath),
      'timeline.json': await sha256(timelinePath),
      'manifest.json': await sha256(manifestPath),
    };
    await writeFile(
      path.join(this.sessionDirectory, 'checksums.json'),
      `${JSON.stringify(checksums, null, 2)}\n`,
    );
    this.state = 'completed';
    await this.persistRuntime();
    return {
      ok: true,
      sessionId: this.sessionId,
      sessionDirectory: this.sessionDirectory,
      video: videoPath,
      timeline: timelinePath,
      manifest: manifestPath,
      durationMs,
    };
  }

  async close() {
    if (this.closePromise) return this.closePromise;
    this.closePromise = (async () => {
      if (this.server?.listening) {
        await new Promise((resolve) => this.server.close(resolve));
      }
      await rm(runtimeStatePath(), { force: true });
    })();
    return this.closePromise;
  }
}
