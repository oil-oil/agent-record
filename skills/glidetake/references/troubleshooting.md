# 故障处理

先判断问题来自录制数据、项目配置还是最终渲染，不要靠反复盲调参数。

## 录制服务未启动或停止失败

```bash
npm run agent-record -- doctor
npm run agent-record -- status
```

确认 macOS、目标浏览器、FFmpeg/ffprobe、屏幕录制权限和本地服务均正常。`start --app` 必须填写实际目标应用名，例如 `Google Chrome` 或 `ego lite`；页面事件桥未返回 `ready` 时刷新目标页面并重查。`stop` 失败时保留终端 JSON 错误，不要把不完整会话交给 Studio。

## 鼠标或镜头卡顿

```bash
npm run cursor:check -- <会话目录>/timeline.json
npm run focus:check -- <会话目录>/timeline.json
```

确认时间轴包含持续变化的鼠标坐标、真实点击和正确视口。若时间轴错误，重新运行完整的 `start`→浏览器自动化→`stop` 流程；若检查通过但视频异常，重新验证项目配置并用 `final` 渲染。

不要通过整体倍速、光流补帧、拖影或整帧模糊掩盖问题。

## 点击或输入位置不准

确认 `stop` 返回的视频和时间轴来自同一次会话，且没有手工修改事件时间、分辨率或裁切。跨标签页素材必须先用 `recordings:merge` 合并，再建立项目。

## 画面模糊或帧率不足

1. 检查 `<会话目录>/manifest.json` 中的捕获尺寸和帧率。
2. 检查项目清晰度是否为 `2k` 或明确要求的 `4k`。
3. 使用 `--quality final` 重新渲染。
4. 用 `verify_demo.sh` 检查真实宽高、平均 60fps 和完整解码。

不能把低清源放大后宣称为 2K/4K。

## 没有自定义光标

确认项目使用 `cursor: studio`，会话时间轴包含鼠标事件，并检查最终成片而不是原始素材。

## 会话产物不完整

成功会话必须同时包含 `capture.mov`、`timeline.json` 和 `manifest.json`。缺少任一文件、`manifest.status` 不是 `completed` 或视频无法完整解码时，删除该项目引用并重新录制；不要手工补写清单。

## 背景抢内容

换用明亮、低频、低干扰背景，保持白色浏览器顶栏。避免暗角、脏灰、小纹理和高对比细节。
