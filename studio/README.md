# Agent Record Studio

Agent Record Studio 是纯前端、本地处理的 Demo 后期编辑器。它把干净录屏与操作轨迹重新合成为带背景、浏览器壳、光标、聚焦和说明文字的视频。

## 使用

1. 在项目根目录运行 `npm run demo`。
2. 打开 `http://127.0.0.1:4173/studio/`。
3. 导入 WebM/MP4 视频，并按需导入操作轨迹。
4. 在“外观”“动效”“说明”三个面板调整背景、壳体、缩放、光标和说明轨道。
5. 点击右上角“导出视频”进行浏览器快速预览（WebM）。

最终交付建议使用项目根目录的离线 CLI：

```bash
npm run studio:cli -- init \
  --video artifacts/recording.webm \
  --motion artifacts/recording-timeline.json \
  --out artifacts/demo-project.json --resolution 2k --zoom 1.20
npm run studio:render -- --project artifacts/demo-project.json \
  --out artifacts/demo-final-2k60.mp4 --quality final
```

CLI 会读取时间轴中的 `source.url` 自动填充浏览器地址栏；若没有真实网址，再使用 `--address` 明确指定。最终验收用 `skills/agent-record/scripts/verify_demo.sh` 检查分辨率、帧率和完整解码。

聚焦镜头由真实 `click` 事件生成，相邻镜头按时间和位置合并；点击发生前保持原始倍率，不提前聚焦。镜头中心和光标位置根据 `move` 事件平滑插值。编辑器优先使用 `nx`/`ny` 归一化坐标，也兼容带视口尺寸的旧事件格式。

## 限制

- 浏览器快速导出依赖 Chrome 的 `canvas.captureStream` 和 `MediaRecorder`，按实时速度执行，仅适合预览。
- Chrome 暂停隐藏视频时，播放看门狗会尝试恢复；源视频不支持 `captureStream()` 时无法保留音轨。
- URL 资源必须同源或允许 CORS；离线 Remotion 渲染不能直接使用远程视频，需先下载到项目内。
- 当前项目格式以本地路径为主，尚未提供桌面打包、自动保存、撤销重做和跨平台安装器。
- 录制画面、网址和轨迹只用于本地编辑；请勿在录制素材中放入密码、令牌或其他敏感信息。详见根目录 [隐私政策](../PRIVACY.md)。
