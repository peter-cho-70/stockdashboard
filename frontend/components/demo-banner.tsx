"use client";

import { useEffect, useState } from "react";
import { Eye } from "lucide-react";
import { api } from "@/lib/api";

export function DemoBanner() {
  const [demo, setDemo] = useState(false);
  const [title, setTitle] = useState("데모 포트폴리오");

  useEffect(() => {
    api
      .health()
      .then((h) => {
        if (h.demo_mode) setDemo(true);
        else setDemo(false);
      })
      .catch(() => {});

    const base = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000/api";
    fetch(`${base}/demo/info`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.demo_mode && d?.title) setTitle(d.title);
      })
      .catch(() => {});
  }, []);

  if (!demo) return null;

  return (
    <div className="border-b border-amber-300/60 bg-amber-50 px-4 py-2 text-center text-xs text-amber-900 dark:border-amber-700/50 dark:bg-amber-950/40 dark:text-amber-200">
      <span className="inline-flex items-center justify-center gap-1.5 font-medium">
        <Eye size={14} />
        {title} — 실제 보유 자산과 무관한 샘플 데이터입니다
      </span>
    </div>
  );
}
