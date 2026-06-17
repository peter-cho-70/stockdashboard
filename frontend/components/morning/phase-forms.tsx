"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import {
  RefreshCw,
  Sparkles,
  Plus,
  Trash2,
  CheckCircle2,
  Loader2,
} from "lucide-react";
import {
  useRoutineStore,
  judgeMarketSentiment,
  sentimentLabel,
  type NewsType,
  type StockCheck,
  type StockPlan,
  type Scenario,
} from "@/lib/routineStore";
import { morningApi } from "@/lib/morningApi";
import { useSnapshot } from "@/lib/useSnapshot";
import { watchlistApi } from "@/lib/api";

// ── Shared UI helpers ─────────────────────────────────────────────────────────

function Label({ children }: { children: React.ReactNode }) {
  return (
    <label className="block text-xs font-semibold text-neutral-500 dark:text-neutral-400 uppercase tracking-wide mb-1">
      {children}
    </label>
  );
}

function NumberInput({
  value,
  onChange,
  placeholder,
  suffix,
  step = "0.01",
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  suffix?: string;
  step?: string;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <input
        type="number"
        step={step}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder ?? "0.00"}
        className="w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-900 placeholder:text-neutral-300 focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
      />
      {suffix && <span className="shrink-0 text-xs text-neutral-400">{suffix}</span>}
    </div>
  );
}

function Textarea({
  value,
  onChange,
  placeholder,
  rows = 3,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  rows?: number;
}) {
  return (
    <textarea
      rows={rows}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full resize-none rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm placeholder:text-neutral-300 focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
    />
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-5 dark:border-neutral-700 dark:bg-neutral-900">
      <h3 className="mb-4 text-sm font-semibold text-neutral-800 dark:text-neutral-200">{title}</h3>
      {children}
    </div>
  );
}

function CompleteButton({
  onClick,
  disabled,
  loading,
  label = "Phase 완료 →",
}: {
  onClick: () => void;
  disabled?: boolean;
  loading?: boolean;
  label?: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled || loading}
      className="w-full rounded-xl bg-emerald-500 py-3.5 text-sm font-semibold text-white transition-colors hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {loading ? <Loader2 className="mx-auto animate-spin" size={18} /> : label}
    </button>
  );
}

// ── Phase 1: 미국 증시 마감 체크 ──────────────────────────────────────────────

