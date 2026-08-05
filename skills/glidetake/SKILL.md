---
name: glidetake
description: 使用 Agent Record 自动操作 Chrome，录制并制作带自然鼠标、聚焦和说明文字的 2K60/4K60 产品 Demo。
---

# Agent Record 自动录制

完成真实录制并交付可播放的 MP4、项目 JSON、时间轴 JSON 和验收结果。默认 2K60；只有用户明确要求时才输出 4K60。首版只支持 macOS。

需要 Chrome、Agent Record 扩展、Node.js/npm 和 FFmpeg。浏览器操作使用 `chrome:control-chrome`；开始和停止录制只通过项目 CLI 完成，不点击扩展入口或弹窗。

## 定位项目

按顺序查找：

1. 用户给出的目录。
2. 当前目录中同时含 `extension/manifest.json`、`studio/`、`scripts/studio-cli.mjs` 的目录。
3. `AGENT_RECORD_ROOT` 指向的目录。

找不到时再询问用户。后续命令都在项目根目录执行。

## 按任务读取说明

- 从网页开始录制：[录制流程](references/recording.md)
- 配置、剪辑或导出：[配置与导出](references/studio-and-export.md)
- 卡顿、模糊、光标或导出异常：[故障处理](references/troubleshooting.md)

## 1. 检查

```bash
npm run agent-record -- doctor
npm run check
npm run studio:typecheck
```

在目标普通网页检查扩展事件桥是否就绪：

```js
document.documentElement.dataset.aiDemoRecorder
```

返回 `ready` 就继续；否则刷新页面后再查一次。仍未就绪时，请用户安装、启用或重新加载扩展。不要让 AI 操作 `chrome://extensions`。

## 2. 唯一录制流程

先把流程压缩为少量关键动作并关闭无关标签页。页面当前可见的账号名称、头像和邮箱无需隐藏。

```bash
npm run agent-record -- start --app "Google Chrome"
```

命令返回 `recording` 后，用 Chrome 自动化完成页面点击、滚动和输入。输入框获得焦点后调用：

```js
var naturalTyping = await import(
  "file://<当前 Skill 目录绝对路径>/scripts/natural-typing.mjs"
);
await naturalTyping.typeNaturally(tab, text);
```

`text` 是要输入的内容；自然输入不提供速度配置。不要使用 `fill()` 或一次性写入。需要跨标签页时，按 [录制流程](references/recording.md) 合并片段。

操作完成后停止：

```bash
npm run agent-record -- status
npm run agent-record -- stop
```

解析 `stop` JSON 中的 `video`、`timeline`、`manifest` 路径。会话目录应包含 `capture.mov`、`timeline.json` 和 `manifest.json`。ScreenCaptureKit 本地服务产生画面，扩展只发送网页操作事件。

## 3. 配置

```bash
npm run studio:cli -- init \
  --video <stop.video> \
  --motion <stop.timeline> \
  --out artifacts/demo-project.json \
  --name "产品演示" \
  --background glass-sunrise \
  --shell browser \
  --address "https://example.com/product" \
  --zoom 1.20 \
  --padding 40 \
  --cursor studio \
  --cursor-size 30 \
  --resolution 2k

npm run studio:cli -- validate --file artifacts/demo-project.json
```

需要演示说明时使用 `caption-add`；具体参数与可用配置见 [配置与导出](references/studio-and-export.md)。不要直接手改项目 JSON。

## 4. 预览与成片

```bash
npm run studio:render -- \
  --project artifacts/demo-project.json \
  --out artifacts/demo-preview.mp4 \
  --quality preview

npm run studio:render -- \
  --project artifacts/demo-project.json \
  --out artifacts/demo-final-2k60.mp4 \
  --quality final
```

预览只用于快速判断，交付必须使用 `final` 产物。

## 5. 验收与交付

```bash
skills/glidetake/scripts/verify_demo.sh \
  artifacts/demo-final-2k60.mp4 2560 1440 60
```

确认文件可完整解码、分辨率与帧率正确，并抽看鼠标、点击、输入、镜头和文字。发现跳动、错位或模糊就继续修复，不交付失败产物。

最终简洁报告：

```text
成片：<绝对路径>
规格：<分辨率> / <帧率> / <时长>
项目：<项目 JSON 绝对路径>
验收：<通过或具体失败项>
```
