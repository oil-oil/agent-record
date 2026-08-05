import { AbsoluteFill, Freeze, OffthreadVideo, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { MousePointer2, Pointer, SlidersHorizontal } from 'lucide-react';
import type { DemoCaption, RecordedEvent, SourceSegment, StudioStyle } from './types';
import { cameraAt, clickCursorAt, cursorAt, getBackground, pointOf, zoomAt } from './visuals';
import { BROWSER_SHELL_COLORS, BROWSER_SHELL_METRICS, browserAddressLabel } from './browser-shell';
import { activeCaptions, captionMotion } from './captions';
import { CAPTION_STYLE } from './caption-style';
import { segmentAddressAt, segmentTransitionAt } from './segment-transitions';

export type CompositionProps = {
  src: string;
  style: StudioStyle;
  events: RecordedEvent[];
  sourceSegments?: SourceSegment[];
  captions?: DemoCaption[];
  durationInFrames?: number;
  fps?: number;
  width?: number;
  height?: number;
};

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

type MediaLayerProps = Pick<CompositionProps, 'style' | 'events'> & {
  mediaSource: string;
  contentWidth: number;
  contentHeight: number;
  renderedWidth: number;
  renderedHeight: number;
  baseX: number;
  baseY: number;
};

function MediaLayer({
  style,
  events,
  mediaSource,
  contentWidth,
  contentHeight,
  renderedWidth,
  renderedHeight,
  baseX,
  baseY,
}: MediaLayerProps) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const time = frame / fps;
  const active = zoomAt(events, time, style.zoom);
  const cursorPoint = pointOf(cursorAt(events, time));
  const cameraPoint = pointOf(active.event) ?? cameraAt(events, active.cameraTime) ?? cursorPoint ?? { x: .5, y: .5 };
  const scale = 1 + active.amount;
  const panProgress = style.zoom > 1 ? active.amount / (style.zoom - 1) : 0;
  const cameraX = baseX + cameraPoint.x * renderedWidth;
  const cameraY = baseY + cameraPoint.y * renderedHeight;
  const translateX = clamp(
    (contentWidth * .5 - cameraX * style.zoom) * panProgress,
    contentWidth - (baseX + renderedWidth) * scale,
    -baseX * scale,
  );
  const translateY = clamp(
    (contentHeight * .5 - cameraY * style.zoom) * panProgress,
    contentHeight - (baseY + renderedHeight) * scale,
    -baseY * scale,
  );
  const mediaStyle = {
    position: 'absolute' as const,
    left: 0,
    top: 0,
    width: renderedWidth,
    height: renderedHeight,
    objectFit: 'fill' as const,
    transformOrigin: '0 0',
    transform: `translate3d(${baseX * scale + translateX}px, ${baseY * scale + translateY}px, 0) scale(${scale})`,
  };
  if (!mediaSource) {
    return <div style={{ ...mediaStyle, background: '#f4f4f2' }} />;
  }
  return <OffthreadVideo src={mediaSource} crossOrigin="anonymous" style={mediaStyle} />;
}

