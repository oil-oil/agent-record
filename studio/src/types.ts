export type BackgroundPreset =
  | 'apple-cream-blue'
  | 'apple-coral-pink'
  | 'apple-coastal-blue'
  | 'apple-warm-silver'
  | 'apple-prismatic'
  | 'glass-sunrise'
  | 'cosmic-orbit'
  | 'desktop-coast'
  | 'abstract-ribbon'
  | 'solid';
export type ShellMode = 'browser' | 'card' | 'none';
export type CursorStyle = 'studio' | 'dot' | 'ring' | 'highlight';
export type ExportResolution = '720p' | '1080p' | '2k' | '4k';
export type DemoCaptionPosition = 'top-left' | 'top-center' | 'top-right' | 'bottom-left' | 'bottom-center' | 'bottom-right';
export type DemoCaption = { id: string; text: string; start: number; end: number; position: DemoCaptionPosition };
export type RecordingSource = { url?: string; title?: string; viewport?: { width?: number; height?: number } };
export type SourceSegment = { startMs: number; durationMs: number; source?: RecordingSource };
export type StudioStyle = { backgroundPreset: BackgroundPreset; backgroundColor: string; shell: ShellMode; browserUrl?: string; padding: number; radius: number; shadow: number; zoom: number; cursor: CursorStyle; cursorSize: number; exportResolution: ExportResolution };
export type RecordedEvent = { kind: string; tMs: number; nx?: number; ny?: number; x?: number; y?: number; url?: string; title?: string; viewportWidth?: number; viewportHeight?: number };
export type StudioProject = { schemaVersion: 1; name: string; video?: string; timeline?: string; style: StudioStyle; captions?: DemoCaption[] };
export const defaultStyle: StudioStyle = { backgroundPreset: 'glass-sunrise', backgroundColor: '#e7e7e2', shell: 'browser', browserUrl: 'example.com', padding: 40, radius: 18, shadow: 24, zoom: 1.2, cursor: 'studio', cursorSize: 30, exportResolution: '2k' };
export const defaultProject: StudioProject = { schemaVersion: 1, name: 'Demo 项目', style: defaultStyle, captions: [] };
