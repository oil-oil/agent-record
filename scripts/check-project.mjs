import { access, readFile, readdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const requiredFiles = [
  "README.md",
  "LICENSE",
  "TRADEMARKS.md",
  "PRIVACY.md",
  "THIRD_PARTY_NOTICES.md",
  ".github/workflows/ci.yml",
  ".github/workflows/release.yml",
  "extension/manifest.json",
  "extension/background.js",
  "extension/content.js",
  "extension/popup.html",
  "extension/popup.js",
  "extension/icons/icon16.png",
  "extension/icons/icon32.png",
  "extension/icons/icon48.png",
  "extension/icons/icon128.png",
  "website/package.json",
  "website/package-lock.json",
  "website/next.config.mjs",
  "website/postcss.config.mjs",
  "website/app/layout.tsx",
  "website/app/page.tsx",
  "website/app/globals.css",
  "website/app/download/page.tsx",
  "website/app/privacy/page.tsx",
  "website/app/support/page.tsx",
  "website/app/terms/page.tsx",
  "website/public/assets/logo.png",
  "website/public/assets/app-icon.png",
  "website/public/assets/demo.mp4",
  "website/public/assets/demo-poster.jpg",
  "website/public/assets/studio.png",
  "demo-site/index.html",
  "demo-site/app.js",
  "studio/index.html",
  "studio/public/brand/icon-32.png",
  "studio/public/brand/icon-180.png",
  "studio/public/brand/app-icon.png",
  "studio/public/brand/logo.png",
  "studio/public/wallpapers/refined-aqua-fold.png",
  "studio/public/wallpapers/refined-blue-horizon.png",
  "studio/public/wallpapers/refined-indigo-ridges.png",
  "studio/public/wallpapers/refined-orange-rays.png",
  "studio/public/wallpapers/refined-orange-sculpture.png",
  "studio/public/wallpapers/refined-prismatic-ribbon.png",
  "studio/public/wallpapers/refined-soft-amber.png",
  "studio/public/wallpapers/refined-violet-arch.png",
  "studio/public/wallpapers/refined-white-silver-fold.png",
  "studio/public/wallpapers/previews/refined-aqua-fold.webp",
  "studio/public/wallpapers/previews/refined-blue-horizon.webp",
  "studio/public/wallpapers/previews/refined-indigo-ridges.webp",
  "studio/public/wallpapers/previews/refined-orange-rays.webp",
  "studio/public/wallpapers/previews/refined-orange-sculpture.webp",
  "studio/public/wallpapers/previews/refined-prismatic-ribbon.webp",
  "studio/public/wallpapers/previews/refined-soft-amber.webp",
  "studio/public/wallpapers/previews/refined-violet-arch.webp",
  "studio/public/wallpapers/previews/refined-white-silver-fold.webp",
  "studio/vite.config.ts",
  "studio/tsconfig.json",
  "studio/src/App.tsx",
  "studio/src/caption-style.ts",
  "studio/src/cursor-motion.ts",
  "studio/src/TimelineAdapter.tsx",
  "studio/src/VideoComposition.tsx",
  "studio/src/exporter.ts",
  "studio/src/index.css",
  "studio/src/main.tsx",
  "studio/src/media-duration.ts",
  "studio/src/types.ts",
  "studio/src/ui.tsx",
  "studio/src/visuals.ts",
  "scripts/studio-cli.mjs",
  "scripts/agent-record.mjs",
  "scripts/agent-record-daemon.mjs",
  "scripts/lib/agent-record-runtime.mjs",
  "scripts/process-video.mjs",
  "scripts/verify-cursor-motion.mjs",
  "scripts/verify-focus-motion.mjs",
  "scripts/build-brand-assets.py",
  "scripts/package-release.mjs",
  "scripts/setup-extension.mjs",
  "scripts/verify-release.mjs",
  "scripts/render-project.mjs",
  "scripts/check-desktop.mjs",
  "shared/timeline-duration.mjs",
  "native/macos/Package.swift",
  "native/macos/Sources/AgentRecordCapture/main.swift",
  "tests/production.test.mjs",
  "skills/glidetake/SKILL.md",
  "skills/glidetake/version.json",
  "skills/glidetake/scripts/bootstrap.mjs",
  "skills/glidetake/scripts/agent-record-proxy.mjs",
  "assets/brand/agent-record-logo-source.png",
  "assets/brand/agent-record-logo.png",
  "assets/brand/agent-record-app-icon.png",
  "distribution/desktop/package.json",
  "distribution/desktop/README.md",
];

for (const file of requiredFiles) {
  await access(resolve(root, file));
}

const manifest = JSON.parse(
  await readFile(resolve(root, "extension/manifest.json"), "utf8"),
);
const packageJson = JSON.parse(
  await readFile(resolve(root, "package.json"), "utf8"),
);
const skillVersion = JSON.parse(
  await readFile(resolve(root, "skills/glidetake/version.json"), "utf8"),
);
if (manifest.manifest_version !== 3) {
  throw new Error("扩展必须使用 Manifest V3");
}
if (manifest.version !== packageJson.version) {
  throw new Error(
    `版本不一致：package=${packageJson.version}，extension=${manifest.version}`,
  );
}
if (skillVersion.version !== packageJson.version) {
  throw new Error(`版本不一致：package=${packageJson.version}，skill=${skillVersion.version}`);
}
if (skillVersion.releaseTag !== `v${packageJson.version}`) {
  throw new Error(`Skill releaseTag 不一致：期望 v${packageJson.version}，实际 ${skillVersion.releaseTag}`);
}
if (skillVersion.desktopAsset !== `agent-record-desktop-${packageJson.version}.zip`) {
  throw new Error(`Skill desktopAsset 不一致：期望 agent-record-desktop-${packageJson.version}.zip，实际 ${skillVersion.desktopAsset}`);
}
if (packageJson.private !== true) {
  throw new Error("根包必须保持 private，避免误发布到 npm");
}
if (packageJson.license !== "AGPL-3.0-only") {
  throw new Error("项目代码许可必须与 LICENSE 一致");
}
if (!packageJson.scripts?.test || !packageJson.scripts?.["release:package"]) {
  throw new Error("缺少自动测试或发布打包脚本");
}
for (const size of ["16", "32", "48", "128"]) {
  if (!manifest.icons?.[size]) {
    throw new Error(`扩展缺少 ${size}px 图标配置`);
  }
}

const scriptFiles = (await readdir(resolve(root, "scripts")))
  .filter((file) => file.endsWith(".mjs"))
  .map((file) => `scripts/${file}`);
const javascriptFiles = [
  "extension/background.js",
  "extension/content.js",
  "extension/popup.js",
  "website/next.config.mjs",
  "website/postcss.config.mjs",
  "demo-site/app.js",
  "shared/timeline-duration.mjs",
  ...scriptFiles,
];

for (const file of javascriptFiles) {
  await new Promise((resolvePromise, rejectPromise) => {
    const process = spawn("node", ["--check", resolve(root, file)], {
      stdio: "inherit",
    });
    process.on("close", (code) => {
      if (code === 0) resolvePromise();
      else rejectPromise(new Error(`${file} 语法检查失败`));
    });
  });
}

const renderSource = await readFile(
  resolve(root, "scripts/render-project.mjs"),
  "utf8",
);
if (renderSource.includes("src: `/public/glidetake-input/")) {
  throw new Error("Remotion public-dir 路径不能包含 /public 前缀");
}
if (!renderSource.includes("'--no-install'")) {
  throw new Error("离线渲染必须禁止 npx 临时下载依赖");
}

console.log(
  `项目检查通过：${requiredFiles.length} 个文件完整，${javascriptFiles.length} 个 JS/MJS 文件语法正常。`,
);
