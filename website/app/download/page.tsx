export default function DownloadPage() {
  const releaseUrl = process.env.RELEASE_DOWNLOAD_URL;
  const sourceUrl = process.env.SOURCE_REPOSITORY_URL;
  const canDownload = typeof releaseUrl === "string" && /^https:\/\//i.test(releaseUrl);
  const canViewSource = typeof sourceUrl === "string" && /^https:\/\//i.test(sourceUrl);

  return (
    <main className="legal-page">
      <a className="brand" href="/"><img src="/assets/logo.png" alt="" /><span>Agent Record</span></a>
      <article>
        <h1>下载 Agent Record</h1>
        <p>Agent Record 免费开源。桌面包包含 Studio、CLI、本地渲染器、Chrome 扩展和 <code>glidetake</code> Skill。</p>
        <div className="download-actions">
          {canDownload && <a className="button button-primary" href={releaseUrl}>下载桌面包 ↗</a>}
          {canViewSource && <a className="button button-secondary" href={sourceUrl}>查看源码 ↗</a>}
        </div>
        {!canDownload && <p>预编译包正在准备。现在可以从源码安装，或稍后查看项目的 Releases 页面。</p>}

        <h2>1. 安装</h2>
        <p>下载并解压后，在项目目录运行：</p>
        <pre><code>{`npm ci
npm run check`}</code></pre>

        <h2>2. 加载 Chrome 扩展</h2>
        <p>打开 <code>chrome://extensions</code>，开启开发者模式，选择“加载已解压的扩展程序”，然后选中 <code>extension/</code>。</p>

        <h2>3. 交给 AI</h2>
        <p>把 <code>skills/glidetake/</code> 复制到 AI Agent 的 Skill 目录。告诉 AI 目标网址与操作步骤，它会负责录制、剪辑和导出。</p>

        <p><a className="text-link" href="/">返回首页 ↗</a></p>
      </article>
    </main>
  );
}
