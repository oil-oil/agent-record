# 配置与导出

录制完成后，使用 `npm run agent-record -- stop` JSON 中的 `video` 和 `timeline` 初始化项目；不要绕过会话清单手工拼接输入。

## 使用 CLI

CLI 是项目配置入口，不直接手改 JSON。

```bash
npm run studio:cli -- show --file artifacts/demo-project.json

npm run studio:cli -- set \
  --file artifacts/demo-project.json \
  --background glass-sunrise \
  --shell browser \
  --address "https://example.com/product" \
  --zoom 1.20 \
  --cursor studio \
  --cursor-size 30 \
  --padding 40 \
  --radius 18 \
  --shadow 24 \
  --resolution 2k

npm run studio:cli -- validate --file artifacts/demo-project.json
```

不确定参数时运行：

```bash
npm run studio:cli -- help
```

## 默认选择

- 背景：明亮、干净、低干扰；优先使用项目内已授权素材。
- 套壳：网页演示用 `browser`；素材已带浏览器外观时用 `card` 或 `none`。
- 地址栏：优先用户提供的网址，其次使用时间轴真实网址。
- 光标：`studio`。
- 聚焦：`1.20`。
- 留白：`40`。
- 清晰度：默认 `2k`（2560×1440）；用户明确要求时才用 `4k`。

Studio 会自动处理点击、输入、镜头、光标和页面切换。AI 只需提供准确的录制数据与项目配置，不重复模拟这些效果。

## 演示说明

只为关键动作添加简短说明：

```bash
npm run studio:cli -- caption-add \
  --file artifacts/demo-project.json \
  --text "应用选择，继续生成" \
  --start 8.2 \
  --duration 3.2 \
  --position bottom-center
```

说明放在不遮挡关键操作的位置，不逐点击解释。

## 渲染

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

预览只用于检查构图。最终交付使用 `final` 生成，并完成规格与解码验收。
