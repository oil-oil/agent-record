import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { access, stat } from "node:fs/promises";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const demoRoot = fileURLToPath(new URL("../demo-site/", import.meta.url));
const studioRoot = fileURLToPath(new URL("../studio/", import.meta.url));
const studioDistRoot = fileURLToPath(new URL("../studio/dist/", import.meta.url));
const artifactsRoot = fileURLToPath(new URL("../artifacts/", import.meta.url));
const port = Number(process.env.DEMO_PORT || 4173);
const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webm": "video/webm",
  ".mp4": "video/mp4",
  ".webp": "image/webp",
};

function safeFilePath(base, relativePath) {
  const normalized = normalize(relativePath).replace(/^(\.\.[/\\])+/, "");
  const filePath = resolve(join(base, normalized));
  const basePath = resolve(base);
  if (filePath !== basePath && !filePath.startsWith(`${basePath}${sep}`)) {
    throw new Error("非法文件路径");
  }
  return filePath;
}

async function sendFile(request, response, filePath) {
  const fileStat = await stat(filePath);
  if (!fileStat.isFile()) throw new Error("不是文件");

  const contentType =
    mimeTypes[extname(filePath).toLowerCase()] || "application/octet-stream";
  const range = request.headers.range;
  const baseHeaders = {
    "Accept-Ranges": "bytes",
    "Cache-Control": "no-store",
    "Content-Type": contentType,
  };

  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!match) {
      response.writeHead(416, {
        ...baseHeaders,
        "Content-Range": `bytes */${fileStat.size}`,
      });
      response.end();
      return;
    }
    const start = match[1] ? Number(match[1]) : 0;
    const end = match[2]
      ? Math.min(Number(match[2]), fileStat.size - 1)
      : fileStat.size - 1;
    if (start > end || start >= fileStat.size) {
      response.writeHead(416, {
        ...baseHeaders,
        "Content-Range": `bytes */${fileStat.size}`,
      });
      response.end();
      return;
    }
    response.writeHead(206, {
      ...baseHeaders,
      "Content-Length": end - start + 1,
      "Content-Range": `bytes ${start}-${end}/${fileStat.size}`,
    });
    createReadStream(filePath, { start, end }).pipe(response);
    return;
  }

  response.writeHead(200, {
    ...baseHeaders,
    "Content-Length": fileStat.size,
  });
  createReadStream(filePath).pipe(response);
}

const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(
      new URL(request.url, "http://localhost").pathname,
    );

    let builtStudioRoot = studioRoot;
    try {
      await access(join(studioDistRoot, "index.html"));
      builtStudioRoot = studioDistRoot;
    } catch {
      // 尚未构建时保留源码入口，方便定位缺少构建步骤。
    }

    if (pathname === "/studio" || pathname === "/studio/") {
      await sendFile(request, response, join(builtStudioRoot, "index.html"));
      return;
    }

    if (pathname.startsWith("/studio/")) {
      await sendFile(
        request,
        response,
        safeFilePath(builtStudioRoot, pathname.slice("/studio/".length)),
      );
      return;
    }

    if (pathname.startsWith("/artifacts/")) {
      await sendFile(
        request,
        response,
        safeFilePath(artifactsRoot, pathname.slice("/artifacts/".length)),
      );
      return;
    }

    if (pathname === "/demo" || pathname === "/demo/") {
      await sendFile(request, response, join(demoRoot, "index.html"));
      return;
    }

    if (pathname.startsWith("/demo/")) {
      await sendFile(
        request,
        response,
        safeFilePath(demoRoot, pathname.slice("/demo/".length)),
      );
      return;
    }

    if (pathname === "/") {
      response.writeHead(302, { Location: "http://127.0.0.1:3000/" });
      response.end();
      return;
    }

    throw new Error("页面不存在");
  } catch {
    response.writeHead(404, {
      "Content-Type": "text/plain; charset=utf-8",
    });
    response.end("页面不存在");
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log("Agent Record 官网：另运行 npm run website:dev（http://127.0.0.1:3000）");
  console.log(`Agent Record Studio：http://127.0.0.1:${port}/studio/`);
  console.log(`Canvas AI 测试站：http://127.0.0.1:${port}/demo/`);
});
