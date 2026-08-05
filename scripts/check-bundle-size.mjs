#!/usr/bin/env node

import { gzipSync } from "node:zlib";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const assetsDir = path.join(root, "studio/dist/assets");
const files = (await readdir(assetsDir)).filter((file) => file.endsWith(".js"));
if (!files.length) throw new Error("Studio 尚未构建，无法检查包体积");

const chunks = await Promise.all(files.map(async (file) => {
  const content = await readFile(path.join(assetsDir, file));
  return { file, raw: content.length, gzip: gzipSync(content).length };
}));
const main = chunks.find(({ file }) => file.startsWith("index-"));
if (!main) throw new Error("找不到 Studio 主入口 chunk");

const totalGzip = chunks.reduce((sum, chunk) => sum + chunk.gzip, 0);
const mainBudget = 210 * 1024;
const totalBudget = 300 * 1024;
if (main.gzip > mainBudget) {
  throw new Error(`Studio 主包 gzip 超出 210KB：${main.gzip} bytes`);
}
if (totalGzip > totalBudget) {
  throw new Error(`Studio JS 总 gzip 超出 300KB：${totalGzip} bytes`);
}

console.log(JSON.stringify({
  main: { file: main.file, gzipBytes: main.gzip, budgetBytes: mainBudget },
  total: { chunks: chunks.length, gzipBytes: totalGzip, budgetBytes: totalBudget },
}, null, 2));
