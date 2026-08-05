import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  root: import.meta.dirname,
  base: "./",
  plugins: [react(), tailwindcss()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    // 桌面编辑器主包包含 Remotion Player；真实门槛由 gzip 预算脚本检查。
    chunkSizeWarningLimit: 650,
  },
});
