# Agent Record 官网

这是可部署到 Vercel 的 Next.js 官网，只包含产品介绍、Demo、下载说明和公开文档，不需要 Stripe、Supabase 或账号系统。

## 本地运行

```bash
npm ci
npm run dev
```

访问 `http://127.0.0.1:3000`。

## 部署

在 Vercel 中导入仓库，将 Root Directory 设为 `website`。构建命令使用 `npm run build`。

可选环境变量：

- `RELEASE_DOWNLOAD_URL`：桌面发布包的 HTTPS 下载地址。
- `SOURCE_REPOSITORY_URL`：公开源码仓库地址。

两个变量都未配置时，下载页会显示从源码安装的说明，不会报错。
