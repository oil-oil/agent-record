import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => readFile(path.join(root, file), 'utf8');

test('扩展权限只保留页面事件桥所需能力', async () => {
  const manifest = JSON.parse(await read('extension/manifest.json'));
  const permissions = manifest.permissions || [];
  for (const forbidden of ['debugger', 'tabCapture', 'offscreen', 'downloads']) {
    assert.equal(permissions.includes(forbidden), false, `不应申请 ${forbidden} 权限`);
  }
  await assert.rejects(access(path.join(root, 'extension/offscreen.html'), constants.F_OK));
  await assert.rejects(access(path.join(root, 'extension/offscreen.js'), constants.F_OK));
});

test('后台只桥接 localhost 状态与事件，不包含旧视频采集路径', async () => {
  const source = await read('extension/background.js');
  assert.match(source, /SERVICE_ORIGIN = "http:\/\/127\.0\.0\.1:43127"/);
  assert.match(source, /STATUS_URL = `\$\{SERVICE_ORIGIN\}\/v1\/status`/);
  assert.match(source, /EVENTS_URL = `\$\{SERVICE_ORIGIN\}\/v1\/events`/);
  assert.match(source, /TARGET_URL = `\$\{SERVICE_ORIGIN\}\/v1\/target`/);
  assert.match(source, /x-agent-record-session-token/);
  assert.match(source, /x-agent-record-extension-id/);
  assert.match(source, /JSON\.stringify\(\{ events \}\)/);
  assert.match(source, /x-agent-record-extension-origin/);
  assert.match(source, /targetToken/);
  assert.match(source, /chrome\.windows\.get\(sender\.tab\.windowId\)/);
  assert.doesNotMatch(source, /getLastFocused/);
  assert.doesNotMatch(source, /tabs\.query\(\{ active: true, windowId \}\)/);
  assert.match(source, /status\.targetUrl/);
  assert.match(source, /targetWindowId/);
  assert.match(source, /targetTabId/);
  assert.match(source, /FLUSH_DELAY_MS = 32/);
  assert.match(source, /scheduleFlush/);
  assert.match(source, /EVENT_BACKPRESSURE/);
  assert.match(source, /LOCAL_STATUS/);
  assert.match(source, /GET_STATUS/);
  assert.doesNotMatch(source, /pendingEvents\.push\(event\);\s*await flushEvents\(\)/);
  assert.doesNotMatch(source, /chrome\.debugger|tabCapture|MediaRecorder|OFFSCREEN_/);
  assert.doesNotMatch(source, /TOGGLE_RECORDING_FROM_PAGE|START_RECORDING|STOP_RECORDING/);
});

test('内容脚本定时读取本地状态并保留原有页面事件采集', async () => {
  const source = await read('extension/content.js');
  assert.match(source, /type: "LOCAL_STATUS"/);
  assert.match(source, /hasExtensionRuntime && isTopFrame/);
  assert.match(source, /page:\s*\{/);
  assert.match(source, /url: safePageUrl\(\)/);
  assert.match(source, /title: document\.title/);
  assert.doesNotMatch(source, /geometry:\s*viewport/);
  assert.match(source, /setInterval\(requestLocalStatus,\s*1_000\)/);
  for (const eventName of ['pointermove', 'click', 'beforeinput', 'compositionend', 'scroll']) {
    assert.match(source, new RegExp(`addEventListener\\(\\"${eventName}\\"`));
  }
  assert.match(source, /type: "DEMO_EVENT"/);
  assert.doesNotMatch(source, /cursor:\s*none|cursorHidden|CURSOR_HIDDEN_ATTRIBUTE|CURSOR_RELAY_TYPE/);
  assert.doesNotMatch(source, /data-agent-record-toggle|F8|TOGGLE_RECORDING_FROM_PAGE/);
  assert.doesNotMatch(source, /__agentRecordPreview|previewEvents/);
});

test('弹窗仍通过 GET_STATUS 获取录制状态', async () => {
  const source = await read('extension/popup.js');
  assert.match(source, /type: "GET_STATUS"/);
});
