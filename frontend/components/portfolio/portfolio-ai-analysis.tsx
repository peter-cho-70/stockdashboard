'use client';

import { useState, useEffect } from 'react';
import {
  Sparkles, Loader2, ChevronDown, ChevronUp, AlertTriangle,
  TrendingUp, PieChart, ShieldAlert, Lightbulb, BarChart2,
  Activity, Target, Compass, ArrowUpDown, RefreshCw,
} from 'lucide-react';
import { api, type PortfolioAIAnalysisResult } from '@/lib/api';
import { krChangeClass, krChangeBorderPanelClass } from '@/lib/krMarketColors';

const fmtKRW = (n: number) =>
  new Intl.NumberFormat('ko-KR', { style: 'currency', currency: 'KRW', maximumFractionDigits: 0 }).format(n);

const fmtRate = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;
const fmtChg  = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`;

function Section({ icon, title, content }: { icon: React.ReactNode; title: string; content: string }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="border border-gray-100 rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-2.5 bg-gray-50 hover:bg-gray-100 transition-colors text-left"
      >
        <span className="flex items-center gap-2 text-xs font-semibold text-gray-700">
          {icon}
          {title}
        </span>
        {open ? <ChevronUp size={13} className="text-gray-400" /> : <ChevronDown size={13} className="text-gray-400" />}
      </button>
      {open && (
        <p className="px-4 py-3 text-xs text-gray-600 leading-relaxed whitespace-pre-line">{content}</p>
      )}
    </div>
  );
}

function MetricCard({
  label, value, sub, highlight,
}: { label: string; value: string; sub?: string; highlight?: 'up' | 'down' | null }) {
  const valueClass =
    highlight === 'up'   ? 'text-red-600'  :
    highlight === 'down' ? 'text-blue-600' :
    'text-gray-800';
  const bgClass =
    highlight === 'up'   ? 'bg-red-50 border border-red-100'   :
    highlight === 'down' ? 'bg-blue-50 border border-blue-100' :
    'bg-gray-50';
  return (
    <div className={`rounded-lg px-3 py-2.5 ${bgClass}`}>
      <p className="text-[10px] text-gray-400 mb-0.5">{label}</p>
      <p className={`text-sm font-bold ${valueClass}`}>{value}</p>
      {sub && <p className={`text-[10px] mt-0.5 ${highlight ? valueClass : 'text-gray-400'}`}>{sub}</p>}
    </div>
  );
}

export function PortfolioAIAnalysis() {
  const [result, setResult] = useState<PortfolioAIAnalysisResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.getPortfolioAnalysis()
      .then((data) => { if (data) setResult(data); })
      .catch(() => {})
      .finally(() => setInitialLoading(false));
  }, []);

  async function handleGenerate() {
    setLoading(true);
    setError(null);
    try {
      const data = await api.generatePortfolioAnalysis();
      setResult(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : '분석 생성에 실패했습니다.');
    } finally {
      setLoading(false);
    }
  }

  const fmtAnalyzedAt = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  const meta     = result?.meta;
  const analysis = result?.analysis;

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      {/* 헤더 */}
      <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="p-1.5 bg-violet-50 border border-violet-200 rounded-lg">
            <Sparkles size={14} className="text-violet-600" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-gray-900">AI 포트폴리오 분석</h3>
            {result?.analyzed_at ? (
              <p className="text-xs text-gray-400 mt-0.5">
                마지막 분석: {fmtAnalyzedAt(result.analyzed_at)}
              </p>
            ) : (
              <p className="text-xs text-gray-400 mt-0.5">주도주 중심 포트폴리오 · 시장 대비 종합 분석</p>
            )}
          </div>
        </div>
        <button
          onClick={handleGenerate}
          disabled={loading || initialLoading}
          className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-50 transition-colors"
        >
          {loading ? <Loader2 size={12} className="animate-spin" /> : result ? <RefreshCw size={12} /> : <Sparkles size={12} />}
          {loading ? '분석 중…' : result ? '갱신' : 'AI 분석 시작'}
        </button>
      </div>

      <div className="p-5 space-y-4">
        {/* 초기 저장 결과 로딩 */}
        {initialLoading && (
          <div className="flex items-center justify-center py-8 text-gray-300">
            <Loader2 size={18} className="animate-spin" />
          </div>
        )}

        {/* AI 생성 중 */}
        {!initialLoading && loading && (
          <div className="flex flex-col items-center justify-center py-12 gap-3 text-gray-400">
            <Loader2 size={24} className="animate-spin text-violet-500" />
            <p className="text-sm">포트폴리오를 분석하고 있습니다…</p>
            <p className="text-xs">시장 데이터 수집 + AI 종합 분석 중입니다. 약 15~30초 소요됩니다.</p>
          </div>
        )}

        {/* 에러 */}
        {!initialLoading && !loading && error && (
          <div className="flex items-center gap-2 text-rose-600 bg-rose-50 border border-rose-200 rounded-lg px-4 py-3 text-sm">
            <AlertTriangle size={14} />
            {error}
          </div>
        )}

        {/* 결과 */}
        {!initialLoading && !loading && analysis && meta && (
          <>
            {/* 요약 배너 */}
            <div className="bg-violet-50 border border-violet-200 rounded-xl px-4 py-3">
              <p className="text-xs font-medium text-violet-500 mb-1">한 줄 요약</p>
              <p className="text-sm font-semibold text-violet-900">{analysis.summary}</p>
            </div>

            {/* 수치 지표 */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
              <MetricCard label="보유 종목" value={`${meta.stock_count}종목`} />
              <MetricCard label="총 매입" value={fmtKRW(meta.total_buy)} />
              <MetricCard label="평가금액" value={fmtKRW(meta.total_eval)} />
              <MetricCard
                label="누적 손익"
                value={fmtRate(meta.total_pnl_rate)}
                sub={fmtKRW(meta.total_pnl)}
                highlight={meta.total_pnl >= 0 ? 'up' : 'down'}
              />
              <MetricCard
                label="오늘 변동"
                value={fmtChg(meta.daily_change_rate)}
                sub={fmtKRW(meta.daily_change)}
                highlight={meta.daily_change >= 0 ? 'up' : 'down'}
              />
              <div className="bg-gray-50 rounded-lg px-3 py-2.5">
                <p className="text-[10px] text-gray-400 mb-0.5">수익/손실</p>
                <p className="text-sm font-bold text-gray-800">
                  <span className="text-red-600">{meta.profit_count}</span>
                  <span className="text-gray-300 mx-1">/</span>
                  <span className="text-blue-600">{meta.loss_count}</span>
                  <span className="text-[10px] text-gray-400 ml-1">종목</span>
                </p>
              </div>
            </div>

            {/* 시장 지수 */}
            {(meta.market.kospi || meta.market.kosdaq) && (
              <div className="flex gap-2 flex-wrap text-xs">
                <span className="text-[10px] text-gray-400 self-center">현재 시장</span>
                {meta.market.kospi && (
                  <span className="bg-gray-100 rounded-md px-2.5 py-1 text-gray-600">
                    KOSPI {meta.market.kospi.index}
                    <span className={krChangeClass(parseFloat(meta.market.kospi.change_rate))}>
                      {' '}({parseFloat(meta.market.kospi.change_rate) >= 0 ? '+' : ''}{meta.market.kospi.change_rate}%)
                    </span>
                  </span>
                )}
                {meta.market.kosdaq && (
                  <span className="bg-gray-100 rounded-md px-2.5 py-1 text-gray-600">
                    KOSDAQ {meta.market.kosdaq.index}
                    <span className={krChangeClass(parseFloat(meta.market.kosdaq.change_rate))}>
                      {' '}({parseFloat(meta.market.kosdaq.change_rate) >= 0 ? '+' : ''}{meta.market.kosdaq.change_rate}%)
                    </span>
                  </span>
                )}
              </div>
            )}

            {/* 분석 섹션 */}
            <div className="space-y-2">
              <Section
                icon={<Lightbulb size={12} className="text-amber-500" />}
                title="포트폴리오 특징"
                content={analysis.characteristics}
              />
              <Section
                icon={<PieChart size={12} className="text-indigo-500" />}
                title="섹터 구성 분석"
                content={analysis.sector_analysis}
              />
              <Section
                icon={<Activity size={12} className="text-orange-500" />}
                title="오늘 하루 변동 분석"
                content={analysis.daily_analysis}
              />
              <Section
                icon={<BarChart2 size={12} className="text-blue-500" />}
                title="시장 대비 성과 비교"
                content={analysis.market_comparison}
              />
              <Section
                icon={<ArrowUpDown size={12} className="text-teal-500" />}
                title="수익·손실 종목 리뷰"
                content={analysis.profit_loss_review}
              />
              <Section
                icon={<ShieldAlert size={12} className="text-rose-500" />}
                title="집중 리스크 분석"
                content={analysis.concentration_risk}
              />
              <Section
                icon={<Compass size={12} className="text-violet-500" />}
                title="주도주 전략 평가"
                content={analysis.strategy_assessment}
              />
              <Section
                icon={<Target size={12} className="text-emerald-500" />}
                title="개선 제언"
                content={analysis.suggestions}
              />
            </div>

            <p className="text-[10px] text-gray-300 text-right">
              * AI 분석은 참고용이며 투자 권유가 아닙니다.
            </p>
          </>
        )}

        {/* 초기 안내 */}
        {!initialLoading && !loading && !error && !result && (
          <div className="flex flex-col items-center justify-center py-10 gap-2 text-gray-400">
            <Sparkles size={20} className="text-violet-300" />
            <p className="text-sm">버튼을 눌러 보유 종목 AI 분석을 시작하세요.</p>
            <p className="text-xs">주도주 중심 포트폴리오 특징 · 오늘 변동 · 섹터 분석 · 리스크를 종합 분석합니다.</p>
          </div>
        )}
      </div>
    </div>
  );
}