function Cursor({ style, left, top, unit, handAmount, pressAmount, opacity }: Pick<CompositionProps, 'style'> & { left: number; top: number; unit: number; handAmount: number; pressAmount: number; opacity: number }) {
  const base = { position: 'absolute' as const, left, top, width: style.cursorSize * unit, height: style.cursorSize * unit };
  const clickScale = 1 + handAmount * .1;
  const pressScale = clickScale * (1 - pressAmount * .08);
  const pressY = pressAmount * 2.4 * unit;
  if (style.cursor === 'dot') return <div style={{ ...base, opacity, border: `${2 * unit}px solid #121318`, background: '#fff', borderRadius: '999px', transform: `translate(-50%, -50%) translateY(${pressY}px) scale(${pressScale})` }} />;
  if (style.cursor === 'ring') return <div style={{ ...base, opacity, border: `${3 * unit}px solid #fff`, borderRadius: '999px', boxShadow: `0 ${unit}px ${6 * unit}px #0008`, transform: `translate(-50%, -50%) translateY(${pressY}px) scale(${pressScale})` }} />;
  if (style.cursor === 'highlight') return <div style={{ ...base, opacity, borderRadius: '999px', background: 'rgba(255,220,78,.36)', boxShadow: 'inset 0 0 0 5px rgba(255,235,128,.68)', transform: `translate(-50%, -50%) translateY(${pressY}px) scale(${pressScale})` }} />;
  return <>
    <MousePointer2
      strokeWidth={2.4}
      style={{
        ...base,
        color: '#fff',
        fill: '#151515',
        filter: 'drop-shadow(0 2px 3px #0009)',
        opacity: opacity * (1 - handAmount),
        transform: `translate(-14%, -14%) scale(${clickScale})`,
        transformOrigin: '14% 14%',
      }}
    />
    <span style={{
      ...base,
      opacity: opacity * handAmount,
      transformOrigin: '33.3% 8.3%',
      transform: `translate(-33.3%, -8.3%) translateY(${pressY}px) scale(${pressScale})`,
      filter: `drop-shadow(0 ${Math.max(.7, 2 - pressAmount) * unit}px ${Math.max(1.5, 3 - pressAmount) * unit}px rgba(0,0,0,.62))`,
    }}>
      <Pointer strokeWidth={4.8} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', color: '#151515' }} />
      <Pointer strokeWidth={2.15} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', color: '#fff' }} />
    </span>
  </>;
}

function CaptionOverlay({ caption, time, chrome, unit }: { caption: DemoCaption; time: number; chrome: number; unit: number }) {
  const [vertical, horizontal] = caption.position.split('-') as ['top' | 'bottom', 'left' | 'center' | 'right'];
  const motion = captionMotion(caption, time);
  const horizontalStyle = horizontal === 'left'
    ? { left: CAPTION_STYLE.horizontalOffset * unit }
    : horizontal === 'right'
      ? { right: CAPTION_STYLE.horizontalOffset * unit }
      : { left: '50%', marginLeft: 0 };
  const verticalStyle = vertical === 'top'
    ? { top: chrome + CAPTION_STYLE.verticalOffset * unit }
    : { bottom: CAPTION_STYLE.verticalOffset * unit };
  const translateX = horizontal === 'center' ? '-50%' : '0';
  const slideX = (1 - motion.text) * -10 * unit;
  const exitY = (1 - motion.exit) * 3 * unit;
  return <div style={{
    position: 'absolute',
    zIndex: 4,
    maxWidth: CAPTION_STYLE.maxTextWidth * unit,
    padding: `${CAPTION_STYLE.verticalPadding * unit}px ${CAPTION_STYLE.horizontalPadding * unit}px`,
    borderRadius: CAPTION_STYLE.borderRadius * unit,
    border: `${unit}px solid rgba(255,255,255,.1)`,
    background: 'rgba(20,20,20,.84)',
    color: '#fff',
    boxShadow: `0 ${10 * unit}px ${30 * unit}px rgba(0,0,0,.22)`,
    backdropFilter: `blur(${14 * unit}px)`,
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif',
    fontSize: CAPTION_STYLE.fontSize * unit,
    fontWeight: 600,
    lineHeight: 1.38,
    letterSpacing: '-0.012em',
    whiteSpace: 'pre-wrap',
    opacity: motion.opacity,
    clipPath: `inset(0 ${(1 - motion.reveal) * 100}% 0 0 round ${CAPTION_STYLE.borderRadius * unit}px)`,
    transform: `translate3d(calc(${translateX} + ${slideX}px), ${exitY}px, 0)`,
    transformOrigin: `${horizontal} ${vertical}`,
    ...horizontalStyle,
    ...verticalStyle,
  }}>
    <span style={{ opacity: motion.text }}>{caption.text}</span>
  </div>;
}

