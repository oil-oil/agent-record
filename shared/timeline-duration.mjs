export function positiveFiniteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : undefined;
}

export function timelineDurationMs(timeline) {
  const explicit = positiveFiniteNumber(timeline?.durationMs);
  if (explicit) return explicit;
  return positiveFiniteNumber(Math.max(
    0,
    ...(Array.isArray(timeline?.events) ? timeline.events : [])
      .map((event) => Number(event?.tMs) || 0),
  ));
}
