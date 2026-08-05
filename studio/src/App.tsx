import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type SyntheticEvent } from 'react';
import { Player, type PlayerRef } from '@remotion/player';
import { AppWindow, Circle, Download, Focus, Image, MousePointer2, Play, Plus, Square, Trash2, Type, Upload } from 'lucide-react';
import { DropdownMenu, ScrollArea, Switch } from 'radix-ui';
import { VideoComposition } from './VideoComposition';
import { DEFAULT_CAPTION_POSITION } from './caption-style';
import { Button, ChoiceGroup, ChoiceItem } from './ui';
import { defaultProject, defaultStyle, type BackgroundPreset, type CursorStyle, type DemoCaption, type DemoCaptionPosition, type ExportResolution, type RecordedEvent, type ShellMode, type SourceSegment, type StudioProject, type StudioStyle } from './types';
import { wallpaperById, wallpapers } from './visuals';
import { durationSecondsFromMedia, durationSecondsFromTimeline, preferredDurationSeconds } from './media-duration';

const fps = 30;
const TimelineAdapter = lazy(() => import('./TimelineAdapter').then((module) => ({ default: module.TimelineAdapter })));
const startupParams = new URLSearchParams(location.search);
const hasStartupSource = ['project', 'video', 'timeline'].some((key) => startupParams.has(key));
const formatTime = (seconds: number) => `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${(seconds % 60).toFixed(1).padStart(4, '0')}`;
const titleFrom = (src?: string) => src ? decodeURIComponent(src.split('/').pop() || '录制文件').replace(/\.[^/.]+$/, '') : 'Demo 项目';
const exportSizes: Record<ExportResolution, { width: number; height: number }> = { '720p': { width: 1280, height: 720 }, '1080p': { width: 1920, height: 1080 }, '2k': { width: 2560, height: 1440 }, '4k': { width: 3840, height: 2160 } };
const lookPresets = [
  { id: 'studio', name: '工作室', style: { backgroundPreset: 'glass-sunrise', backgroundColor: '#e7e7e2', shell: 'browser', padding: 40, radius: 18, shadow: 24 } },
  { id: 'editorial', name: '编辑部', style: { backgroundPreset: 'desktop-coast', backgroundColor: '#e7e3db', shell: 'browser', padding: 48, radius: 12, shadow: 18 } },
  { id: 'pop', name: '波普', style: { backgroundPreset: 'abstract-ribbon', backgroundColor: '#f0ded6', shell: 'browser', padding: 40, radius: 10, shadow: 28 } },
  { id: 'minimal', name: '极简', style: { backgroundPreset: 'solid', backgroundColor: '#dedbd2', shell: 'card', padding: 48, radius: 8, shadow: 16 } },
] satisfies { id: string; name: string; style: Partial<StudioStyle> }[];
const featuredBackgrounds = [
  'glass-sunrise',
  'desktop-coast',
  'abstract-ribbon',
  'cosmic-orbit',
  'apple-cream-blue',
  'apple-warm-silver',
  'apple-coral-pink',
  'apple-prismatic',
  'apple-coastal-blue',
] satisfies Exclude<BackgroundPreset, 'solid'>[];
const browserAssetUrl = (src: string) => new URL(src.replace(/^\//, ''), document.baseURI).toString();
const projectAssetUrl = (src: string) => /^(?:https?:|blob:|data:|\/)/.test(src) ? src : `/${src}`;
const previewBackground = (preset: BackgroundPreset, color = '#dedbd2') => preset === 'solid'
  ? color
  : `url("${browserAssetUrl(wallpaperById[preset].previewSrc ?? wallpaperById[preset].src)}") center / cover`;
const framePresets = [
  { id: 'compact', label: '紧凑', style: { padding: 24, radius: 12, shadow: 18 } },
  { id: 'balanced', label: '标准', style: { padding: 40, radius: 18, shadow: 24 } },
  { id: 'gallery', label: '展台', style: { padding: 72, radius: 20, shadow: 30 } },
] satisfies { id: string; label: string; style: Partial<StudioStyle> }[];
const focusPresets = [
  { value: 1.12, label: '轻柔' },
  { value: 1.2, label: '标准' },
  { value: 1.3, label: '强调' },
];
const cursorSizePresets = [
  { value: 26, label: '轻巧' },
  { value: 30, label: '标准' },
  { value: 36, label: '醒目' },
];
const captionDurations = [
  { value: 2.5, label: '简短' },
  { value: 3.5, label: '标准' },
  { value: 5, label: '从容' },
];

export default function App() {
  const playerRef = useRef<PlayerRef>(null);
  const videoInput = useRef<HTMLInputElement>(null);
  const traceInput = useRef<HTMLInputElement>(null);
  const currentFrameRef = useRef(0);
  const lastUiFrameRef = useRef(-3);
  const localVideoUrlRef = useRef<string | undefined>(undefined);
  const loadControllerRef = useRef<AbortController | null>(null);
  const [project, setProject] = useState<StudioProject>(defaultProject);
  const [source, setSource] = useState<string>();
  const [events, setEvents] = useState<RecordedEvent[]>([]);
  const [sourceSegments, setSourceSegments] = useState<SourceSegment[]>([]);
  const [mediaDuration, setMediaDuration] = useState<number>();
  const [timelineDuration, setTimelineDuration] = useState<number>();
  const [currentFrame, setCurrentFrame] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [focusEnabled, setFocusEnabled] = useState(true);
  const [initializing, setInitializing] = useState(hasStartupSource);
  const [notice, setNotice] = useState('');
  const [exporting, setExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [inspectorTab, setInspectorTab] = useState<'canvas' | 'motion' | 'captions'>('canvas');

  const duration = preferredDurationSeconds(timelineDuration, mediaDuration);
  const currentTime = currentFrame / fps;
  const durationInFrames = Math.max(1, Math.round(duration * fps));
  const compositionStyle = useMemo(() => ({ ...project.style, zoom: focusEnabled ? project.style.zoom : 1 }), [focusEnabled, project.style]);
  const currentBackgroundName = project.style.backgroundPreset === 'solid' ? '纸张灰' : wallpapers.find((wallpaper) => wallpaper.id === project.style.backgroundPreset)?.name ?? '背景';
  const exportSize = exportSizes['720p'];
  const currentLook = lookPresets.find((preset) => Object.entries(preset.style).every(([key, value]) => project.style[key as keyof StudioStyle] === value))?.id;
  const currentFramePreset = framePresets.find((preset) => preset.style.padding === project.style.padding && preset.style.radius === project.style.radius && preset.style.shadow === project.style.shadow)?.id;
  const updateStyle = useCallback((next: Partial<StudioStyle>) => setProject((value) => ({ ...value, style: { ...value.style, ...next } })), []);
  const replaceSource = useCallback((next?: string) => {
    setMediaDuration(undefined);
    setSource(next);
  }, []);
  const updateCaption = useCallback((id: string, next: Partial<DemoCaption>) => {
    setProject((value) => ({ ...value, captions: (value.captions ?? []).map((caption) => caption.id === id ? { ...caption, ...next } : caption) }));
  }, []);
  const removeCaption = useCallback((id: string) => {
    setProject((value) => ({ ...value, captions: (value.captions ?? []).filter((caption) => caption.id !== id) }));
  }, []);
  const addCaption = useCallback(() => {
    const start = Math.min(Math.max(0, currentTime), Math.max(0, duration - .4));
    const caption: DemoCaption = {
      id: `caption-${Date.now()}`,
      text: '说明当前操作',
      start: Number(start.toFixed(2)),
      end: Number(Math.min(duration, start + 3).toFixed(2)),
      position: DEFAULT_CAPTION_POSITION,
    };
    setProject((value) => ({ ...value, captions: [...(value.captions ?? []), caption] }));
    setInspectorTab('captions');
  }, [currentTime, duration]);

  const applyTimelineSource = useCallback((sourceUrl?: string) => {
    if (!sourceUrl) return;
    setProject((value) => ({
      ...value,
      style: {
        ...value.style,
        browserUrl: !value.style.browserUrl || value.style.browserUrl === defaultStyle.browserUrl ? sourceUrl : value.style.browserUrl,
      },
    }));
  }, []);

  const beginLoad = useCallback(() => {
    loadControllerRef.current?.abort();
    const controller = new AbortController();
    loadControllerRef.current = controller;
    return controller;
  }, []);
  const loadTimeline = useCallback(async (url: string, signal?: AbortSignal) => {
    const response = await fetch(url, { signal });
    if (!response.ok) throw new Error('无法读取操作轨迹。');
    const data = await response.json() as { durationMs?: number; events?: RecordedEvent[]; source?: { url?: string }; sourceSegments?: SourceSegment[] };
    if (!Array.isArray(data.events)) throw new Error('操作轨迹格式不正确。');
    if (signal?.aborted) return;
    setEvents(data.events.filter((item) => Number.isFinite(item.tMs)));
    setSourceSegments(Array.isArray(data.sourceSegments) ? data.sourceSegments : []);
    setTimelineDuration(durationSecondsFromTimeline(data));
    applyTimelineSource(data.source?.url);
    setNotice('');
  }, [applyTimelineSource]);

  const loadProject = useCallback(async (url: string, signal?: AbortSignal) => {
    const response = await fetch(url, { signal });
    if (!response.ok) throw new Error('无法读取项目配置。');
    const data = await response.json() as Partial<StudioProject>;
    if (data.schemaVersion !== 1) throw new Error('项目配置版本不支持。');
    if (signal?.aborted) return;
    const next = { ...defaultProject, ...data, style: { ...defaultStyle, ...data.style }, captions: Array.isArray(data.captions) ? data.captions : [] } as StudioProject;
    setProject(next);
    if (next.timeline) await loadTimeline(projectAssetUrl(next.timeline), signal);
    else setTimelineDuration(undefined);
    if (!signal?.aborted && next.video) replaceSource(projectAssetUrl(next.video));
  }, [loadTimeline, replaceSource]);

  useEffect(() => {
    const projectUrl = startupParams.get('project');
    const videoUrl = startupParams.get('video');
    const timelineUrl = startupParams.get('timeline');
    const controller = beginLoad();
    (async () => {
      try {
        if (projectUrl) await loadProject(projectUrl, controller.signal);
        else {
          if (controller.signal.aborted) return;
          if (timelineUrl) await loadTimeline(projectAssetUrl(timelineUrl), controller.signal);
          else setTimelineDuration(undefined);
          if (videoUrl && !controller.signal.aborted) {
            replaceSource(projectAssetUrl(videoUrl));
            setProject((value) => ({ ...value, name: titleFrom(videoUrl) }));
          }
        }
      } catch (error) {
        if (!controller.signal.aborted) setNotice(error instanceof Error ? error.message : '加载失败。');
      } finally {
        if (!controller.signal.aborted) setInitializing(false);
      }
    })();
    return () => controller.abort();
  }, [beginLoad, loadProject, loadTimeline, replaceSource]);

  useEffect(() => {
    const player = playerRef.current;
    if (!player) return;
    const onFrame = ({ detail }: { detail: { frame: number } }) => {
      currentFrameRef.current = detail.frame;
      if (Math.abs(detail.frame - lastUiFrameRef.current) >= 3) {
        lastUiFrameRef.current = detail.frame;
        setCurrentFrame(detail.frame);
      }
    };
    const onPlay = () => setPlaying(true);
    const onPause = () => {
      setPlaying(false);
      setCurrentFrame(currentFrameRef.current);
    };
    player.addEventListener('frameupdate', onFrame);
    player.addEventListener('play', onPlay);
    player.addEventListener('pause', onPause);
    return () => {
      player.removeEventListener('frameupdate', onFrame);
      player.removeEventListener('play', onPlay);
      player.removeEventListener('pause', onPause);
    };
  }, [source]);

  useEffect(() => {
    if (!playing) return;
    let last = currentFrameRef.current;
    const watch = window.setInterval(() => {
      if (last === currentFrameRef.current) {
        playerRef.current?.pause();
      }
      last = currentFrameRef.current;
    }, 1300);
    return () => clearInterval(watch);
  }, [playing]);

  useEffect(() => {
    (window as Window & { __EASY_DEMO_STUDIO__?: unknown }).__EASY_DEMO_STUDIO__ = {
      getConfig: () => ({ ...project, video: source, timeline: project.timeline }),
      applyConfig: (value: Partial<StudioProject>) => {
        const controller = beginLoad();
        setProject((item) => ({ ...item, ...value, style: { ...item.style, ...value.style } }));
        if (value.timeline) {
          void loadTimeline(projectAssetUrl(value.timeline), controller.signal)
            .then(() => {
              if (value.video && !controller.signal.aborted) replaceSource(projectAssetUrl(value.video));
            })
            .catch((error) => {
              if (!controller.signal.aborted) setNotice(error instanceof Error ? error.message : '加载失败。');
            });
        } else if (value.video) {
          setTimelineDuration(undefined);
          replaceSource(projectAssetUrl(value.video));
        }
      },
    };
  }, [beginLoad, project, source, loadTimeline, replaceSource]);

  useEffect(() => () => {
    if (localVideoUrlRef.current) URL.revokeObjectURL(localVideoUrlRef.current);
  }, []);

  const importVideo = (file?: File) => {
    if (!file) return;
    beginLoad();
    if (localVideoUrlRef.current) URL.revokeObjectURL(localVideoUrlRef.current);
    localVideoUrlRef.current = URL.createObjectURL(file);
    setTimelineDuration(undefined);
    replaceSource(localVideoUrlRef.current);
    setSourceSegments([]);
    setProject((value) => ({ ...value, name: file.name.replace(/\.[^/.]+$/, '') }));
    setCurrentFrame(0);
    setNotice('');
  };

  const importTrace = async (file?: File) => {
    if (!file) return;
    const controller = beginLoad();
    try {
      const data = JSON.parse(await file.text()) as { durationMs?: number; events?: RecordedEvent[]; source?: { url?: string }; sourceSegments?: SourceSegment[] };
      if (controller.signal.aborted) return;
      if (!Array.isArray(data.events)) throw new Error();
      setEvents(data.events.filter((item) => Number.isFinite(item.tMs)));
      setSourceSegments(Array.isArray(data.sourceSegments) ? data.sourceSegments : []);
      setTimelineDuration(durationSecondsFromTimeline(data));
      applyTimelineSource(data.source?.url);
      setNotice('');
    } catch {
      if (!controller.signal.aborted) setNotice('无法读取操作轨迹。');
    }
  };

  const seek = (time: number) => playerRef.current?.seekTo(Math.round(Math.max(0, Math.min(duration, time)) * fps));
  const togglePlay = () => playerRef.current?.toggle();
  const metadata = (event: SyntheticEvent<HTMLVideoElement>) => {
    const media = event.currentTarget;
    const known = durationSecondsFromMedia(media);
    if (known) {
      setMediaDuration(known);
      return;
    }
    if (timelineDuration) return;
    setNotice('录制文件缺少时长，请同时导入对应的操作轨迹。');
  };
  const onExport = async () => {
    if (!source) return;
    setExporting(true);
    setExportProgress(0);
    setNotice('');
    try {
      const { exportWebm } = await import('./exporter');
      const result = await exportWebm({ src: source, style: { ...compositionStyle, exportResolution: '720p' }, events, sourceSegments, captions: project.captions, onProgress: setExportProgress });
      const blob = result.blob;
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${project.name || 'demo'}-edited.webm`;
      anchor.style.display = 'none';
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      if (result.warning) setNotice(result.warning);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '导出失败。');
    } finally {
      setExporting(false);
    }
  };

  return <div className="studio-shell grid h-[100dvh] min-w-0 grid-rows-[54px_minmax(0,1fr)] overflow-hidden bg-[#0a0a0a] text-[#f5f5f5]">
    <header className="studio-topbar flex h-[54px] items-center gap-4 border-b border-white/[.05] px-5">
      <div className="min-w-0 flex-1 truncate text-[12px] font-medium text-[#e8e8e8]">{project.name}</div>
      {source && <div className="flex items-center gap-1.5">
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild><Button variant="ghost">文件</Button></DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content className="z-20 min-w-40 rounded-lg border border-white/[.08] bg-[#141414] p-1 shadow-[0_12px_32px_rgba(0,0,0,.55)]">
              <DropdownMenu.Item onSelect={() => videoInput.current?.click()} className="cursor-pointer rounded-md px-2.5 py-2 text-[11px] text-[#d8d8d8] outline-none transition-colors hover:bg-white/[.07] data-[highlighted]:bg-white/[.07]">替换录制</DropdownMenu.Item>
              <DropdownMenu.Item onSelect={() => traceInput.current?.click()} className="cursor-pointer rounded-md px-2.5 py-2 text-[11px] text-[#d8d8d8] outline-none transition-colors hover:bg-white/[.07] data-[highlighted]:bg-white/[.07]">替换鼠标轨迹</DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
        <Button variant="primary" loading={exporting} onClick={onExport}>{exporting ? `正在导出预览 ${Math.round(exportProgress * 100)}%` : <><Download className="size-3.5" />导出 720p 预览</>}</Button>
      </div>}
      <input ref={videoInput} onChange={(event) => importVideo(event.target.files?.[0])} type="file" accept="video/webm,video/mp4,video/*" hidden />
      <input ref={traceInput} onChange={(event) => void importTrace(event.target.files?.[0])} type="file" accept=".json,application/json" hidden />
    </header>

    <div className={`studio-workspace grid min-h-0 min-w-0 ${source ? 'has-source grid-cols-[minmax(0,1fr)_minmax(280px,336px)]' : 'grid-cols-1'}`}>
      <main className={`grid min-h-0 min-w-0 ${source ? 'grid-rows-[minmax(0,1fr)_168px]' : 'grid-rows-1'}`}>
        <section className="flex min-h-0 min-w-0 flex-col px-6 pb-0 pt-5">
          <div className="mb-3 flex h-6 shrink-0 items-center justify-between text-[9px] uppercase tracking-[.18em] text-[#5c5c5c]"><span>{source ? '画面预览' : '新建演示'}</span>{source && <span className="font-mono tracking-[.08em]">720P 预览 · {exportSize.width} × {exportSize.height}</span>}</div>
          <div className="preview-stage relative grid min-h-0 min-w-0 flex-1 place-items-center overflow-hidden">
            {source
              ? <Player ref={playerRef} component={VideoComposition} inputProps={{ src: source, style: compositionStyle, events, sourceSegments, captions: project.captions }} durationInFrames={durationInFrames} compositionWidth={1280} compositionHeight={720} fps={fps} controls={false} acknowledgeRemotionLicense showPosterWhenBuffering className="overflow-hidden rounded-[10px] ring-1 ring-white/[.06]" style={{ width: '100%', maxWidth: '100%', maxHeight: '100%', aspectRatio: '16 / 9' }} />
              : initializing
                ? <div className="absolute inset-0 animate-pulse rounded-xl bg-white/[.03]" aria-label="正在打开项目" />
                : <div className="absolute inset-0 grid place-items-center">
                  <div className="flex max-w-xs flex-col items-center text-center">
                    <img src={browserAssetUrl('brand/app-icon.png')} alt="" className="mb-5 size-12" />
                    {notice && <p className="mb-4 text-[12px] leading-5 text-[#8a8a8a]">{notice}</p>}
                    <Button variant="primary" onClick={() => videoInput.current?.click()}><Upload className="size-3.5" />选择文件</Button>
                  </div>
                </div>}
            <video className="hidden" src={source} crossOrigin="anonymous" onLoadedMetadata={metadata} onDurationChange={metadata} />
          </div>
          {source && <div className="flex h-12 shrink-0 items-center justify-center gap-3">
            <Button variant="secondary" size="icon" className="rounded-full" onClick={togglePlay} aria-label={playing ? '暂停' : '播放'}>{playing ? <Square className="size-3 fill-current" /> : <Play className="size-3 fill-current" />}</Button>
            <span className="w-24 font-mono text-[10px] tabular-nums text-[#9a9a9a]">{formatTime(currentTime)} <span className="text-[#4a4a4a]">/</span> {formatTime(duration)}</span>
            {notice && <span className="absolute left-5 max-w-[34%] truncate text-[9px] text-[#6f6f6f]">{notice}</span>}
          </div>}
        </section>

        {source && <section className="flex min-h-0 flex-col border-t border-white/[.05]">
          <div className="flex h-9 shrink-0 items-center gap-3 px-4 text-[9px] text-[#5c5c5c]"><span className="text-[11px] font-medium text-[#d6d6d6]">时间轴</span>{events.length > 0 && <span>{events.length} 个操作</span>}<button type="button" onClick={addCaption} className="ml-auto inline-flex h-6 items-center gap-1 rounded-md bg-white/[.06] px-2 text-[#b5b5b5] shadow-[inset_0_0_0_1px_rgba(255,255,255,.06)] outline-none transition-colors hover:bg-white/[.1] hover:text-white focus-visible:shadow-[0_0_0_2px_#0a0a0a,0_0_0_3.5px_rgba(255,255,255,.35)]"><Type className="size-3" />添加说明</button></div>
          <div className="grid min-h-0 flex-1 grid-cols-[76px_minmax(0,1fr)] overflow-hidden">
            <div className="grid grid-rows-[22px_repeat(4,28px)] border-r border-white/[.04] text-[9px] text-[#5c5c5c]">
              <span />
              <span className="flex items-center px-4">原片</span>
              <span className="flex items-center px-4">{focusEnabled ? '聚焦' : ''}</span>
              <span className="flex items-center px-4">说明</span>
              <span className="flex items-center px-4">操作</span>
            </div>
            <div className="min-h-0 min-w-0 overflow-hidden"><Suspense fallback={<div className="h-full animate-pulse bg-white/[.02]" aria-label="正在加载时间轴" />}><TimelineAdapter duration={duration} currentTime={currentTime} events={events} captions={project.captions ?? []} showFocus={focusEnabled} onSeek={seek} /></Suspense></div>
          </div>
        </section>}
      </main>

      {source && <aside className="min-h-0 border-l border-white/[.05]">
        <ScrollArea.Root className="h-full overflow-hidden">
          <ScrollArea.Viewport className="h-full w-full">
            <div className="sticky top-0 z-10 bg-[#0a0a0a]/90 px-5 pb-3 pt-4 backdrop-blur">
              <div className="grid grid-cols-3 gap-0.5 rounded-[9px] bg-white/[.05] p-0.5 shadow-[inset_0_0_0_1px_rgba(255,255,255,.04)]">
                {([['canvas', '外观'], ['motion', '动效'], ['captions', '说明']] as const).map(([tab, label]) => <button key={tab} type="button" onClick={() => setInspectorTab(tab)} className={`h-8 rounded-[7px] text-[11px] font-medium outline-none transition-[background-color,color,box-shadow] focus-visible:shadow-[0_0_0_2px_#0a0a0a,0_0_0_3.5px_rgba(255,255,255,.35)] ${inspectorTab === tab ? 'bg-[#f5f5f5] text-[#0d0d0d] shadow-[0_1px_2px_rgba(0,0,0,.4),inset_0_1px_0_rgba(255,255,255,.4)]' : 'text-[#8a8a8a] hover:text-[#d6d6d6]'}`}>
                  {label}
                </button>)}
              </div>
            </div>

            <div className="px-5 pb-8 pt-3">
              {inspectorTab === 'canvas' ? <div className="space-y-10">
                <section className="studio-section space-y-3.5">
                  <h3 className="studio-label">整体风格</h3>
                  <div className="grid grid-cols-2 gap-x-3 gap-y-4">
                    {lookPresets.map((preset) => <button key={preset.id} type="button" onClick={() => updateStyle(preset.style)} className="group rounded-lg text-left outline-none">
                      <span className={`relative block h-14 overflow-hidden rounded-md transition-shadow ${currentLook === preset.id ? 'shadow-[0_0_0_2px_#0a0a0a,0_0_0_3.5px_#f5f5f5]' : 'shadow-[0_0_0_1px_rgba(255,255,255,.09)] group-hover:shadow-[0_0_0_1px_rgba(255,255,255,.3)] group-focus-visible:shadow-[0_0_0_2px_#0a0a0a,0_0_0_3.5px_rgba(255,255,255,.35)]'}`} style={{ background: previewBackground(preset.style.backgroundPreset!, preset.style.backgroundColor) }}>
                        <span className="absolute inset-x-[12%] bottom-[12%] top-[18%] border border-black/15 bg-white shadow-sm" />
                      </span>
                      <span className={`mt-2 block text-[11px] font-medium transition-colors ${currentLook === preset.id ? 'text-[#f5f5f5]' : 'text-[#9a9a9a] group-hover:text-[#d6d6d6]'}`}>{preset.name}</span>
                    </button>)}
                  </div>
                </section>

                <section className="studio-section space-y-3.5">
                  <div className="flex items-center justify-between"><h3 className="studio-label">背景</h3><span className="max-w-28 truncate text-[10px] text-[#6f6f6f]">{currentBackgroundName}</span></div>
                  <div className="grid grid-cols-3 gap-2">
                    {featuredBackgrounds.map((id) => {
                      const wallpaper = wallpaperById[id];
                      return <button key={id} type="button" onClick={() => updateStyle({ backgroundPreset: id })} className={`group relative aspect-[8/5] overflow-hidden rounded-md outline-none transition-shadow focus-visible:shadow-[0_0_0_2px_#0a0a0a,0_0_0_3.5px_rgba(255,255,255,.35)] ${project.style.backgroundPreset === id ? 'shadow-[0_0_0_2px_#0a0a0a,0_0_0_3.5px_#f5f5f5]' : 'shadow-[0_0_0_1px_rgba(255,255,255,.08)] hover:shadow-[0_0_0_1px_rgba(255,255,255,.3)]'}`} aria-label={`使用${wallpaper.name}背景`} title={wallpaper.name}>
                        <img src={browserAssetUrl(wallpaper.previewSrc ?? wallpaper.src)} alt="" className="h-full w-full object-cover transition-transform duration-200 ease-out group-hover:scale-[1.04]" />
                      </button>;
                    })}
                    <button type="button" onClick={() => updateStyle({ backgroundPreset: 'solid', backgroundColor: '#dedbd2' })} className={`group relative aspect-[8/5] overflow-hidden rounded-md outline-none transition-shadow focus-visible:shadow-[0_0_0_2px_#0a0a0a,0_0_0_3.5px_rgba(255,255,255,.35)] ${project.style.backgroundPreset === 'solid' ? 'shadow-[0_0_0_2px_#0a0a0a,0_0_0_3.5px_#f5f5f5]' : 'shadow-[0_0_0_1px_rgba(255,255,255,.08)] hover:shadow-[0_0_0_1px_rgba(255,255,255,.3)]'}`} aria-label="使用纸张灰背景" title="纸张灰"><span className="block h-full w-full bg-[#dedbd2] transition-transform duration-200 ease-out group-hover:scale-[1.04]" /></button>
                  </div>
                </section>

                <section className="studio-section space-y-3.5">
                  <h3 className="studio-label">窗口</h3>
                  <ChoiceGroup value={project.style.shell} onChange={(shell) => updateStyle({ shell: shell as ShellMode })}>
                    <ChoiceItem value="browser" label="浏览器"><AppWindow className="size-4" /></ChoiceItem>
                    <ChoiceItem value="card" label="纯容器"><Square className="size-4" /></ChoiceItem>
                    <ChoiceItem value="none" label="无套壳"><Image className="size-4" /></ChoiceItem>
                  </ChoiceGroup>
                  {project.style.shell !== 'none' && <div className="grid grid-cols-3 gap-1.5">
                    {framePresets.map((preset) => <button key={preset.id} type="button" data-active={currentFramePreset === preset.id} onClick={() => updateStyle(preset.style)} className="studio-option">{preset.label}</button>)}
                  </div>}
                  {project.style.shell === 'browser' && <label className="block space-y-2">
                    <span className="studio-field-label">地址栏</span>
                    <input value={project.style.browserUrl ?? ''} onChange={(event) => updateStyle({ browserUrl: event.target.value })} placeholder="example.com" className="studio-input h-9 rounded-lg px-3 text-[12px]" />
                  </label>}
                </section>

                <section className="studio-section space-y-3.5">
                  <div className="flex items-center justify-between"><h3 className="studio-label">最终 MP4</h3><span className="text-[10px] text-[#6f6f6f]">浏览器仅导出 720P 预览</span></div>
                  <ChoiceGroup value={project.style.exportResolution} onChange={(exportResolution) => updateStyle({ exportResolution: exportResolution as ExportResolution })}>
                    <ChoiceItem value="1080p" label="1080P"><span className="font-mono text-[10px]">FHD</span></ChoiceItem>
                    <ChoiceItem value="2k" label="2K"><span className="font-mono text-[10px]">QHD</span></ChoiceItem>
                    <ChoiceItem value="4k" label="4K"><span className="font-mono text-[10px]">UHD</span></ChoiceItem>
                  </ChoiceGroup>
                </section>
              </div> : inspectorTab === 'motion' ? <div className="space-y-10">
                <section className="studio-section space-y-3.5">
                  <div className="flex items-center justify-between gap-4">
                    <h3 className="studio-label">自动聚焦</h3>
                    <Switch.Root checked={focusEnabled} onCheckedChange={setFocusEnabled} aria-label="自动聚焦" className="relative h-5 w-9 cursor-pointer rounded-full bg-white/[.12] shadow-[inset_0_1px_2px_rgba(0,0,0,.35),inset_0_0_0_1px_rgba(255,255,255,.05)] outline-none transition-[background-color,box-shadow] focus-visible:shadow-[0_0_0_2px_#0a0a0a,0_0_0_3.5px_rgba(255,255,255,.35)] data-[state=checked]:bg-[#f5f5f5] data-[state=checked]:shadow-[inset_0_1px_0_rgba(255,255,255,.4)]"><Switch.Thumb className="block size-3.5 translate-x-[3px] rounded-full bg-[#7a7a7a] shadow-[0_1px_2px_rgba(0,0,0,.45)] transition-[transform,background-color] data-[state=checked]:translate-x-[19px] data-[state=checked]:bg-[#0d0d0d]" /></Switch.Root>
                  </div>
                  {focusEnabled && <div className="grid grid-cols-3 gap-1.5">
                    {focusPresets.map((preset) => <button key={preset.label} type="button" data-active={Math.abs(project.style.zoom - preset.value) < .01} onClick={() => updateStyle({ zoom: preset.value })} className="studio-option">{preset.label}</button>)}
                  </div>}
                </section>

                <section className="studio-section space-y-3.5">
                  <h3 className="studio-label">鼠标</h3>
                  <ChoiceGroup columns={4} value={project.style.cursor} onChange={(cursor) => updateStyle({ cursor: cursor as CursorStyle })}>
                    <ChoiceItem value="studio" label="工作室"><MousePointer2 className="size-4 fill-[#171613] stroke-[#eeeae1]" /></ChoiceItem>
                    <ChoiceItem value="dot" label="圆点"><Circle className="size-3 fill-current" /></ChoiceItem>
                    <ChoiceItem value="ring" label="圆环"><Circle className="size-4" /></ChoiceItem>
                    <ChoiceItem value="highlight" label="聚光"><Focus className="size-4" /></ChoiceItem>
                  </ChoiceGroup>
                  <div className="grid grid-cols-3 gap-1.5">
                    {cursorSizePresets.map((preset) => <button key={preset.label} type="button" data-active={project.style.cursorSize === preset.value} onClick={() => updateStyle({ cursorSize: preset.value })} className="studio-option">{preset.label}</button>)}
                  </div>
                </section>
              </div> : <div className="space-y-5">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="studio-label">演示说明</h3>
                  <Button variant="secondary" size="compact" onClick={addCaption}><Plus className="size-3" />添加</Button>
                </div>
                {(project.captions ?? []).length === 0
                  ? <button type="button" onClick={addCaption} aria-label="添加说明" className="grid w-full place-items-center rounded-xl bg-white/[.04] px-4 py-10 text-[#6f6f6f] shadow-[inset_0_0_0_1px_rgba(255,255,255,.05)] outline-none transition-[background-color,color,box-shadow] hover:bg-white/[.07] hover:text-[#d6d6d6] hover:shadow-[inset_0_0_0_1px_rgba(255,255,255,.08)] focus-visible:shadow-[0_0_0_2px_#0a0a0a,0_0_0_3.5px_rgba(255,255,255,.35)]"><Type className="size-5" /></button>
                  : <div className="space-y-3">{(project.captions ?? []).map((caption, index) => {
                    const captionDuration = caption.end - caption.start;
                    return <section key={caption.id} className="space-y-3 rounded-xl bg-white/[.045] p-3.5 shadow-[inset_0_0_0_1px_rgba(255,255,255,.05)]">
                      <div className="flex items-center justify-between"><span className="text-[11px] font-medium text-[#c4c4c4]">说明 {index + 1}</span><button type="button" onClick={() => removeCaption(caption.id)} aria-label={`删除说明 ${index + 1}`} className="grid size-6 place-items-center rounded-md text-[#6f6f6f] outline-none transition-colors hover:bg-white/[.08] hover:text-[#e5e5e5] focus-visible:shadow-[0_0_0_2px_#0a0a0a,0_0_0_3.5px_rgba(255,255,255,.35)]"><Trash2 className="size-3" /></button></div>
                      <textarea value={caption.text} rows={2} maxLength={120} onChange={(event) => updateCaption(caption.id, { text: event.target.value })} className="studio-input resize-none rounded-lg px-3 py-2.5 text-[12px] leading-5" />
                      <div className="flex items-center justify-between rounded-lg bg-white/[.05] px-3 py-2.5"><span className="font-mono text-[10px] tabular-nums text-[#9a9a9a]">{formatTime(caption.start)}</span><button type="button" onClick={() => { const span = caption.end - caption.start; const start = Math.min(currentTime, Math.max(0, duration - .2)); updateCaption(caption.id, { start, end: Math.min(duration, start + span) }); }} className="text-[10px] font-medium text-[#d6d6d6] outline-none transition-colors hover:text-white">定位</button></div>
                      <div className="space-y-2"><span className="studio-field-label">停留时间</span><div className="grid grid-cols-3 gap-1.5">
                        {captionDurations.map((preset) => <button key={preset.label} type="button" data-active={Math.abs(captionDuration - preset.value) < .15} onClick={() => updateCaption(caption.id, { end: Math.min(duration, caption.start + preset.value) })} className="studio-option studio-option-sm">{preset.label}</button>)}
                      </div></div>
                      <div className="space-y-2"><span className="studio-field-label">位置</span><div className="grid grid-cols-3 gap-1.5">
                        {([
                          ['top-left', '左上'], ['top-center', '上中'], ['top-right', '右上'],
                          ['bottom-left', '左下'], ['bottom-center', '下中'], ['bottom-right', '右下'],
                        ] as [DemoCaptionPosition, string][]).map(([position, label]) => <button key={position} type="button" data-active={caption.position === position} onClick={() => updateCaption(caption.id, { position })} className="studio-option studio-option-sm">{label}</button>)}
                      </div></div>
                    </section>;
                  })}</div>}
              </div>}
            </div>
          </ScrollArea.Viewport>
          <ScrollArea.Scrollbar orientation="vertical" className="flex w-2 touch-none select-none bg-transparent p-0.5"><ScrollArea.Thumb className="relative flex-1 rounded-full bg-white/[.14] transition-colors hover:bg-white/[.24]" /></ScrollArea.Scrollbar>
        </ScrollArea.Root>
      </aside>}
    </div>
  </div>;
}
