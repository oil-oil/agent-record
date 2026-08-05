export type CursorMotionKeyframe = {
  time: number;
  x: number;
  y: number;
  kind?: string;
};

type MotionPoint = {
  x: number;
  y: number;
};

export type SmoothCursorSegment = {
  startTime: number;
  endTime: number;
  path: MotionPoint[];
  cumulativePixels: number[];
  lengthPixels: number;
};

export type SmoothCursorTrack = {
  knots: CursorMotionKeyframe[];
  segments: SmoothCursorSegment[];
  initial: MotionPoint | null;
};

type CursorMotionOptions = {
  viewportWidth?: number;
  viewportHeight?: number;
  targetSpeedPixelsPerSecond?: number;
  minimumDurationSeconds?: number;
  maximumDurationSeconds?: number;
  minimumHoldSeconds?: number;
};

const DEFAULT_VIEWPORT_WIDTH = 1440;
const DEFAULT_VIEWPORT_HEIGHT = 900;
const DEFAULT_TARGET_SPEED = 400;
const DEFAULT_MINIMUM_DURATION = .65;
const DEFAULT_MAXIMUM_DURATION = 1.85;
const DEFAULT_MINIMUM_HOLD = .16;
const GESTURE_BREAK_SECONDS = .8;
const PATH_SIMPLIFY_TOLERANCE_PIXELS = 2.5;
const PATH_SMOOTHING_PASSES = 6;

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}

function pointDistancePixels(
  from: MotionPoint,
  to: MotionPoint,
  viewportWidth: number,
  viewportHeight: number,
) {
  return Math.hypot(
    (to.x - from.x) * viewportWidth,
    (to.y - from.y) * viewportHeight,
  );
}

function normalizeKeyframes(keyframes: CursorMotionKeyframe[]) {
  const sorted = keyframes
    .filter((item) => Number.isFinite(item.time) && Number.isFinite(item.x) && Number.isFinite(item.y))
    .map((item) => ({
      ...item,
      time: Math.max(0, item.time),
      x: clamp(item.x, .02, .98),
      y: clamp(item.y, .02, .98),
    }))
    .sort((a, b) => a.time - b.time);
  const normalized: CursorMotionKeyframe[] = [];

  sorted.forEach((item) => {
    const previous = normalized.at(-1);
    if (previous && Math.abs(previous.time - item.time) < .000001) {
      normalized[normalized.length - 1] = item;
      return;
    }
    normalized.push(item);
  });

  return normalized;
}

function perpendicularDistancePixels(
  point: MotionPoint,
  from: MotionPoint,
  to: MotionPoint,
  viewportWidth: number,
  viewportHeight: number,
) {
  const fromX = from.x * viewportWidth;
  const fromY = from.y * viewportHeight;
  const toX = to.x * viewportWidth;
  const toY = to.y * viewportHeight;
  const pointX = point.x * viewportWidth;
  const pointY = point.y * viewportHeight;
  const dx = toX - fromX;
  const dy = toY - fromY;
  const squaredLength = dx * dx + dy * dy;
  if (squaredLength === 0) return Math.hypot(pointX - fromX, pointY - fromY);
  const projection = clamp(((pointX - fromX) * dx + (pointY - fromY) * dy) / squaredLength, 0, 1);
  return Math.hypot(pointX - (fromX + dx * projection), pointY - (fromY + dy * projection));
}

function simplifyPath(
  points: MotionPoint[],
  viewportWidth: number,
  viewportHeight: number,
): MotionPoint[] {
  if (points.length <= 2) return points;
  let maximumDistance = 0;
  let splitIndex = 0;

  for (let index = 1; index < points.length - 1; index += 1) {
    const distance = perpendicularDistancePixels(
      points[index],
      points[0],
      points.at(-1)!,
      viewportWidth,
      viewportHeight,
    );
    if (distance > maximumDistance) {
      maximumDistance = distance;
      splitIndex = index;
    }
  }

  if (maximumDistance <= PATH_SIMPLIFY_TOLERANCE_PIXELS) {
    return [points[0], points.at(-1)!];
  }

  const left = simplifyPath(points.slice(0, splitIndex + 1), viewportWidth, viewportHeight);
  const right = simplifyPath(points.slice(splitIndex), viewportWidth, viewportHeight);
  return [...left.slice(0, -1), ...right];
}

