'use client';

import { useFinanceStore } from '@/lib/finance/store/finance-store';
import {
  ArrowUpRight,
  ArrowDownRight,
  Wallet,
  CreditCard,
  TrendingUp,
  Landmark,
  Plus,
  AlertTriangle,
  ChevronRight,
  Info,
} from 'lucide-react';

export default function DashboardPage() {
  const store = useFinanceStore();


  const totalAssets = store.getTotalAssets();
  const liquidNetWorth = store.getLiquidNetWorth();
  const totalLiabilities = store.getTotalLiabilities();
  const monthlyCashflow = store.getMonthlyNetCashflow();

  const formatKRW = (amount: number) =>
    new Intl.NumberFormat('ko-KR', {
      style: 'currency',
      currency: 'KRW',
      notation: 'compact',
      maximumFractionDigits: 1,
    }).format(amount);

  const formatKRWFull = (amount: number) =>
    new Intl.NumberFormat('ko-KR', { style: 'currency', currency: 'KRW' }).format(amount);

  const now = new Date();
  const lastUpdated = `${now.getMonth() + 1}월 ${now.getDate()}일 ${now.getHours()}시 ${String(now.getMinutes()).padStart(2, '0')}분`;

  const totalCashAssets = store.cashAssets.reduce((s, a) => s + a.amount, 0);
  const stockValue = store.stockSnapshot?.total_value ?? 0;
  const securitiesAssets = store.cashAssets.filter((a) => a.accountType === 'securities');
  const bankAssets = store.cashAssets.filter((a) => a.accountType !== 'securities');
  const totalIlliquid = store.illiquidAssets.reduce((s, a) => s + a.amount, 0);
  const totalRealEstate = store.realEstateAssets.reduce((s, a) => s + a.estimatedValue, 0);

  const today = new Date();
  const upcomingExpenses = store.fixedExpenses
    .filter((e) => {
      const d = new Date(e.nextDueDate);
      const diff = Math.ceil((d.getTime() - today.getTime()) / (1000 * 3600 * 24));
      return diff >= 0 && diff <= 45;
    })
    .sort((a, b) => new Date(a.nextDueDate).getTime() - new Date(b.nextDueDate).getTime());

  // 재무 건강도 동적 계산
  const debtRatioScore = (() => {
    const r = totalLiabilities / Math.max(totalAssets, 1);
    if (r < 0.15) return 40; if (r < 0.25) return 35; if (r < 0.40) return 25; if (r < 0.60) return 15; return 5;
  })();
  const cashflowScore = monthlyCashflow > 1000000 ? 35 : monthlyCashflow > 0 ? 25 : monthlyCashflow > -500000 ? 10 : 0;
  const liquidityScore = (() => {
    const r = liquidNetWorth / Math.max(totalLiabilities, 1);
    if (r > 3) return 25; if (r > 2) return 20; if (r > 1) return 12; if (r > 0) return 5; return 0;
  })();
  const healthScore = Math.min(100, debtRatioScore + cashflowScore + liquidityScore);

  const urgentFunding = store.fundingNeeds.filter((n) => {
    const diff = Math.ceil((new Date(n.neededByDate).getTime() - today.getTime()) / (1000 * 3600 * 24));
    return diff >= 0 && diff <= 7 && n.status !== 'completed';
  });

  return (
    <div className="space-y-4 max-w-[1400px] mx-auto">
      {/* Page header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">대시보드</h1>
          <p className="text-gray-400 text-sm mt-0.5">최종 갱신: {lastUpdated}</p>
        </div>
        <div className="flex items-center gap-2">
          <button className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 text-white text-xs font-medium rounded-md hover:bg-emerald-500 transition-all shadow-sm">
            <Plus size={12} />
            자산 등록
          </button>
        </div>
      </div>

      {urgentFunding.length > 0 && (
        <div className="flex items-center justify-between px-4 py-2.5 bg-amber-50 border border-amber-200 rounded-lg text-sm">
          <div className="flex items-center gap-2">
            <AlertTriangle size={14} className="text-amber-600 shrink-0" />
            <span className="text-amber-700 font-medium">
              7일 이내 자금 수요 {urgentFunding.length}건 — {urgentFunding.map(f => f.title).join(', ')}
            </span>
          </div>
          <a href="/finance/funding" className="flex items-center gap-0.5 text-gray-500 hover:text-gray-700 text-xs transition-colors ml-4">
            자세히 <ChevronRight size={12} />
          </a>
        </div>
      )}

      {/* Summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <SummaryCard
          label="전체 자산"
          value={formatKRWFull(totalAssets)}
          sub="비유동/부동산 포함"
          icon={<Landmark size={16} />}
          color="gray"
          compact
          tooltip="유동 현금 자산 + 비유동 투자 + 부동산 자산 (부채 차감 전 총액)"
        />
        <SummaryCard
          label="유동 순자산"
          value={formatKRWFull(liquidNetWorth)}
          sub="즉시 조달 가능"
          icon={<Wallet size={16} />}
          color="emerald"
          highlight
          compact
          tooltip="은행 예수금 + StockMind 주식 평가 - 총 부채. 비유동·부동산은 제외"
        />
        <SummaryCard
          label="총 부채"
          value={formatKRWFull(totalLiabilities)}
          sub="대출 및 마이너스 통장"
          icon={<CreditCard size={16} />}
          color="rose"
          compact
          tooltip="등록된 모든 대출·마이너스통장의 원금(principal) 합계"
        />
        <SummaryCard
          label="월 순현금흐름"
          value={formatKRWFull(monthlyCashflow)}
          sub="수입 - 고정지출"
          icon={<TrendingUp size={16} />}
          color={monthlyCashflow >= 0 ? 'blue' : 'rose'}
          trend={monthlyCashflow >= 0 ? 'up' : 'down'}
          compact
          tooltip="월 정기 수입(cycle: monthly) 합계 - 월 고정지출(cycle: monthly) 합계"
        />
      </div>

      {/* Main content */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Asset breakdown */}
        <div className="lg:col-span-2 bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
          <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-gray-900">자산 구성 현황</h3>
              <p className="text-gray-400 text-xs mt-0.5">포트폴리오 자산 분류별 비중</p>
            </div>
            <span className="text-lg font-bold text-gray-900">{formatKRW(totalAssets)}</span>
          </div>

          <div className="p-6 space-y-5">
            {stockValue > 0 && (
              <AssetBar
                label="보유 주식 (StockMind)"
                sublabel={`${store.stockSnapshot?.stock_count ?? 0}종목 · 실시간 평가`}
                value={stockValue}
                total={totalAssets}
                color="bg-blue-500"
                formattedValue={formatKRWFull(stockValue)}
              />
            )}
            <AssetBar
              label="유동 현금 자산"
              sublabel="은행·증권 예수금 (수동 입력)"
              value={totalCashAssets}
              total={totalAssets}
              color="bg-emerald-500"
              formattedValue={formatKRWFull(totalCashAssets)}
            />
            <AssetBar
              label="비유동 투자"
              sublabel="비상장 투자·기타 고정 자산"
              value={totalIlliquid}
              total={totalAssets}
              color="bg-slate-400"
              formattedValue={formatKRWFull(totalIlliquid)}
            />
            {totalRealEstate > 0 && (
              <AssetBar
                label="부동산 자산"
                sublabel="토지·건물·아파트 등"
                value={totalRealEstate}
                total={totalAssets}
                color="bg-amber-500"
                formattedValue={formatKRWFull(totalRealEstate)}
              />
            )}
          </div>

          {/* Cash assets table */}
          <div className="border-t border-gray-100">
            <div className="px-6 py-3 bg-gray-50">
              <p className="text-xs font-medium text-gray-500">계좌별 현황</p>
            </div>
            {securitiesAssets.length > 0 && (
              <div>
                <p className="px-6 pt-2.5 pb-1 text-[11px] font-semibold text-blue-600">증권사 계좌</p>
                <table className="w-full text-sm">
                  <tbody>
                    {securitiesAssets.map((asset, i) => (
                      <tr
                        key={asset.id}
                        className={`flex justify-between items-center px-6 py-3 ${i < securitiesAssets.length - 1 ? 'border-b border-gray-100' : ''} hover:bg-gray-50 transition-colors`}
                      >
                        <td className="flex items-center gap-2">
                          <span className="text-gray-800 font-medium">{asset.name}</span>
                          <span className="text-[11px] text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded border border-gray-200">{asset.institution}</span>
                        </td>
                        <td className="text-gray-700 font-semibold tabular-nums">{formatKRWFull(asset.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {bankAssets.length > 0 && (
              <div className="border-t border-gray-100">
                <p className="px-6 pt-2.5 pb-1 text-[11px] font-semibold text-emerald-600">은행 계좌</p>
                <table className="w-full text-sm">
                  <tbody>
                    {bankAssets.map((asset, i) => (
                      <tr
                        key={asset.id}
                        className={`flex justify-between items-center px-6 py-3 ${i < bankAssets.length - 1 ? 'border-b border-gray-100' : ''} hover:bg-gray-50 transition-colors`}
                      >
                        <td className="flex items-center gap-2">
                          <span className="text-gray-800 font-medium">{asset.name}</span>
                          <span className="text-[11px] text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded border border-gray-200">{asset.institution}</span>
                        </td>
                        <td className="text-gray-700 font-semibold tabular-nums">{formatKRWFull(asset.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Real estate assets table */}
          {store.realEstateAssets.length > 0 && (
            <div className="border-t border-gray-100">
              <div className="px-6 py-3 bg-gray-50 flex items-center justify-between">
                <p className="text-xs font-medium text-gray-500">부동산별 현황</p>
                <span className="text-xs font-semibold text-amber-600 tabular-nums">{formatKRWFull(totalRealEstate)}</span>
              </div>
              <table className="w-full text-sm">
                <tbody className="divide-y divide-gray-100">
                  {store.realEstateAssets.map((asset) => {
                    const typeLabel: Record<string, string> = { apartment: '아파트', land: '토지', building: '건물', commercial: '상가', other: '기타' };
                    return (
                      <tr key={asset.id} className="hover:bg-gray-50 transition-colors">
                        <td className="px-6 py-3">
                          <div className="flex items-center gap-2">
                            <span className="text-gray-800 font-medium">{asset.name}</span>
                            <span className="text-[11px] text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded border border-amber-200">
                              {typeLabel[asset.realEstateType] ?? asset.realEstateType}
                            </span>
                          </div>
                          {asset.address && <p className="text-xs text-gray-400 mt-0.5">{asset.address}</p>}
                        </td>
                        <td className="px-6 py-3 text-right">
                          <span className={`text-[11px] font-medium px-2 py-0.5 rounded border ${asset.valuationType === 'official' ? 'text-blue-600 bg-blue-50 border-blue-200' : 'text-emerald-600 bg-emerald-50 border-emerald-200'}`}>
                            {asset.valuationType === 'official' ? '공시지가' : '실거래가'}
                          </span>
                        </td>
                        <td className="px-6 py-3 text-right font-semibold text-amber-600 tabular-nums">
                          {formatKRWFull(asset.estimatedValue)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Right column */}
        <div className="space-y-4">
          {/* Upcoming payments */}
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
            <div className="px-5 py-4 border-b border-gray-100">
              <h3 className="text-sm font-semibold text-gray-900">다가오는 결제</h3>
              <p className="text-gray-400 text-xs mt-0.5">45일 이내 납부 예정</p>
            </div>
            <div className="divide-y divide-gray-100">
              {upcomingExpenses.length === 0 ? (
                <div className="px-5 py-6 text-center text-xs text-gray-400">납부 예정 항목이 없습니다</div>
              ) : (
                upcomingExpenses.map((expense) => {
                  const dueDate = new Date(expense.nextDueDate);
                  const daysDiff = Math.ceil((dueDate.getTime() - today.getTime()) / (1000 * 3600 * 24));
                  return (
                    <div key={expense.id} className="px-5 py-3 flex items-center justify-between hover:bg-gray-50 transition-colors">
                      <div>
                        <p className="text-sm text-gray-800 font-medium">{expense.name}</p>
                        <p className="text-xs text-gray-400 mt-0.5">
                          {expense.nextDueDate.replace(/-/g, '.')}
                          <span className={`ml-1.5 font-semibold ${daysDiff <= 7 ? 'text-rose-500' : daysDiff <= 14 ? 'text-amber-500' : 'text-gray-500'}`}>
                            D-{daysDiff}
                          </span>
                        </p>
                      </div>
                      <span className="text-sm font-semibold text-gray-800 tabular-nums">{formatKRW(expense.amount)}</span>
                    </div>
                  );
                })
              )}
            </div>
            <div className="px-5 py-3 border-t border-gray-100">
              <a href="/finance/cashflow" className="text-xs text-gray-400 hover:text-emerald-600 flex items-center gap-1 transition-colors">
                현금흐름 전체보기 <ChevronRight size={12} />
              </a>
            </div>
          </div>

          {/* Debt summary */}
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-gray-900">부채 현황</h3>
                <p className="text-gray-400 text-xs mt-0.5">활성 대출 포트폴리오</p>
              </div>
              <span className="text-rose-500 font-semibold text-sm">{formatKRW(totalLiabilities)}</span>
            </div>
            <div className="divide-y divide-gray-100">
              {store.liabilities.map((liability) => (
                <div key={liability.id} className="px-5 py-3 flex items-center justify-between hover:bg-gray-50 transition-colors">
                  <div>
                    <p className="text-sm text-gray-800 font-medium">{liability.name}</p>
                    <p className="text-xs text-gray-400 mt-0.5">연 {liability.interestRate}% · 월 {formatKRW(liability.monthlyInterest)}</p>
                  </div>
                  <span className="text-sm font-semibold text-rose-500 tabular-nums">{formatKRW(liability.principal)}</span>
                </div>
              ))}
            </div>
            <div className="px-5 py-3 border-t border-gray-100">
              <a href="/finance/liabilities" className="text-xs text-gray-400 hover:text-rose-500 flex items-center gap-1 transition-colors">
                부채 관리 <ChevronRight size={12} />
              </a>
            </div>
          </div>

          {/* Financial health score */}
          <div className="bg-gradient-to-br from-emerald-500 to-blue-600 rounded-xl px-5 py-5 text-white shadow-sm">
            <div className="relative group/health inline-flex items-center gap-1.5 cursor-default">
              <p className="text-xs text-white/70 font-medium">재무 건강도</p>
              <Info size={12} className="text-white/40 group-hover/health:text-white/80 transition-colors" />
              {/* Tooltip */}
              <div className="absolute bottom-full left-0 mb-2 w-72 bg-gray-900 text-white text-xs rounded-xl p-4 opacity-0 group-hover/health:opacity-100 transition-opacity pointer-events-none z-50 shadow-2xl">
                <p className="font-semibold text-white mb-2.5">재무 건강도 산정 기준</p>
                <div className="space-y-2">
                  <div className="flex justify-between items-center">
                    <div>
                      <p className="text-gray-300 font-medium">부채 비율</p>
                      <p className="text-gray-500 text-[11px]">총 부채 ÷ 전체 자산</p>
                    </div>
                    <span className="font-bold text-emerald-400">{debtRatioScore}<span className="text-gray-500 font-normal">/40</span></span>
                  </div>
                  <div className="flex justify-between items-center">
                    <div>
                      <p className="text-gray-300 font-medium">현금흐름</p>
                      <p className="text-gray-500 text-[11px]">월 순현금흐름 흑/적자</p>
                    </div>
                    <span className="font-bold text-emerald-400">{cashflowScore}<span className="text-gray-500 font-normal">/35</span></span>
                  </div>
                  <div className="flex justify-between items-center">
                    <div>
                      <p className="text-gray-300 font-medium">유동성</p>
                      <p className="text-gray-500 text-[11px]">유동 순자산 ÷ 총 부채</p>
                    </div>
                    <span className="font-bold text-emerald-400">{liquidityScore}<span className="text-gray-500 font-normal">/25</span></span>
                  </div>
                </div>
                <div className="mt-2.5 pt-2.5 border-t border-gray-700 flex justify-between items-center">
                  <span className="text-gray-400">합계</span>
                  <span className="font-bold text-white">{healthScore}<span className="text-gray-500 font-normal">/100</span></span>
                </div>
                {/* Arrow */}
                <div className="absolute top-full left-4 w-0 h-0 border-l-4 border-r-4 border-t-4 border-l-transparent border-r-transparent border-t-gray-900" />
              </div>
            </div>
            <div className="flex items-end gap-1 mt-2">
              <span className="text-3xl font-bold">{healthScore}</span>
              <span className="text-white/60 text-sm mb-1">/100</span>
            </div>
            <div className="mt-3 h-1.5 bg-white/20 rounded-full overflow-hidden">
              <div className="h-full bg-white/80 rounded-full transition-all duration-700" style={{ width: `${healthScore}%` }} />
            </div>
            <a href="/finance/funding" className="mt-4 flex items-center justify-between text-xs text-white/70 hover:text-white transition-colors">
              자금 계획 확인 <ArrowUpRight size={12} />
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}

interface SummaryCardProps {
  label: string;
  value: string;
  sub: string;
  icon: React.ReactNode;
  color: 'gray' | 'emerald' | 'rose' | 'blue' | 'amber';
  highlight?: boolean;
  trend?: 'up' | 'down';
  compact?: boolean;
  tooltip?: string;
}

function SummaryCard({ label, value, sub, icon, color, highlight, trend, compact, tooltip }: SummaryCardProps) {
  const valueColor = {
    gray: 'text-gray-900',
    emerald: 'text-emerald-600',
    rose: 'text-rose-500',
    blue: 'text-blue-600',
    amber: 'text-amber-600',
  };
  const iconStyle = {
    gray: 'bg-gray-100 border-gray-200 text-gray-500',
    emerald: 'bg-emerald-50 border-emerald-200 text-emerald-600',
    rose: 'bg-rose-50 border-rose-200 text-rose-500',
    blue: 'bg-blue-50 border-blue-200 text-blue-600',
    amber: 'bg-amber-50 border-amber-200 text-amber-600',
  };

  return (
    <div className={`bg-white rounded-xl border px-5 py-4 hover:shadow-md transition-shadow shadow-sm ${highlight ? 'border-emerald-200' : 'border-gray-200'}`}>
      <div className="flex items-start justify-between mb-3">
        <div className={`p-1.5 rounded-lg border ${iconStyle[color]}`}>
          {icon}
        </div>
        {trend && (
          <span className={`text-[11px] font-medium flex items-center gap-0.5 ${trend === 'up' ? 'text-emerald-600' : 'text-rose-500'}`}>
            {trend === 'up' ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}
            {trend === 'up' ? '흑자' : '적자'}
          </span>
        )}
      </div>
      <div className="relative group/tip inline-flex items-center gap-1 cursor-default">
        <p className="text-xs text-gray-500 font-medium">{label}</p>
        {tooltip && (
          <>
            <Info size={11} className="text-gray-300 group-hover/tip:text-gray-500 transition-colors" />
            <div className="absolute top-full left-0 mt-2 w-64 bg-gray-900 text-white text-[11px] leading-relaxed rounded-xl p-3 opacity-0 group-hover/tip:opacity-100 transition-opacity pointer-events-none z-50 shadow-2xl">
              {tooltip}
            </div>
          </>
        )}
      </div>
      <p className={`font-bold mt-1 tracking-tight ${compact ? 'text-base' : 'text-xl'} ${valueColor[color]}`}>{value}</p>
      <p className="text-xs text-gray-400 mt-1">{sub}</p>
    </div>
  );
}

interface AssetBarProps {
  label: string;
  sublabel: string;
  value: number;
  total: number;
  color: string;
  formattedValue: string;
}

function AssetBar({ label, sublabel, value, total, color, formattedValue }: AssetBarProps) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0;
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <div>
          <span className="text-sm text-gray-700 font-medium">{label}</span>
          <span className="text-xs text-gray-400 ml-2">{sublabel}</span>
        </div>
        <div className="flex items-center gap-3 text-right">
          <span className="text-xs text-gray-400 tabular-nums">{formattedValue}</span>
          <span className="text-sm font-bold text-gray-700 w-10 text-right tabular-nums">{pct}%</span>
        </div>
      </div>
      <div className="h-1.5 w-full bg-gray-100 rounded-full overflow-hidden">
        <div
          className={`h-full ${color} rounded-full transition-all duration-700`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
