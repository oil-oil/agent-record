import type { DemoCaption, ExportResolution, RecordedEvent, SourceSegment, StudioStyle } from './types';
import { cameraAt, clickCursorAt, cursorAt, pointOf, wallpaperById, zoomAt } from './visuals';
import { BROWSER_SHELL_COLORS, BROWSER_SHELL_METRICS, browserAddressLabel } from './browser-shell';
import { activeCaptions, captionMotion } from './captions';
import { CAPTION_STYLE } from './caption-style';
import { segmentAddressAt, segmentTransitionAt } from './segment-transitions';

const profiles: Record<ExportResolution, { width: number; height: number; bitrate: number }> = {
  '720p': { width: 1280, height: 720, bitrate: 7_000_000 },
  '1080p': { width: 1920, height: 1080, bitrate: 14_000_000 },
  '2k': { width: 2560, height: 1440, bitrate: 22_000_000 },
  '4k': { width: 3840, height: 2160, bitrate: 32_000_000 },
};

const roundedPath = (ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) => {
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, Math.min(radius, width / 2, height / 2));
  ctx.closePath();
};

const loadImage = (src: string) => new Promise<HTMLImageElement | null>((resolve) => {
  const image = new Image();
  let settled = false;
  const finish = (value: HTMLImageElement | null) => {
    if (settled) return;
    settled = true;
    window.clearTimeout(timeout);
    image.onload = null;
    image.onerror = null;
    resolve(value);
  };
  const timeout = window.setTimeout(() => finish(null), 8_000);
  image.crossOrigin = 'anonymous';
  image.onload = () => finish(image);
  image.onerror = () => finish(null);
  image.src = src;
});

const drawCover = (ctx: CanvasRenderingContext2D, image: HTMLImageElement, width: number, height: number) => {
  const ratio = Math.max(width / image.naturalWidth, height / image.naturalHeight);
  const renderedWidth = image.naturalWidth * ratio;
  const renderedHeight = image.naturalHeight * ratio;
  ctx.drawImage(image, (width - renderedWidth) / 2, (height - renderedHeight) / 2, renderedWidth, renderedHeight);
};

