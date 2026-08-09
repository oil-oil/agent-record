---
name: agent-record
description: 使用 Agent Record 操作用户已经运行的 Chrome 或 Ego Lite，录制并制作带自然鼠标、聚焦和说明文字的 2K60/4K60 产品 Demo。
---

# Agent Record 自动录制

完成真实录制并交付可播放的 MP4、项目 JSON、时间轴 JSON 和验收结果。默认 2K60；只有用户明确要求时才输出 4K60。首版只支持 macOS。

需要 Chrome 或 Ego Lite、Agent Record 扩展、Node.js、npm 和 FFmpeg。首次使用会定位已经安装的 Agent Record；找不到时，代理会从 `oil-oil/agent-record` 的对应 GitHub Release 下载经过校验的 macOS 桌面伴侣，并按锁文件安装开源渲染依赖。扩展首次安装和 macOS 屏幕录制授权必须由用户确认，代理不会操作 `chrome://extensions`。

## 浏览器生命周期

只连接用户已经运行的浏览器、登录态和扩展。禁止独立应用实例、临时 profile，以及 `--user-data-dir`、`--remote-debugging-port`、`--load-extension` 等启动参数。

- Chrome：使用 `chrome:control-chrome` 控制现有窗口。
- Ego Lite：必须使用 `ego-browser`；Task Space 是现有 Ego Lite 进程中的隔离空间，不是独立实例。整次任务复用同一个 Task Space，不使用 Computer Use 操作网页。
- 用户看到的原生光标始终保留。ScreenCaptureKit 只在素材中排除原生光标，最终由 Studio 绘制自定义光标；禁止向网页注入 `cursor: none`。

浏览器或扩展未就绪时提示用户处理。录制前确认自动化页面与 ScreenCaptureKit 捕获窗口一致。

## 首次准备

代理命令统一经过本 Skill 的 bootstrap，不要求用户手动设置项目根：

```bash
node "<当前 Skill 目录>/scripts/agent-record-proxy.mjs" bootstrap
node "<当前 Skill 目录>/scripts/agent-record-proxy.mjs" doctor
```

bootstrap 不下载 Core 源码，也不执行原生编译。准备完成后，在任意普通网页连续检查两次：

```js
document.documentElement.dataset.agentRecord
```

返回 `ready` 就继续。没有返回时，Agent 先运行：

```bash
node "<当前 Skill 目录>/scripts/agent-record-proxy.mjs" extension
```

命令只准备固定扩展目录并复制路径，不启动浏览器。请用户在现有浏览器中加载该目录，完成后刷新普通网页并重新检查 `ready`；不要让 AI 操作扩展管理页。

## 唯一录制流程：Explore → 脚本 → 重置页面 → start

严格按以下顺序执行，每次录制都要重新做一次：

1. **Explore**：先在用户已经运行的目标浏览器中打开普通网页，观察页面结构、账号状态和关键路径；此阶段不录制。
2. **脚本**：写出 6–10 个关键动作，明确要点击、输入、滚动和停留的场景。原始录制建议 40–60 秒，最终保留约 25–35 秒；操作后保留 1.2–2.5 秒结果停留，最终状态保留 3–4 秒。不要通过整体加速压时长，只剪掉无意义等待。
3. **重置页面**：关闭无关标签页，回到起始 URL，重新加载并确认页面就绪；不要沿用 Explore 阶段的中间状态。
4. **start**：只通过代理启动本地录制服务，不启动浏览器；再使用对应浏览器工具完成脚本。Ego Lite 继续复用 Explore 阶段的 Task Space。输入框获得焦点后自然输入，不用一次性填充。

```bash
node "<当前 Skill 目录>/scripts/agent-record-proxy.mjs" start --url "<重置后的起始 URL>" --app "<Google Chrome 或 ego lite>"
# 在同一个现有浏览器窗口完成已规划的点击、滚动和输入
node "<当前 Skill 目录>/scripts/agent-record-proxy.mjs" status
node "<当前 Skill 目录>/scripts/agent-record-proxy.mjs" stop
```

Chrome 输入调用 `typeNaturally(tab, text)`；Ego Lite 使用 `ego-browser` 的 `typeText`。自然输入不提供速度配置。标题字幕只标注关键阶段，每条约 3–5 秒，不要给每个动作加说明。

停止后必须先处理会话，再交给 Studio：

```bash
node "<当前 Skill 目录>/scripts/agent-record-proxy.mjs" process \
  <stop.video> <stop.timeline> artifacts/processed.mp4

node "<当前 Skill 目录>/scripts/agent-record-proxy.mjs" studio \
  init --video artifacts/processed.mp4 --motion artifacts/processed.timeline.json \
  --out artifacts/demo-project.json --background glass-sunrise \
  --shell browser --zoom 1.20 --cursor studio --resolution 2k
node "<当前 Skill 目录>/scripts/agent-record-proxy.mjs" studio \
  validate --file artifacts/demo-project.json
node "<当前 Skill 目录>/scripts/agent-record-proxy.mjs" render -- \
  --project artifacts/demo-project.json --out artifacts/demo-preview.mp4 --quality preview
node "<当前 Skill 目录>/scripts/agent-record-proxy.mjs" render -- \
  --project artifacts/demo-project.json --out artifacts/demo-final-2k60.mp4 --quality final
```

最终导出会读取本机授权。Free 自动输出带 Agent Record 水印的 1080p30；Pro 才输出无水印 2K/4K60。需要查看授权时运行：

```bash
node "<当前 Skill 目录>/scripts/agent-record-proxy.mjs" auth status
```

需要字幕、背景、套壳或故障处理时，只读取对应参考：

- [录制流程](references/recording.md)
- [配置与导出](references/studio-and-export.md)
- [故障处理](references/troubleshooting.md)

## 验收与交付

```bash
"<当前 Skill 目录>/scripts/verify_demo.sh" \
  artifacts/demo-final-2k60.mp4 2560 1440 60
```

确认文件可完整解码、分辨率与帧率正确，并抽看鼠标、点击、输入、镜头和文字。最终简洁报告：成片绝对路径、规格、项目 JSON 绝对路径和验收结果。
