"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { useRoutineStore, phaseLabel, type DailyRoutine } from "@/lib/routineStore";

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  const days = ["일", "월", "화", "수", "목", "금", "토"];
  const [y, m, day] = dateStr.split("-");
  return `${y}.${m}.${day} (${days[d.getDay()]})`;
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  if (!value && value !== 0) return null;
  return (
    <div className="flex gap-3 py-2 border-b border-neutral-100 dark:border-neutral-800 last:border-0">
      <dt className="w-32 shrink-0 text-xs font-medium text-neutral-400">{label}</dt>
      <dd className="flex-1 text-sm text-neutral-800 dark:text-neutral-200 break-words">{value}</dd>
    </div>
  );
}

function PhaseCard({ n, r }: { n: number; r: DailyRoutine }) {
  const data = [null, r.phase1, r.phase2, r.phase3, r.phase4, r.phase5, r.phase6][n];
  if (!data) return null;

  const renderContent = () => {
    if (n === 1 && r.phase1) {
      const p = r.phase1;
      const sentText = p.marketSentiment === "risk_on" ? "🟢 위험 선호" : p.marketSentiment === "risk_off" ? "🔴 위험 회피" : "🟡 방향성 탐색";
      return (
        <dl>
          <Row label="나스닥" value={`${p.nasdaq > 0 ? "+" : ""}${p.nasdaq.toFixed(2)}%`} />
          <Row label="S&P 500" value={`${p.sp500 > 0 ? "+" : ""}${p.sp500.toFixed(2)}%`} />
          <Row label="SOX (반도체)" value={`${p.sox > 0 ? "+" : ""}${p.sox.toFixed(2)}%`} />
          <Row label="VIX" value={p.vix.toFixed(1)} />
          <Row label="오늘 분위기" value={sentText} />
          <Row label="메모" value={p.memo || null} />
        </dl>
      );
    }
    if (n === 2 && r.phase2) {
      const p = r.phase2;
      const dirText = p.futuresDirection === "up" ? "▲ 상승" : p.futuresDirection === "down" ? "▼ 하락" : "— 중립";
      return (
        <dl>
          <Row label="미국 10년물" value={`${p.us10yYield.toFixed(3)}%`} />
          <Row label="달러인덱스" value={p.dxy.toFixed(2)} />
          <Row label="달러/원" value={`${p.usdKrw.toFixed(0)}원`} />
          <Row label="WTI 유가" value={`$${p.wti.toFixed(2)}`} />
          <Row label="이슈 유형" value={p.newsTypes.join(", ") || null} />
          <Row label="뉴스 메모" value={p.newsMemo || null} />
          <Row label="매크로 판단" value={p.macroJudgment || null} />
          <Row label="선물 방향" value={dirText} />
        </dl>
      );
    }
    if (n === 3 && r.phase3) {
      const p = r.phase3;
      const checked = p.stockChecks.filter((s) => s.checked).map((s) => s.name).join(", ");
      return (
        <dl>
          <Row label="코스피" value={`${p.kospiPrev > 0 ? "+" : ""}${p.kospiPrev.toFixed(2)}%`} />
          <Row label="코스닥" value={`${p.kosdaqPrev > 0 ? "+" : ""}${p.kosdaqPrev.toFixed(2)}%`} />
          <Row label="외국인 순매수" value={`${p.foreignerNet > 0 ? "+" : ""}${p.foreignerNet}억`} />
          <Row label="기관 순매수" value={`${p.institutionNet > 0 ? "+" : ""}${p.institutionNet}억`} />
          <Row label="강세 섹터" value={p.strongSectors.join(" / ") || null} />
          <Row label="약세 섹터" value={p.weakSectors.join(" / ") || null} />
          <Row label="종목 체크 완료" value={checked || null} />
          <Row label="오늘 이벤트" value={p.todayEvents || null} />
          <Row label="수급 메모" value={p.supplyDemandMemo || null} />
        </dl>
      );
    }
    if (n === 4 && r.phase4) {
      const p = r.phase4;
      return (
        <dl>
          <Row label="시나리오 A" value={p.scenarioA.condition ? `[${p.scenarioA.condition}] → ${p.scenarioA.action}` : null} />
          <Row label="시나리오 B" value={p.scenarioB.condition ? `[${p.scenarioB.condition}] → ${p.scenarioB.action}` : null} />
          <Row label="시나리오 C" value={p.scenarioC.condition ? `[${p.scenarioC.condition}] → ${p.scenarioC.action}` : null} />
          <Row label="보유 종목 계획" value={p.holdingPlans || null} />
          <Row label="매매 금지" value={p.forbiddenActions || null} />
          <Row label="주목 테마" value={p.themeMemo || null} />
          {p.stockPlans.length > 0 && (
            <Row
              label="종목 계획"
              value={
                <ul className="space-y-1">
                  {p.stockPlans.map((sp, i) => (
                    <li key={i} className="text-xs">
                      <span className="font-medium">{sp.name}</span>
                      {sp.targetPrice && <> · 목표 {sp.targetPrice.toLocaleString()}</>}
                      {sp.stopLossPrice && <> · 손절 {sp.stopLossPrice.toLocaleString()}</>}
                      {sp.positionSizePct && <> · {sp.positionSizePct}%</>}
                    </li>
                  ))}
                </ul>
              }
            />
          )}
        </dl>
      );
    }
    if (n === 5 && r.phase5) {
      const p = r.phase5;
      const mentalText = ["", "집중도 낮음", "보통 이하", "보통", "집중", "최상 집중"][p.mentalScore];
      return (
        <dl>
          <Row label="추가 뉴스" value={p.lateNewsMemo || null} />
          <Row label="시나리오 확인" value={[p.scenarioAConfirmed && "A", p.scenarioBConfirmed && "B", p.scenarioCConfirmed && "C"].filter(Boolean).join(", ") || "—"} />
          <Row label="멘탈 상태" value={`${p.mentalScore}점 — ${mentalText}`} />
          <Row label="금지사항 확인" value={p.forbiddenConfirmed ? "✅ 확인 완료" : "미확인"} />
        </dl>
      );
    }
    if (n === 6 && r.phase6) {
      const p = r.phase6;
      const gapText = p.openingGap === "gapUp" ? "▲ 갭업" : p.openingGap === "gapDown" ? "▼ 갭다운" : "— 보합";
      const futText = p.foreignerFuturesDir === "buy" ? "순매수 ▲" : p.foreignerFuturesDir === "sell" ? "순매도 ▼" : "중립 —";
      return (
        <dl>
          <Row label="시가 갭" value={gapText} />
          <Row label="외국인 선물" value={futText} />
          <Row label="실행 시나리오" value={p.executedScenario === "none" ? "관망" : `시나리오 ${p.executedScenario}`} />
          <Row label="개장 메모" value={p.openingMemo || null} />
        </dl>
      );
    }
    return null;
  };

  return (
    <div className="rounded-xl border border-neutral-200 bg-white dark:border-neutral-700 dark:bg-neutral-900">
      <div className="border-b border-neutral-100 px-4 py-3 dark:border-neutral-800">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-neutral-400">Phase {n}</span>
          <span className="text-sm font-semibold text-neutral-800 dark:text-neutral-200">{phaseLabel(n)}</span>
          <span className="ml-auto text-[10px] text-emerald-500">✅ 완료</span>
        </div>
      </div>
      <div className="px-4 py-3">{renderContent()}</div>
    </div>
  );
}