function BrowserChrome({ address, addressOpacity, addressTranslateX, unit }: {
  address?: string;
  addressOpacity: number;
  addressTranslateX: number;
  unit: number;
}) {
  const metrics = BROWSER_SHELL_METRICS;
  return <div style={{
    height: metrics.height * unit,
    display: 'flex',
    alignItems: 'center',
    position: 'relative',
    background: BROWSER_SHELL_COLORS.toolbar,
    borderBottom: `${unit}px solid ${BROWSER_SHELL_COLORS.separator}`,
  }}>
    {['#ff5f57', '#febc2e', '#28c840'].map((colour, index) => <i key={colour} style={{
      position: 'absolute',
      left: (metrics.trafficLightStartX + index * metrics.trafficLightGap) * unit,
      top: '50%',
      width: metrics.trafficLightDiameter * unit,
      height: metrics.trafficLightDiameter * unit,
      borderRadius: '50%',
      background: colour,
      boxShadow: `inset 0 0 0 ${unit}px rgba(0,0,0,.06)`,
      transform: 'translateY(-50%)',
    }} />)}
    <div style={{
      position: 'absolute',
      left: metrics.addressX * unit,
      right: metrics.addressRight * unit,
      top: metrics.addressY * unit,
      height: metrics.addressHeight * unit,
      borderRadius: metrics.addressRadius * unit,
      display: 'flex',
      alignItems: 'center',
      background: BROWSER_SHELL_COLORS.address,
      color: BROWSER_SHELL_COLORS.addressText,
      boxShadow: `inset 0 0 0 ${unit}px rgba(60,64,67,.07), inset 0 ${unit}px ${unit}px rgba(255,255,255,.72)`,
      overflow: 'hidden',
    }}>
      <SlidersHorizontal
        strokeWidth={1.8}
        style={{
          position: 'absolute',
          left: (metrics.addressIconX - metrics.addressX - 7) * unit,
          width: 14 * unit,
          height: 14 * unit,
          color: BROWSER_SHELL_COLORS.addressIcon,
        }}
      />
      <span style={{
        marginLeft: (metrics.addressTextX - metrics.addressX) * unit,
        marginRight: 12 * unit,
        minWidth: 0,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        fontFamily: 'Arial, "Helvetica Neue", -apple-system, BlinkMacSystemFont, sans-serif',
        fontWeight: 400,
        fontSize: 12 * unit,
        lineHeight: 1,
        letterSpacing: 0,
        opacity: addressOpacity,
        transform: `translateX(${addressTranslateX * unit}px)`,
      }}>{browserAddressLabel(address)}</span>
    </div>
  </div>;
}

