export function positiveFiniteNumber(value: unknown): number | undefined;

export function timelineDurationMs(timeline: {
  durationMs?: unknown;
  events?: Array<{ tMs?: unknown }>;
}): number | undefined;
