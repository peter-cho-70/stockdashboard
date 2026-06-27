'use client';

import { useEffect, useState } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import { TrendingUp, Loader2 } from 'lucide-react';
import { api, type FinanceAssetSnapshot } from '@/lib/api';

const formatCompact = (v: number) =>
  new Intl.NumberFormat('ko-KR', { notation: 'compact', maximumFractionDigits: 1 }).format(v);

const formatKRWFull = (v: number) =>
  new Intl.NumberFormat('ko-KR', { style: 'currency', currency: 'KRW' }).format(v);

export function AssetTrendChart() {
  const [items, setItems] = useState<FinanceAssetSnapshot[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .getFinanceAssetSnapshots(180)
      .then((res) => setItems(res.items))
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, []);

  const chartData = items.map((s) => ({
    date: s.date.slice(5).replace('-', '.'),
    총자산: Math.round(s.total_assets),
    유동성자산: Math.round(s.liquid_assets),
  }));

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
      <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-1.5">
            <TrendingUp size={14} className="text-emerald-500" />
            자산 변화 추이
          </h3>
          <p className="text-gray-400 text-xs mt-0.5">날짜별 전체 자산 · 유동성 자산 (재정보드를 열 때마다 자동 기록)</p>
        </div>
      </div>
      <div className="p-6">
        {loading ? (
          <div className="flex h-[220px] items-center justify-center text-gray-400">
            <Loader2 size={18} className="animate-spin" />
          </div>
        ) : chartData.length < 2 ? (
          <div className="flex h-[220px] flex-col items-center justify-center gap-1 text-center text-sm text-gray-400">
            <p>아직 추이를 보여드릴 데이터가 부족합니다.</p>
            <p className="text-xs">재정보드를 열 때마다 그날의 자산 값이 자동으로 쌓여요. 며칠 후 다시 확인해 주세요.</p>
          </div>
        ) : (
          <div className="h-[260px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 5, right: 56, left: -10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#9ca3af' }} />
                <YAxis
                  yAxisId="total"
                  orientation="left"
                  tickFormatter={formatCompact}
                  tick={{ fontSize: 11, fill: '#9ca3af' }}
                  width={56}
                  domain={['auto', 'auto']}
                />
                <YAxis
                  yAxisId="liquid"
                  orientation="right"
                  tickFormatter={formatCompact}
                  tick={{ fontSize: 11, fill: '#10b981' }}
                  width={56}
                  domain={['auto', 'auto']}
                />
                <Tooltip
                  formatter={(value, name) => [formatKRWFull(Number(value ?? 0)), name]}
                  contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e5e7eb' }}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Line yAxisId="total" type="monotone" dataKey="총자산" stroke="#111827" strokeWidth={2} dot={false} />
                <Line yAxisId="liquid" type="monotone" dataKey="유동성자산" stroke="#10b981" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </div>
  );
}
