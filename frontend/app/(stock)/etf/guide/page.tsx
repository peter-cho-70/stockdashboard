"use client";

import { useRouter } from "next/navigation";
import { ArrowLeft, Tag, Layers, History, BookOpen } from "lucide-react";

type Part = { text: string; label: string; color: string };

const COLORS: Record<string, string> = {
  brand: "bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300",
  index: "bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300",
  strategy: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
  suffix: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300",
};

function NameBreakdown({ name, parts }: { name: string; parts: Part[] }) {
  return (
    <div className="space-y-2">
      <p className="text-xs text-neutral-400">예시: {name}</p>
      <div className="flex flex-wrap items-center gap-1.5 text-base font-semibold">
        {parts.map((p, i) => (
          <span key={i} className={`rounded-md px-2 py-1 ${COLORS[p.color]}`}>
            {p.text}
          </span>
        ))}
      </div>
      <div className="flex flex-wrap gap-3 text-[11px] text-neutral-500">
        {parts.map((p, i) => (
          <span key={i} className="flex items-center gap-1">
            <span className={`size-2 rounded-full ${COLORS[p.color].split(" ")[0]}`} />
            {p.label}
          </span>
        ))}
      </div>
    </div>
  );
}

const LAYERS = [
  {
    n: 1,
    title: "운용사 브랜드명",
    color: "brand",
    desc: "ETF를 운용하는 자산운용사의 브랜드. 같은 운용사여도 시기에 따라 브랜드명이 바뀔 수 있습니다 (아래 리브랜딩 참고).",
    examples: "KODEX · TIGER · ACE · RISE · PLUS · SOL · HANARO · KIWOOM · TIME",
  },
  {
    n: 2,
    title: "투자 대상 · 기초지수",
    color: "index",
    desc: "이 ETF가 추종하는 지수나 테마. ETF 수익률을 결정하는 가장 핵심적인 부분입니다.",
    examples: "200 · 코스닥150 · 미국S&P500 · 반도체TOP10 · 미국나스닥100",
  },
  {
    n: 3,
    title: "운용 전략 (있을 때만)",
    color: "strategy",
    desc: "기초지수를 그대로 추종하지 않고 배율을 적용하거나 반대로 움직이게 설계된 경우에만 붙습니다. 없으면 기초지수를 1:1로 추종하는 일반 ETF입니다.",
    examples: "레버리지 (2배 추종) · 인버스 (반대 방향) · 액티브 (지수+자체 운용)",
  },
  {
    n: 4,
    title: "접미사",
    color: "suffix",
    desc: "환헤지 여부나 분배금 처리 방식, 복제 방식을 알려주는 약어. 자세한 의미는 아래 글로서리를 참고하세요.",
    examples: "(H) · TR · 합성",
  },
];

const REBRANDS = [
  { from: "KB STAR", to: "RISE", date: "2024.05", manager: "KB자산운용" },
  { from: "ARIRANG", to: "PLUS", date: "2024.10", manager: "한화자산운용" },
  { from: "KINDEX", to: "ACE", date: "2022", manager: "한국투자신탁운용" },
];

const SUFFIXES = [
  {
    code: "(H)",
    title: "Hedge — 환헤지",
    body: "해외 자산에 투자하면서 환율 변동의 영향을 제거한 상품입니다. (H)가 없으면 기초지수 수익률 외에 원/달러 등 환율 변동분도 그대로 수익률에 더해집니다. 환율 방향에 베팅하고 싶지 않다면 (H), 환율 상승도 같이 누리고 싶다면 (H) 없는 상품을 고릅니다.",
  },
  {
    code: "TR",
    title: "Total Return — 분배금 재투자",
    body: "일반 ETF는 분배금(배당)을 현금으로 지급하지만, TR은 분배금을 받는 대신 ETF 내부에서 자동으로 재투자합니다. 분배금에 대한 과세 시점이 매도 시점까지 이연되고, 복리 효과를 누릴 수 있어 장기 투자에 유리한 편입니다.",
  },
  {
    code: "합성",
    title: "Synthetic — 합성 ETF",
    body: "운용사가 실물 자산(주식 등)을 직접 사서 담는 대신, 증권사와의 총수익스왑(swap) 계약을 통해 기초지수 수익률을 제공받는 방식입니다. 실물로 복제하기 어려운 해외지수·원자재 등에 주로 쓰이며, 그 대가로 거래상대방(증권사)의 신용위험을 추가로 안게 된다는 점이 실물형 ETF와 다릅니다.",
  },
];

