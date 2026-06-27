import type { Metadata } from "next";
import "./globals.css";
import { AppShell } from "@/components/app-shell";

export const metadata: Metadata = {
  title: "StockMind — AI 주식 인텔리전스",
  description: "내 포트폴리오 중심 AI 주식 인텔리전스 플랫폼",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="ko"
      suppressHydrationWarning
      data-theme="light"
      className="h-full antialiased"
    >
      <head>
        {/* 테마 초기화 — React 19에서 body 안 script 태그 경고 방지용으로 head 인라인 처리 */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem("stockmind-theme")||"light";document.documentElement.setAttribute("data-theme",t);}catch(e){}})();`,
          }}
        />
      </head>
      <body className="flex min-h-full flex-col bg-[var(--background)] text-[var(--foreground)] transition-colors duration-200">
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