export default function JournalDetailPage() {
  const params = useParams();
  const store = useRoutineStore();
  const [mounted, setMounted] = useState(false);

  const dateStr = params.date as string;

  useEffect(() => { setMounted(true); }, []);

  if (!mounted) return null;

  const all = [...store.archive, ...(store.today ? [store.today] : [])];
  const routine = all.find((r) => r.date === dateStr);

  if (!routine) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-12 text-center">
        <p className="text-neutral-500">해당 날짜의 루틴 기록이 없습니다.</p>
        <Link href="/morning/journal" className="mt-3 inline-block text-sm text-blue-500 hover:underline">
          ← 일지 목록으로
        </Link>
      </div>
    );
  }

  const completedCount = [routine.phase1, routine.phase2, routine.phase3, routine.phase4, routine.phase5, routine.phase6].filter(Boolean).length;

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      {/* Header */}
      <div className="mb-6 flex items-center gap-3">
        <Link href="/morning/journal" className="rounded-lg p-2 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors">
          <ArrowLeft size={18} className="text-neutral-600 dark:text-neutral-400" />
        </Link>
        <div>
          <h1 className="text-xl font-bold text-neutral-900 dark:text-neutral-100">
            {formatDate(dateStr)}
          </h1>
          <p className="text-xs text-neutral-400">
            Phase {completedCount}/6 완료
            {routine.overallStatus === "completed" && (
              <span className="ml-2 text-emerald-500">✅ 루틴 완료</span>
            )}
          </p>
        </div>
      </div>

      {/* Phase cards */}
      <div className="space-y-3">
        {[1, 2, 3, 4, 5, 6].map((n) => (
          <PhaseCard key={n} n={n} r={routine} />
        ))}
      </div>

      {/* Empty phases notice */}
      {completedCount < 6 && (
        <p className="mt-4 text-center text-xs text-neutral-400">
          나머지 {6 - completedCount}개 Phase는 미완료 상태입니다.
        </p>
      )}
    </div>
  );
}
