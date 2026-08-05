import type { RecordedEvent, SourceSegment } from './types';

export type SegmentTransition = {
  active: boolean;
  progress: number;
  boundaryTime: number | null;
  originX: number;
  originY: number;
  opacity: number;
  scale: number;
  translateX: number;
  addressOpacity: number;
  addressTranslateX: number;
};

const ENTER_SECONDS = .34;
const CLICK_LOOKBACK_SECONDS = 2.5;
const boundaryCache = new WeakMap<SourceSegment[], number[]>();
const pageAddressCache = new WeakMap<RecordedEvent[], Array<{ time: number; address: string }>>();
const segmentAddressCache = new WeakMap<SourceSegment[], Array<{ time: number; address: string }>>();
const clickOriginCache = new WeakMap<RecordedEvent[], Array<{ time: number; x: number; y: number }>>();

function clamp(value: number, minimum = 0, maximum = 1) {
  return Math.max(minimum, Math.min(maximum, value));
}

function easeOut(value: number) {
  const t = clamp(value);
  return 1 - (1 - t) ** 3;
}

function latestEntry<T extends { time: number }>(entries: T[], time: number) {
  let lower = 0;
  let upper = entries.length;
  while (lower < upper) {
    const middle = Math.floor((lower + upper) / 2);
    if (entries[middle].time <= time) lower = middle + 1;
    else upper = middle;
  }
  return lower > 0 ? entries[lower - 1] : undefined;
}

function segmentBoundaries(segments: SourceSegment[]) {
  const cached = boundaryCache.get(segments);
  if (cached) return cached;
  const boundaries = segments
    .slice(1)
    .map((segment) => Number(segment.startMs) / 1000)
    .filter(Number.isFinite);
  boundaryCache.set(segments, boundaries);
  return boundaries;
}

function pageAddresses(events: RecordedEvent[]) {
  const cached = pageAddressCache.get(events);
  if (cached) return cached;
  const addresses = events
    .filter((event) => event.kind === 'page' && event.url?.trim() && Number.isFinite(Number(event.tMs)))
    .map((event) => ({ time: Number(event.tMs) / 1000, address: event.url!.trim() }))
    .sort((a, b) => a.time - b.time);
  pageAddressCache.set(events, addresses);
  return addresses;
}

function segmentAddresses(segments: SourceSegment[]) {
  const cached = segmentAddressCache.get(segments);
  if (cached) return cached;
  const addresses = segments
    .slice(1)
    .filter((segment) => segment.source?.url?.trim() && Number.isFinite(Number(segment.startMs)))
    .map((segment) => ({
      time: Number(segment.startMs) / 1000,
      address: segment.source!.url!.trim(),
    }))
    .sort((a, b) => a.time - b.time);
  segmentAddressCache.set(segments, addresses);
  return addresses;
}

function clickOrigins(events: RecordedEvent[]) {
  const cached = clickOriginCache.get(events);
  if (cached) return cached;
  const origins = events
    .filter((event) => event.kind === 'click'
      && Number.isFinite(Number(event.tMs))
      && Number.isFinite(Number(event.nx))
      && Number.isFinite(Number(event.ny)))
    .map((event) => ({
      time: Number(event.tMs) / 1000,
      x: clamp(Number(event.nx), .06, .94),
      y: clamp(Number(event.ny), .06, .94),
    }))
    .sort((a, b) => a.time - b.time);
  clickOriginCache.set(events, origins);
  return origins;
}

export function segmentTransitionAt(
  segments: SourceSegment[] | undefined,
  time: number,
  events: RecordedEvent[] = [],
): SegmentTransition {
  const boundaries = segments?.length ? segmentBoundaries(segments) : [];
  const boundary = boundaries.find(
    (candidate) => time >= candidate && time <= candidate + ENTER_SECONDS,
  );
  if (boundary === undefined) {
    return {
      active: false,
      progress: 1,
      boundaryTime: null,
      originX: .5,
      originY: .5,
      opacity: 1,
      scale: 1,
      translateX: 0,
      addressOpacity: 1,
      addressTranslateX: 0,
    };
  }

  const click = latestEntry(clickOrigins(events), boundary);
  const origin = click && boundary - click.time <= CLICK_LOOKBACK_SECONDS
    ? click
    : { x: .5, y: .5 };
  const amount = easeOut((time - boundary) / ENTER_SECONDS);
  return {
    active: true,
    progress: amount,
    boundaryTime: boundary,
    originX: origin.x,
    originY: origin.y,
    opacity: 1,
    scale: 1,
    translateX: 0,
    addressOpacity: amount,
    addressTranslateX: 8 * (1 - amount),
  };
}

export function segmentAddressAt(
  segments: SourceSegment[] | undefined,
  time: number,
  fallback?: string,
  events: RecordedEvent[] = [],
) {
  const page = latestEntry(pageAddresses(events), time);
  const segment = latestEntry(segments?.length ? segmentAddresses(segments) : [], time);
  if (page && (!segment || page.time > segment.time)) return page.address;
  return segment?.address ?? page?.address ?? fallback;
}