export default function EtfGuidePage() {
  const router = useRouter();

  return (
    <div className="space-y-6">
      <div>
        <button
          type="button"
          onClick={() => router.push("/etf")}
          className="mb-2 flex items-center gap-1 text-xs text-neutral-400 hover:text-violet-600"
        >
          <ArrowLeft size={12} /> ETF
        </button>
        <div className="flex items-center gap-1.5">
          <BookOpen size={18} className="text-violet-500" />
          <h1 className="text-xl font-semibold text-neutral-900 dark:text-neutral-100">ETF 이름 읽는 법</h1>
        </div>
        <p className="mt-0.5 text-xs text-neutral-400">
          ETF 이름은 보통 4개 층으로 읽으면 됩니다. 구조를 알면 처음 보는 ETF도 무엇에 투자하는지 바로 파악할 수 있어요.
        </p>
      </div>

      <section className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface)] p-4 space-y-4">
        <div className="flex items-center gap-2">
          <Layers size={15} className="text-violet-500" />
          <h2 className="text-sm font-semibold text-neutral-800 dark:text-neutral-200">구조 분해 예시</h2>
        </div>
        <NameBreakdown
          name="TIGER 미국S&P500(H)"
          parts={[
            { text: "TIGER", label: "① 운용사 (미래에셋)", color: "brand" },
            { text: "미국S&P500", label: "② 기초지수 (S&P500)", color: "index" },
            { text: "(H)", label: "④ 접미사 (환헤지)", color: "suffix" },
          ]}
        />
        <div className="border-t border-[var(--border-subtle)] pt-4">
          <NameBreakdown
            name="KODEX 코스닥150레버리지"
            parts={[
              { text: "KODEX", label: "① 운용사 (삼성자산운용)", color: "brand" },
              { text: "코스닥150", label: "② 기초지수", color: "index" },
              { text: "레버리지", label: "③ 운용전략 (2배 추종)", color: "strategy" },
            ]}
          />
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-2">
        {LAYERS.map((l) => (
          <div key={l.n} className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface)] p-4 space-y-2">
            <div className="flex items-center gap-2">
              <span className={`flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${COLORS[l.color]}`}>
                {l.n}
              </span>
              <h3 className="text-sm font-semibold text-neutral-800 dark:text-neutral-200">{l.title}</h3>
            </div>
            <p className="text-xs leading-relaxed text-neutral-500">{l.desc}</p>
            <p className="text-[11px] text-neutral-400">예: {l.examples}</p>
          </div>
        ))}
      </section>

      <section className="space-y-2">
        <div className="flex items-center gap-2">
          <History size={15} className="text-sky-500" />
          <h2 className="text-sm font-semibold text-neutral-600 dark:text-neutral-400">운용사 리브랜딩 (2022~2025)</h2>
        </div>
        <p className="text-xs text-neutral-400">
          최근 몇 년 사이 일부 운용사가 ETF 브랜드명을 바꿨습니다. 옛 이름으로 검색해도 같은 운용사의 ETF입니다.
        </p>
        <div className="overflow-x-auto rounded-lg border border-[var(--border-subtle)]">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--border-subtle)] bg-[var(--surface-elevated)] text-left text-xs text-neutral-400">
                <th className="px-3 py-2 font-medium">이전 브랜드</th>
                <th className="px-3 py-2 font-medium"></th>
                <th className="px-3 py-2 font-medium">현재 브랜드</th>
                <th className="px-3 py-2 font-medium">운용사</th>
                <th className="px-3 py-2 text-right font-medium">변경 시점</th>
              </tr>
            </thead>
            <tbody>
              {REBRANDS.map((r) => (
                <tr key={r.from} className="border-b border-[var(--border-subtle)] last:border-0">
                  <td className="px-3 py-2 text-neutral-400 line-through">{r.from}</td>
                  <td className="px-3 py-2 text-neutral-300">→</td>
                  <td className="px-3 py-2 font-medium text-neutral-800 dark:text-neutral-200">{r.to}</td>
                  <td className="px-3 py-2 text-neutral-500">{r.manager}</td>
                  <td className="px-3 py-2 text-right text-neutral-400">{r.date}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-2">
        <div className="flex items-center gap-2">
          <Tag size={15} className="text-emerald-500" />
          <h2 className="text-sm font-semibold text-neutral-600 dark:text-neutral-400">주요 접미사 글로서리</h2>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          {SUFFIXES.map((s) => (
            <div key={s.code} className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface)] p-4 space-y-1.5">
              <span className={`inline-block rounded-md px-2 py-0.5 text-sm font-bold ${COLORS.suffix}`}>{s.code}</span>
              <p className="text-sm font-semibold text-neutral-800 dark:text-neutral-200">{s.title}</p>
              <p className="text-xs leading-relaxed text-neutral-500">{s.body}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
