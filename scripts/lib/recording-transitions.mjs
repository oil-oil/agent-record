const DEFAULT_TRANSITION_HOLD_MS = 550;
const DEFAULT_MINIMUM_TAIL_TRIM_MS = 500;
const DEFAULT_MAXIMUM_LEADING_BLACK_MS = 800;
const FRAME_MS_60FPS = 1000 / 60;

function finiteNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function transitionEndMs(
  timeline,
  {
    isLast = false,
    enabled = true,
    holdMs = DEFAULT_TRANSITION_HOLD_MS,
    minimumTailTrimMs = DEFAULT_MINIMUM_TAIL_TRIM_MS,
  } = {},
) {
  const durationMs = Math.max(0, finiteNumber(timeline?.durationMs, 0));
  if (!enabled || isLast) return durationMs;

  const lastClick = [...(timeline?.events ?? [])]
    .filter((event) => event.kind === 'click' && Number.isFinite(Number(event.tMs)))
    .sort((a, b) => Number(b.tMs) - Number(a.tMs))[0];
  if (!lastClick) return durationMs;

  const candidate = Math.min(
    durationMs,
    Math.max(0, Number(lastClick.tMs)) + Math.max(0, finiteNumber(holdMs, 0)),
  );
  return durationMs - candidate >= Math.max(0, finiteNumber(minimumTailTrimMs, 0))
    ? Math.round(candidate)
    : durationMs;
}

export function leadingBlackTrimMs(
  blackDetectLog,
  {
    enabled = true,
    maximumMs = DEFAULT_MAXIMUM_LEADING_BLACK_MS,
  } = {},
) {
  if (!enabled || typeof blackDetectLog !== 'string') return 0;
  const matches = [
    ...blackDetectLog.matchAll(
      /black_start:([0-9.]+)\s+black_end:([0-9.]+)\s+black_duration:([0-9.]+)/g,
    ),
  ];
  const interval = matches
    .map((match) => ({
      start: Number(match[1]),
      end: Number(match[2]),
    }))
    .find(({ start, end }) => start <= .02 && end > start);
  if (!interval) return 0;

  const endMs = interval.end * 1000;
  if (endMs > Math.max(0, finiteNumber(maximumMs, 0))) return 0;
  return Math.round(
    (Math.ceil(endMs / FRAME_MS_60FPS) + 1) * FRAME_MS_60FPS,
  );
}

export function adjustedSegmentDurationMs(timeline, trimStartMs, trimEndMs) {
  const durationMs = Math.max(0, finiteNumber(timeline?.durationMs, 0));
  const startMs = Math.min(durationMs, Math.max(0, finiteNumber(trimStartMs, 0)));
  const endMs = Math.min(
    durationMs,
    Math.max(startMs, finiteNumber(trimEndMs, durationMs)),
  );
  return Math.max(0, Math.round(endMs - startMs));
}

export function remapSegmentEvents(
  timeline,
  {
    trimStartMs = 0,
    trimEndMs = Number(timeline?.durationMs) || 0,
    offsetMs = 0,
    isFirst = false,
    isLast = false,
  } = {},
) {
  const startMs = Math.max(0, finiteNumber(trimStartMs, 0));
  const endMs = Math.max(startMs, finiteNumber(trimEndMs, startMs));
  const segmentDurationMs = Math.max(0, Math.round(endMs - startMs));
  const output = [];
  const pageBeforeStart = (timeline?.events ?? [])
    .filter((event) => event.kind === 'page' && finiteNumber(event.tMs, 0) <= startMs)
    .sort((a, b) => finiteNumber(a.tMs, 0) - finiteNumber(b.tMs, 0))
    .at(-1);

  if (pageBeforeStart) {
    output.push({
      ...pageBeforeStart,
      tMs: Math.round(offsetMs),
    });
  }

  for (const event of timeline?.events ?? []) {
    const timeMs = finiteNumber(event.tMs, 0);
    if (event.kind === 'recording-start') {
      if (isFirst) output.push({ ...event, tMs: Math.round(offsetMs) });
      continue;
    }
    if (event.kind === 'recording-stop') {
      if (isLast) {
        output.push({
          ...event,
          tMs: Math.round(offsetMs + segmentDurationMs),
        });
      }
      continue;
    }
    if (event.kind === 'page') {
      if (event === pageBeforeStart || timeMs < startMs || timeMs > endMs) continue;
      output.push({
        ...event,
        tMs: Math.round(offsetMs + timeMs - startMs),
      });
      continue;
    }
    if (timeMs < startMs || timeMs > endMs) continue;
    output.push({
      ...event,
      tMs: Math.round(offsetMs + timeMs - startMs),
    });
  }

  return output;
}

export function addIdleGestureBridges(
  events,
  {
    minimumIdleMs = 1000,
    bridgeAfterMs = 800,
    minimumLeadMs = 180,
  } = {},
) {
  const sorted = [...(events ?? [])].sort(
    (a, b) => finiteNumber(a.tMs, 0) - finiteNumber(b.tMs, 0),
  );
  const bridges = [];
  let anchor = null;
  let firstMove = null;

  for (const event of sorted) {
    const hasPoint = Number.isFinite(Number(event.nx))
      && Number.isFinite(Number(event.ny));
    if (event.kind === 'page' && hasPoint) {
      anchor = event;
      firstMove = null;
      continue;
    }
    if (event.kind === 'move' && hasPoint) {
      firstMove ??= event;
      continue;
    }
    if (event.kind !== 'click' || !hasPoint) continue;

    if (
      anchor
      && firstMove
      && Number(firstMove.tMs) - Number(anchor.tMs) >= minimumIdleMs
    ) {
      const timeMs = Math.min(
        Number(firstMove.tMs) - minimumLeadMs,
        Number(anchor.tMs) + bridgeAfterMs,
      );
      if (timeMs > Number(anchor.tMs) + minimumLeadMs) {
        bridges.push({
          kind: 'move',
          tMs: Math.round(timeMs),
          nx: anchor.nx,
          ny: anchor.ny,
          x: anchor.x,
          y: anchor.y,
          synthetic: 'idle-gesture-bridge',
        });
      }
    }
    anchor = event;
    firstMove = null;
  }

  return [...sorted, ...bridges].sort(
    (a, b) => finiteNumber(a.tMs, 0) - finiteNumber(b.tMs, 0),
  );
}
