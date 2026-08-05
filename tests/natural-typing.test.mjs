import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  naturalTypingSteps,
  typeNaturally,
} from '../skills/glidetake/scripts/natural-typing.mjs';

test('自然输入按字素拆分中英文与表情，节奏固定可复现', () => {
  const first = naturalTypingSteps('AI 狼🐺！');
  const second = naturalTypingSteps('AI 狼🐺！');

  assert.deepEqual(first, second);
  assert.deepEqual(
    first.map((step) => step.text),
    ['A', 'I', ' ', '狼', '🐺', '！'],
  );
  assert(first.every((step) => step.delayMs >= 36));
  assert(first.at(-1).delayMs > first[0].delayMs);
});

test('自然输入使用真实 CUA 逐字符发送，并包含起止停顿', async () => {
  const typed = [];
  const waits = [];
  const tab = {
    cua: {
      type: async ({ text }) => typed.push(text),
    },
    playwright: {
      waitForTimeout: async (milliseconds) => waits.push(milliseconds),
    },
  };

  await typeNaturally(tab, 'Demo');

  assert.deepEqual(typed, ['D', 'e', 'm', 'o']);
  assert.equal(waits[0], 180);
  assert.equal(waits.at(-1), 320);
  assert.equal(waits.length, typed.length + 2);
});

test('自然输入拒绝缺少真实浏览器输入能力的对象', async () => {
  await assert.rejects(
    () => typeNaturally({}, 'Demo'),
    /cua\.type/,
  );
});

test('项目 Skill 明确把自然逐字输入设为无配置默认值', async () => {
  const skill = await readFile(
    new URL('../skills/glidetake/SKILL.md', import.meta.url),
    'utf8',
  );
  const recording = await readFile(
    new URL('../skills/glidetake/references/recording.md', import.meta.url),
    'utf8',
  );

  assert.match(skill, /typeNaturally\(tab, text\)/);
  assert.match(skill, /不提供速度配置/);
  assert.match(recording, /不使用 `fill\(\)`/);
  assert.match(recording, /输入内容只出现在网页录屏中，不写入时间轴/);
});
