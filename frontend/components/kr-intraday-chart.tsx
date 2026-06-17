"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { KrMarketChartPoint } from "@/lib/api";

export function KrIntradayChart({
  title,
  points,
}: {
  title: string;
  points: KrMarketChartPoint[];
}) {
  if (!points.length) return null;

  const prices = points.map((p) => p.price);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const pad = (max - min) * 0.08 || max * 0.01;

  const tickFormatter = (v: string) => (v.endsWith("00") || v.endsWith("30") ? v : "");

  return (
    <div className="rounded-md border border-[var(--border-subtle)] p-3">
      <p className="text-[11px] font-medium text-neutral-500 mb-2">{title} 장중 추이</p>
      <div className="h-[160px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={points} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="kospiFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#ef4444" stopOpacity={0.25} />
                <stop offset="100%" stopColor="#ef4444" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" vertical={false} />
            <XAxis
              dataKey="time"
              tick={{ fontSize: 9, fill: "#a3a3a3" }}
              tickFormatter={tickFormatter}
              interval="preserveStartEnd"
              minTickGap={28}
            />
            <YAxis
              domain={[min - pad, max + pad]}
              tick={{ fontSize: 9, fill: "#a3a3a3" }}
              width={48}
              tickFormatter={(v) => Number(v).toLocaleString("ko-KR")}
            />
            <Tooltip
              contentStyle={{
                fontSize: 11,
                borderRadius: 8,
                border: "1px solid var(--border-subtle)",
              }}
              formatter={(value) => [Number(value ?? 0).toLocaleString("ko-KR"), "지수"]}
              labelFormatter={(label) => `${label}`}
            />
            <Area
              type="monotone"
              dataKey="price"
              stroke="#ef4444"
              strokeWidth={1.5}
              fill="url(#kospiFill)"
              dot={false}
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
