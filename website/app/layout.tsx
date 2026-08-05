import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "Agent Record — 让 AI 自动录制产品 Demo",
  description: "免费的开源工具：让 AI 自动操作 Chrome，并生成带自然鼠标、聚焦镜头和字幕的产品 Demo。",
  icons: { icon: "/assets/app-icon.png" },
  referrer: "no-referrer",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}
