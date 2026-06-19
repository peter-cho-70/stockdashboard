'use client';

import { useMemo, useState } from 'react';
import {
  PieChart, Pie, Cell, ResponsiveContainer, Tooltip,
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Legend,
} from 'recharts';
import { PieChart as PieIcon, BarChart3, Radar as RadarIcon } from 'lucide-react';
import type { CategoryInfo, Budget } from '@/lib/finance/types';
import { chartColor } from '@/lib/finance/category-colors';

export type BreakdownItem = {
  category: string;
  amount: number;
  pct: number;
  fill: string;
  budget?: number;
};

type AnalysisType = 'expense' | 'income';
type ChartType = 'donut' | 'bar' | 'radar';

function fmtCompact(n: number) {
  if (n >= 100000000) return (n / 100000000).toFixed(1) + '억';
  if (n >= 10000) return Math.round(n / 10000) + '만';
  return n.toLocaleString('ko-KR');
}

function fmt(n: number) {
  return n.toLocaleString('ko-KR') + '원';
}

function buildBreakdown(
  categories: CategoryInfo[],
  incomeOk: boolean,
  total: number,
  getAmount: (cat: string) => number,
  budgets: Budget[],
): BreakdownItem[] {
  return categories
    .filter(c => c.incomeOk === incomeOk)
    .map(c => {
      const amount = getAmount(c.name);
      const budget = budgets.find(b => b.category === c.name)?.monthlyLimit;
      return {
        category: c.name,
        amount,
        pct: total > 0 ? Math.round((amount / total) * 100) : 0,
        fill: chartColor(c.color),
        budget,
      };
    })
    .filter(x => x.amount > 0)
    .sort((a, b) => b.amount - a.amount);
}

function CustomTooltip({ active, payload, analysisType }: {
  active?: boolean;
  payload?: { payload: BreakdownItem }[];
  analysisType: AnalysisType;
}) {
  if (!active || !payload?.length) return null;
  const item = payload[0].payload;
  return (
    <div className="bg-white border border-gray-200 rounded-lg shadow-lg px-3 py-2 text-xs">
      <p className="font-semibold text-gray-900">{item.category}</p>
      <p className="text-gray-600 mt-0.5">{fmt(item.amount)}</p>
      <p className={`font-medium mt-0.5 ${analysisType === 'expense' ? 'text-rose-600' : 'text-emerald-600'}`}>
        {item.pct}%
      </p>
    </div>
  );
}

function DonutChart({ data, total, analysisType }: {
  data: BreakdownItem[];
  total: number;
  analysisType: AnalysisType;
}) {
  const accent = analysisType === 'expense' ? 'text-rose-600' : 'text-emerald-600';
  const label = analysisType === 'expense' ? '총 지출' : '총 수입';

  return (
    <div className="relative h-[260px]">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={data}
            dataKey="amount"
            nameKey="category"
            cx="50%"
            cy="50%"
            innerRadius={65}
            outerRadius={95}
            paddingAngle={2}
            strokeWidth={0}
          >
            {data.map(d => (
              <Cell key={d.category} fill={d.fill} />
            ))}
          </Pie>
          <Tooltip content={<CustomTooltip analysisType={analysisType} />} />
        </PieChart>
      </ResponsiveContainer>
      <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
        <span className="text-[10px] text-gray-400">{label}</span>
        <span className={`text-sm font-bold ${accent}`}>{fmtCompact(total)}</span>
      </div>
    </div>
  );
}

