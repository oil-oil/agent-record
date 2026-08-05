export default function TermsPage() {
  return (
    <main className="legal-page">
      <a className="brand" href="/"><img src="/assets/logo.png" alt="" /><span>Agent Record</span></a>
      <article>
        <h1>使用条款</h1>
        <p>Agent Record 是用于本地录制、编辑和导出网页演示的开源工具。</p>
        <h2>代码许可</h2>
        <p>项目代码采用 AGPL-3.0-only。复制、修改或分发代码时，请遵守仓库中的 LICENSE。</p>
        <h2>品牌与素材</h2>
        <p>Agent Record 名称、Logo 和品牌素材不包含在代码许可中。衍生项目需要使用自己的名称与视觉标识。</p>
        <h2>使用责任</h2>
        <p>请确保录制内容、网页操作和导出视频符合适用法律与第三方网站规则。</p>
      </article>
    </main>
  );
}
