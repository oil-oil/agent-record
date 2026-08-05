const DEFAULTS = {
  actionLeadMs: 350,
  actionTailMs: 1_800,
  resultLeadMs: 2_000,
  inputLeadMs: 220,
  inputTailMs: 900,
  inputGapMs: 2_200,
  inferredInputMaximumMs: 120_000,
  mergeGapMs: 2_200,
  minimumSceneMs: 1_200,
  finalResultMs: 4_000,
};

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function timeOf(event) {
  return Math.max(0, finite(event?.tMs));
}

function rectOf(event) {
  const rect = event?.targetRect;
  if (!rect) return null;
  const x = finite(rect.x, Number.NaN);
  const y = finite(rect.y, Number.NaN);
  const width = finite(rect.width, Number.NaN);
  const height = finite(rect.height, Number.NaN);
  if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) {
    return null;
  }
  return { x, y, width, height };
}

function centerOf(event) {
  const rect = rectOf(event);
  if (rect) {
    return {
      x: rect.x + rect.width / 2,
      y: rect.y + rect.height / 2,
      width: Math.max(1, finite(event.viewportWidth, 1)),
      height: Math.max(1, finite(event.viewportHeight, 1)),
    };
  }
  if (Number.isFinite(Number(event?.nx)) && Number.isFinite(Number(event?.ny))) {
    return {
      x: finite(event.nx),
      y: finite(event.ny),
      width: 1,
      height: 1,
    };
  }
  return null;
}

function normalizedDistance(from, to) {
  const a = centerOf(from);
  const b = centerOf(to);
  if (!a || !b) return Number.POSITIVE_INFINITY;
  const width = Math.max(a.width, b.width, 1);
  const height = Math.max(a.height, b.height, 1);
  return Math.hypot((a.x - b.x) / width, (a.y - b.y) / height);
}

function sameEditingRegion(focus, action) {
  const input = rectOf(focus);
  const target = rectOf(action);
  if (!input || !target) return normalizedDistance(focus, action) <= .16;
  const targetCenterX = target.x + target.width / 2;
  const targetCenterY = target.y + target.height / 2;
  const horizontalMatch =
    targetCenterX >= input.x - 24 &&
    targetCenterX <= input.x + input.width + 24;
  const verticalGap = Math.max(
    0,
    input.y - targetCenterY,
    targetCenterY - (input.y + input.height),
  );
  return horizontalMatch && verticalGap <= 180;
}

function isEditableFocus(event) {
  if (event?.kind !== "focus") return false;
  const target = String(event.target || "");
  return /^(input|textarea|select|div)(?::|$)/.test(target);
}

function inputSessions(events, durationMs, settings) {
  const inputs = events.filter((event) => event.kind === "input");
  const ends = events.filter((event) => event.kind === "input-end");
  const focuses = events.filter(isEditableFocus);
  const sessions = [];

  for (const input of inputs) {
    const previous = sessions.at(-1);
    if (
      previous &&
      timeOf(input) - previous.lastInputMs <= settings.inputGapMs &&
      (
        !input.target ||
        !previous.target ||
        input.target === previous.target ||
        sameEditingRegion(previous.anchor, input)
      )
    ) {
      previous.lastInputMs = timeOf(input);
      previous.events.push(input);
      continue;
    }

    const anchor = [...focuses]
      .reverse()
      .find((focus) => (
        timeOf(focus) <= timeOf(input) &&
        timeOf(input) - timeOf(focus) <= 1_500 &&
        (
          !focus.target ||
          !input.target ||
          focus.target === input.target ||
          sameEditingRegion(focus, input)
        )
      )) || input;
    sessions.push({
      anchor,
      target: input.target,
      firstInputMs: timeOf(input),
      lastInputMs: timeOf(input),
      events: [input],
      inferred: false,
    });
  }

  for (const session of sessions) {
    const end = ends.find((event) => (
      timeOf(event) >= session.lastInputMs &&
      timeOf(event) - session.lastInputMs <= 3_000 &&
      (
        !event.target ||
        !session.target ||
        event.target === session.target ||
        sameEditingRegion(session.anchor, event)
      )
    ));
    session.startMs = Math.max(0, timeOf(session.anchor) - settings.inputLeadMs);
    session.endMs = Math.min(
      durationMs,
      Math.max(
        session.lastInputMs + settings.inputTailMs,
        end ? timeOf(end) + 300 : 0,
      ),
    );
  }

  for (const focus of focuses) {
    if (sessions.some((session) => (
      timeOf(focus) >= session.startMs &&
      timeOf(focus) <= session.endMs
    ))) {
      continue;
    }
    const nextClick = events.find((event) => (
      event.kind === "click" &&
      timeOf(event) > timeOf(focus)
    ));
    if (!nextClick) continue;
    const span = timeOf(nextClick) - timeOf(focus);
    if (
      span < 500 ||
      span > settings.inferredInputMaximumMs ||
      !sameEditingRegion(focus, nextClick)
    ) {
      continue;
    }
    const interrupted = events.some((event) => (
      timeOf(event) > timeOf(focus) &&
      timeOf(event) < timeOf(nextClick) &&
      ["click", "page"].includes(event.kind)
    ));
    if (interrupted) continue;

    const previousClick = [...events]
      .reverse()
      .find((event) => event.kind === "click" && timeOf(event) < timeOf(focus));
    const followsDistantNavigation = previousClick &&
      timeOf(focus) - timeOf(previousClick) <= 900 &&
      !sameEditingRegion(focus, previousClick);
    sessions.push({
      anchor: focus,
      target: focus.target,
      firstInputMs: timeOf(focus),
      lastInputMs: timeOf(nextClick),
      startMs: Math.max(
        0,
        timeOf(focus) - (followsDistantNavigation ? 80 : settings.inputLeadMs),
      ),
      endMs: Math.min(durationMs, timeOf(nextClick) + settings.inputTailMs),
      events: [],
      inferred: true,
      submit: nextClick,
      navigationClick: followsDistantNavigation ? previousClick : null,
    });
  }

  return sessions.sort((a, b) => a.startMs - b.startMs);
}