function HorizontalBarChart({ data, analysisType }: {
  data: BreakdownItem[];
  analysisType: AnalysisType;
}) {
  const chartData = [...data].reverse();

  return (
    <div className="h-[260px]">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={chartData} layout="vertical" margin={{ top: 4, right: 48, left: 4, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f3f4f6" />
          <XAxis type="number" hide />
          <YAxis
            type="category"
            dataKey="category"
            width={56}
            tick={{ fontSize: 10, fill: '#6b7280' }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip content={<CustomTooltip analysisType={analysisType} />} />
          <Bar dataKey="amount" radius={[0, 4, 4, 0]} barSize={14}>
            {chartData.map(d => (
              <Cell key={d.category} fill={d.fill} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function CategoryRadarChart({ data, analysisType }: {
  data: BreakdownItem[];
  analysisType: AnalysisType;
}) {
  const maxVal = Math.max(
    ...data.map(d => d.amount),
    ...data.filter(d => d.budget).map(d => d.budget!),
    1,
  );

  const radarData = data.map(d => ({
    category: d.category,
    실제: Math.round((d.amount / maxVal) * 100),
    ...(analysisType === 'expense' && d.budget
      ? { 예산: Math.round((d.budget / maxVal) * 100) }
      : {}),
    _amount: d.amount,
    _budget: d.budget,
  }));

  const hasBudget = analysisType === 'expense' && data.some(d => d.budget);

  return (
    <div className="h-[260px]">
      <ResponsiveContainer width="100%" height="100%">
        <RadarChart data={radarData} cx="50%" cy="50%" outerRadius="70%">
          <PolarGrid stroke="#e5e7eb" />
          <PolarAngleAxis dataKey="category" tick={{ fontSize: 10, fill: '#6b7280' }} />
          <PolarRadiusAxis angle={90} domain={[0, 100]} tick={false} axisLine={false} />
          <Radar
            name="실제"
            dataKey="실제"
            stroke={analysisType === 'expense' ? '#f43f5e' : '#10b981'}
            fill={analysisType === 'expense' ? '#f43f5e' : '#10b981'}
            fillOpacity={0.25}
            strokeWidth={2}
          />
          {hasBudget && (
            <Radar
              name="예산"
              dataKey="예산"
              stroke="#6366f1"
              fill="#6366f1"
              fillOpacity={0.1}
              strokeWidth={2}
              strokeDasharray="4 4"
            />
          )}
          <Legend wrapperStyle={{ fontSize: 11 }} />
          <Tooltip
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const row = payload[0].payload as typeof radarData[0];
              return (
                <div className="bg-white border border-gray-200 rounded-lg shadow-lg px-3 py-2 text-xs">
                  <p className="font-semibold text-gray-900">{row.category}</p>
                  <p className="text-gray-600">실제: {fmt(row._amount)}</p>
                  {row._budget != null && (
                    <p className="text-indigo-600">예산: {fmt(row._budget)}</p>
                  )}
                </div>
              );
            }}
          />
        </RadarChart>
      </ResponsiveContainer>
    </div>
  );
}

function LegendList({ data }: { data: BreakdownItem[] }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1.5 mt-4 pt-4 border-t border-gray-100">
      {data.map(d => (
        <div key={d.category} className="flex items-center gap-2 min-w-0">
          <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: d.fill }} />
          <span className="text-[11px] text-gray-600 truncate">{d.category}</span>
          <span className="text-[11px] font-medium text-gray-800 ml-auto shrink-0">{d.pct}%</span>
        </div>
      ))}
    </div>
  );
}

interface CategoryBreakdownPanelProps {
  categories: CategoryInfo[];
  budgets: Budget[];
  viewYear: number;
  viewMonth: number;
  monthExpenses: number;
  monthIncome: number;
  getCategorySpending: (year: number, month: number, category: string) => number;
  getCategoryIncome: (year: number, month: number, category: string) => number;
}

export function CategoryBreakdownPanel({
  categories,
  budgets,
  viewYear,
  viewMonth,
  monthExpenses,
  monthIncome,
  getCategorySpending,
  getCategoryIncome,
}: CategoryBreakdownPanelProps) {
  const [analysisType, setAnalysisType] = useState<AnalysisType>('expense');
  const [chartType, setChartType] = useState<ChartType>('donut');

  const expenseData = useMemo(
    () => buildBreakdown(categories, false, monthExpenses, c => getCategorySpending(viewYear, viewMonth, c), budgets),
    [categories, monthExpenses, viewYear, viewMonth, getCategorySpending, budgets],
  );

  const incomeData = useMemo(
    () => buildBreakdown(categories, true, monthIncome, c => getCategoryIncome(viewYear, viewMonth, c), budgets),
    [categories, monthIncome, viewYear, viewMonth, getCategoryIncome, budgets],
  );

  const data = analysisType === 'expense' ? expenseData : incomeData;
  const total = analysisType === 'expense' ? monthExpenses : monthIncome;

  if (monthExpenses === 0 && monthIncome === 0) return null;

  const chartTabs: { id: ChartType; label: string; icon: typeof PieIcon }[] = [
    { id: 'donut', label: '원형', icon: PieIcon },
    { id: 'bar', label: '막대', icon: BarChart3 },
    { id: 'radar', label: '별형', icon: RadarIcon },
  ];

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
        <h3 className="text-xs font-semibold text-gray-600">카테고리별 분석</h3>
        <div className="flex items-center gap-2 flex-wrap">
          {/* 지출 / 수입 탭 */}
          <div className="flex rounded-lg border border-gray-200 p-0.5 bg-gray-50">
            {(['expense', 'income'] as const).map(t => (
              <button
                key={t}
                onClick={() => setAnalysisType(t)}
                disabled={t === 'expense' ? monthExpenses === 0 : monthIncome === 0}
                className={`px-3 py-1 rounded-md text-[11px] font-medium transition-all disabled:opacity-40 ${
                  analysisType === t
                    ? t === 'expense'
                      ? 'bg-white text-rose-600 shadow-sm'
                      : 'bg-white text-emerald-600 shadow-sm'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                {t === 'expense' ? '지출' : '수입'}
              </button>
            ))}
          </div>
          {/* 차트 형태 탭 */}
          <div className="flex rounded-lg border border-gray-200 p-0.5 bg-gray-50">
            {chartTabs.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                onClick={() => setChartType(id)}
                className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-medium transition-all ${
                  chartType === id
                    ? 'bg-white text-gray-900 shadow-sm'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                <Icon size={12} />
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {data.length === 0 ? (
        <p className="text-sm text-gray-400 text-center py-12">
          {analysisType === 'expense' ? '이번 달 지출' : '이번 달 수입'} 내역이 없습니다.
        </p>
      ) : (
        <>
          {chartType === 'donut' && (
            <DonutChart data={data} total={total} analysisType={analysisType} />
          )}
          {chartType === 'bar' && (
            <HorizontalBarChart data={data} analysisType={analysisType} />
          )}
          {chartType === 'radar' && (
            <>
              <CategoryRadarChart data={data} analysisType={analysisType} />
              {analysisType === 'expense' && !data.some(d => d.budget) && (
                <p className="text-[10px] text-gray-400 text-center mt-1">
                  예산을 설정하면 별형 차트에서 예산 대비 실적을 비교할 수 있습니다.
                </p>
              )}
            </>
          )}
          <LegendList data={data} />
        </>
      )}
    </div>
  );
}
