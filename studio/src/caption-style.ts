import type { DemoCaptionPosition } from './types';

export const DEFAULT_CAPTION_POSITION: DemoCaptionPosition = 'bottom-center';

export const CAPTION_STYLE = {
  maxTextWidth: 500,
  horizontalPadding: 22,
  verticalPadding: 15,
  fontSize: 22,
  lineHeight: 30,
  horizontalOffset: 42,
  verticalOffset: 46,
  borderRadius: 12,
} as const;
