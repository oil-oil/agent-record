export default function SupportPage() {
  return (
    <main className="legal-page">
      <a className="brand" href="/"><img src="/assets/logo.png" alt="" /><span>Agent Record</span></a>
      <article>
        <h1>支持</h1>
        <p>遇到安装、录制或导出问题，请附上系统版本、操作步骤和错误日志。</p>
        <p><a className="text-link" href="https://github.com/oil-oil/agent-record/issues">提交 GitHub Issue ↗</a></p>
      </article>
    </main>
  );
}