function smoothPath(points: MotionPoint[]) {
  if (points.length <= 2) return points;
  let smoothed = points;

  for (let pass = 0; pass < PATH_SMOOTHING_PASSES; pass += 1) {
    const next: MotionPoint[] = [smoothed[0]];
    for (let index = 0; index < smoothed.length - 1; index += 1) {
      const from = smoothed[index];
      const to = smoothed[index + 1];
      next.push({
        x: from.x * .75 + to.x * .25,
        y: from.y * .75 + to.y * .25,
      });
      next.push({
        x: from.x * .25 + to.x * .75,
        y: from.y * .25 + to.y * .75,
      });
    }
    next.push(smoothed.at(-1)!);
    smoothed = next;
  }

  return smoothed;
}

function preparePath(
  source: MotionPoint[],
  viewportWidth: number,
  viewportHeight: number,
) {
  const deduplicated = source.filter((point, index) => (
    index === 0
    || index === source.length - 1
    || pointDistancePixels(source[index - 1], point, viewportWidth, viewportHeight) >= 1.5
  ));
  if (deduplicated.length === 1) deduplicated.push({ ...deduplicated[0] });
  const path = smoothPath(simplifyPath(deduplicated, viewportWidth, viewportHeight));
  const cumulativePixels = [0];

  for (let index = 1; index < path.length; index += 1) {
    cumulativePixels.push(
      cumulativePixels[index - 1]
      + pointDistancePixels(path[index - 1], path[index], viewportWidth, viewportHeight),
    );
  }

  return {
    path,
    cumulativePixels,
    lengthPixels: cumulativePixels.at(-1) ?? 0,
  };
}

function easeInOut(progress: number) {
  const t = clamp(progress, 0, 1);
  const cubic = t * t * (3 - 2 * t);
  const minimumJerk = t * t * t * (10 + t * (-15 + 6 * t));
  return minimumJerk * .8 + cubic * .2;
}

function samplePath(segment: SmoothCursorSegment, distancePixels: number) {
  if (segment.path.length === 0) return null;
  if (distancePixels <= 0) return segment.path[0];
  if (distancePixels >= segment.lengthPixels) return segment.path.at(-1)!;

  let toIndex = 1;
  while (
    toIndex < segment.cumulativePixels.length - 1
    && segment.cumulativePixels[toIndex] < distancePixels
  ) {
    toIndex += 1;
  }
  const fromIndex = toIndex - 1;
  const fromDistance = segment.cumulativePixels[fromIndex];
  const span = segment.cumulativePixels[toIndex] - fromDistance;
  const amount = span <= 0 ? 1 : (distancePixels - fromDistance) / span;
  const from = segment.path[fromIndex];
  const to = segment.path[toIndex];
  return {
    x: from.x + (to.x - from.x) * amount,
    y: from.y + (to.y - from.y) * amount,
  };
}

