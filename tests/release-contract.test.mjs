import assert from 'node:assert/strict';
import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { constants } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import test from 'node:test';
import { cameraAt } from '../studio/src/visuals.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => readFile(path.join(root, file), 'utf8');
const exists = async (file) => access(path.join(root, file), constants.F_OK);

test('0.6.0 候选版本在 npm 包与扩展清单中一致', async () => {
  const pkg = JSON.parse(await read('package.json'));
  const manifest = JSON.parse(await read('extension/manifest.json'));
  assert.equal(pkg.version, '0.6.0');
  assert.equal(manifest.version, pkg.version);
});

test('扩展使用 Manifest V3，并且只承担本地事件桥职责', async () => {
  const manifest = JSON.parse(await read('extension/manifest.json'));
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.background?.type, 'module');
  assert.equal(manifest.content_scripts[0].all_frames, true);
  for (const permission of ['debugger', 'tabCapture', 'offscreen', 'downloads']) {
    assert.equal((manifest.permissions ?? []).includes(permission), false);
  }
  await exists(`extension/${manifest.background.service_worker}`);
  await exists(path.join('extension', manifest.action.default_popup.replace(/^\//, '')));
  for (const file of manifest.content_scripts.flatMap((entry) => entry.js ?? [])) {
    await exists(`extension/${file}`);
  }

  const source = await read('extension/content.js');
  assert.match(source, /dataset\.aiDemoRecorder\s*=\s*["']ready/);
  assert.match(source, /beforeinput/);
  assert.match(source, /compositionend/);
  assert.match(source, /FRAME_RELAY_TYPE/);
  assert.match(source, /detectRouteChange/);
  assert.match(source, /LOCAL_STATUS/);
  assert.doesNotMatch(source, /data-ai-demo-recorder-toggle|TOGGLE_RECORDING_FROM_PAGE|F8/);
  const background = await read('extension/background.js');
  assert.match(background, /SERVICE_ORIGIN = "http:\/\/127\.0\.0\.1:43127"/);
  assert.match(background, /\/v1\/status/);
  assert.match(background, /\/v1\/target/);
  assert.match(background, /\/v1\/events/);
  assert.match(background, /x-agent-record-extension-origin/);
  assert.match(background, /x-agent-record-session-token/);
  assert.doesNotMatch(background, /chrome\.debugger|tabCapture|MediaRecorder|OFFSCREEN_/);
  await assert.rejects(exists('extension/offscreen.html'));
  await assert.rejects(exists('extension/offscreen.js'));
});

test('本地录制内核使用 ScreenCaptureKit 且不包含第二条浏览器采集路径', async () => {
  const runtime = await read('scripts/lib/agent-record-runtime.mjs');
  const cli = await read('scripts/agent-record.mjs');
  const native = await read('native/macos/Sources/AgentRecordCapture/main.swift');
  assert.match(runtime, /RecordingDaemon/);
  assert.match(runtime, /ScreenCaptureKit/);
  assert.match(runtime, /MAX_EVENTS = 20_000/);
  assert.match(cli, /doctor/);
  assert.match(cli, /start/);
  assert.match(cli, /status/);
  assert.match(cli, /stop/);
  assert.match(native, /import ScreenCaptureKit/);
  assert.match(native, /SCContentFilter\(desktopIndependentWindow:/);
  assert.match(native, /configuration\.showsCursor = false/);
  assert.doesNotMatch(runtime, /chrome\.debugger|tabCapture|MediaRecorder/);
});

test('CLI 拒绝没有视频和时间轴的空项目', async () => {
  const output = path.join(root, 'tests', '.empty-project.json');
  const result = await new Promise((resolve) => {
    const child = spawn(process.execPath, ['scripts/studio-cli.mjs', 'init', '--out', output], {
      cwd: root,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('close', (code) => resolve({ code, output: `${stdout}\n${stderr}` }));
  });
  await import('node:fs/promises').then(({ rm }) => rm(output, { force: true }));
  assert.notEqual(result.code, 0, `CLI 不应创建空项目：${result.output}`);
  assert.match(result.output, /视频|video|时间轴|timeline/i);
});

test('Remotion 使用 studio/public 根目录下的项目输入路径', async () => {
  const renderer = await read('scripts/render-project.mjs');
  assert.match(renderer, /path\.join\(root, ['"]studio\/public\/glidetake-input['"]\)/);
  assert.match(renderer, /['"]--public-dir=studio\/public['"]/);
  assert.match(renderer, /src:\s*`glidetake-input\/\$\{cachedName\}`/);
  assert.match(renderer, /acquireRenderLock/);
  assert.match(renderer, /prepareCachedVideo/);
  assert.match(renderer, /availableParallelism\(\)/);
  assert.match(renderer, /--x264-preset=/);
  assert.match(renderer, /--hardware-acceleration=if-possible/);
  assert.match(renderer, /不支持的导出清晰度/);
  assert.doesNotMatch(renderer, /--bundle-cache=false/);
  assert.doesNotMatch(renderer, /requireValidLicense|LICENSE_BYPASS|SKIP_LICENSE/);

  const entry = await read('studio/src/remotion-entry.tsx');
  assert.match(entry, /src:\s*['"]{2}/);
  assert.doesNotMatch(entry, /studio\/public/);
  const composition = await read('studio/src/VideoComposition.tsx');
  assert.match(composition, /src\.startsWith\(['"]glidetake-input\/['"]\)\s*\?\s*staticFile\(src\)/);
  const exporter = await read('studio/src/exporter.ts');
  assert.match(exporter, /segmentAddressAt\(sourceSegments,\s*video\.currentTime,\s*style\.browserUrl,\s*events\)/);
  assert.match(exporter, /draw\(\);\s*ctx\.getImageData[\s\S]+recorder\.start\(400\)/);
});

test('剪辑使用完整操作场景，多尺寸录制在合并前统一画布', async () => {
  const processor = await read('scripts/process-video.mjs');
  const segmenter = await read('scripts/lib/scene-segmentation.mjs');
  const merger = await read('scripts/merge-recordings.mjs');

  assert.match(processor, /createSceneSegments/);
  assert.match(processor, /remapSceneTimeline/);
  assert.match(segmenter, /input-session-inferred/);
  assert.doesNotMatch(segmenter, /\["page",\s*"move",\s*"click"/);
  assert.match(merger, /force_original_aspect_ratio=increase/);
  assert.match(merger, /crop=\$\{width\}:\$\{height\}/);
  assert.doesNotMatch(merger, /合并片段的分辨率必须一致/);
});

test('发布脚本使用扩展白名单且源码不保留废弃壁纸系列', async () => {
  const packager = await read('scripts/package-release.mjs');
  assert.match(packager, /EXTENSION_FILES/);
  assert.match(packager, /allowedFiles:\s*EXTENSION_FILES/);
  assert.match(packager, /agent-record-extension-\$\{version\}\.zip/);
  assert.doesNotMatch(await read('studio/src/types.ts'), /shots-|v2-/);
  assert.doesNotMatch(await read('studio/src/visuals.ts'), /shots-|v2-/);
  assert.doesNotMatch(await read('scripts/studio-cli.mjs'), /shots-|v2-/);
  assert.match(packager, /agent-record-desktop-\$\{version\}\.zip/);
  assert.match(packager, /file\.startsWith\(['"]scripts\/['"]\)/);
  assert.match(packager, /file\.startsWith\(['"]shared\/['"]\)/);
  assert.match(packager, /file\.startsWith\(['"]studio\/src\/['"]\)/);
  assert.match(packager, /bin\/agent-record-capture/);
  assert.match(packager, /copyDirectory\(['"]native\/macos['"]/);
  assert.match(packager, /file\.startsWith\(['"]native\/macos\/['"]\)/);
  assert.match(packager, /node_modules/);
  assert.match(packager, /file !== ['"]\.env\.example['"]/);
  assert.match(packager, /\.tsbuildinfo/);
  assert.match(packager, /copyDirectory\(['"]extension['"]\)/);
  assert.match(packager, /copyDirectory\(['"]skills\/glidetake['"]\)/);
  assert.match(packager, /distribution\/desktop\/package\.json/);
  assert.match(packager, /distribution\/desktop\/README\.md/);
  assert.match(packager, /copyFile\(['"]LICENSE['"]\)/);
  assert.match(packager, /extraFiles/);
});

test('两万条操作事件可在两秒内建立镜头轨迹', () => {
  const events = Array.from({ length: 20_000 }, (_, index) => {
    const progress = (index % 500) / 499;
    const reverse = Math.floor(index / 500) % 2 === 1;
    return {
      kind: index > 0 && index % 1_000 === 0 ? 'click' : index === 0 ? 'page' : 'move',
      tMs: index * 5,
      nx: .05 + .9 * progress,
      ny: .1 + .8 * (reverse ? 1 - progress : progress),
      viewportWidth: 1440,
      viewportHeight: 900,
    };
  });
  const startedAt = performance.now();
  const camera = cameraAt(events, 99);
  const elapsed = performance.now() - startedAt;
  assert(camera, '大时间轴应生成有效镜头位置');
  assert(elapsed < 2_000, `两万事件镜头计算过慢：${elapsed.toFixed(1)}ms`);
});

test('Skill 与 references 保持 2K60、1.20、本地 CLI 和真实渲染命令', async () => {
  const files = [
    'skills/glidetake/SKILL.md',
    'skills/glidetake/references/recording.md',
    'skills/glidetake/references/studio-and-export.md',
    'skills/glidetake/references/troubleshooting.md',
    'skills/glidetake/evals/evals.json',
  ];
  const content = await Promise.all(files.map(read));
  const all = content.join('\n');
  assert.match(all, /2k|2K/);
  assert.match(all, /60fps/);
  assert.match(all, /1\.20/);
  assert.match(all, /agent-record/);
  assert.match(all, /start/);
  assert.match(all, /stop/);
  assert.match(all, /npm run studio:render/);
  assert.match(all, /--quality final/);
  assert.doesNotMatch(all, /1\.52/);
  assert.doesNotMatch(all, /预聚焦/);
  assert.doesNotMatch(all, /Agent Record：开始或停止录制/);
});

test('独立 Skill 包含版本清单、bootstrap 和代理流程', async () => {
  const skill = await read('skills/glidetake/SKILL.md');
  const version = JSON.parse(await read('skills/glidetake/version.json'));
  const bootstrap = await read('skills/glidetake/scripts/bootstrap.mjs');
  const proxy = await read('skills/glidetake/scripts/agent-record-proxy.mjs');
  assert.equal(version.version, '0.6.0');
  assert.equal(version.repo, 'oil-oil/agent-record');
  assert.equal(version.releaseTag, `v${version.version}`);
  assert.equal(version.desktopAsset, `agent-record-desktop-${version.version}.zip`);
  assert.match(version.desktopAsset, /agent-record-desktop-0\.6\.0\.zip/);
  assert.match(bootstrap, /AGENT_RECORD_ROOT/);
  assert.match(bootstrap, /AGENT_RECORD_RELEASE_BASE_URL/);
  assert.match(bootstrap, /SHA256SUMS/);
  assert.match(bootstrap, /npm.*ci/);
  assert.match(bootstrap, /native:build/);
  assert.match(proxy, /doctor/);
  assert.match(proxy, /setup-extension/);
  assert.match(proxy, /start/);
  assert.match(proxy, /process/);
  assert.match(proxy, /studio-cli|studio/);
  assert.match(proxy, /render/);
  assert.match(skill, /Explore.*脚本.*重置页面.*start/s);
  assert.match(skill, /process/);
  assert.match(skill, /dataset\.aiDemoRecorder/);
  assert.match(skill, /agent-record-proxy\.mjs["']?\s+extension/);
  assert.match(skill, /不会.*chrome:\/\/extensions/);
});

test('标签发布工作流在 macOS 构建并上传完整 Release', async () => {
  const workflow = await read('.github/workflows/release.yml');
  assert.match(workflow, /tags:[\s\S]*['"]v\*['"]/);
  assert.match(workflow, /contents:\s*write/);
  assert.match(workflow, /runs-on:\s*macos-14/);
  assert.match(workflow, /npm run release:build/);
  assert.match(workflow, /PACKAGE_VERSION=/);
  assert.doesNotMatch(workflow, /node -p \\\\"/);
  assert.match(workflow, /gh release create/);
  assert.match(workflow, /release\/\*/);
});

test('开源扩展提供单命令安装引导', async () => {
  const [rootPackage, desktopPackage, setup, readme] = await Promise.all([
    read('package.json'),
    read('distribution/desktop/package.json'),
    read('scripts/setup-extension.mjs'),
    read('README.md'),
  ]);
  assert.equal(JSON.parse(rootPackage).scripts['extension:setup'], 'node scripts/setup-extension.mjs');
  assert.equal(JSON.parse(desktopPackage).scripts['extension:setup'], 'node scripts/setup-extension.mjs');
  assert.match(setup, /chrome:\/\/extensions/);
  assert.match(setup, /extensionDirectory/);
  assert.match(setup, /加载已解压的扩展程序/);
  assert.match(readme, /npm run extension:setup/);
});

test('README 第一屏明确正式支持的系统与浏览器', async () => {
  const readme = await read('README.md');
  assert.match(readme, /macOS 13/);
  assert.match(readme, /Chrome 116/);
  assert.match(readme, /暂不支持 Windows、Linux、Firefox 和 Safari/);
  assert.match(readme, /屏幕录制权限/);
});

test('扩展安装命令同步到固定目录且可重复更新', async () => {
  const supportRoot = await mkdtemp(path.join(tmpdir(), 'agent-record-extension-'));
  try {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const result = spawnSync(process.execPath, ['scripts/setup-extension.mjs', '--no-open'], {
        cwd: root,
        env: { ...process.env, AGENT_RECORD_APP_SUPPORT: supportRoot },
        encoding: 'utf8',
      });
      assert.equal(result.status, 0, result.stderr);
    }
    const installed = JSON.parse(await readFile(path.join(supportRoot, 'extension/manifest.json'), 'utf8'));
    const source = JSON.parse(await read('extension/manifest.json'));
    assert.equal(installed.name, source.name);
    assert.equal(installed.version, source.version);
  } finally {
    await rm(supportRoot, { recursive: true, force: true });
  }
});

test('发布与项目检查脚本拒绝 Skill 版本清单漂移', async () => {
  const packager = await read('scripts/package-release.mjs');
  const checker = await read('scripts/check-project.mjs');
  for (const source of [packager, checker]) {
    assert.match(source, /skills\/glidetake\/version\.json/);
    assert.match(source, /skillManifest|skillVersion/);
    assert.match(source, /releaseTag/);
    assert.match(source, /desktopAsset/);
    assert.match(source, /agent-record-desktop-\$\{.*version.*\}\.zip/);
  }
});
