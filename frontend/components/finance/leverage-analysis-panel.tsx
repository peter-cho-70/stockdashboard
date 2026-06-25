'use client';

import { useEffect, useState } from 'react';
import { Loader2, ArrowRight } from 'lucide-react';
import { api, type LeverageAnalysisResult, type LeverageAnalysisItem } from '@/lib/api';

const formatKRW = (v: number) =>
  new Intl.NumberFormat('ko-KR', { style: 'currency', currency: 'KRW', maximumFractionDigits: 0 }).format(v);

function ProfitText({ value }: { value: number }) {
  return (
    <span className={value > 0 ? 'text-rose-500' : value < 0 ? 'text-blue-500' : 'text-gray-500'}>
      {value > 0 ? '+' : ''}
      {formatKRW(value)}
    </span>
  );
}

function ItemRow({ item, basis }: { item: LeverageAnalysisItem; basis: 'post_loan' | 'overall' }) {
  const costBasis = basis === 'post_loan' ? item.post_loan_avg_price : item.overall_avg_price;
  const unrealized = basis === 'post_loan' ? item.unrealized_profit_post_loan_avg : item.unrealized_profit_overall_avg;
  const [sellPrice, setSellPrice] = useState(item.current_price);

  const projectedProfit = (sellPrice - costBasis) * item.held_qty + item.realized_profit;

  return (
    <tr className="border-b border-gray-100 last:border-0">
      <td className="py-2.5 pr-3">
        <p className="text-sm font-medium text-gray-800">{item.name}</p>
        <p className="text-[11px] text-gray-400">
          대출 후 매수 {item.post_loan_buy_qty.toLocaleString()}주 @ {formatKRW(item.post_loan_avg_price)}
        </p>
      </td>
      <td className="py-2.5 pr-3 text-right text-xs text-gray-500 tabular-nums">
        {item.held_qty.toLocaleString()}주
        <br />
        <span className="text-[11px] text-gray-400">현재가 {formatKRW(item.current_price)}</span>
      </td>
      <td className="py-2.5 pr-3 text-right text-xs tabular-nums">
        {item.realized_profit !== 0 ? <ProfitText value={item.realized_profit} /> : <span className="text-gray-400">—</span>}
      </td>
      <td className="py-2.5 pr-3 text-right text-xs tabular-nums">
        <ProfitText value={unrealized} />
      </td>
      <td className="py-2.5 pr-3 text-right">
        <input
          type="number"
          value={sellPrice}
          onChange={(e) => setSellPrice(Number(e.target.value))}
          className="w-24 bg-gray-50 border border-gray-200 px-2 py-1 rounded-md text-xs text-right outline-none focus:border-emerald-400 focus:bg-white tabular-nums"
        />
      </td>
      <td className="py-2.5 text-right text-xs font-semibold tabular-nums">
        <ProfitText value={projectedProfit} />
      </td>
    </tr>
  );
}

export function LeverageAnalysisPanel({
  startDate,
  principal,
  annualRate,
}: {
  startDate: string;
  principal: number;
  annualRate: number;
}) {
  const [data, setData] = useState<LeverageAnalysisResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [basis, setBasis] = useState<'post_loan' | 'overall'>('post_loan');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .getLeverageAnalysis(startDate, principal, annualRate)
      .then((res) => {
        if (!cancelled) setData(res);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : '분석에 실패했습니다.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [startDate, principal, annualRate]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-6 text-sm text-gray-400">
        <Loader2 size={14} className="animate-spin" /> 분석 중...
      </div>
    );
  }

  if (error || !data) {
    return <p className="text-sm text-rose-500">{error ?? '분석 결과를 불러오지 못했습니다.'}</p>;
  }

  if (data.items.length === 0) {
    return (
      <p className="text-sm text-gray-400">
        대출 실행일({startDate}) 이후 매수한 종목이 없습니다.
      </p>
    );
  }

  const investmentProfit = basis === 'post_loan' ? data.investment_profit_post_loan_avg : data.investment_profit_overall_avg;
  const netProfit = basis === 'post_loan' ? data.net_profit_post_loan_avg : data.net_profit_overall_avg;
  const netReturnPct = data.principal ? (netProfit / data.principal) * 100 : 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-gray-500">
          대출 실행일 <span className="font-medium text-gray-700">{startDate}</span> 이후 (약 {data.months_elapsed.toFixed(1)}개월) 매수한 종목 기준
        </p>
        <div className="flex items-center rounded-md border border-gray-200 bg-white p-0.5 text-[11px]">
          <button
            onClick={() => setBasis('post_loan')}
            className={`px-2.5 py-1 rounded-sm transition-colors ${basis === 'post_loan' ? 'bg-emerald-500 text-white' : 'text-gray-500 hover:text-gray-700'}`}
          >
            대출 후 매수 평단가
          </button>
          <button
            onClick={() => setBasis('overall')}
            className={`px-2.5 py-1 rounded-sm transition-colors ${basis === 'overall' ? 'bg-emerald-500 text-white' : 'text-gray-500 hover:text-gray-700'}`}
          >
            전체 평단가
          </button>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-3">
        <div className="bg-white rounded-lg border border-gray-200 px-4 py-3">
          <p className="text-[11px] text-gray-500">누적 매수금액</p>
          <p className="text-sm font-semibold text-gray-800 mt-0.5 tabular-nums">{formatKRW(data.total_invested)}</p>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 px-4 py-3">
          <p className="text-[11px] text-gray-500">투자 손익 (실현+추정)</p>
          <p className="text-sm font-semibold mt-0.5 tabular-nums"><ProfitText value={investmentProfit} /></p>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 px-4 py-3">
          <p className="text-[11px] text-gray-500">누적 대출 이자비용</p>
          <p className="text-sm font-semibold text-amber-600 mt-0.5 tabular-nums">-{formatKRW(data.total_interest_cost)}</p>
        </div>
        <div className="bg-white rounded-lg border-2 border-emerald-300 px-4 py-3">
          <p className="text-[11px] text-gray-500">레버리지 순수익 (이자 차감)</p>
          <p className="text-sm font-bold mt-0.5 tabular-nums">
            <ProfitText value={netProfit} />
            <span className="text-[11px] text-gray-400 ml-1">
              ({netReturnPct > 0 ? '+' : ''}{netReturnPct.toFixed(1)}% / 대출원금)
            </span>
          </p>
        </div>
      </div>

      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="bg-gray-50 text-[11px] text-gray-500 border-b border-gray-100">
              <th className="text-left py-2 pl-3 pr-3 font-medium">종목</th>
              <th className="text-right py-2 pr-3 font-medium">보유수량</th>
              <th className="text-right py-2 pr-3 font-medium">실현손익</th>
              <th className="text-right py-2 pr-3 font-medium">추정손익(현재가)</th>
              <th className="text-right py-2 pr-3 font-medium">
                <span className="inline-flex items-center gap-1">가상 매도가 <ArrowRight size={10} /></span>
              </th>
              <th className="text-right py-2 pr-3 font-medium">예상 손익</th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((item) => (
              <ItemRow key={item.symbol} item={item} basis={basis} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