export function buildSmoothCursorTrack(
  keyframes: CursorMotionKeyframe[],
  options: CursorMotionOptions = {},
): SmoothCursorTrack {
  const source = normalizeKeyframes(keyframes);
  const initial = source[0] ? { x: source[0].x, y: source[0].y } : null;
  if (source.length < 2 || !initial) {
    return { knots: source, segments: [], initial };
  }

  const viewportWidth = options.viewportWidth ?? DEFAULT_VIEWPORT_WIDTH;
  const viewportHeight = options.viewportHeight ?? DEFAULT_VIEWPORT_HEIGHT;
  const targetSpeed = options.targetSpeedPixelsPerSecond ?? DEFAULT_TARGET_SPEED;
  const minimumDuration = options.minimumDurationSeconds ?? DEFAULT_MINIMUM_DURATION;
  const maximumDuration = options.maximumDurationSeconds ?? DEFAULT_MAXIMUM_DURATION;
  const minimumHold = options.minimumHoldSeconds ?? DEFAULT_MINIMUM_HOLD;
  const segments: SmoothCursorSegment[] = [];
  const knots: CursorMotionKeyframe[] = [source[0]];
  let currentPoint = initial;
  let currentAnchorTime = source[0].time;
  let pending: CursorMotionKeyframe[] = [];
  let followsNavigation = source[0].kind === 'page';

  const finishGesture = (end: CursorMotionKeyframe) => {
    const rawPath = [
      currentPoint,
      ...pending.map(({ x, y }) => ({ x, y })),
      { x: end.x, y: end.y },
    ];
    const prepared = preparePath(rawPath, viewportWidth, viewportHeight);
    if (prepared.lengthPixels < 2) {
      currentPoint = { x: end.x, y: end.y };
      currentAnchorTime = end.time;
      pending = [];
      knots.push(end);
      return;
    }

    const plannedDuration = clamp(
      prepared.lengthPixels / targetSpeed,
      minimumDuration,
      maximumDuration,
    );
    const firstMoveTime = pending[0]?.time ?? end.time - plannedDuration;
    const desiredStart = Math.min(firstMoveTime, end.time - plannedDuration);
    const hold = followsNavigation ? 0 : minimumHold;
    const startTime = Math.max(currentAnchorTime + hold, desiredStart);
    const endTime = Math.max(startTime + 1 / 120, end.time);
    segments.push({
      startTime,
      endTime,
      ...prepared,
    });
    knots.push(
      { time: startTime, x: currentPoint.x, y: currentPoint.y, kind: 'gesture-start' },
      end,
    );
    currentPoint = { x: end.x, y: end.y };
    currentAnchorTime = end.time;
    pending = [];
    followsNavigation = false;
  };

  for (let index = 1; index < source.length; index += 1) {
    const keyframe = source[index];
    if (keyframe.kind === 'page') {
      if (pending.length > 0) finishGesture(pending.at(-1)!);
      // 导航事件记录的是新页面视口中心，不是真实鼠标位置。页面切换后保持
      // 上一次指针落点，避免把光标瞬间传送到页面中心。
      currentAnchorTime = Math.max(currentAnchorTime, keyframe.time);
      followsNavigation = true;
      knots.push({
        ...keyframe,
        x: currentPoint.x,
        y: currentPoint.y,
      });
      continue;
    }
    if (keyframe.kind === 'move') {
      const previousMove = pending.at(-1);
      if (previousMove && keyframe.time - previousMove.time > GESTURE_BREAK_SECONDS) {
        finishGesture(previousMove);
      }
      pending.push(keyframe);
      continue;
    }

    if (keyframe.kind === 'click') {
      finishGesture(keyframe);
      continue;
    }

    if (pending.length > 0) finishGesture(pending.at(-1)!);
    currentPoint = { x: keyframe.x, y: keyframe.y };
    currentAnchorTime = keyframe.time;
    knots.push(keyframe);
  }

  if (pending.length > 0) finishGesture(pending.at(-1)!);

  return { knots, segments, initial };
}

export function sampleSmoothCursorTrack(track: SmoothCursorTrack, time: number) {
  if (!track.initial) return null;
  const segments = track.segments;
  let lower = 0;
  let upper = segments.length;
  while (lower < upper) {
    const middle = Math.floor((lower + upper) / 2);
    if (segments[middle].endTime < time) lower = middle + 1;
    else upper = middle;
  }
  if (lower >= segments.length) return segments.at(-1)?.path.at(-1) ?? track.initial;

  const point = lower === 0
    ? track.initial
    : segments[lower - 1].path.at(-1) ?? track.initial;
  const segment = segments[lower];
  if (time < segment.startTime) return point;
  const duration = segment.endTime - segment.startTime;
  const progress = duration <= 0 ? 1 : (time - segment.startTime) / duration;
  return samplePath(segment, easeInOut(progress) * segment.lengthPixels) ?? point;
}
