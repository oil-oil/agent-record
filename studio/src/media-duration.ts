import type { RecordedEvent } from './types';
import { positiveFiniteNumber, timelineDurationMs } from '../../shared/timeline-duration.mjs';

export const DEFAULT_STUDIO_DURATION_SECONDS = 9.6;

type TimelineDurationSource = {
  durationMs?: unknown;
  events?: RecordedEvent[];
};

type MediaDurationSource = {
  duration: number;
};

export function finiteDurationSeconds(value: unknown) {
  return positiveFiniteNumber(value);
}

export function durationSecondsFromTimeline(timeline: TimelineDurationSource) {
  const durationMs = timelineDurationMs(timeline);
  return durationMs ? durationMs / 1000 : undefined;
}

export function preferredDurationSeconds(
  timelineDuration?: number,
  mediaDuration?: number,
) {
  return finiteDurationSeconds(timelineDuration)
    ?? finiteDurationSeconds(mediaDuration)
    ?? DEFAULT_STUDIO_DURATION_SECONDS;
}

export function durationSecondsFromMedia(media: MediaDurationSource) {
  return finiteDurationSeconds(media.duration);
}