function drawBrowserChrome(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  unit: number,
  address?: string,
  addressOpacity = 1,
  addressTranslateX = 0,
) {
  const metrics = BROWSER_SHELL_METRICS;
  const chromeHeight = metrics.height * unit;
  ctx.fillStyle = BROWSER_SHELL_COLORS.toolbar;
  ctx.fillRect(x, y, width, chromeHeight);
  ctx.fillStyle = BROWSER_SHELL_COLORS.separator;
  ctx.fillRect(x, y + chromeHeight - unit, width, unit);
  ['#ff5f57', '#febc2e', '#28c840'].forEach((colour, index) => {
    ctx.fillStyle = colour;
    ctx.beginPath();
    ctx.arc(
      x + (metrics.trafficLightStartX + index * metrics.trafficLightGap + metrics.trafficLightDiameter / 2) * unit,
      y + chromeHeight / 2,
      metrics.trafficLightDiameter / 2 * unit,
      0,
      Math.PI * 2,
    );
    ctx.fill();
  });
  ctx.fillStyle = BROWSER_SHELL_COLORS.address;
  roundedPath(
    ctx,
    x + metrics.addressX * unit,
    y + metrics.addressY * unit,
    width - (metrics.addressX + metrics.addressRight) * unit,
    metrics.addressHeight * unit,
    metrics.addressRadius * unit,
  );
  ctx.fill();
  ctx.strokeStyle = 'rgba(60,64,67,.08)';
  ctx.lineWidth = unit;
  ctx.stroke();

  const iconX = x + metrics.addressIconX * unit;
  const iconY = y + chromeHeight / 2;
  ctx.strokeStyle = BROWSER_SHELL_COLORS.addressIcon;
  ctx.lineWidth = 1.4 * unit;
  ctx.lineCap = 'round';
  [
    { offset: -4, knob: -1.5 },
    { offset: 0, knob: 2 },
    { offset: 4, knob: -2.5 },
  ].forEach(({ offset, knob }) => {
    ctx.beginPath();
    ctx.moveTo(iconX - 5 * unit, iconY + offset * unit);
    ctx.lineTo(iconX + 5 * unit, iconY + offset * unit);
    ctx.stroke();
    ctx.fillStyle = BROWSER_SHELL_COLORS.address;
    ctx.beginPath();
    ctx.arc(iconX + knob * unit, iconY + offset * unit, 1.6 * unit, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  });

  ctx.fillStyle = BROWSER_SHELL_COLORS.addressText;
  ctx.font = `${12 * unit}px Arial, "Helvetica Neue", -apple-system, BlinkMacSystemFont, sans-serif`;
  ctx.textBaseline = 'middle';
  ctx.save();
  ctx.globalAlpha = addressOpacity;
  ctx.fillText(
    browserAddressLabel(address),
    x + (metrics.addressTextX + addressTranslateX) * unit,
    y + chromeHeight / 2,
    width - (metrics.addressTextX + metrics.addressRight + 8) * unit,
  );
  ctx.restore();
}

function traceHand(ctx: CanvasRenderingContext2D) {
  [
    'M22 14a8 8 0 0 1-8 8',
    'M18 11v-1a2 2 0 0 0-2-2a2 2 0 0 0-2 2',
    'M14 10V9a2 2 0 0 0-2-2a2 2 0 0 0-2 2v1',
    'M10 9.5V4a2 2 0 0 0-2-2a2 2 0 0 0-2 2v10',
    'M18 11a2 2 0 1 1 4 0v3a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15',
  ].forEach((path) => ctx.stroke(new Path2D(path)));
}

function drawHandPointer(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, unit: number, pressAmount: number) {
  const pressScale = 1.1 * (1 - pressAmount * .08);
  ctx.save();
  ctx.translate(x, y + pressAmount * 2.4 * unit);
  ctx.scale(size / 24 * pressScale, size / 24 * pressScale);
  // Pointer 图标的指尖位于 viewBox 的 (8, 2)，始终与真实点击坐标对齐。
  ctx.translate(-8, -2);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.shadowColor = 'rgba(0,0,0,.58)';
  ctx.shadowBlur = (3 - pressAmount * 1.5) * 24 / size * unit;
  ctx.shadowOffsetY = (2 - pressAmount) * 24 / size * unit;
  ctx.strokeStyle = '#151515';
  ctx.lineWidth = 4.8;
  traceHand(ctx);
  ctx.shadowColor = 'transparent';
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 2.15;
  traceHand(ctx);
  ctx.restore();
}

function drawPointer(ctx: CanvasRenderingContext2D, style: StudioStyle, x: number, y: number, unit: number, handAmount: number, pressAmount: number) {
  const size = style.cursorSize * unit;
  const clickScale = 1 + handAmount * .1;
  const pressScale = clickScale * (1 - pressAmount * .08);
  ctx.lineWidth = 2 * unit;
  if (style.cursor === 'dot') {
    ctx.save();
    ctx.translate(x, y + pressAmount * 2.4 * unit);
    ctx.scale(pressScale, pressScale);
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = '#121318';
    ctx.beginPath();
    ctx.arc(0, 0, size * .24, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
    return;
  }
  if (style.cursor === 'ring') {
    ctx.save();
    ctx.translate(x, y + pressAmount * 2.4 * unit);
    ctx.scale(pressScale, pressScale);
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 3 * unit;
    ctx.beginPath();
    ctx.arc(0, 0, size * .42, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
    return;
  }
  if (style.cursor === 'highlight') {
    ctx.save();
    ctx.translate(x, y + pressAmount * 2.4 * unit);
    ctx.scale(pressScale, pressScale);
    ctx.fillStyle = 'rgba(255,220,78,.32)';
    ctx.beginPath();
    ctx.arc(0, 0, size * .85, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    return;
  }
  ctx.save();
  ctx.globalAlpha = 1 - handAmount;
  ctx.translate(x, y);
  ctx.scale(clickScale, clickScale);
  ctx.translate(-x, -y);
  ctx.fillStyle = '#151515';
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 2.4 * unit;
  ctx.lineJoin = 'round';
  ctx.shadowColor = 'rgba(0,0,0,.55)';
  ctx.shadowBlur = 4 * unit;
  ctx.shadowOffsetY = 2 * unit;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x, y + size);
  ctx.lineTo(x + size * .24, y + size * .7);
  ctx.lineTo(x + size * .48, y + size * 1.05);
  ctx.lineTo(x + size * .66, y + size * .93);
  ctx.lineTo(x + size * .44, y + size * .57);
  ctx.lineTo(x + size * .74, y + size * .55);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
  if (handAmount > 0) {
    ctx.save();
    ctx.globalAlpha = handAmount;
    drawHandPointer(ctx, x, y, size, unit, pressAmount);
    ctx.restore();
  }
}

function captionLines(ctx: CanvasRenderingContext2D, text: string, maxWidth: number) {
  const lines: string[] = [];
  text.split('\n').forEach((paragraph) => {
    let line = '';
    Array.from(paragraph).forEach((character) => {
      const next = line + character;
      if (line && ctx.measureText(next).width > maxWidth) {
        lines.push(line.trim());
        line = character.trimStart();
      } else {
        line = next;
      }
    });
    if (line.trim() || !paragraph) lines.push(line.trim());
  });
  return lines;
}

function drawCaption(ctx: CanvasRenderingContext2D, caption: DemoCaption, time: number, frameX: number, frameY: number, frameWidth: number, frameHeight: number, chromeHeight: number, unit: number) {
  const motion = captionMotion(caption, time);
  if (!motion.opacity) return;
  const maxTextWidth = CAPTION_STYLE.maxTextWidth * unit;
  ctx.save();
  ctx.font = `600 ${CAPTION_STYLE.fontSize * unit}px -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif`;
  ctx.textBaseline = 'top';
  const lines = captionLines(ctx, caption.text, maxTextWidth);
  const lineHeight = CAPTION_STYLE.lineHeight * unit;
  const textWidth = Math.max(...lines.map((line) => ctx.measureText(line).width), 1);
  const cardWidth = Math.min(maxTextWidth, textWidth) + CAPTION_STYLE.horizontalPadding * 2 * unit;
  const cardHeight = lines.length * lineHeight + CAPTION_STYLE.verticalPadding * 2 * unit;
  const [, horizontal] = caption.position.split('-') as ['top' | 'bottom', 'left' | 'center' | 'right'];
  const isTop = caption.position.startsWith('top');
  const x = horizontal === 'left'
    ? frameX + CAPTION_STYLE.horizontalOffset * unit
    : horizontal === 'right'
      ? frameX + frameWidth - cardWidth - CAPTION_STYLE.horizontalOffset * unit
      : frameX + (frameWidth - cardWidth) / 2;
  const baseY = isTop
    ? frameY + chromeHeight + CAPTION_STYLE.verticalOffset * unit
    : frameY + frameHeight - cardHeight - CAPTION_STYLE.verticalOffset * unit;
  const y = baseY + (1 - motion.exit) * 3 * unit;
  const revealWidth = cardWidth * motion.reveal;

  ctx.globalAlpha = motion.opacity;
  ctx.beginPath();
  ctx.rect(x, y - 30 * unit, revealWidth, cardHeight + 60 * unit);
  ctx.clip();
  ctx.shadowColor = 'rgba(0,0,0,.22)';
  ctx.shadowBlur = 30 * unit;
  ctx.shadowOffsetY = 10 * unit;
  roundedPath(ctx, x, y, cardWidth, cardHeight, CAPTION_STYLE.borderRadius * unit);
  ctx.fillStyle = 'rgba(20,20,20,.84)';
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.lineWidth = unit;
  ctx.strokeStyle = 'rgba(255,255,255,.1)';
  ctx.stroke();
  ctx.globalAlpha = motion.opacity * motion.text;
  ctx.fillStyle = '#fff';
  const textX = x + CAPTION_STYLE.horizontalPadding * unit + (1 - motion.text) * -10 * unit;
  lines.forEach((line, index) => ctx.fillText(line, textX, y + CAPTION_STYLE.verticalPadding * unit + index * lineHeight, maxTextWidth));
  ctx.restore();
}

export type ExportResult = { blob: Blob; warning?: string };

export async function exportWebm({ src, style, events, sourceSegments = [], captions = [], onProgress }: { src: string; style: StudioStyle; events: RecordedEvent[]; sourceSegments?: SourceSegment[]; captions?: DemoCaption[]; onProgress: (progress: number) => void }): Promise<ExportResult> {
  if (!HTMLCanvasElement.prototype.captureStream || !window.MediaRecorder) throw new Error('当前浏览器不支持本地视频导出，请使用最新版 Chrome。');
  // 浏览器端导出 720p 快速预览；1080p/2K/4K 由 CLI 离线高清渲染。
  const profile = profiles['720p'];
  const unit = profile.width / 1280;
  const video = document.createElement('video');
  video.crossOrigin = 'anonymous';
  video.src = src;
  video.muted = true;
  video.playsInline = true;
  const cleanupVideo = () => {
    video.pause();
    video.removeAttribute('src');
    video.load();
  };
  const isRemoteCrossOrigin = (() => {
    try { return !['blob:', 'data:'].includes(new URL(src, document.baseURI).protocol) && new URL(src, document.baseURI).origin !== location.origin; } catch { return false; }
  })();
  try {
    await new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new Error('读取录制文件超时，请重新加载后再试。')), 12_000);
    const cleanup = () => {
      window.clearTimeout(timeout);
      video.removeEventListener('loadeddata', onLoaded);
      video.removeEventListener('error', onError);
    };
    const onLoaded = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error(isRemoteCrossOrigin ? '录制文件跨域，服务器未允许 CORS，无法导出。' : '无法读取录制文件。'));
    };
    video.addEventListener('loadeddata', onLoaded, { once: true });
    video.addEventListener('error', onError, { once: true });
    video.load();
    });
  } catch (error) {
    cleanupVideo();
    throw error;
  }

  const canvas = document.createElement('canvas');
  canvas.width = profile.width;
  canvas.height = profile.height;
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) {
    cleanupVideo();
    throw new Error('无法创建导出画布。');
  }

  const wallpaper = style.backgroundPreset === 'solid' ? null : wallpaperById[style.backgroundPreset];
  const wallpaperImage = wallpaper ? await loadImage(wallpaper.src) : null;
  // 浏览器导出固定为稳定的 30fps 预览；最终 60fps 成片交给离线渲染器。
  let stream: MediaStream;
  try {
    stream = canvas.captureStream(30);
  } catch (error) {
    cleanupVideo();
    if (error instanceof DOMException && error.name === 'SecurityError') throw new Error('录制文件跨域或画布已被污染，无法导出。');
    throw new Error('无法创建导出视频流。');
  }
  let hasAudio = false;
  let sourceStream: MediaStream | undefined;
  try {
    const capturableVideo = video as HTMLVideoElement & { captureStream?: () => MediaStream };
    sourceStream = capturableVideo.captureStream?.();
    const audioTracks = sourceStream?.getAudioTracks() ?? [];
    audioTracks.forEach((track) => stream.addTrack(track));
    hasAudio = audioTracks.length > 0;
  } catch {
    // 音轨不可捕获时继续导出画面，并在结果中明确提示。
  }

  const mime = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'].find((item) => !MediaRecorder.isTypeSupported || MediaRecorder.isTypeSupported(item));
  if (!mime) {
    stream.getTracks().forEach((track) => track.stop());
    sourceStream?.getTracks().forEach((track) => track.stop());
    cleanupVideo();
    throw new Error('当前浏览器没有可用的视频编码器。');
  }
  const chunks: Blob[] = [];
  let recorder: MediaRecorder;
  try {
    recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: profile.bitrate });
  } catch {
    stream.getTracks().forEach((track) => track.stop());
    sourceStream?.getTracks().forEach((track) => track.stop());
    cleanupVideo();
    throw new Error('当前浏览器无法创建视频编码器。');
  }
  recorder.ondataavailable = (event) => event.data.size && chunks.push(event.data);
  const done = new Promise<void>((resolve, reject) => {
    recorder.onstop = () => resolve();
    recorder.onerror = () => reject(new Error('视频编码失败。'));
  });
  let canvasOriginChecked = false;
  const sourceEvent = events.find((event) => Number(event.viewportWidth) > 0 && Number(event.viewportHeight) > 0);
  const sourceAspect = sourceEvent ? sourceEvent.viewportWidth! / sourceEvent.viewportHeight! : 16 / 9;

  const draw = () => {
    const { width, height } = profile;
    const gradient = ctx.createLinearGradient(0, 0, width, height);
    if (style.backgroundPreset === 'solid') {
      gradient.addColorStop(0, style.backgroundColor);
      gradient.addColorStop(1, style.backgroundColor);
    } else {
      gradient.addColorStop(0, wallpaper!.fallback[0]);
      gradient.addColorStop(1, wallpaper!.fallback[1]);
    }
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
    if (wallpaperImage) drawCover(ctx, wallpaperImage, width, height);

    const padding = style.shell === 'none' ? 0 : style.padding * unit;
    const chromeHeight = style.shell === 'browser' ? BROWSER_SHELL_METRICS.height * unit : 0;
    const frameX = padding;
    const frameY = padding;
    const frameWidth = width - padding * 2;
    const frameHeight = height - padding * 2;
    const radius = style.shell === 'none' ? 0 : style.radius * unit;

    if (style.shell !== 'none') {
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,.24)';
      ctx.shadowBlur = style.shadow * unit;
      ctx.shadowOffsetY = style.shadow * .28 * unit;
      roundedPath(ctx, frameX, frameY, frameWidth, frameHeight, radius);
      ctx.fillStyle = '#fff';
      ctx.fill();
      ctx.restore();
    }

    roundedPath(ctx, frameX, frameY, frameWidth, frameHeight, radius);
    ctx.save();
    ctx.clip();
    const segmentTransition = segmentTransitionAt(sourceSegments, video.currentTime, events);
    const browserAddress = segmentAddressAt(sourceSegments, video.currentTime, style.browserUrl, events);
    if (style.shell === 'browser') {
      drawBrowserChrome(
        ctx,
        frameX,
        frameY,
        frameWidth,
        unit,
        browserAddress,
        segmentTransition.addressOpacity,
        segmentTransition.addressTranslateX,
      );
    }

    const contentY = frameY + chromeHeight;
    const contentHeight = frameHeight - chromeHeight;
    ctx.fillStyle = '#fff';
    ctx.fillRect(frameX, contentY, frameWidth, contentHeight);
    // 与预览保持一致：优先使用录制轨迹中的视口比例，缺失时按 16:9 处理。
    const renderedWidth = sourceAspect >= frameWidth / contentHeight ? contentHeight * sourceAspect : frameWidth;
    const renderedHeight = sourceAspect >= frameWidth / contentHeight ? contentHeight : frameWidth / sourceAspect;
    const baseX = (frameWidth - renderedWidth) / 2;
    const baseY = (contentHeight - renderedHeight) / 2;
    const drawCameraSample = (time: number) => {
      const active = zoomAt(events, Math.max(0, time), style.zoom);
      const cursor = pointOf(cursorAt(events, Math.max(0, time)));
      const camera = pointOf(active.event) ?? cameraAt(events, active.cameraTime) ?? cursor ?? { x: .5, y: .5 };
      const scale = 1 + active.amount;
      const panProgress = style.zoom > 1 ? active.amount / (style.zoom - 1) : 0;
      const cameraX = baseX + camera.x * renderedWidth;
      const cameraY = baseY + camera.y * renderedHeight;
      const translateX = Math.max(
        frameWidth - (baseX + renderedWidth) * scale,
        Math.min(-baseX * scale, (frameWidth * .5 - cameraX * style.zoom) * panProgress),
      );
      const translateY = Math.max(
        contentHeight - (baseY + renderedHeight) * scale,
        Math.min(-baseY * scale, (contentHeight * .5 - cameraY * style.zoom) * panProgress),
      );
      ctx.save();
      ctx.globalAlpha = segmentTransition.opacity;
      ctx.translate(
        frameX + frameWidth / 2 + segmentTransition.translateX * unit,
        contentY + contentHeight / 2,
      );
      ctx.scale(segmentTransition.scale, segmentTransition.scale);
      ctx.translate(-(frameX + frameWidth / 2), -(contentY + contentHeight / 2));
      ctx.translate(frameX + baseX * scale + translateX, contentY + baseY * scale + translateY);
      ctx.scale(scale, scale);
      try {
        ctx.drawImage(video, 0, 0, renderedWidth, renderedHeight);
      } catch (error) {
        if (error instanceof DOMException && error.name === 'SecurityError') throw new Error('录制文件跨域或画布已被污染，无法导出。');
        throw error;
      }
      ctx.restore();
      return { scale, translateX, translateY };
    };

    ctx.save();
    ctx.beginPath();
    ctx.rect(frameX, contentY, frameWidth, contentHeight);
    ctx.clip();
    const cameraTransform = drawCameraSample(video.currentTime);
    ctx.restore();
    ctx.restore();

    const pointer = pointOf(cursorAt(events, video.currentTime));
    if (pointer) {
      const clickCursor = clickCursorAt(events, video.currentTime);
      ctx.save();
      ctx.globalAlpha = segmentTransition.opacity;
      drawPointer(
        ctx,
        style,
        frameX + (baseX + pointer.x * renderedWidth) * cameraTransform.scale + cameraTransform.translateX,
        contentY + (baseY + pointer.y * renderedHeight) * cameraTransform.scale + cameraTransform.translateY,
        unit,
        clickCursor.handAmount,
        clickCursor.pressAmount,
      );
      ctx.restore();
    }
    activeCaptions(captions, video.currentTime).forEach((caption) => {
      drawCaption(ctx, caption, video.currentTime, frameX, frameY, frameWidth, frameHeight, chromeHeight, unit);
    });
  };

  const seekToStart = () => new Promise<void>((resolve, reject) => {
    if (video.currentTime === 0 && video.readyState >= HTMLMediaElement.HAVE_METADATA) { resolve(); return; }
    const timeout = window.setTimeout(() => { cleanup(); reject(new Error('定位录制文件起点超时，请重新加载后再试。')); }, 4_000);
    const cleanup = () => { window.clearTimeout(timeout); video.removeEventListener('seeked', onSeeked); };
    const onSeeked = () => { cleanup(); resolve(); };
    video.addEventListener('seeked', onSeeked, { once: true });
    video.currentTime = 0;
  });
  let watchdog = 0;
  let frameId = 0;
  let onEnded: (() => void) | undefined;
  try {
    await seekToStart();
    draw();
    ctx.getImageData(0, 0, 1, 1);
    canvasOriginChecked = true;
    recorder.start(400);
    await video.play();
    await new Promise<void>((resolve, reject) => {
      const startedAt = performance.now();
      const frameInterval = 1000 / 30;
      let lastDrawAt = Number.NEGATIVE_INFINITY;
      let lastTime = -1;
      let stalledTicks = 0;
      let settled = false;
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        window.clearInterval(watchdog);
        cancelAnimationFrame(frameId);
        if (onEnded) video.removeEventListener('ended', onEnded);
        error ? reject(error) : resolve();
      };
      onEnded = () => finish();
      const render = (now: number) => {
        if (now - lastDrawAt >= frameInterval - 1) {
          try {
            draw();
            if (!canvasOriginChecked) {
              ctx.getImageData(0, 0, 1, 1);
              canvasOriginChecked = true;
            }
          } catch (error) {
            finish(error instanceof Error && error.message.includes('跨域') ? error : new Error('导出画面失败，请检查录制文件和背景资源。'));
            return;
          }
          lastDrawAt = now;
          onProgress(Math.min(1, video.currentTime / video.duration));
        }
        if (!settled) frameId = requestAnimationFrame(render);
      };
      watchdog = window.setInterval(() => {
        const current = video.currentTime;
        if (video.ended || current >= video.duration - .04) return finish();
        if (Math.abs(current - lastTime) < .01) stalledTicks += 1;
        else stalledTicks = 0;
        lastTime = current;
        if (video.paused) video.play().catch(() => {});
        if (stalledTicks > 50 || performance.now() - startedAt > (video.duration + 25) * 1000) finish(new Error('导出播放停滞，请重新加载后再试。'));
      }, 100);
      video.addEventListener('ended', onEnded, { once: true });
      frameId = requestAnimationFrame(render);
    });
    recorder.stop();
    await done;
    onProgress(1);
    return { blob: new Blob(chunks, { type: mime }), warning: hasAudio ? undefined : '导出完成，但录制文件没有可用音轨。' };
  } catch (error) {
    if (recorder.state !== 'inactive') {
      recorder.stop();
      await done.catch(() => {});
    }
    throw error;
  } finally {
    window.clearInterval(watchdog);
    cancelAnimationFrame(frameId);
    if (onEnded) video.removeEventListener('ended', onEnded);
    stream.getTracks().forEach((track) => track.stop());
    sourceStream?.getTracks().forEach((track) => track.stop());
    cleanupVideo();
  }
}
