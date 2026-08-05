import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { spawn } from "node:child_process";
import {
  createSceneSegments,
  remapSceneTimeline,
} from "./lib/scene-segmentation.mjs";
import {
  positiveFiniteNumber,
  timelineDurationMs,
} from "../shared/timeline-duration.mjs";

const [, , inputArg, metadataArg, outputArg] = process.argv;

if (!inputArg || !metadataArg || !outputArg) {
  console.error(
    "用法：npm run process -- <原始视频.webm> <时间轴.json> <输出视频.mp4>",
  );
  process.exit(1);
}

const inputPath = resolve(inputArg);
const metadataPath = resolve(metadataArg);
const outputPath = resolve(outputArg);

function run(command, args, { capture = false } = {}) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      stdio: capture ? ["ignore", "pipe", "inherit"] : "inherit",
    });
    let stdout = "";
    if (capture) {
      child.stdout.on("data", (chunk) => {
        stdout += chunk;
      });
    }
    child.on("error", rejectPromise);
    child.on("close", (code) => {
      if (code === 0) resolvePromise(stdout);
      else rejectPromise(new Error(`${command} 执行失败，退出码 ${code}`));
    });
  });
}

const metadata = JSON.parse(await readFile(metadataPath, "utf8"));
const settings = {
  sceneModel: metadata.processing?.sceneModel ?? "semantic-v1",
  idleThresholdMs: metadata.processing?.idleThresholdMs ?? 1500,
  paddingBeforeMs: metadata.processing?.paddingBeforeMs ?? 500,
  paddingAfterMs: metadata.processing?.paddingAfterMs ?? 950,
  mode: "cut",
};

const probeOutput = await run(
  "ffprobe",
  [
    "-v",
    "error",
    "-show_entries",
    "format=duration:stream=codec_type",
    "-of",
    "json",
    inputPath,
  ],
  { capture: true },
);
const probe = JSON.parse(probeOutput);
const duration =
  positiveFiniteNumber(probe.format?.duration)
  ?? ((timelineDurationMs(metadata) ?? 0) / 1000);
const hasAudio = probe.streams?.some((stream) => stream.codec_type === "audio");
if (!Number.isFinite(duration) || duration <= 0) {
  throw new Error("无法读取原始视频时长");
}

const sceneSegments = createSceneSegments(
  duration * 1000,
  metadata.events || [],
  {
    actionLeadMs: Math.max(700, settings.paddingBeforeMs),
    actionTailMs: Math.max(1_800, settings.paddingAfterMs),
    mergeGapMs: Math.max(2_200, settings.idleThresholdMs),
  },
);
const segments = sceneSegments.map((scene) => ({
  start: scene.startMs / 1000,
  end: scene.endMs / 1000,
  speed: 1,
  reasons: scene.reasons,
}));
const filters = [];
const concatInputs = [];
segments.forEach((segment, index) => {
  filters.push(
    `[0:v]trim=start=${segment.start.toFixed(3)}:end=${segment.end.toFixed(3)},` +
      `setpts=PTS-STARTPTS[v${index}]`,
  );
  if (hasAudio) {
    filters.push(
      `[0:a]atrim=start=${segment.start.toFixed(3)}:end=${segment.end.toFixed(3)},` +
        `asetpts=PTS-STARTPTS[a${index}]`,
    );
    concatInputs.push(`[v${index}][a${index}]`);
  } else {
    concatInputs.push(`[v${index}]`);
  }
});
if (hasAudio) {
  filters.push(
    `${concatInputs.join("")}concat=n=${segments.length}:v=1:a=1[joinedv][outa]`,
  );
  filters.push(
    "[joinedv]fps=60,scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p[outv]",
  );
} else {
  filters.push(
    `${concatInputs.join("")}concat=n=${segments.length}:v=1:a=0,` +
      "fps=60,scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p[outv]",
  );
}

await mkdir(dirname(outputPath), { recursive: true });
const ffmpegArgs = [
  "-y",
  "-i",
  inputPath,
  "-filter_complex",
  filters.join(";"),
  "-map",
  "[outv]",
];
if (hasAudio) {
  ffmpegArgs.push("-map", "[outa]", "-c:a", "aac", "-b:a", "192k");
} else {
  ffmpegArgs.push("-an");
}
ffmpegArgs.push(
  "-c:v",
  "libx264",
  "-preset",
  "medium",
  "-crf",
  "18",
  "-movflags",
  "+faststart",
  outputPath,
);
await run("ffmpeg", ffmpegArgs);

const keptSeconds = segments.reduce(
  (sum, segment) => sum + (segment.end - segment.start),
  0,
);
const outputProbe = JSON.parse(await run(
  "ffprobe",
  [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "json",
    outputPath,
  ],
  { capture: true },
));
const finalSeconds = Number(outputProbe.format?.duration) || keptSeconds;
const report = {
  input: inputPath,
  metadata: metadataPath,
  output: outputPath,
  mode: "cut",
  originalDurationSeconds: Number(duration.toFixed(3)),
  keptDurationSeconds: Number(keptSeconds.toFixed(3)),
  finalDurationSeconds: Number(finalSeconds.toFixed(3)),
  savedSeconds: Number((duration - finalSeconds).toFixed(3)),
  audioPreserved: hasAudio,
  segments,
};
const processedMetadata = {
  ...remapSceneTimeline(metadata, sceneSegments),
  processing: {
    ...metadata.processing,
    sceneModel: "semantic-v1",
    idleSpeed: 1,
    mode: "cut",
  },
  processingResult: report,
};
const actualDurationMs = Math.round(finalSeconds * 1000);
const durationCorrectionMs = actualDurationMs - processedMetadata.durationMs;
processedMetadata.durationMs = actualDurationMs;
const lastSourceSegment = processedMetadata.sourceSegments?.at(-1);
if (lastSourceSegment) {
  lastSourceSegment.durationMs = Math.max(
    1,
    lastSourceSegment.durationMs + durationCorrectionMs,
  );
}
const stopEvent = processedMetadata.events
  .find((event) => event.kind === "recording-stop");
if (stopEvent) stopEvent.tMs = actualDurationMs;
await writeFile(
  outputPath.replace(/\.mp4$/i, ".timeline.json"),
  JSON.stringify(processedMetadata, null, 2),
);
await writeFile(
  outputPath.replace(/\.mp4$/i, ".processing.json"),
  JSON.stringify(report, null, 2),
);

console.log(
  `处理完成：${duration.toFixed(1)} 秒 → ${finalSeconds.toFixed(1)} 秒（仅剪辑，保留片段均为 1×）`,
);
console.log(`成片：${outputPath}`);
