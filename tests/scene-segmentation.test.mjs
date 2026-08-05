import assert from "node:assert/strict";
import test from "node:test";
import {
  createSceneSegments,
  remapSceneTimeline,
} from "../scripts/lib/scene-segmentation.mjs";

test("缺失 input 事件时仍保留从编辑框聚焦到提交的完整输入", () => {
  const events = [
    { kind: "page", tMs: 20, url: "https://eazo.ai/creator/explore" },
    {
      kind: "click",
      tMs: 1_185,
      viewportWidth: 2_000,
      viewportHeight: 1_000,
      targetRect: { x: 12, y: 166, width: 199, height: 35 },
    },
    {
      kind: "focus",
      tMs: 1_355,
      target: "div",
      viewportWidth: 2_000,
      viewportHeight: 1_000,
      targetRect: { x: 771, y: 178, width: 586, height: 24 },
    },
    { kind: "move", tMs: 18_000, nx: .6, ny: .2 },
    {
      kind: "click",
      tMs: 37_718,
      target: "div",
      viewportWidth: 2_000,
      viewportHeight: 1_000,
      targetRect: { x: 771, y: 245, width: 586, height: 24 },
    },
    { kind: "recording-stop", tMs: 40_000 },
  ];

  const scenes = createSceneSegments(40_000, events);
  assert.equal(scenes.length, 1);
  assert(
    scenes[0].startMs >= 1_250,
    `不应保留跳转前的 Explore 闪帧：${scenes[0].startMs}ms`,
  );
  assert(
    scenes[0].endMs >= 38_500,
    `必须保留完整输入和提交后的停留：${scenes[0].endMs}ms`,
  );
  assert(scenes[0].reasons.includes("input-session-inferred"));
  const mapped = remapSceneTimeline(
    { durationMs: 40_000, events },
    scenes,
  );
  const inputHeartbeats = mapped.events.filter(
    (event) => event.synthetic === "inferred-input-heartbeat",
  );
  assert(inputHeartbeats.length >= 50);
  assert(
    inputHeartbeats.at(-1).tMs - inputHeartbeats[0].tMs >= 35_000,
    "输入聚焦必须持续到文本输入结束",
  );
});

test("显式输入事件合并为连续输入会话", () => {
  const events = [
    { kind: "focus", tMs: 1_000, target: "textarea" },
    { kind: "input", tMs: 1_100, target: "textarea" },
    { kind: "input", tMs: 1_900, target: "textarea" },
    { kind: "input", tMs: 2_700, target: "textarea" },
    { kind: "input-end", tMs: 2_900, target: "textarea" },
    { kind: "click", tMs: 3_200, target: "button:发送" },
  ];

  const scenes = createSceneSegments(6_000, events);
  assert.equal(scenes.length, 1);
  assert(scenes[0].startMs <= 800);
  assert(scenes[0].endMs >= 5_000);
  assert(scenes[0].reasons.includes("input-session"));
});

test("鼠标移动只驱动光标，不连接相隔很远的操作场景", () => {
  const events = [
    { kind: "click", tMs: 2_000 },
    { kind: "move", tMs: 15_000, nx: .5, ny: .5 },
    { kind: "click", tMs: 30_000 },
  ];

  const scenes = createSceneSegments(34_000, events);
  assert.equal(scenes.length, 2);
  assert(scenes[0].endMs < 10_000);
  assert(scenes[1].startMs > 20_000);
});

test("重映射后每个场景都有来源，事件不会落入被删除的等待时间", () => {
  const metadata = {
    durationMs: 30_000,
    source: { url: "https://example.com/start" },
    events: [
      { kind: "recording-start", tMs: 0 },
      { kind: "page", tMs: 10, url: "https://example.com/start" },
      { kind: "click", tMs: 2_000 },
      { kind: "page", tMs: 20_000, url: "https://example.com/result" },
      { kind: "click", tMs: 21_000 },
      { kind: "recording-stop", tMs: 30_000 },
    ],
  };
  const scenes = [
    { startMs: 1_000, endMs: 4_000, reasons: ["click"] },
    { startMs: 19_000, endMs: 23_000, reasons: ["page", "click"] },
  ];

  const mapped = remapSceneTimeline(metadata, scenes);
  assert.equal(mapped.durationMs, 7_000);
  assert.equal(mapped.sourceSegments.length, 2);
  assert.equal(mapped.sourceSegments[1].startMs, 3_000);
  assert.equal(mapped.sourceSegments[1].source.url, "https://example.com/start");
  assert(
    mapped.events.every((event) => event.tMs >= 0 && event.tMs <= 7_000),
  );
  assert.equal(mapped.events.at(-1).kind, "recording-stop");
});
