"use client";

import { useRef, useState } from "react";

const features = [
  "浏览器扩展、Studio、CLI 与 AI Skill",
  "默认 2K60，可选 1080p 与 4K60",
  "自然鼠标、点击聚焦与镜头跟随",
  "录制与渲染全程保存在本机",
];

export default function HomePage() {
  const [videoPlaying, setVideoPlaying] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  function toggleVideo() {
    if (!videoRef.current) return;
    if (videoRef.current.paused) void videoRef.current.play();
    else videoRef.current.pause();
  }

  return (
    <>
      <header className="site-header">
        <a className="brand" href="/" aria-label="Agent Record 首页">
          <img src="/assets/logo.png" alt="" />
          <span>Agent Record</span>
        </a>
        <nav aria-label="主导航">
          <a href="#demo">Demo</a>
          <a href="#workflow">流程</a>
          <a href="#open-source">开源</a>
        </nav>
        <a className="header-action" href="/download">下载 <span aria-hidden="true">↗</span></a>
      </header>

      <main>
        <section id="product" className="hero reveal is-visible">
          <div className="hero-copy">
            <span className="kicker">AI 自动录制</span>
            <h1>AI 操作网页，<br />直接生成 Demo。</h1>
            <ul className="hero-features">
              <li>给出网址和操作目标，AI 自动完成浏览器操作。</li>
              <li>自动补上鼠标、镜头与字幕，导出可分享的 MP4。</li>
            </ul>
            <div className="hero-actions">
              <a className="button button-primary" href="/download">免费下载</a>
              <a className="button button-secondary" href="#workflow">查看工作方式</a>
            </div>
          </div>
          <div id="demo" className="hero-demo">
            <div className="film">
              <video ref={videoRef} src="/assets/demo.mp4" muted loop playsInline preload="metadata" poster="/assets/demo-poster.jpg" onPlay={() => setVideoPlaying(true)} onPause={() => setVideoPlaying(false)} />
              <button className="video-control" type="button" aria-label={videoPlaying ? "暂停演示" : "播放演示"} onClick={toggleVideo}>
                <span className="play-icon" aria-hidden="true" />
                <span className="control-label">{videoPlaying ? "暂停" : "播放"}</span>
              </button>
            </div>
          </div>
        </section>

        <section className="editor-section reveal is-visible">
          <div className="editor-copy">
            <span className="kicker">本地 Studio</span>
            <h2>常用设置已经整理成预设。</h2>
            <p>在 Studio 里调整背景、浏览器套壳、镜头、光标与字幕，预览满意后再导出，不需要从零学习剪辑软件。</p>
            <a className="text-link" href="/download">获取 Studio <span>↗</span></a>
          </div>
          <figure className="editor-shot"><img src="/assets/studio.png" alt="Agent Record Studio 的视频预览与参数面板" width={1440} height={900} loading="lazy" /></figure>
        </section>

        <section id="workflow" className="workflow reveal is-visible" aria-labelledby="workflow-title">
          <div className="section-heading"><span>录制流程</span><div className="heading-copy"><h2 id="workflow-title">从一句操作说明，到一支可以直接分享的 MP4。</h2></div></div>
          <div className="workflow-stage workflow-stage-simple">
            <article className="workflow-brief"><span className="workflow-object-label">用户提供 / Skill</span><strong>录制 Wolfcha Demo</strong><p>打开 GitHub Dashboard，搜索仓库并进入游戏输入 ID。</p><p className="workflow-brief-status"><i aria-hidden="true" />已交给 AI Agent</p></article>
            <article className="workflow-browser"><div className="workflow-browser-bar"><span className="workflow-traffic"><i /><i /><i /></span><span className="workflow-address">Chrome · github.com/dashboard</span><span className="workflow-recording"><i /> REC</span></div><div className="workflow-browser-body"><div className="workflow-search">oil-oil/wolfcha</div><div className="workflow-result"><span>W</span><strong>oil-oil / wolfcha</strong><small>打开仓库</small></div></div><div className="workflow-timeline"><b>Agent Record 扩展</b><small>mouse · click · input · scroll</small></div></article>
            <article className="workflow-output"><div className="workflow-output-preview"><span className="workflow-play" /></div><div><strong>demo.mp4</strong><span>H.264 · 2K · 60fps</span></div></article>
          </div>
        </section>

        <section id="open-source" className="open-source reveal is-visible" aria-labelledby="open-source-title">
          <div className="open-source-copy"><span className="kicker">开源</span><h2 id="open-source-title">免费使用，也可以自己修改。</h2><p>扩展、Studio、CLI 与 Skill 都在同一个项目中。没有账号、订阅或许可证激活。</p></div>
          <div className="open-source-card">
            <div className="open-source-line"><strong>AGPL-3.0</strong><span>开源许可</span></div>
            <ul>{features.map((feature) => <li key={feature}>{feature}</li>)}</ul>
            <a className="button button-primary" href="/download">下载 Agent Record <span aria-hidden="true">↗</span></a>
            <p className="source-note">代码采用 AGPL-3.0；产品名称、Logo 与品牌素材不包含在开源许可中。</p>
          </div>
        </section>
      </main>

      <footer><a className="brand footer-brand" href="/"><img src="/assets/logo.png" alt="" /><span>Agent Record</span></a><div className="footer-links"><a href="/privacy">隐私说明</a><a href="/terms">使用条款</a><a href="/support">支持</a></div></footer>
    </>
  );
}