export function VideoComposition({ src, style, events, sourceSegments = [], captions = [] }: CompositionProps) {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const unit = width / 1280;
  const time = frame / fps;
  const segmentTransition = segmentTransitionAt(sourceSegments, time, events);
  const browserAddress = segmentAddressAt(sourceSegments, time, style.browserUrl, events);
  const active = zoomAt(events, time, style.zoom);
  const clickCursor = clickCursorAt(events, time);
  const cursorPoint = pointOf(cursorAt(events, time));
  const cameraPoint = pointOf(active.event) ?? cameraAt(events, active.cameraTime) ?? cursorPoint ?? { x: .5, y: .5 };
  const chrome = style.shell === 'browser' ? BROWSER_SHELL_METRICS.height * unit : 0;
  const padding = style.shell === 'none' ? 0 : style.padding * unit;
  const contentWidth = width - padding * 2;
  const contentHeight = height - padding * 2 - chrome;
  const sourceEvent = events.find((event) => Number(event.viewportWidth) > 0 && Number(event.viewportHeight) > 0);
  const sourceAspect = sourceEvent ? sourceEvent.viewportWidth! / sourceEvent.viewportHeight! : 16 / 9;
  const contentAspect = contentWidth / contentHeight;
  const renderedWidth = sourceAspect >= contentAspect ? contentHeight * sourceAspect : contentWidth;
  const renderedHeight = sourceAspect >= contentAspect ? contentHeight : contentWidth / sourceAspect;
  const baseX = (contentWidth - renderedWidth) / 2;
  const baseY = (contentHeight - renderedHeight) / 2;
  const scale = 1 + active.amount;
  const panProgress = style.zoom > 1 ? active.amount / (style.zoom - 1) : 0;
  const cameraX = baseX + cameraPoint.x * renderedWidth;
  const cameraY = baseY + cameraPoint.y * renderedHeight;
  const translateX = clamp(
    (contentWidth * .5 - cameraX * style.zoom) * panProgress,
    contentWidth - (baseX + renderedWidth) * scale,
    -baseX * scale,
  );
  const translateY = clamp(
    (contentHeight * .5 - cameraY * style.zoom) * panProgress,
    contentHeight - (baseY + renderedHeight) * scale,
    -baseY * scale,
  );
  const cursorLeft = cursorPoint ? (baseX + cursorPoint.x * renderedWidth) * scale + translateX : 0;
  const cursorTop = cursorPoint ? chrome + (baseY + cursorPoint.y * renderedHeight) * scale + translateY : 0;
  const mediaSource = src.startsWith('glidetake-input/') ? staticFile(src) : src;
  const revealOriginX = clamp((baseX + segmentTransition.originX * renderedWidth) / contentWidth, .02, .98);
  const revealOriginY = clamp((baseY + segmentTransition.originY * renderedHeight) / contentHeight, .02, .98);
  const revealProgress = segmentTransition.progress;
  const revealTop = (1 - revealProgress) * revealOriginY * 100;
  const revealRight = (1 - revealProgress) * (1 - revealOriginX) * 100;
  const revealBottom = (1 - revealProgress) * (1 - revealOriginY) * 100;
  const revealLeft = (1 - revealProgress) * revealOriginX * 100;
  const revealRadius = (1 - revealProgress) * 18 * unit;
  const mediaLayerProps: MediaLayerProps = {
    style,
    events,
    mediaSource,
    contentWidth,
    contentHeight,
    renderedWidth,
    renderedHeight,
    baseX,
    baseY,
  };
  return <AbsoluteFill style={{ background: getBackground(style), overflow: 'hidden' }}>
    <div style={{ position: 'absolute', inset: padding, overflow: 'hidden', borderRadius: style.shell === 'none' ? 0 : style.radius * unit, background: '#fff', border: style.shell === 'none' ? 'none' : `${unit}px solid rgba(24,24,27,.12)`, boxShadow: style.shell === 'none' ? 'none' : `0 ${style.shadow * .28 * unit}px ${style.shadow * unit}px rgba(0,0,0,.24)` }}>
      {style.shell === 'browser' && <BrowserChrome address={browserAddress} addressOpacity={segmentTransition.addressOpacity} addressTranslateX={segmentTransition.addressTranslateX} unit={unit} />}
      <div style={{ position: 'absolute', inset: `${chrome}px 0 0`, overflow: 'hidden', background: '#fff' }}>
        {segmentTransition.active && segmentTransition.boundaryTime !== null && <div style={{ position: 'absolute', inset: 0 }}>
          <Freeze frame={Math.max(0, Math.round(segmentTransition.boundaryTime * fps) - 1)}>
            <MediaLayer {...mediaLayerProps} />
          </Freeze>
        </div>}
        <div style={{
          position: 'absolute',
          inset: 0,
          clipPath: segmentTransition.active
            ? `inset(${revealTop}% ${revealRight}% ${revealBottom}% ${revealLeft}% round ${revealRadius}px)`
            : 'none',
          transformOrigin: `${revealOriginX * 100}% ${revealOriginY * 100}%`,
          transform: segmentTransition.active ? `scale(${.96 + revealProgress * .04})` : 'none',
          willChange: segmentTransition.active ? 'clip-path, transform' : 'auto',
        }}>
          <MediaLayer {...mediaLayerProps} />
        </div>
      </div>
      {cursorPoint && <Cursor style={style} left={cursorLeft} top={cursorTop} unit={unit} handAmount={clickCursor.handAmount} pressAmount={clickCursor.pressAmount} opacity={segmentTransition.opacity} />}
      {activeCaptions(captions, time).map((caption) => <CaptionOverlay key={caption.id} caption={caption} time={time} chrome={chrome} unit={unit} />)}
    </div>
  </AbsoluteFill>;
}
