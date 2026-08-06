import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  calculateContentRect,
  RecordingDaemon,
  sanitizeEvent,
  sanitizeUrl,
  selectCaptureWindowDescriptor,
} from '../scripts/lib/agent-record-runtime.mjs';

test('事件清洗会删除敏感值与网址参数', () => {
  const event = sanitizeEvent({
    kind: 'click',
    timestamp: 123,
    url: 'https://example.com/product?token=secret#section',
    frameUrl: 'https://example.com/frame?account=oil',
    value: '不能保存',
    password: '不能保存',
    token: '不能保存',
    nx: .5,
    ny: .4,
  });
  assert.equal(event.url, 'https://example.com/product');
  assert.equal(event.frameUrl, 'https://example.com/frame');
  assert.equal('value' in event, false);
  assert.equal('password' in event, false);
  assert.equal('token' in event, false);
});

test('事件清洗拒绝未知事件类型', () => {
  assert.throws(
    () => sanitizeEvent({ kind: 'unknown', timestamp: Date.now() }),
    /不支持的事件类型/,
  );
});

test('目标网址去掉参数后仍可精确绑定页面', () => {
  assert.equal(
    sanitizeUrl('https://vibe-hub.org/en?from=demo#search'),
    'https://vibe-hub.org/en',
  );
  assert.equal(sanitizeUrl('chrome://extensions'), undefined);
});

test('窗口坐标会稳定换算成视频里的网页内容区域', () => {
  const rect = calculateContentRect({
    window: { x: 100, y: 50, width: 1440, height: 960 },
    page: {
      screen: {
        x: 100,
        y: 50,
        outerWidth: 1440,
        outerHeight: 960,
        innerWidth: 1440,
        innerHeight: 860,
      },
    },
  }, { width: 2880, height: 1920 });
  assert.deepEqual(
    { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
    { x: 0, y: 200, width: 2880, height: 1720 },
  );
});

test('Ego Lite 缺失 outer 尺寸时使用窗口内部坐标校准', () => {
  const rect = calculateContentRect({
    window: { x: -270, y: -1050, width: 1920, height: 1050 },
    page: {
      screen: {
        x: -270,
        y: -1050,
        outerWidth: 0,
        outerHeight: 0,
        innerWidth: 1920,
        innerHeight: 1050,
      },
    },
  }, { width: 3840, height: 2100 });
  assert.deepEqual(
    { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
    { x: 0, y: 0, width: 3840, height: 2100 },
  );
});

test('多浏览器同时轮询时只绑定 CLI 指定的真实窗口', () => {
  const windows = [
    {
      windowId: 1,
      owner: 'ego lite',
      title: 'AI Hook · Museon',
      frame: { x: -270, y: -1050, width: 1920, height: 1050 },
    },
    {
      windowId: 2,
      owner: 'Google Chrome',
      title: 'Example Domain',
      frame: { x: 54, y: 33, width: 1304, height: 848 },
    },
  ];
  assert.equal(selectCaptureWindowDescriptor(windows, {
    owner: 'Google Chrome',
    title: 'Example Domain',
    bounds: windows[0].frame,
  }), null);
  assert.equal(selectCaptureWindowDescriptor(windows, {
    owner: 'Google Chrome',
    title: 'Example Domain',
    bounds: windows[1].frame,
  })?.windowId, 2);
});

test('本地服务只向扩展来源暴露一次性目标令牌', async (context) => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'agent-record-runtime-'));
  const previousRuntime = process.env.AGENT_RECORD_RUNTIME_DIR;
  process.env.AGENT_RECORD_RUNTIME_DIR = path.join(temporary, 'runtime');
  const daemon = new RecordingDaemon({
    root: process.cwd(),
    sessionId: 'test-session',
    sessionDirectory: path.join(temporary, 'session'),
    targetUrl: 'https://vibe-hub.org/en?from=test',
    port: 0,
  });
  context.after(async () => {
    await daemon.close();
    await rm(temporary, { recursive: true, force: true });
    if (previousRuntime === undefined) delete process.env.AGENT_RECORD_RUNTIME_DIR;
    else process.env.AGENT_RECORD_RUNTIME_DIR = previousRuntime;
  });

  await daemon.startServer();
  const port = daemon.server.address().port;
  const publicResponse = await fetch(`http://127.0.0.1:${port}/v1/status`);
  const publicStatus = await publicResponse.json();
  assert.equal(publicStatus.state, 'awaiting-target');
  assert.equal('targetToken' in publicStatus, false);
  assert.equal('targetUrl' in publicStatus, false);

  const extensionOrigin = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop';
  const extensionResponse = await fetch(`http://127.0.0.1:${port}/v1/status`, {
    headers: {
      'x-agent-record-extension-id': 'abcdefghijklmnopabcdefghijklmnop',
    },
  });
  const extensionStatus = await extensionResponse.json();
  assert.equal(typeof extensionStatus.targetToken, 'string');
  assert.equal(extensionStatus.targetToken.length > 20, true);
  assert.equal(extensionStatus.targetUrl, 'https://vibe-hub.org/en');
  assert.equal(
    extensionResponse.headers.get('x-agent-record-extension-origin'),
    extensionOrigin,
  );
  assert.equal(extensionResponse.headers.get('access-control-allow-origin'), '*');

  const rejectedResponse = await fetch(`http://127.0.0.1:${port}/v1/status`, {
    headers: {
      'x-agent-record-extension-id': 'ponmlkjihgfedcbaponmlkjihgfedcba',
    },
  });
  assert.equal(rejectedResponse.status, 403);
  const rejectedStatus = await rejectedResponse.json();
  assert.equal('targetToken' in rejectedStatus, false);
});