function mergeScenes(intervals, durationMs, settings) {
  const sorted = intervals
    .map((scene) => ({
      ...scene,
      startMs: Math.max(0, Math.min(durationMs, finite(scene.startMs))),
      endMs: Math.max(0, Math.min(durationMs, finite(scene.endMs))),
      reasons: [...new Set(scene.reasons || [])],
    }))
    .filter((scene) => scene.endMs > scene.startMs)
    .sort((a, b) => a.startMs - b.startMs);
  const merged = [];

  for (const scene of sorted) {
    const previous = merged.at(-1);
    if (!previous || scene.startMs - previous.endMs > settings.mergeGapMs) {
      merged.push({ ...scene });
      continue;
    }
    previous.endMs = Math.max(previous.endMs, scene.endMs);
    previous.reasons = [...new Set([...previous.reasons, ...scene.reasons])];
  }

  return merged.map((scene) => {
    const missing = Math.max(0, settings.minimumSceneMs - (scene.endMs - scene.startMs));
    const before = Math.min(scene.startMs, missing / 2);
    const after = Math.min(durationMs - scene.endMs, missing - before);
    return {
      ...scene,
      startMs: Math.round(scene.startMs - before),
      endMs: Math.round(scene.endMs + after),
    };
  });
}

export function createSceneSegments(
  durationMs,
  sourceEvents,
  overrides = {},
) {
  const settings = { ...DEFAULTS, ...overrides };
  const duration = Math.max(0, finite(durationMs));
  const events = [...(sourceEvents || [])]
    .filter((event) => Number.isFinite(Number(event?.tMs)))
    .sort((a, b) => timeOf(a) - timeOf(b));
  const sessions = inputSessions(events, duration, settings);
  const scenes = sessions.map((session) => ({
    startMs: session.startMs,
    endMs: session.endMs,
    reasons: [session.inferred ? "input-session-inferred" : "input-session"],
  }));

  const meaningful = events.filter((event) => (
    ["click", "focus", "input", "input-end", "scroll", "page", "page-stable"]
      .includes(event.kind)
  ));

  for (const [index, event] of meaningful.entries()) {
    const time = timeOf(event);
    if (sessions.some((session) => (
      time >= session.startMs &&
      time <= session.endMs
    ))) {
      continue;
    }
    if (event.kind === "click") {
      const opensInputSession = sessions.some((session) => (
        session.navigationClick === event
      ));
      if (opensInputSession) continue;
      const previous = meaningful[index - 1];
      const hasLongLead = !previous || time - timeOf(previous) > 4_000;
      scenes.push({
        startMs: time - (hasLongLead ? settings.resultLeadMs : settings.actionLeadMs),
        endMs: time + settings.actionTailMs,
        reasons: ["click"],
      });
      continue;
    }
    if (event.kind === "scroll") {
      scenes.push({
        startMs: time - 250,
        endMs: time + 1_100,
        reasons: ["scroll"],
      });
      continue;
    }
    if (event.kind === "page" && event.topFrame === false) continue;
    if (event.kind === "page" && time <= 500) continue;
    if (event.kind === "page" || event.kind === "page-stable") {
      scenes.push({
        startMs: time - 300,
        endMs: time + 1_500,
        reasons: [event.kind],
      });
      continue;
    }
    if (event.kind === "focus") {
      scenes.push({
        startMs: time - 180,
        endMs: time + 850,
        reasons: ["focus"],
      });
    }
  }

  const lastAction = [...meaningful]
    .reverse()
    .find((event) => !["input-end", "page-stable"].includes(event.kind));
  if (lastAction && duration - timeOf(lastAction) > settings.actionTailMs) {
    const containing = scenes.find((scene) => (
      timeOf(lastAction) >= scene.startMs &&
      timeOf(lastAction) <= scene.endMs
    ));
    if (containing) {
      containing.endMs = Math.min(
        duration,
        Math.max(containing.endMs, timeOf(lastAction) + settings.finalResultMs),
      );
    }
  }

  const merged = mergeScenes(scenes, duration, settings);
  if (merged.length || duration <= 0) return merged;
  return [{
    startMs: 0,
    endMs: Math.round(duration),
    reasons: ["fallback-full"],
  }];
}

