import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "山海课伴",
  description: "懂教材，也懂课堂的 AI 备课助手。",
  icons: {
    icon: "/brand/shanhai-ai-logo-256.png",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}

