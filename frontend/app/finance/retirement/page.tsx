'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  api,
  type RetireProfile,
  type RetirementOpinion,
  type RetirementReview,
  type RetirementSnapshot,
} from '@/lib/api';
import {
  AlertTriangle,
  BookOpen,
  Bot,
  CalendarCheck,
  Loader2,
  PiggyBank,
  RefreshCw,
  Scale,
  Sunset,
  Target,
  TrendingUp,
  Wallet,
} from 'lucide-react';

// ── 포맷 헬퍼 ────────────────────────────────────────────────────────────────
function fmtWon(v: number | null | undefined): string {
  if (v == null) return '—';
  const abs = Math.abs(v);
  if (abs >= 1e8) return `${(v / 1e8).toFixed(1)}억원`;
  if (abs >= 1e4) return `${Math.round(v / 1e4).toLocaleString()}만원`;
  return `${Math.round(v).toLocaleString()}원`;
}

function fmtSigned(v: number | null | undefined): string {
  if (v == null) return '—';
  return `${v > 0 ? '+' : ''}${fmtWon(v)}`;
}

const RISK_LABELS: Record<RetireProfile['risk_tolerance'], string> = {
  conservative: '안정형',
  balanced: '균형형',
  aggressive: '성장형',
};

// ── 요약 카드 ────────────────────────────────────────────────────────────────
function SummaryCard({
  icon: Icon,
  label,
  value,
  sub,
  color = 'gray',
}: {
  icon: React.ComponentType<{ size?: number; className?: string }>;
  label: string;
  value: string;
  sub?: React.ReactNode;
  color?: 'gray' | 'emerald' | 'rose' | 'blue' | 'amber';
}) {
  const iconStyle: Record<string, string> = {
    gray: 'bg-gray-50 border-gray-200 text-gray-500',
    emerald: 'bg-emerald-50 border-emerald-200 text-emerald-600',
    rose: 'bg-rose-50 border-rose-200 text-rose-500',
    blue: 'bg-blue-50 border-blue-200 text-blue-500',
    amber: 'bg-amber-50 border-amber-200 text-amber-600',
  };
  const valueColor: Record<string, string> = {
    gray: 'text-gray-900',
    emerald: 'text-emerald-600',
    rose: 'text-rose-500',
    blue: 'text-blue-600',
    amber: 'text-amber-600',
  };
  return (
    <div className="bg-white rounded-xl border border-gray-200 px-5 py-4 shadow-sm hover:shadow-md transition-shadow">
      <div className="flex items-center gap-2">
        <div className={`p-1.5 rounded-lg border ${iconStyle[color]}`}>
          <Icon size={14} />
        </div>
        <span className="text-xs font-medium text-gray-500">{label}</span>
      </div>
      <p className={`mt-2 text-xl font-bold tabular-nums ${valueColor[color]}`}>{value}</p>
      {sub && <div className="mt-1 text-xs text-gray-500">{sub}</div>}
    </div>
  );
}

