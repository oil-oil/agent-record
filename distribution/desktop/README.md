# Agent Record 桌面包

这是 Agent Record 的本地桌面源包，包含 Chrome 事件扩展、`glidetake` Skill、Studio 源码和 CLI。当前仅支持 macOS 13 Ventura 或更高版本，以及 Google Chrome 116 或更高版本；暂不支持 Windows、Linux、Firefox 和 Safari。录制素材与导出视频只保存在本机。

## 安装

需要 macOS 13+、Node.js 22（`>=22 <24`）、npm 10、Google Chrome 116+，以及最终渲染所需的 FFmpeg/ffprobe。

```bash
npm ci
npm run check
```

### 安装 Chrome 事件扩展

运行 `npm run extension:setup`。命令会把扩展同步到固定的本地目录，打开 Chrome 扩展管理页，并在 Finder 中选中该目录。开启“开发者模式”，点击“加载已解压的扩展程序”。安装一次后可以长期使用；更新后重新运行命令并重新加载。

### 安装 Skill

将 `skills/glidetake/` 复制到 AI Agent 支持的本地 skills 目录，并按其中的 `SKILL.md` 使用。Skill 会调用本包中的 CLI，不需要复制仓库根目录文件。

也可以只安装 GitHub Release 提供的 `.skill`。首次使用时，Skill 会先定位 `AGENT_RECORD_ROOT` 或当前/祖先完整源码根；找不到时自动下载本版本桌面包，校验 `SHA256SUMS`、解压到用户 Application Support 的版本目录并执行一次 `npm ci`。重复使用会复用缓存，不会重复安装。可用 `AGENT_RECORD_RELEASE_BASE_URL` 覆盖 Release 地址进行内部分发或测试。

Chrome 扩展首次加载和 macOS 屏幕录制授权必须由用户确认；Skill 只报告缺失状态，不会自动打开或操作 `chrome://extensions`。

## 唯一录制流程

在本包根目录执行（独立 Skill 会通过同一个代理转发这些命令）：

```bash
npm run agent-record -- doctor
npm run agent-record -- start --url "https://example.com" --app "Google Chrome"
# AI 使用 Chrome 自动化完成自然点击、滚动和输入
npm run agent-record -- status
npm run agent-record -- stop
```

`stop` 返回 JSON。使用其中的 `video`、`timeline` 和 `manifest` 路径；会话目录固定包含 `capture.mov`、`timeline.json` 和 `manifest.json`。ScreenCaptureKit 本地服务是唯一画面来源。

停止后先处理等待和场景片段，再初始化 Studio：

```bash
node skills/glidetake/scripts/agent-record-proxy.mjs process \
  <stop.video> <stop.timeline> artifacts/processed.mp4
```

## 使用 Studio

```bash
npm run studio:cli -- init --video artifacts/capture.mov --motion artifacts/timeline.json --out demo-project.json --resolution 2k
npm run studio:cli -- validate --file demo-project.json
npm run studio:render -- --project demo-project.json --out demo-final-2k60.mp4 --quality final
npm run studio:dev
```

浏览器打开 Vite 提供的地址即可使用 Studio；最终 2K60/4K60 MP4 使用 `studio:render` 离线生成，不需要账号或许可证激活。

本包的 `package.json` 是桌面发布专用清单，未包含仓库官网、测试和发布流程；依赖锁定在同目录的 `package-lock.json`。

随包提供 macOS 捕获内核源码。预编译文件不可用时，可运行 `npm run native:build` 后再次执行 `npm run check`。
