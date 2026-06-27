"use client";

import { useEffect, useState } from "react";
import { isKrMarketFocusKST } from "@/lib/marketDisplay";
import { KrMarketCard } from "@/components/kr-market-card";
import { UsMarketReportCard } from "@/components/us-market-report-card";
import { MarketViewToggle } from "@/components/market-view-parts";

const VIEW_KEY = "stockmind-market-view";

function loadSavedView(): "kr" | "us" | null {
  if (typeof window === "undefined") return null;
  const v = sessionStorage.getItem(VIEW_KEY);
  return v === "kr" || v === "us" ? v : null;
}

/** 국내/미국 토글 — 기본은 장 마감 여부에 따라 결정 */
export function MarketBriefingCard() {
  // SSR과 클라이언트 초기값이 일치하도록 sessionStorage를 초기값에 사용하지 않음
  const [view, setView] = useState<"kr" | "us">(() => isKrMarketFocusKST() ? "kr" : "us");

  useEffect(() => {
    // 하이드레이션 후 저장된 탭 선택을 복원
    const saved = loadSavedView();
    if (saved) setView(saved);
  }, []);

  useEffect(() => {
    sessionStorage.setItem(VIEW_KEY, view);
  }, [view]);

  const toggle = <MarketViewToggle view={view} onChange={setView} />;

  if (view === "us") {
    return <UsMarketReportCard cacheOnly marketToggle={toggle} />;
  }
  return <KrMarketCard marketToggle={toggle} />;
}