export function Phase1({ onComplete }: { onComplete: () => void }) {
  const store = useRoutineStore();
  const saved = store.today?.phase1;
  const { loading: autoLoading, error: autoError, fetch: fetchSnap } = useSnapshot();

  const [nasdaq, setNasdaq] = useState(saved?.nasdaq?.toString() ?? "");
  const [sp500, setSp500] = useState(saved?.sp500?.toString() ?? "");
  const [dow, setDow] = useState(saved?.dow?.toString() ?? "");
  const [sox, setSox] = useState(saved?.sox?.toString() ?? "");
  const [vix, setVix] = useState(saved?.vix?.toString() ?? "");
  const [memo, setMemo] = useState(saved?.memo ?? "");

  const nasdaqNum = parseFloat(nasdaq) || 0;
  const vixNum = parseFloat(vix) || 0;
  const sentiment = judgeMarketSentiment(nasdaqNum, vixNum);
  const { text: sentText, color: sentColor } = sentimentLabel(sentiment);
  const vixAlert = vixNum >= 20 && vixNum > 0;

  const handleAutoFill = async () => {
    const snap = await fetchSnap();
    if (!snap) return;
    if (snap.nasdaq !== null) setNasdaq(snap.nasdaq.toFixed(2));
    if (snap.sp500 !== null) setSp500(snap.sp500.toFixed(2));
    if (snap.dow !== null) setDow(snap.dow.toFixed(2));
    if (snap.sox !== null) setSox(snap.sox.toFixed(2));
    if (snap.vix !== null) setVix(snap.vix.toFixed(2));
  };

  const handleComplete = () => {
    const n = parseFloat(nasdaq);
    const s = parseFloat(sp500);
    const d = parseFloat(dow);
    const sx = parseFloat(sox);
    const v = parseFloat(vix);
    if (isNaN(n) || isNaN(v)) return alert("나스닥과 VIX는 필수 입력입니다.");
    store.updatePhase1({
      nasdaq: n,
      sp500: isNaN(s) ? 0 : s,
      dow: isNaN(d) ? 0 : d,
      sox: isNaN(sx) ? 0 : sx,
      vix: v,
      marketSentiment: judgeMarketSentiment(n, v),
      memo,
    });
    onComplete();
  };

  return (
    <div className="space-y-4">
      <Section title="미국 지수 등락률 (%)">
        <div className="grid grid-cols-2 gap-3">
          {[
            { label: "나스닥 (NASDAQ)", value: nasdaq, set: setNasdaq },
            { label: "S&P 500", value: sp500, set: setSp500 },
            { label: "다우 (DJIA)", value: dow, set: setDow },
            { label: "필라델피아 반도체 (SOX)", value: sox, set: setSox },
          ].map(({ label, value, set }) => (
            <div key={label}>
              <Label>{label}</Label>
              <NumberInput value={value} onChange={set} suffix="%" />
            </div>
          ))}
        </div>
        <p className="mt-2 text-[11px] leading-snug text-neutral-400">
          전일 종가 기준 등락률입니다.{" "}
          <span className="font-medium text-neutral-500">
            나스닥·S&P 500·다우
          </span>
          는 시장 전체 방향을,{" "}
          <span className="font-medium text-neutral-500">SOX</span>
          는 AI·반도체 심리를 보여줍니다.
        </p>
        <button
          onClick={handleAutoFill}
          disabled={autoLoading}
          className="mt-3 flex items-center gap-2 rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 text-xs font-medium text-neutral-600 transition-colors hover:bg-neutral-100 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700 disabled:opacity-50"
        >
          {autoLoading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
          자동 조회 (yfinance)
        </button>
        {autoError && <p className="mt-1 text-xs text-red-500">{autoError}</p>}
      </Section>

      <Section title="VIX 공포지수">
        <div className="flex items-center justify-between gap-2">
          <Label>VIX</Label>
          <span className="text-[11px] text-neutral-400">
            20 이상이면 공포 구간, 30 이상은 패닉에 가까운 수준입니다.
          </span>
        </div>
        <NumberInput value={vix} onChange={setVix} step="0.1" />
        {vixAlert && (
          <div className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-xs font-medium text-red-600 dark:bg-red-950/30 dark:text-red-400">
            ⚠️ VIX {vixNum.toFixed(1)} — 공포 구간 (20 이상). 위험 관리 강화 권장.
          </div>
        )}
      </Section>

      {(nasdaqNum !== 0 || vixNum !== 0) && (
        <Section title="오늘 분위기 자동 판정">
          <p className={`text-sm font-semibold ${sentColor}`}>{sentText}</p>
          <p className="mt-1 text-xs text-neutral-400">
            나스닥 {nasdaq}%, VIX {vix}
          </p>
          <p className="mt-1 text-[11px] text-neutral-400">
            나스닥은 위험자산 선호도를, VIX는 변동성·공포 수준을 의미합니다.
            두 지표가 함께 과열·공포 쪽으로 치우쳐 있지 않은지 항상 확인해 주세요.
          </p>
        </Section>
      )}

      <Section title="메모">
        <Textarea
          value={memo}
          onChange={setMemo}
          placeholder="오늘 느낀 시장 분위기, 특이사항 메모..."
          rows={3}
        />
      </Section>

      <CompleteButton onClick={handleComplete} />
    </div>
  );
}

// ── Phase 2: 글로벌 매크로 분석 ────────────────────────────────────────────────

const NEWS_TYPES: { value: NewsType; label: string }[] = [
  { value: "FOMC", label: "FOMC/연준" },
  { value: "earnings", label: "기업 실적" },
  { value: "geopolitics", label: "지정학" },
  { value: "economic_indicator", label: "경제지표" },
  { value: "other", label: "기타" },
];

export function Phase2({ onComplete }: { onComplete: () => void }) {
  const store = useRoutineStore();
  const saved = store.today?.phase2;
  const { loading: autoLoading, error: autoError, fetch: fetchSnap } = useSnapshot();

  const [us10y, setUs10y] = useState(saved?.us10yYield?.toString() ?? "");
  const [dxy, setDxy] = useState(saved?.dxy?.toString() ?? "");
  const [krw, setKrw] = useState(saved?.usdKrw?.toString() ?? "");
  const [wti, setWti] = useState(saved?.wti?.toString() ?? "");
  const [newsTypes, setNewsTypes] = useState<NewsType[]>(saved?.newsTypes ?? []);
  const [newsMemo, setNewsMemo] = useState(saved?.newsMemo ?? "");
  const [judgment, setJudgment] = useState(saved?.macroJudgment ?? "");
  const [futures, setFutures] = useState<"up" | "neutral" | "down">(
    saved?.futuresDirection ?? "neutral"
  );
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState("");

  const krwNum = parseFloat(krw) || 0;
  const krwAlert = krwNum >= 1400 && krwNum > 0;

  const toggleNewsType = (t: NewsType) => {
    setNewsTypes((prev) =>
      prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]
    );
  };

  const handleAutoFill = async () => {
    const snap = await fetchSnap();
    if (!snap) return;
    if (snap.us10yYield !== null) setUs10y(snap.us10yYield.toFixed(3));
    if (snap.dxy !== null) setDxy(snap.dxy.toFixed(2));
    if (snap.usdKrw !== null) setKrw(snap.usdKrw.toFixed(1));
    if (snap.wti !== null) setWti(snap.wti.toFixed(2));
  };

  const handleAiJudgment = async () => {
    setAiLoading(true);
    setAiError("");
    try {
      const phase1 = store.today?.phase1;
      const res = await morningApi.getMacroJudgment({
        nasdaq: phase1?.nasdaq ?? null,
        sp500: phase1?.sp500 ?? null,
        vix: phase1?.vix ?? null,
        us10y_yield: parseFloat(us10y) || null,
        dxy: parseFloat(dxy) || null,
        usd_krw: parseFloat(krw) || null,
        wti: parseFloat(wti) || null,
        news_types: newsTypes,
        news_memo: newsMemo || undefined,
      });
      setJudgment(res.judgment);
    } catch (e) {
      setAiError((e as Error).message || "AI 판단 생성 실패");
    } finally {
      setAiLoading(false);
    }
  };

  const handleComplete = () => {
    if (!judgment.trim()) return alert("매크로 판단을 입력하거나 AI로 생성하세요.");
    store.updatePhase2({
      us10yYield: parseFloat(us10y) || 0,
      dxy: parseFloat(dxy) || 0,
      usdKrw: parseFloat(krw) || 0,
      wti: parseFloat(wti) || 0,
      newsTypes,
      newsMemo,
      macroJudgment: judgment,
      futuresDirection: futures,
    });
    onComplete();
  };

  return (
    <div className="space-y-4">
      <Section title="매크로 지표">
        <div className="grid grid-cols-2 gap-3">
          {[
            { label: "미국 10년물 금리", value: us10y, set: setUs10y, suffix: "%" },
            { label: "달러인덱스 (DXY)", value: dxy, set: setDxy, suffix: "" },
            { label: "달러/원 환율", value: krw, set: setKrw, suffix: "원" },
            { label: "WTI 유가", value: wti, set: setWti, suffix: "$" },
          ].map(({ label, value, set, suffix }) => (
            <div key={label}>
              <Label>{label}</Label>
              <NumberInput value={value} onChange={set} suffix={suffix} />
            </div>
          ))}
        </div>
        <div className="mt-2 space-y-1 text-[11px] leading-snug text-neutral-400">
          <p>
            <span className="font-medium text-neutral-500">미국 10년물 금리</span>
            는 장기 금리 방향과 성장주/가치주 선호를,{" "}
            <span className="font-medium text-neutral-500">DXY</span>
            는 달러 강세·위험회피 정도를 보여줍니다.
          </p>
          <p>
            <span className="font-medium text-neutral-500">달러/원 환율</span>
            은 외국인 자금 유입/유출을,{" "}
            <span className="font-medium text-neutral-500">WTI 유가</span>
            는 인플레이션·경기 민감 섹터에 영향을 줍니다.
          </p>
        </div>
        {krwAlert && (
          <div className="mt-3 rounded-lg bg-orange-50 px-3 py-2 text-xs font-medium text-orange-600 dark:bg-orange-950/30 dark:text-orange-400">
            ⚠️ 달러/원 {krwNum.toFixed(0)}원 — 1,400원 돌파. 외국인 수급 악화 주의.
          </div>
        )}
        <button
          onClick={handleAutoFill}
          disabled={autoLoading}
          className="mt-3 flex items-center gap-2 rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 text-xs font-medium text-neutral-600 hover:bg-neutral-100 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700 disabled:opacity-50 transition-colors"
        >
          {autoLoading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
          자동 조회
        </button>
        {autoError && <p className="mt-1 text-xs text-red-500">{autoError}</p>}
      </Section>

      <Section title="오늘 주요 이슈">
        <Label>이슈 유형</Label>
        <div className="flex flex-wrap gap-2 mb-3">
          {NEWS_TYPES.map(({ value, label }) => (
            <button
              key={value}
              onClick={() => toggleNewsType(value)}
              className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                newsTypes.includes(value)
                  ? "bg-blue-500 text-white"
                  : "border border-neutral-200 bg-white text-neutral-600 hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-400"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <Label>뉴스 메모 (500자)</Label>
        <Textarea
          value={newsMemo}
          onChange={setNewsMemo}
          placeholder="오늘 밤 주요 뉴스, 이슈 내용 메모..."
          rows={4}
        />
      </Section>

      <Section title="코스피200·코스닥150 선물 방향">
        <div className="flex gap-2">
          {(["up", "neutral", "down"] as const).map((dir) => (
            <button
              key={dir}
              onClick={() => setFutures(dir)}
              className={`flex-1 rounded-lg border py-2 text-xs font-semibold transition-colors ${
                futures === dir
                  ? dir === "up"
                    ? "border-red-400 bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-400"
                    : dir === "down"
                    ? "border-blue-400 bg-blue-50 text-blue-700 dark:bg-blue-950/30 dark:text-blue-400"
                    : "border-neutral-400 bg-neutral-100 text-neutral-700 dark:bg-neutral-700 dark:text-neutral-200"
                  : "border-neutral-200 bg-white text-neutral-500 hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-800"
              }`}
            >
              {dir === "up" ? "▲ 상승" : dir === "down" ? "▼ 하락" : "— 중립"}
            </button>
          ))}
        </div>
      </Section>

      <Section title="매크로 판단">
        <div className="mb-2 flex items-center justify-between">
          <Label>한 줄 판단</Label>
          <button
            onClick={handleAiJudgment}
            disabled={aiLoading}
            className="flex items-center gap-1.5 rounded-lg bg-violet-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-violet-600 disabled:opacity-50 transition-colors"
          >
            {aiLoading ? <Loader2 size={11} className="animate-spin" /> : <Sparkles size={11} />}
            AI 판단 생성
          </button>
        </div>
        {aiError && <p className="mb-2 text-xs text-red-500">{aiError}</p>}
        <Textarea
          value={judgment}
          onChange={setJudgment}
          placeholder="예: 금리 상승 + 달러 강세로 위험 회피 심화. 성장주 약세 우려, 방어주·현금 비중 확대 고려."
          rows={3}
        />
        <p className="mt-1 text-[11px] text-neutral-400">
          위 숫자·뉴스를 한 번 더 정리해서{" "}
          <span className="font-medium text-neutral-500">
            오늘 시장 방향·내 포지션 전략
          </span>
          을 2줄 이내로 요약해 두면, 장중에 흔들리지 않고 계획을 지키기 쉽습니다.
        </p>
      </Section>

      <CompleteButton onClick={handleComplete} />
    </div>
  );
}

// ── Phase 3: 국내 시장 분석 ───────────────────────────────────────────────────

export function Phase3({ onComplete }: { onComplete: () => void }) {
  const store = useRoutineStore();
  const saved = store.today?.phase3;

  const [kospi, setKospi] = useState(saved?.kospiPrev?.toString() ?? "");
  const [kosdaq, setKosdaq] = useState(saved?.kosdaqPrev?.toString() ?? "");
  const [foreigner, setForeigner] = useState(saved?.foreignerNet?.toString() ?? "");
  const [institution, setInstitution] = useState(saved?.institutionNet?.toString() ?? "");
  const [strongSectors, setStrongSectors] = useState<string[]>(saved?.strongSectors ?? ["", "", ""]);
  const [weakSectors, setWeakSectors] = useState<string[]>(saved?.weakSectors ?? ["", "", ""]);
  const [stockChecks, setStockChecks] = useState<StockCheck[]>(saved?.stockChecks ?? []);
  const [todayEvents, setTodayEvents] = useState(saved?.todayEvents ?? "");
  const [supplyMemo, setSupplyMemo] = useState(saved?.supplyDemandMemo ?? "");
  const [watchLoading, setWatchLoading] = useState(false);

  const loadWatchlist = useCallback(async () => {
    if (stockChecks.length > 0) return;
    setWatchLoading(true);
    try {
      const res = await watchlistApi.getAll();
      setStockChecks(
        res.items.map((item) => ({
          id: item.id,
          ticker: item.symbol ?? "",
          name: item.stock_name,
          checked: false,
          technicalNote: "",
        }))
      );
    } catch {
      /* silent */
    } finally {
      setWatchLoading(false);
    }
  }, [stockChecks.length]);

  useEffect(() => {
    loadWatchlist();
  }, [loadWatchlist]);

  const updateSector = (type: "strong" | "weak", idx: number, val: string) => {
    if (type === "strong") {
      const next = [...strongSectors];
      next[idx] = val;
      setStrongSectors(next);
    } else {
      const next = [...weakSectors];
      next[idx] = val;
      setWeakSectors(next);
    }
  };

  const toggleCheck = (id: number) => {
    setStockChecks((prev) =>
      prev.map((s) => (s.id === id ? { ...s, checked: !s.checked } : s))
    );
  };

  const updateNote = (id: number, note: string) => {
    setStockChecks((prev) =>
      prev.map((s) => (s.id === id ? { ...s, technicalNote: note } : s))
    );
  };

  const handleComplete = () => {
    store.updatePhase3({
      kospiPrev: parseFloat(kospi) || 0,
      kosdaqPrev: parseFloat(kosdaq) || 0,
      foreignerNet: parseFloat(foreigner) || 0,
      institutionNet: parseFloat(institution) || 0,
      strongSectors: strongSectors.filter(Boolean),
      weakSectors: weakSectors.filter(Boolean),
      stockChecks,
      todayEvents,
      supplyDemandMemo: supplyMemo,
    });
    onComplete();
  };

  return (
    <div className="space-y-4">
      <Section title="전일 국내 시장">
        <div className="grid grid-cols-2 gap-3">
          {[
            { label: "코스피 등락률", value: kospi, set: setKospi, suffix: "%" },
            { label: "코스닥 등락률", value: kosdaq, set: setKosdaq, suffix: "%" },
            { label: "외국인 순매수", value: foreigner, set: setForeigner, suffix: "억" },
            { label: "기관 순매수", value: institution, set: setInstitution, suffix: "억" },
          ].map(({ label, value, set, suffix }) => (
            <div key={label}>
              <Label>{label}</Label>
              <NumberInput value={value} onChange={set} suffix={suffix} />
            </div>
          ))}
        </div>
      </Section>

      <Section title="섹터 강약">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label>강세 섹터 (최대 3개)</Label>
            <div className="space-y-2">
              {[0, 1, 2].map((i) => (
                <input
                  key={i}
                  type="text"
                  value={strongSectors[i]}
                  onChange={(e) => updateSector("strong", i, e.target.value)}
                  placeholder={`강세 섹터 ${i + 1}`}
                  className="w-full rounded-lg border border-red-200 bg-red-50/40 px-3 py-2 text-sm focus:border-red-400 focus:outline-none dark:border-red-900/40 dark:bg-red-950/20"
                />
              ))}
            </div>
          </div>
          <div>
            <Label>약세 섹터 (최대 3개)</Label>
            <div className="space-y-2">
              {[0, 1, 2].map((i) => (
                <input
                  key={i}
                  type="text"
                  value={weakSectors[i]}
                  onChange={(e) => updateSector("weak", i, e.target.value)}
                  placeholder={`약세 섹터 ${i + 1}`}
                  className="w-full rounded-lg border border-blue-200 bg-blue-50/40 px-3 py-2 text-sm focus:border-blue-400 focus:outline-none dark:border-blue-900/40 dark:bg-blue-950/20"
                />
              ))}
            </div>
          </div>
        </div>
      </Section>

      <Section title="관심 종목 차트 점검">
        {watchLoading ? (
          <div className="flex items-center gap-2 text-sm text-neutral-400">
            <Loader2 size={14} className="animate-spin" /> 관심 종목 불러오는 중...
          </div>
        ) : stockChecks.length === 0 ? (
          <p className="text-sm text-neutral-400">
            등록된 관심 종목이 없습니다.{" "}
            <Link href="/watchlist" className="text-blue-500 underline">
              관심 종목 추가하기
            </Link>
          </p>
        ) : (
          <div className="space-y-3">
            {stockChecks.map((s) => (
              <div
                key={s.id}
                className={`rounded-lg border p-3 transition-colors ${
                  s.checked
                    ? "border-emerald-200 bg-emerald-50/60 dark:border-emerald-900/40 dark:bg-emerald-950/20"
                    : "border-neutral-200 bg-white dark:border-neutral-700 dark:bg-neutral-800"
                }`}
              >
                <div className="flex items-center gap-3 mb-2">
                  <button onClick={() => toggleCheck(s.id)} className="shrink-0">
                    {s.checked ? (
                      <CheckCircle2 size={18} className="text-emerald-500" />
                    ) : (
                      <div className="h-4.5 w-4.5 rounded-full border-2 border-neutral-300" />
                    )}
                  </button>
                  <div className="flex-1 min-w-0">
                    <span className="text-sm font-medium text-neutral-800 dark:text-neutral-200">
                      {s.name}
                    </span>
                    {s.ticker && (
                      <span className="ml-2 text-xs text-neutral-400">{s.ticker}</span>
                    )}
                  </div>
                </div>
                <input
                  type="text"
                  value={s.technicalNote}
                  onChange={(e) => updateNote(s.id, e.target.value)}
                  placeholder="기술적 위치 메모 (지지선, 저항선, 이평선 배열...)"
                  className="w-full rounded-md border border-neutral-200 bg-neutral-50 px-2.5 py-1.5 text-xs text-neutral-700 placeholder:text-neutral-300 focus:border-blue-400 focus:outline-none dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300"
                />
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section title="오늘 국내 이벤트 / 수급 메모">
        <div className="space-y-3">
          <div>
            <Label>오늘 이벤트 (실적·공시·경제지표)</Label>
            <Textarea
              value={todayEvents}
              onChange={setTodayEvents}
              placeholder="예: 삼성전자 잠정실적, 한국 소비자물가 발표..."
              rows={2}
            />
          </div>
          <div>
            <Label>수급 분석 메모</Label>
            <Textarea
              value={supplyMemo}
              onChange={setSupplyMemo}
              placeholder="프로그램 매매, 대차잔고 변화, 외국인 연속 흐름..."
              rows={2}
            />
          </div>
        </div>
      </Section>

      <CompleteButton onClick={handleComplete} />
    </div>
  );
}

// ── Phase 4: 오늘의 전략 수립 ──────────────────────────────────────────────────

const SCENARIO_CONFIG = [
  {
    key: "A" as const,
    label: "시나리오 A",
    sub: "강세 (상승)",
    placeholder: "코스피 +0.5% 이상 시",
    cls: "border-red-200 dark:border-red-900/40",
    titleCls: "text-red-600 dark:text-red-400",
  },
  {
    key: "B" as const,
    label: "시나리오 B",
    sub: "중립·보합",
    placeholder: "코스피 ±0.5% 이내",
    cls: "border-yellow-200 dark:border-yellow-900/40",
    titleCls: "text-yellow-600 dark:text-yellow-400",
  },
  {
    key: "C" as const,
    label: "시나리오 C",
    sub: "약세 (하락)",
    placeholder: "코스피 -0.5% 이하 시",
    cls: "border-blue-200 dark:border-blue-900/40",
    titleCls: "text-blue-600 dark:text-blue-400",
  },
] as const;

const emptyScenario = (): Scenario => ({ condition: "", action: "" });
const emptyPlan = (): StockPlan => ({
  ticker: "",
  name: "",
  entryCondition: "",
  targetPrice: null,
  stopLossPrice: null,
  positionSizePct: null,
  note: "",
});

export function Phase4({ onComplete }: { onComplete: () => void }) {
  const store = useRoutineStore();
  const saved = store.today?.phase4;

  const [scenarioA, setScenarioA] = useState<Scenario>(saved?.scenarioA ?? emptyScenario());
  const [scenarioB, setScenarioB] = useState<Scenario>(saved?.scenarioB ?? emptyScenario());
  const [scenarioC, setScenarioC] = useState<Scenario>(saved?.scenarioC ?? emptyScenario());
  const [plans, setPlans] = useState<StockPlan[]>(saved?.stockPlans ?? []);
  const [holding, setHolding] = useState(saved?.holdingPlans ?? "");
  const [forbidden, setForbidden] = useState(saved?.forbiddenActions ?? "");
  const [theme, setTheme] = useState(saved?.themeMemo ?? "");

  const scenarios = {
    A: [scenarioA, setScenarioA],
    B: [scenarioB, setScenarioB],
    C: [scenarioC, setScenarioC],
  } as const;

  const addPlan = () => setPlans((p) => [...p, emptyPlan()]);
  const removePlan = (i: number) => setPlans((p) => p.filter((_, idx) => idx !== i));
  const updatePlan = (i: number, key: keyof StockPlan, val: string | number | null) => {
    setPlans((p) => {
      const next = [...p];
      next[i] = { ...next[i], [key]: val };
      return next;
    });
  };

  const handleComplete = () => {
    const allFilled = [scenarioA, scenarioB, scenarioC].every((s) => s.condition && s.action);
    if (!allFilled) return alert("시나리오 A/B/C 조건과 대응 전략을 모두 입력하세요.");
    if (!forbidden.trim()) return alert("오늘 매매 금지사항을 입력하세요.");
    store.updatePhase4({
      scenarioA,
      scenarioB,
      scenarioC,
      stockPlans: plans,
      holdingPlans: holding,
      forbiddenActions: forbidden,
      themeMemo: theme,
    });
    onComplete();
  };

  return (
    <div className="space-y-4">
      <Section title="시나리오 3가지 (모두 작성 필수)">
        <div className="space-y-5">
          {SCENARIO_CONFIG.map(({ key, label, sub, cls, titleCls, placeholder }) => {
            const [sc, setSc] = scenarios[key] as [Scenario, (s: Scenario) => void];
            return (
              <div key={key} className={`rounded-lg border p-4 ${cls}`}>
                <p className={`mb-3 text-xs font-bold ${titleCls}`}>
                  {label} — {sub}
                </p>
                <div className="space-y-2">
                  <div>
                    <Label>발동 조건</Label>
                    <input
                      type="text"
                      value={sc.condition}
                      onChange={(e) => setSc({ ...sc, condition: e.target.value })}
                      placeholder={placeholder}
                      className="w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm focus:border-blue-400 focus:outline-none dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
                    />
                  </div>
                  <div>
                    <Label>대응 전략</Label>
                    <Textarea
                      value={sc.action}
                      onChange={(v) => setSc({ ...sc, action: v })}
                      placeholder="구체적인 매매 대응 전략..."
                      rows={2}
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </Section>

      <Section title="관심 종목 계획">
        <div className="space-y-3">
          {plans.map((plan, i) => (
            <div key={i} className="rounded-lg border border-neutral-200 p-3 dark:border-neutral-700">
              <div className="mb-2 flex items-center justify-between">
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={plan.name}
                    onChange={(e) => updatePlan(i, "name", e.target.value)}
                    placeholder="종목명"
                    className="w-28 rounded-md border border-neutral-200 px-2 py-1 text-xs dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
                  />
                  <input
                    type="text"
                    value={plan.ticker}
                    onChange={(e) => updatePlan(i, "ticker", e.target.value)}
                    placeholder="코드"
                    className="w-20 rounded-md border border-neutral-200 px-2 py-1 text-xs dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
                  />
                </div>
                <button onClick={() => removePlan(i)} className="text-red-400 hover:text-red-500">
                  <Trash2 size={14} />
                </button>
              </div>
              <div className="grid grid-cols-3 gap-2 mb-2">
                {[
                  { label: "목표가", key: "targetPrice" as const },
                  { label: "손절가", key: "stopLossPrice" as const },
                  { label: "비중(%)", key: "positionSizePct" as const },
                ].map(({ label, key }) => (
                  <div key={key}>
                    <p className="mb-0.5 text-[10px] text-neutral-400">{label}</p>
                    <input
                      type="number"
                      value={plan[key]?.toString() ?? ""}
                      onChange={(e) =>
                        updatePlan(i, key, e.target.value ? parseFloat(e.target.value) : null)
                      }
                      placeholder="-"
                      className="w-full rounded-md border border-neutral-200 px-2 py-1 text-xs dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
                    />
                  </div>
                ))}
              </div>
              <input
                type="text"
                value={plan.entryCondition}
                onChange={(e) => updatePlan(i, "entryCondition", e.target.value)}
                placeholder="진입 조건 (예: 86,000원 지지 확인 후 진입)"
                className="w-full rounded-md border border-neutral-200 px-2 py-1.5 text-xs dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
              />
            </div>
          ))}
          <button
            onClick={addPlan}
            className="flex items-center gap-1.5 rounded-lg border border-dashed border-neutral-300 px-3 py-2 text-xs text-neutral-500 hover:border-blue-400 hover:text-blue-500 dark:border-neutral-600 dark:text-neutral-400 transition-colors"
          >
            <Plus size={12} /> 종목 추가
          </button>
        </div>
      </Section>

      <Section title="기타">
        <div className="space-y-3">
          <div>
            <Label>보유 종목 대응 계획</Label>
            <Textarea
              value={holding}
              onChange={setHolding}
              placeholder="추가매수·익절·손절 조건..."
              rows={2}
            />
          </div>
          <div>
            <Label>오늘 절대 금지 사항 ⚠️</Label>
            <Textarea
              value={forbidden}
              onChange={setForbidden}
              placeholder="예: 테마주 추격 매수 금지, 손실 종목 물타기 금지..."
              rows={2}
            />
          </div>
          <div>
            <Label>오늘 주목 테마·섹터</Label>
            <Textarea
              value={theme}
              onChange={setTheme}
              placeholder="예: AI 반도체 온기 지속, 조선업 모멘텀 관찰..."
              rows={2}
            />
          </div>
        </div>
      </Section>

      <CompleteButton onClick={handleComplete} label="전략 완성 ✅" />
    </div>
  );
}

// ── Phase 5: 최종 점검 ────────────────────────────────────────────────────────

const MENTAL_LABELS: Record<number, string> = {
  1: "집중도 낮음",
  2: "보통 이하",
  3: "보통",
  4: "집중",
  5: "최상 집중",
};

export function Phase5({ onComplete }: { onComplete: () => void }) {
  const store = useRoutineStore();
  const saved = store.today?.phase5;

  const [lateMemo, setLateMemo] = useState(saved?.lateNewsMemo ?? "");
  const [aOk, setAOk] = useState(saved?.scenarioAConfirmed ?? false);
  const [bOk, setBOk] = useState(saved?.scenarioBConfirmed ?? false);
  const [cOk, setCOk] = useState(saved?.scenarioCConfirmed ?? false);
  const [mental, setMental] = useState<1 | 2 | 3 | 4 | 5>(saved?.mentalScore ?? 3);
  const [forbOk, setForbOk] = useState(saved?.forbiddenConfirmed ?? false);

  const phase4 = store.today?.phase4;

  const handleComplete = () => {
    if (!aOk || !bOk || !cOk) return alert("시나리오 A/B/C를 모두 재확인하세요.");
    if (!forbOk) return alert("매매 금지사항 확인을 체크하세요.");
    store.updatePhase5({
      lateNewsMemo: lateMemo,
      scenarioAConfirmed: aOk,
      scenarioBConfirmed: bOk,
      scenarioCConfirmed: cOk,
      mentalScore: mental,
      forbiddenConfirmed: forbOk,
    });
    onComplete();
  };

  return (
    <div className="space-y-4">
      <Section title="08:00 추가 뉴스 체크">
        <Textarea
          value={lateMemo}
          onChange={setLateMemo}
          placeholder="개장 전 마지막 뉴스 변수, 갑작스러운 이슈..."
          rows={3}
        />
      </Section>

      <Section title="시나리오 최종 재확인">
        <div className="space-y-3">
          {(
            [
              { key: "A", ok: aOk, setOk: setAOk, sc: phase4?.scenarioA },
              { key: "B", ok: bOk, setOk: setBOk, sc: phase4?.scenarioB },
              { key: "C", ok: cOk, setOk: setCOk, sc: phase4?.scenarioC },
            ] as const
          ).map(({ key, ok, setOk, sc }) => (
            <label
              key={key}
              className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors ${
                ok
                  ? "border-emerald-200 bg-emerald-50/60 dark:border-emerald-900/40 dark:bg-emerald-950/20"
                  : "border-neutral-200 bg-white dark:border-neutral-700 dark:bg-neutral-900"
              }`}
            >
              <input
                type="checkbox"
                checked={ok}
                onChange={(e) => setOk(e.target.checked)}
                className="mt-0.5 h-4 w-4 accent-emerald-500"
              />
              <div>
                <p className="text-xs font-semibold text-neutral-500">시나리오 {key}</p>
                <p className="text-sm text-neutral-800 dark:text-neutral-200">
                  {sc ? `[${sc.condition}] → ${sc.action}` : "Phase 4 미완료"}
                </p>
              </div>
            </label>
          ))}
        </div>
      </Section>

      <Section title="오늘 멘탈 상태">
        <div className="flex gap-2">
          {([1, 2, 3, 4, 5] as const).map((score) => (
            <button
              key={score}
              onClick={() => setMental(score)}
              className={`flex-1 rounded-lg border py-2.5 text-xs font-semibold transition-colors ${
                mental === score
                  ? "border-blue-400 bg-blue-50 text-blue-700 dark:bg-blue-950/30 dark:text-blue-400"
                  : "border-neutral-200 bg-white text-neutral-500 hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-800"
              }`}
            >
              {score}
            </button>
          ))}
        </div>
        <p className="mt-2 text-center text-xs text-neutral-400">{MENTAL_LABELS[mental]}</p>
      </Section>

      <Section title="매매 금지사항 최종 확인">
        <label
          className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 ${
            forbOk
              ? "border-emerald-200 bg-emerald-50/60 dark:border-emerald-900/40 dark:bg-emerald-950/20"
              : "border-neutral-200 bg-white dark:border-neutral-700 dark:bg-neutral-900"
          }`}
        >
          <input
            type="checkbox"
            checked={forbOk}
            onChange={(e) => setForbOk(e.target.checked)}
            className="mt-0.5 h-4 w-4 accent-emerald-500"
          />
          <div>
            <p className="text-sm font-medium text-neutral-800 dark:text-neutral-200">
              {phase4?.forbiddenActions || "Phase 4에서 금지사항을 입력하세요."}
            </p>
            <p className="text-xs text-neutral-400 mt-0.5">위 금지사항을 지킬 것을 확인합니다.</p>
          </div>
        </label>
      </Section>

      <CompleteButton onClick={handleComplete} label="개장 준비 완료 ✅" />
    </div>
  );
}

// ── Phase 6: 개장 초반 관찰 ────────────────────────────────────────────────────

export function Phase6({ onComplete }: { onComplete: () => void }) {
  const store = useRoutineStore();
  const saved = store.today?.phase6;

  const [gap, setGap] = useState<"gapUp" | "flat" | "gapDown">(
    saved?.openingGap ?? "flat"
  );
  const [futuresDir, setFuturesDir] = useState<"buy" | "neutral" | "sell">(
    saved?.foreignerFuturesDir ?? "neutral"
  );
  const [sectorNoted, setSectorNoted] = useState(saved?.sectorStrengthNoted ?? false);
  const [scenarioMatch, setScenarioMatch] = useState(saved?.scenarioMatchChecked ?? false);
  const [executed, setExecuted] = useState<"A" | "B" | "C" | "none">(
    saved?.executedScenario ?? "none"
  );
  const [memo, setMemo] = useState(saved?.openingMemo ?? "");

  const handleComplete = () => {
    store.updatePhase6({
      openingGap: gap,
      foreignerFuturesDir: futuresDir,
      sectorStrengthNoted: sectorNoted,
      scenarioMatchChecked: scenarioMatch,
      executedScenario: executed,
      openingMemo: memo,
    });
    onComplete();
  };

  return (
    <div className="space-y-4">
      <Section title="09:00~09:30 개장 초반 체크">
        <div className="space-y-3">
          <div>
            <Label>시가 갭</Label>
            <div className="flex gap-2">
              {(
                [
                  ["gapUp", "▲ 갭업"],
                  ["flat", "— 보합"],
                  ["gapDown", "▼ 갭다운"],
                ] as const
              ).map(([val, label]) => (
                <button
                  key={val}
                  onClick={() => setGap(val)}
                  className={`flex-1 rounded-lg border py-2 text-xs font-semibold transition-colors ${
                    gap === val
                      ? val === "gapUp"
                        ? "border-red-400 bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-400"
                        : val === "gapDown"
                        ? "border-blue-400 bg-blue-50 text-blue-700 dark:bg-blue-950/30 dark:text-blue-400"
                        : "border-neutral-400 bg-neutral-100 text-neutral-700 dark:bg-neutral-700 dark:text-neutral-200"
                      : "border-neutral-200 bg-white text-neutral-500 hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-800"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <Label>외국인 선물 방향</Label>
            <div className="flex gap-2">
              {(
                [
                  ["buy", "순매수 ▲"],
                  ["neutral", "중립 —"],
                  ["sell", "순매도 ▼"],
                ] as const
              ).map(([val, label]) => (
                <button
                  key={val}
                  onClick={() => setFuturesDir(val)}
                  className={`flex-1 rounded-lg border py-2 text-xs font-semibold transition-colors ${
                    futuresDir === val
                      ? val === "buy"
                        ? "border-red-400 bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-400"
                        : val === "sell"
                        ? "border-blue-400 bg-blue-50 text-blue-700 dark:bg-blue-950/30 dark:text-blue-400"
                        : "border-neutral-400 bg-neutral-100 text-neutral-700 dark:bg-neutral-700 dark:text-neutral-200"
                      : "border-neutral-200 bg-white text-neutral-500 hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-800"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {[
            { ok: sectorNoted, set: setSectorNoted, label: "섹터별 초반 강약 구도 파악 완료" },
            {
              ok: scenarioMatch,
              set: setScenarioMatch,
              label: "예상 시나리오와 실제 시장 일치 여부 판단 완료",
            },
          ].map(({ ok, set, label }) => (
            <label
              key={label}
              className={`flex cursor-pointer items-center gap-3 rounded-lg border p-3 transition-colors ${
                ok
                  ? "border-emerald-200 bg-emerald-50/60 dark:border-emerald-900/40 dark:bg-emerald-950/20"
                  : "border-neutral-200 bg-white dark:border-neutral-700 dark:bg-neutral-900"
              }`}
            >
              <input
                type="checkbox"
                checked={ok}
                onChange={(e) => set(e.target.checked)}
                className="h-4 w-4 accent-emerald-500"
              />
              <span className="text-sm text-neutral-700 dark:text-neutral-300">{label}</span>
            </label>
          ))}
        </div>
      </Section>

      <Section title="실제 진행된 시나리오">
        <div className="flex gap-2">
          {(
            [
              ["A", "시나리오 A"],
              ["B", "시나리오 B"],
              ["C", "시나리오 C"],
              ["none", "관망"],
            ] as const
          ).map(([val, label]) => (
            <button
              key={val}
              onClick={() => setExecuted(val)}
              className={`flex-1 rounded-lg border py-2.5 text-xs font-semibold transition-colors ${
                executed === val
                  ? "border-blue-400 bg-blue-50 text-blue-700 dark:bg-blue-950/30 dark:text-blue-400"
                  : "border-neutral-200 bg-white text-neutral-500 hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-800"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </Section>

      <Section title="개장 초반 판단 메모">
        <Textarea
          value={memo}
          onChange={setMemo}
          placeholder="개장 초반 관찰 내용, 시나리오 일치 여부, 느낀 점... (200자)"
          rows={3}
        />
      </Section>

      <CompleteButton onClick={handleComplete} label="오늘 루틴 완료 🎉" />
    </div>
  );
}