// ── 프로필 폼 ────────────────────────────────────────────────────────────────
function ProfileForm({
  profile,
  onSaved,
}: {
  profile: RetireProfile;
  onSaved: (p: RetireProfile) => void;
}) {
  const [birthYear, setBirthYear] = useState<string>(profile.birth_year ? String(profile.birth_year) : '');
  const [retireAge, setRetireAge] = useState<string>(String(profile.target_retire_age));
  const [monthlyManwon, setMonthlyManwon] = useState<string>(String(Math.round(profile.target_monthly_expense / 10000)));
  const [risk, setRisk] = useState<RetireProfile['risk_tolerance']>(profile.risk_tolerance);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const saved = await api.saveRetireProfile({
        birth_year: birthYear ? Number(birthYear) : undefined,
        target_retire_age: Number(retireAge) || undefined,
        target_monthly_expense: Math.max(0, Math.round(Number(monthlyManwon) * 10000)) || undefined,
        risk_tolerance: risk,
      });
      onSaved(saved);
    } catch (e) {
      setError(e instanceof Error ? e.message : '저장 실패');
    } finally {
      setSaving(false);
    }
  };

  const inputCls =
    'w-full rounded-lg border border-gray-200 px-3 py-1.5 text-sm text-gray-900 focus:border-emerald-400 focus:outline-none';

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm">
      <div className="flex items-center gap-2">
        <div className="p-1.5 bg-emerald-50 border border-emerald-200 rounded-lg">
          <Target className="text-emerald-600" size={15} />
        </div>
        <h3 className="text-sm font-semibold text-gray-900">은퇴 목표 프로필</h3>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <label className="space-y-1">
          <span className="text-xs text-gray-500">출생연도</span>
          <input
            type="number"
            value={birthYear}
            onChange={(e) => setBirthYear(e.target.value)}
            placeholder="예: 1975"
            className={inputCls}
          />
        </label>
        <label className="space-y-1">
          <span className="text-xs text-gray-500">목표 은퇴 나이</span>
          <input
            type="number"
            value={retireAge}
            onChange={(e) => setRetireAge(e.target.value)}
            className={inputCls}
          />
        </label>
        <label className="space-y-1">
          <span className="text-xs text-gray-500">은퇴 후 목표 월 생활비 (만원)</span>
          <input
            type="number"
            value={monthlyManwon}
            onChange={(e) => setMonthlyManwon(e.target.value)}
            className={inputCls}
          />
        </label>
        <label className="space-y-1">
          <span className="text-xs text-gray-500">위험 성향</span>
          <select
            value={risk}
            onChange={(e) => setRisk(e.target.value as RetireProfile['risk_tolerance'])}
            className={inputCls}
          >
            {(Object.keys(RISK_LABELS) as RetireProfile['risk_tolerance'][]).map((k) => (
              <option key={k} value={k}>
                {RISK_LABELS[k]}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="mt-3 flex items-center gap-3">
        <button
          onClick={save}
          disabled={saving}
          className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          {saving && <Loader2 size={13} className="animate-spin" />}
          프로필 저장
        </button>
        {!profile.birth_year && (
          <span className="text-xs text-amber-600">
            출생연도를 입력하면 연령대별 목표 자산배분(글라이드 패스) 진단이 활성화됩니다.
          </span>
        )}
        {error && <span className="text-xs text-rose-500">{error}</span>}
      </div>
    </div>
  );
}

// ── 페이지 ───────────────────────────────────────────────────────────────────
export default function RetirementPage() {
  const [snapshot, setSnapshot] = useState<RetirementSnapshot | null>(null);
  const [opinion, setOpinion] = useState<RetirementOpinion | null>(null);
  const [reviews, setReviews] = useState<RetirementReview[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [reviewRunning, setReviewRunning] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const [snap, op, revs] = await Promise.all([
        api.getRetirementSnapshot(),
        api.getRetirementOpinion(),
        api.getRetirementReviews(),
      ]);
      setSnapshot(snap);
      setOpinion(op);
      setReviews(revs);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const generateOpinion = async () => {
    setGenerating(true);
    setAiError(null);
    try {
      setOpinion(await api.generateRetirementOpinion());
    } catch (e) {
      setAiError(e instanceof Error ? e.message : 'AI 의견 생성 실패');
    } finally {
      setGenerating(false);
    }
  };

  const runReview = async () => {
    setReviewRunning(true);
    setAiError(null);
    try {
      const entry = await api.runRetirementReview();
      setReviews((prev) => [entry, ...prev.filter((r) => r.week_of !== entry.week_of)]);
    } catch (e) {
      setAiError(e instanceof Error ? e.message : '주간 리뷰 실행 실패');
    } finally {
      setReviewRunning(false);
    }
  };

  if (loading) {
    return <p className="py-16 text-center text-sm text-gray-400">노후생활 데이터 불러오는 중…</p>;
  }
  if (!snapshot) {
    return <p className="py-16 text-center text-sm text-rose-500">진단 데이터를 불러오지 못했습니다.</p>;
  }

  const { assets, portfolio, retirement_goal: goal, monthly_balance: balance, glide_path: glide } = snapshot;
  const progress = goal.progress_pct;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Sunset className="text-amber-500" size={18} />
        <h2 className="text-base font-semibold text-gray-900">노후생활 — 은퇴 준비 진단</h2>
        <span className="text-xs text-gray-400">
          투자·세무 자문이 아닌 참고 정보입니다. 세제 수치는 2026-07 조사 기준이며 최신 세법을 확인하세요.
        </span>
      </div>

      <ProfileForm profile={snapshot.profile} onSaved={() => reload()} />

      {/* 요약 카드 */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <SummaryCard
          icon={PiggyBank}
          label="필요 노후자금 (4% 룰)"
          value={fmtWon(goal.required_capital)}
          color="emerald"
          sub={
            progress != null ? (
              <div className="space-y-1">
                <span>
                  달성률 <b className={progress >= 100 ? 'text-emerald-600' : 'text-gray-700'}>{progress.toFixed(1)}%</b>
                  {' '}(순자산 기준)
                </span>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-100">
                  <div
                    className={`h-full rounded-full ${progress >= 100 ? 'bg-emerald-500' : 'bg-amber-400'}`}
                    style={{ width: `${Math.min(100, progress)}%` }}
                  />
                </div>
              </div>
            ) : (
              '목표 월 생활비를 입력하세요'
            )
          }
        />
        <SummaryCard
          icon={Wallet}
          label="순자산 (총자산 − 부채)"
          value={fmtWon(assets.net_worth)}
          color="gray"
          sub={
            <span>
              7일 {fmtSigned(assets.net_worth_delta_7d)} · 90일 {fmtSigned(assets.net_worth_delta_90d)}
            </span>
          }
        />
        <SummaryCard
          icon={Scale}
          label="주식 비중 vs 목표"
          value={portfolio.equity_pct_of_assets != null ? `${portfolio.equity_pct_of_assets}%` : '—'}
          color={
            portfolio.equity_drift_vs_target == null
              ? 'gray'
              : Math.abs(portfolio.equity_drift_vs_target) <= 5
                ? 'emerald'
                : 'amber'
          }
          sub={
            glide ? (
              <span>
                목표 {glide.equity_min}~{glide.equity_max}%
                {portfolio.equity_drift_vs_target != null &&
                  ` · 이탈 ${portfolio.equity_drift_vs_target > 0 ? '+' : ''}${portfolio.equity_drift_vs_target}%p`}
              </span>
            ) : (
              '출생연도 입력 시 목표 밴드 표시'
            )
          }
        />
        <SummaryCard
          icon={TrendingUp}
          label="월 저축 여력"
          value={fmtSigned(balance.savings_capacity)}
          color={balance.savings_capacity >= 0 ? 'blue' : 'rose'}
          sub={
            <span>
              수입 {fmtWon(balance.income)} − 지출 {fmtWon(balance.expense)}
              {balance.measured.months_counted > 0 && ` (가계부 최근 ${balance.measured.months_counted}개월 평균)`}
            </span>
          }
        />
      </div>

      {glide && (
        <p className="rounded-lg border border-emerald-100 bg-emerald-50/60 px-4 py-2 text-xs text-emerald-800">
          {snapshot.age}세 · 은퇴까지 약 {snapshot.years_to_retire}년 — 현재 구간 초점: {glide.focus}
        </p>
      )}

      {aiError && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-2 text-sm text-rose-700">{aiError}</div>
      )}

      {/* AI 종합 의견 */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
          <div className="flex items-center gap-2">
            <Bot size={16} className="text-violet-500" />
            <h3 className="text-sm font-semibold text-gray-900">AI 종합 의견 — 노후 준비 적절성 · 향후 추세</h3>
            {opinion?.generated_at && (
              <span className="text-xs text-gray-400">
                {new Date(`${opinion.generated_at}Z`).toLocaleString('ko-KR')} 생성
              </span>
            )}
          </div>
          <button
            onClick={generateOpinion}
            disabled={generating}
            className="inline-flex items-center gap-1.5 rounded-lg border border-violet-200 bg-violet-50 px-3 py-1.5 text-xs font-medium text-violet-700 hover:bg-violet-100 disabled:opacity-50"
          >
            {generating ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
            {generating ? '분석 중…' : opinion ? '다시 분석' : 'AI 분석 실행'}
          </button>
        </div>
        <div className="px-6 py-4">
          {!opinion ? (
            <p className="text-sm text-gray-400">
              아직 생성된 의견이 없습니다. 현재 포트폴리오·재정보드 데이터를 기반으로 AI 분석을 실행해 보세요.
            </p>
          ) : (
            <div className="space-y-4 text-sm leading-relaxed text-gray-700">
              <div className="flex items-start gap-3">
                {opinion.adequacy_score != null && (
                  <div className="shrink-0 rounded-lg border border-violet-200 bg-violet-50 px-3 py-2 text-center">
                    <p className="text-[10px] text-violet-500">준비 점수</p>
                    <p className="text-lg font-bold text-violet-700 tabular-nums">{opinion.adequacy_score}</p>
                  </div>
                )}
                <p className="whitespace-pre-line">{opinion.adequacy}</p>
              </div>
              {opinion.trend && (
                <div>
                  <p className="mb-1 text-xs font-semibold text-gray-500">향후 추세 전망</p>
                  <p className="whitespace-pre-line">{opinion.trend}</p>
                </div>
              )}
              {opinion.finance_balance && (
                <div className="rounded-lg border border-blue-100 bg-blue-50/60 px-4 py-3">
                  <p className="mb-1 text-xs font-semibold text-blue-600">재정보드 연동 — 월 소득·지출 밸런스 조언</p>
                  <p className="whitespace-pre-line text-blue-900">{opinion.finance_balance}</p>
                </div>
              )}
              {opinion.actions.length > 0 && (
                <div>
                  <p className="mb-1 text-xs font-semibold text-gray-500">지금 실행할 조치</p>
                  <ul className="list-disc space-y-1 pl-5">
                    {opinion.actions.map((a, i) => (
                      <li key={i}>{a}</li>
                    ))}
                  </ul>
                </div>
              )}
              {opinion.risk_warnings.length > 0 && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
                  <p className="mb-1 flex items-center gap-1 text-xs font-semibold text-amber-700">
                    <AlertTriangle size={12} /> 리스크 경고
                  </p>
                  <ul className="list-disc space-y-1 pl-5 text-amber-900">
                    {opinion.risk_warnings.map((w, i) => (
                      <li key={i}>{w}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* 주간 리뷰 */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
          <div className="flex items-center gap-2">
            <CalendarCheck size={16} className="text-emerald-600" />
            <h3 className="text-sm font-semibold text-gray-900">주간 포트폴리오 리뷰</h3>
            <span className="text-xs text-gray-400">매주 일요일 18:00 자동 실행 · 알림으로 도착</span>
          </div>
          <button
            onClick={runReview}
            disabled={reviewRunning}
            className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700 hover:bg-emerald-100 disabled:opacity-50"
          >
            {reviewRunning ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
            {reviewRunning ? '리뷰 중…' : '지금 리뷰 실행'}
          </button>
        </div>
        <div className="divide-y divide-gray-100">
          {reviews.length === 0 ? (
            <p className="px-6 py-6 text-sm text-gray-400">
              아직 리뷰가 없습니다. 첫 리뷰를 지금 실행해 보세요.
            </p>
          ) : (
            reviews.map((r) => (
              <div key={r.week_of} className="px-6 py-4 text-sm text-gray-700">
                <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-gray-400">
                  <b className="text-gray-600">{r.week_of}</b>
                  {r.progress_pct != null && <span>달성률 {r.progress_pct}%</span>}
                  {r.net_worth != null && <span>순자산 {fmtWon(r.net_worth)}</span>}
                  {r.savings_capacity != null && <span>저축 여력 {fmtSigned(r.savings_capacity)}</span>}
                </div>
                <p className="whitespace-pre-line">{r.summary}</p>
                {r.direction && <p className="mt-1 whitespace-pre-line text-gray-500">→ {r.direction}</p>}
                {r.actions.length > 0 && (
                  <ul className="mt-1 list-disc pl-5 text-gray-600">
                    {r.actions.map((a, i) => (
                      <li key={i}>{a}</li>
                    ))}
                  </ul>
                )}
              </div>
            ))
          )}
        </div>
      </div>

      {/* 지식 베이스 */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="flex items-center gap-2 border-b border-gray-100 px-6 py-4">
          <BookOpen size={16} className="text-blue-500" />
          <h3 className="text-sm font-semibold text-gray-900">노후 준비 핵심 지식 (2026-07 조사 기준)</h3>
        </div>
        <div className="grid grid-cols-1 gap-4 px-6 py-4 text-sm text-gray-700 md:grid-cols-3">
          <div>
            <p className="mb-2 text-xs font-semibold text-gray-500">글라이드 패스 — 목표 주식비중</p>
            <table className="w-full text-xs">
              <tbody>
                {[
                  ['은퇴까지 25년+', '80~90%'],
                  ['15~24년', '65~75%'],
                  ['5~14년', '45~55%'],
                  ['5년 미만·은퇴 후', '30~40%'],
                ].map(([k, v]) => (
                  <tr key={k} className="border-b border-gray-50">
                    <td className="py-1 text-gray-500">{k}</td>
                    <td className="py-1 text-right font-medium tabular-nums">{v}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div>
            <p className="mb-2 text-xs font-semibold text-gray-500">절세 계좌 우선순위</p>
            <ol className="list-decimal space-y-1 pl-5 text-xs">
              <li>연금저축+IRP 세액공제 한도 <b>연 900만원</b> 소진 (환급 13.2~16.5%)</li>
              <li>ISA 납입 (연 2,000만·총 1억, 비과세+9.9% 분리과세)</li>
              <li>남는 자금은 일반 위탁계좌</li>
              <li>ISA 만기 → 연금 이전 시 전환액 10%(최대 300만) 추가 공제</li>
            </ol>
          </div>
          <div>
            <p className="mb-2 text-xs font-semibold text-gray-500">은퇴 후 실수령 방어 (세금+건보료)</p>
            <ul className="list-disc space-y-1 pl-5 text-xs">
              <li>사적연금 수령은 <b>연 1,500만원 이하</b>로 분산 → 저율(3.3~5.5%) 분리과세</li>
              <li>건보 피부양자: 합산소득 2,000만·금융소득 1,000만 초과 시 탈락 주의</li>
              <li>사적연금 소득은 <b>건보료 산정 제외</b> — 배당 생활보다 유리할 수 있음</li>
              <li>인출 순서: ①비과세 원금 → ②퇴직금(한도 내) → ③세액공제분+수익</li>
            </ul>
          </div>
        </div>
        <p className="border-t border-gray-100 px-6 py-3 text-[11px] text-gray-400">
          본 화면의 모든 수치·제안은 투자·세무 자문이 아니며, 세법 개정으로 달라질 수 있습니다. 실행 전 국세청·금융사 최신
          자료를 확인하세요. (근거: doc/retire_PRD.md)
        </p>
      </div>
    </div>
  );
}
