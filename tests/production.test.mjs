import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('开源候选的公开说明与发布清单存在', async () => {
  for (const file of ['README.md', 'LICENSE', 'TRADEMARKS.md', 'PRIVACY.md', 'THIRD_PARTY_NOTICES.md', '.github/workflows/ci.yml']) {
    await access(path.join(root, file), constants.F_OK);
  }
  const readme = await readFile(path.join(root, 'README.md'), 'utf8');
  assert.match(readme, /website\/public\/assets\/demo\.mp4/);
  assert.match(readme, /本地处理/);
  assert.match(readme, /AGPL-3\.0-only/);
  assert.doesNotMatch(readme, /raycast-ai-demo-retina-4k60\.mp4/);
});

test('离线渲染契约不使用临时安装或错误 public 前缀', async () => {
  const source = await readFile(path.join(root, 'scripts/render-project.mjs'), 'utf8');
  assert.match(source, /--no-install/);
  assert.match(source, /--public-dir=studio\/public/);
  assert.match(source, /src:\s*`agent-record-input\//);
  const composition = await readFile(path.join(root, 'studio/src/VideoComposition.tsx'), 'utf8');
  assert.match(composition, /staticFile\(src\)/);
});
