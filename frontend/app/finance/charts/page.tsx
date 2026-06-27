'use client';

import { MonthlyCashflowAnalysis } from '@/components/finance/cashflow/monthly-cashflow-analysis';

export default function ChartsPage() {
  return (
    <div className="max-w-[1400px] mx-auto">
      <MonthlyCashflowAnalysis />
    </div>
  );
}