export function remapSceneTimeline(metadata, scenes) {
  const events = metadata?.events || [];
  const durationMs = scenes.reduce(
    (sum, scene) => sum + scene.endMs - scene.startMs,
    0,
  );
  const sourceSegments = [];
  const mappedEvents = [];
  let offsetMs = 0;

  for (const scene of scenes) {
    const page = [...events]
      .filter((event) => (
        event.kind === "page" &&
        event.topFrame !== false &&
        timeOf(event) <= scene.startMs
      ))
      .sort((a, b) => timeOf(a) - timeOf(b))
      .at(-1);
    sourceSegments.push({
      startMs: offsetMs,
      durationMs: scene.endMs - scene.startMs,
      sourceStartMs: scene.startMs,
      sourceEndMs: scene.endMs,
      reasons: scene.reasons,
      source: page
        ? { url: page.url, title: page.title }
        : metadata.source,
    });
    if (page) {
      mappedEvents.push({
        ...page,
        tMs: offsetMs,
        synthetic: "scene-page-anchor",
      });
    }
    if (scene.reasons?.includes("input-session-inferred")) {
      const focus = events.find((event) => (
        event.kind === "focus" &&
        timeOf(event) >= scene.startMs &&
        timeOf(event) <= scene.endMs
      ));
      const submit = focus && events.find((event) => (
        event.kind === "click" &&
        timeOf(event) > timeOf(focus) &&
        timeOf(event) <= scene.endMs &&
        sameEditingRegion(focus, event)
      ));
      if (focus && submit) {
        for (
          let time = timeOf(focus);
          time < timeOf(submit);
          time += 600
        ) {
          mappedEvents.push({
            ...focus,
            kind: "input",
            tMs: Math.round(offsetMs + time - scene.startMs),
            synthetic: "inferred-input-heartbeat",
          });
        }
      }
    }
    for (const event of events) {
      const time = timeOf(event);
      if (
        ["recording-start", "recording-stop", "page"].includes(event.kind) ||
        time < scene.startMs ||
        time > scene.endMs
      ) {
        continue;
      }
      mappedEvents.push({
        ...event,
        tMs: Math.round(offsetMs + time - scene.startMs),
      });
    }
    offsetMs += scene.endMs - scene.startMs;
  }

  mappedEvents.push({ kind: "recording-start", tMs: 0 });
  mappedEvents.push({ kind: "recording-stop", tMs: Math.round(durationMs) });
  const unique = new Map();
  for (const event of mappedEvents.sort((a, b) => timeOf(a) - timeOf(b))) {
    const key = [
      event.kind,
      event.tMs,
      event.target || "",
      event.synthetic || "",
    ].join(":");
    unique.set(key, event);
  }

  return {
    ...metadata,
    durationMs: Math.round(durationMs),
    events: [...unique.values()].sort((a, b) => timeOf(a) - timeOf(b)),
    sourceSegments,
  };
}
