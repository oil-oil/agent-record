const INITIAL_PAUSE_MS = 180;
const FINAL_PAUSE_MS = 320;
const CADENCE_MS = [0, 7, -4, 11, -2];

function graphemes(text) {
  const value = String(text ?? '');
  if (typeof Intl.Segmenter !== 'function') return [...value];
  const segmenter = new Intl.Segmenter('zh', { granularity: 'grapheme' });
  return [...segmenter.segment(value)].map(({ segment }) => segment);
}

function baseDelayMs(character) {
  if (/^\s$/u.test(character)) return 68;
  if (/^\p{P}$/u.test(character)) return 118;
  if (/^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]$/u.test(character)) {
    return 88;
  }
  if (/^[\p{L}\p{N}]$/u.test(character)) return 50;
  return 82;
}

export function naturalTypingSteps(text) {
  return graphemes(text).map((character, index) => ({
    text: character,
    delayMs: Math.max(36, baseDelayMs(character) + CADENCE_MS[index % CADENCE_MS.length]),
  }));
}

export async function typeNaturally(tab, text) {
  if (!tab?.cua?.type || !tab?.playwright?.waitForTimeout) {
    throw new Error('自然输入需要 Chrome 标签页的 cua.type 与 playwright.waitForTimeout');
  }
  const steps = naturalTypingSteps(text);
  if (steps.length === 0) return;

  await tab.playwright.waitForTimeout(INITIAL_PAUSE_MS);
  for (const step of steps) {
    await tab.cua.type({ text: step.text });
    await tab.playwright.waitForTimeout(step.delayMs);
  }
  await tab.playwright.waitForTimeout(FINAL_PAUSE_MS);
}

