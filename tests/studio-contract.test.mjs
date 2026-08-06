import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const app = () => readFile(new URL('../studio/src/App.tsx', import.meta.url), 'utf8');
const timeline = () => readFile(new URL('../studio/src/TimelineAdapter.tsx', import.meta.url), 'utf8');

test('Studio 预览使用 60fps，并提供单一多文件打开入口', async () => {
  const source = await app();
  assert.match(source, /const fps = 60/);
  assert.match(source, /multiple onChange=/);
  assert.match(source, /打开录制/);
  assert.match(source, /importRecordings/);
  assert.match(source, /if \(video\) importVideo\(video\);\n    if \(timeline\) await importTrace\(timeline\);/);
});

test('替换视频和无 timeline 项目会清空旧时间轴数据', async () => {
  const source = await app();
  assert.match(source, /const clearTimeline = useCallback/);
  assert.match(source, /setEvents\(\[\]\)/);
  assert.match(source, /setSourceSegments\(\[\]\)/);
  assert.match(source, /clearTimeline\(\);\n    setSource\(next\)/);
});

test('项目失败保留视频并显示持久错误，项目下载是实际 JSON 下载', async () => {
  const source = await app();
  assert.match(source, /项目时间轴加载失败：/);
  assert.match(source, /onDownloadProject/);
  assert.match(source, /anchor\.download = .*project\.json/);
  assert.match(source, /video: project\.video/);
  assert.match(source, /role="alert"/);
  assert.match(source, /录制时长不足，无法添加说明/);
});

test('字幕轨道允许拖动和拉伸，其他轨道只读', async () => {
  const source = await timeline();
  assert.match(source, /effectId: 'caption', movable: true, flexible: true/);
  assert.match(source, /disableDrag=\{false\}/);
  assert.match(source, /onActionMoveEnd=/);
  assert.match(source, /onActionResizeEnd=/);
  assert.match(source, /onCaptionChange\(id/);
});
