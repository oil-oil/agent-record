import type { ReactNode } from "react";

export default function PrivacyPage() {
  return (
    <LegalPage title="隐私说明">
      <p>Agent Record 以本地处理为默认原则。录制文件、操作事件与导出项目保存在你的设备上，不会因为使用扩展而自动上传。</p>
      <h2>扩展处理的数据</h2>
      <p>用户或 AI 主动开始录制后，本地 ScreenCaptureKit 服务捕获指定浏览器窗口；扩展只记录鼠标、点击、输入位置、滚动和页面切换事件，不保存输入内容。</p>
      <h2>网站</h2>
      <p>官网只提供产品介绍、下载与文档，不要求注册账号，也不处理付款信息。</p>
      <h2>联系</h2>
      <p><a href="https://github.com/oil-oil/agent-record/issues">GitHub Issues</a></p>
    </LegalPage>
  );
}

function LegalPage({ title, children }: { title: string; children: ReactNode }) {
  return <main className="legal-page"><a className="brand" href="/"><img src="/assets/logo.png" alt="" /><span>Agent Record</span></a><article><h1>{title}</h1>{children}</article></main>;
}
