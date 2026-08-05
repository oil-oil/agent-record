import { Composition, registerRoot } from 'remotion';
import { VideoComposition } from './VideoComposition';
import type { DemoCaption, RecordedEvent, StudioStyle } from './types';

const events: RecordedEvent[] = [
  { kind: 'recording-start', tMs: 0 },
  { kind: 'page', tMs: 0, nx: 0.5, ny: 0.5 },
  { kind: 'move', tMs: 260, nx: 0.365, ny: 0.075 },
  { kind: 'click', tMs: 1000, nx: 0.365, ny: 0.075 },
  { kind: 'move', tMs: 1680, nx: 0.5, ny: 0.48 },
  { kind: 'click', tMs: 2000, nx: 0.5, ny: 0.48 },
  { kind: 'scroll', tMs: 2100, nx: 0.5, ny: 0.52 },
  { kind: 'move', tMs: 4420, nx: 0.5, ny: 0.66 },
  { kind: 'click', tMs: 5100, nx: 0.5, ny: 0.66 },
  { kind: 'scroll', tMs: 5300, nx: 0.5, ny: 0.66 },
  { kind: 'move', tMs: 7420, nx: 0.43, ny: 0.56 },
  { kind: 'click', tMs: 8300, nx: 0.43, ny: 0.56 },
  { kind: 'scroll', tMs: 8500, nx: 0.43, ny: 0.56 },
  { kind: 'move', tMs: 10500, nx: 0.67, ny: 0.62 },
  { kind: 'recording-stop', tMs: 12000 },
];

const style: StudioStyle = {
  backgroundPreset: 'glass-sunrise',
  backgroundColor: '#e7e7e2',
  shell: 'browser',
  browserUrl: 'example.com',
  padding: 40,
  radius: 18,
  shadow: 24,
  zoom: 1.2,
  cursor: 'studio',
  cursorSize: 30,
  exportResolution: '4k',
};
const captions: DemoCaption[] = [];

function RemotionRoot() {
  return (
    <Composition
      id="EasyDemo4K"
      component={VideoComposition}
      durationInFrames={720}
      fps={60}
      width={3840}
      height={2160}
      calculateMetadata={({ props }) => ({
        durationInFrames: props.durationInFrames ?? 720,
        fps: props.fps ?? 60,
        width: props.width ?? 3840,
        height: props.height ?? 2160,
      })}
      defaultProps={{
        src: '',
        style,
        events,
        sourceSegments: [],
        captions,
        durationInFrames: 720,
        fps: 60,
        width: 3840,
        height: 2160,
      }}
    />
  );
}

registerRoot(RemotionRoot);
