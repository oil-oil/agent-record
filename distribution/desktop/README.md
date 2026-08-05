# Agent Record 桌面包

这是 Agent Record 的本地桌面源包，包含 Chrome 事件扩展、`glidetake` Skill、Studio 源码和 CLI。默认 macOS 首版，录制素材与导出视频只保存在本机。

## 安装

需要 Node.js 22（`>=22 <24`）、npm 10、Google Chrome，以及最终渲染所需的 FFmpeg/ffprobe。

```bash
npm ci
npm run check
```

### 安装 Chrome 事件扩展

1. 打开 `chrome://extensions`，开启“开发者模式”。
2. 点击“加载已解压的扩展程序”，选择本包的 `extension/` 目录。扩展只采集网页操作事件并桥接到本地录制服务，画面由本地服务管理。

### 安装 Skill

将 `skills/glidetake/` 复制到 AI Agent 支持的本地 skills 目录，并按其中的 `SKILL.md` 使用。Skill 会调用本包中的 CLI，不需要复制仓库根目录文件。

## 唯一录制流程

在本包根目录执行：

```bash
npm run agent-record -- doctor
npm run agent-record -- start --app "Google Chrome"
# AI 使用 Chrome 自动化完成自然点击、滚动和输入
npm run agent-record -- status
npm run agent-record -- stop
```

`stop` 返回 JSON。使用其中的 `video`、`timeline` 和 `manifest` 路径；会话目录固定包含 `capture.mov`、`timeline.json` 和 `manifest.json`。ScreenCaptureKit 本地服务是唯一画面来源。

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
