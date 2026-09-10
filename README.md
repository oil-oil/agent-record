# Agent Record Skill

让 AI 在用户已经打开的 Chrome 或 Ego Lite 中规划、录制并制作产品 Demo。

本仓库只包含公开的 Agent Skill。浏览器扩展免费；本地 Companion 提供录制与导出能力。Free 可导出带水印的 1080p30，Pro 可导出无水印的 2K/4K60，并允许商业使用。

## Skill 在哪里

Skill 目录是：

```text
skills/agent-record/
```

其中 `SKILL.md` 是入口，`scripts/` 是公开代理与安装器，`references/` 是操作规范。

## 安装到 Codex

```bash
git clone https://github.com/oil-oil/agent-record.git
mkdir -p "${CODEX_HOME:-$HOME/.codex}/skills"
cp -R agent-record/skills/agent-record "${CODEX_HOME:-$HOME/.codex}/skills/agent-record"
```

重新打开 Codex 后即可使用。首次运行会下载对应版本的 macOS Companion、校验 SHA256，并按锁文件安装开源渲染依赖；不会下载 Core 源码。

## 首次检查

```bash
node "${CODEX_HOME:-$HOME/.codex}/skills/agent-record/scripts/agent-record-proxy.mjs" bootstrap
node "${CODEX_HOME:-$HOME/.codex}/skills/agent-record/scripts/agent-record-proxy.mjs" doctor
```

当前首版只支持 macOS。还需要 Node.js 22、npm、FFmpeg，以及用户自己确认浏览器扩展和屏幕录制权限。

## 收费边界

- Skill：开源免费。
- 浏览器扩展：免费，随 Companion 提供。
- Free：1080p30、带水印、仅非商业使用。
- Pro：2K/4K60、无水印、允许商业使用，按账号与设备授权。

购买和设备管理入口会在官网开放。授权由服务端签发，客户端只保存公钥和短期离线凭证。

## 隐私

录制素材、时间轴和导出视频默认只保存在本机。授权请求只需要账号、设备标识和订阅状态，不上传录制内容。

## 许可证

本仓库的公开 Skill 采用 [GNU AGPL-3.0-only](LICENSE)。Agent Record 名称与标识的使用规则见 [TRADEMARKS.md](TRADEMARKS.md)。Companion 不包含在本许可证授权范围内。

## 配置、依赖与使用边界

需要 Agent Record CLI、已配置的录制扩展及受支持浏览器；具体导出规格受账号档位影响。先运行 doctor。

只关闭本任务创建的标签页，不关用户原有页面。免费降级如实报告，不能拿不存在的 2K60 权限作默认验收要求。

使用示例：

```text
录制一个 10 秒产品操作视频，按我的实际授权档位导出。
```

## GitHub 安装

把 [仓库地址](https://github.com/oil-oil/agent-record) 交给 Agent，要求按 README 安装；也可运行：

```bash
npx skills add oil-oil/agent-record
```

安装后由宿主重新加载 Skill。
