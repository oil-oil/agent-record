import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (file) => readFile(new URL(`../${file}`, import.meta.url), "utf8");

test("官网只保留开源下载路径", async () => {
  const [page, download, pkg] = await Promise.all([
    read("app/page.tsx"),
    read("app/download/page.tsx"),
    read("package.json"),
  ]);

  assert.match(page, /免费使用，也可以自己修改/);
  assert.match(download, /RELEASE_DOWNLOAD_URL/);
  assert.doesNotMatch(`${page}\n${download}`, /Stripe|checkout|购买|激活许可证/);

  const dependencies = JSON.parse(pkg).dependencies;
  assert.equal(dependencies.stripe, undefined);
  assert.equal(dependencies.postgres, undefined);
});
