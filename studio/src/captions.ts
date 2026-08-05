import type { DemoCaption } from './types';

const smoothstep = (value: number) => {
  const t = Math.max(0, Math.min(1, value));
  return t * t * (3 - 2 * t);
};

export function captionOpacity(caption: DemoCaption, time: number) {
  return captionMotion(caption, time).opacity;
}

export function captionMotion(caption: DemoCaption, time: number) {
  if (time < caption.start || time > caption.end) return { opacity: 0, reveal: 0, text: 0, exit: 0 };
  const duration = caption.end - caption.start;
  const enterDuration = Math.min(.38, Math.max(.24, duration / 5));
  const exitDuration = Math.min(.3, Math.max(.2, duration / 6));
  const reveal = smoothstep((time - caption.start) / enterDuration);
  const exit = smoothstep((caption.end - time) / exitDuration);
  const text = smoothstep((time - caption.start - .08) / Math.max(.16, enterDuration - .08));
  return {
    opacity: Math.min(reveal, exit),
    reveal,
    text: Math.min(text, exit),
    exit,
  };
}

export function activeCaptions(captions: DemoCaption[], time: number) {
  return captions
    .filter((caption) => caption.text.trim() && captionOpacity(caption, time) > 0)
    .sort((a, b) => a.start - b.start);
}
