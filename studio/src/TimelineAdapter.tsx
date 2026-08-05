import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from 'react';
import { Timeline, type TimelineState } from '@xzdarcy/react-timeline-editor';
import type { TimelineRow } from '@xzdarcy/timeline-engine';
import type { DemoCaption, RecordedEvent } from './types';
import { zoomSegments } from './visuals';

export type TimelineAdapterRef = { seek: (time: number) => void };
export const TimelineAdapter = forwardRef<TimelineAdapterRef, { duration: number; currentTime: number; events: RecordedEvent[]; captions: DemoCaption[]; showFocus: boolean; onSeek: (time: number) => void }>(({ duration, currentTime, events, captions, showFocus, onSeek }, ref) => {
  const editorRef = useRef<TimelineState>(null);
  const rows = useMemo<TimelineRow[]>(() => {
    const videoRow = { id: 'video', actions: [{ id: 'clip', start: 0, end: duration, effectId: 'video', movable: false, flexible: false }], classNames: ['studio-video-row'] };
    const focusRow = { id: 'focus', actions: zoomSegments(events, duration).map((segment, index) => ({ id: `focus-${index}`, start: segment.start, end: segment.end, effectId: 'focus', movable: false, flexible: false })), classNames: ['studio-focus-row'] };
    const captionRow = { id: 'captions', actions: captions.map((caption) => ({ id: caption.id, start: caption.start, end: caption.end, effectId: 'caption', movable: false, flexible: false })), classNames: ['studio-caption-row'] };
    const eventRow = { id: 'actions', actions: events.filter((event) => ['click', 'focus', 'input', 'scroll'].includes(event.kind)).map((event, index) => ({ id: `event-${index}`, start: event.tMs / 1000, end: Math.min(duration, event.tMs / 1000 + .11), effectId: event.kind, movable: false, flexible: false })), classNames: ['studio-event-row'] };
    return [videoRow, showFocus ? focusRow : { ...focusRow, actions: [] }, captionRow, eventRow] as TimelineRow[];
  }, [captions, duration, events, showFocus]);
  useEffect(() => { editorRef.current?.setTime(currentTime); }, [currentTime]);
  useImperativeHandle(ref, () => ({ seek: (time) => editorRef.current?.setTime(time) }));
  return <div className="timeline-adapter h-full overflow-hidden" aria-label="时间轴"><Timeline ref={editorRef} editorData={rows} effects={{ video: { id: 'video' }, focus: { id: 'focus' }, caption: { id: 'caption' }, move: { id: 'move' }, click: { id: 'click' }, input: { id: 'input' }, scroll: { id: 'scroll' }, page: { id: 'page' } }} style={{ width: '100%', height: '100%' }} scale={1} scaleWidth={92} minScaleCount={Math.max(5, Math.ceil(duration))} maxScaleCount={Math.max(5, Math.ceil(duration))} startLeft={0} rowHeight={28} disableDrag enableRowDrag={false} autoReRender={false} getScaleRender={(scale) => <span>{scale.toFixed(0)}s</span>} getActionRender={(action, row) => {
    if (row.id === 'video') return <div className="mx-0.5 mt-[3px] flex h-[22px] items-center rounded-md bg-white/[.08] px-2 text-[10px] text-[#c4c4c4] shadow-[inset_0_1px_0_rgba(255,255,255,.09)]">屏幕录制</div>;
    if (row.id === 'focus') return <div className="mt-[11px] h-[5px] rounded-full bg-white/40" />;
    if (row.id === 'captions') return <div className="mx-0.5 mt-[7px] h-3.5 rounded bg-white/[.1] px-1 text-[8px] leading-[14px] text-[#b0b0b0] shadow-[inset_0_1px_0_rgba(255,255,255,.07)]">说明</div>;
    if (action.effectId === 'click') return <div className="mx-auto mt-[7px] h-3.5 w-[3px] rounded-full bg-[#f5f5f5]" />;
    const marker = action.effectId === 'focus' ? 'bg-white/55' : action.effectId === 'input' ? 'bg-white/30' : 'bg-white/[.18]';
    return <div className={`mx-auto mt-2 h-3 w-px rounded-full ${marker}`} />;
  }} onClickTimeArea={(time) => { onSeek(Math.max(0, Math.min(duration, time))); return false; }} onClickAction={(_, item) => onSeek(item.time)} /></div>;
});
TimelineAdapter.displayName = 'TimelineAdapter';
