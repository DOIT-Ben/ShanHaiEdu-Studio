import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "山海媒体工作台",
  description: "线性 AI 备课工作台前端演示",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}

