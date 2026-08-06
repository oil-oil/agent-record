# 录制流程

## 扩展就绪

普通网页连续两次未返回 `ready` 时，运行代理的 `extension` 命令，并请用户在现有浏览器中加载返回的目录。

扩展就绪标记：

```js
document.documentElement.dataset.aiDemoRecorder
```

扩展只采集网页事件并桥接到本地服务；不要寻找、点击或让 AI 操作扩展里的录制按钮。

## 复用现有浏览器

- Chrome 和 Ego Lite 都只连接用户现有会话，不启动独立实例或 profile。
- Chrome 使用 `chrome:control-chrome`；Ego Lite 使用 `ego-browser`，不要用 Computer Use 操作网页。
- Ego Task Space 是现有 Ego Lite 进程内的隔离空间。Explore、录制和验收始终复用同一个 Task Space。
- 不隐藏用户浏览器里的原生光标。ScreenCaptureKit 在素材层排除原生光标，Studio 再烧录自定义光标。
- 如果自动化页面与本地捕获窗口的标题、尺寸或内容不一致，立即停止，不继续生成成片。

## 录制顺序

1. 打开目标页面并等待稳定。
2. 调整到需要的页面比例并关闭无关浮层；账号名称、头像和邮箱等页面可见信息无需隐藏。
3. 在项目根目录启动本地录制服务：

   ```bash
   npm run agent-record -- start --url "<重置后的起始 URL>" --app "Google Chrome"
   ```

   `--url` 必须填写重置后页面的真实 URL，扩展会用它精确绑定目标标签页。`--app` 必须填写当前实际被操作的现有浏览器应用名；使用 Ego Lite 时填写 `ego lite`。该命令只启动本地录制服务，不启动浏览器。

4. 命令进入 `recording` 后，用对应浏览器工具在同一窗口或 Ego Task Space 执行少量关键动作。
5. 输入框获得焦点后使用自然输入。
6. 展示最终结果后停止：

   ```bash
   npm run agent-record -- stop
   ```

7. 从 `stop` JSON 读取 `video`、`timeline`、`manifest`，确认会话目录有 `capture.mov`、`timeline.json` 和 `manifest.json`，再交给 Studio。

自动化耗时不影响最终节奏；后期应剪掉等待，不要把页面和光标整体倍速。ScreenCaptureKit 本地服务是唯一画面来源，扩展只发送网页操作事件。

## 自然输入

输入框获得焦点后调用：

```js
var naturalTyping = await import(
  "file://<当前 Skill 目录绝对路径>/scripts/natural-typing.mjs"
);
await naturalTyping.typeNaturally(tab, "AI Demo");
```

不使用 `fill()` 或一次性输入。输入内容只出现在网页录屏中，不写入时间轴。

Ego Lite 使用：

```js
await click("目标")
await typeText("AI Demo")
```

## 跨标签页合并

每个标签页分别启动并停止一个会话，然后运行：

```bash
npm run recordings:merge -- \
  --out artifacts/merged.mov \
  --timeline-out artifacts/merged.timeline.json \
  --clip artifacts/segment-1.mov \
  --timeline artifacts/segment-1.timeline.json \
  --clip artifacts/segment-2.mov \
  --timeline artifacts/segment-2.timeline.json
```

使用合并结果建立 Studio 项目，不手工猜测剪辑点或修改事件时间。
