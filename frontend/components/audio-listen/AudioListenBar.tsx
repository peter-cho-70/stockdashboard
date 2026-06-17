"use client";

import { Headphones, Pause, Play, Square, SkipBack, SkipForward } from "lucide-react";
import type { SpeechListenStatus } from "@/lib/useSpeechListen";

const RATES = [0.8, 0.9, 1, 1.2, 1.5];

const transportBtn =
  "inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md text-neutral-600 hover:bg-neutral-100 disabled:opacity-40 dark:hover:bg-neutral-800 sm:min-h-0 sm:min-w-0 sm:p-1.5";

function voiceLabel(v: SpeechSynthesisVoice): string {
  const tag = v.localService ? "로컬" : "온라인";
  return `${v.name} (${tag})`;
}

export function AudioListenBar({
  title,
  sectionLabel,
  status,
  currentIndex,
  total,
  rate,
  pitch,
  voices,
  voiceURI,
  onRateChange,
  onPitchChange,
  onVoiceChange,
  onToggle,
  onStop,
  onSkip,
}: {
  title: string;
  sectionLabel: string | null;
  status: SpeechListenStatus;
  currentIndex: number;
  total: number;
  rate: number;
  pitch: number;
  voices: SpeechSynthesisVoice[];
  voiceURI: string | null;
  onRateChange: (r: number) => void;
  onPitchChange: (p: number) => void;
  onVoiceChange: (uri: string | null) => void;
  onToggle: () => void;
  onStop: () => void;
  onSkip: (delta: number) => void;
}) {
  if (total === 0) return null;

  const progress = total > 0 ? ((currentIndex + 1) / total) * 100 : 0;
  const needsManualStart = status === "idle";

  return (
    <div
      data-listen-controls
      className="sticky top-[calc(var(--header-height)+0.5rem)] z-20 rounded-xl border border-emerald-300/80 bg-[var(--surface)]/98 backdrop-blur shadow-lg dark:border-emerald-800 p-3 space-y-2 sm:top-2"
    >
      {needsManualStart && (
        <div className="flex flex-col gap-2 rounded-lg border border-emerald-400/60 bg-emerald-50 px-3 py-2 sm:flex-row sm:items-center dark:border-emerald-700 dark:bg-emerald-950/40">
          <button
            type="button"
            onClick={onToggle}
            className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-full bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-emerald-700"
          >
            <Play size={16} className="ml-0.5" />
            재생 시작
          </button>
          <p className="text-[11px] text-emerald-800 dark:text-emerald-200">
            자동 재생이 안 되면 위 버튼을 눌러 주세요.
          </p>
        </div>
      )}

      <div className="flex items-start gap-2 min-w-0">
        <Headphones size={16} className="shrink-0 text-emerald-600 mt-0.5" />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium truncate">{title}</p>
          <p className="text-[10px] text-neutral-500 truncate">
            {sectionLabel ?? "—"} · {currentIndex + 1} / {total} 문장
          </p>
        </div>
      </div>
      <div className="h-1 rounded-full bg-neutral-200 dark:bg-neutral-800 overflow-hidden">
        <div
          className="h-full bg-emerald-500 transition-all duration-300"
          style={{ width: `${progress}%` }}
        />
      </div>
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <div className="flex items-center justify-center gap-1 sm:justify-start">
          <button
            type="button"
            onClick={() => onSkip(-1)}
            disabled={currentIndex <= 0 && status !== "playing"}
            className={transportBtn}
            title="이전 문장"
            aria-label="이전 문장"
          >
            <SkipBack size={18} />
          </button>
          <button
            type="button"
            onClick={onToggle}
            className="inline-flex min-h-[48px] min-w-[48px] items-center justify-center rounded-full bg-emerald-600 text-white hover:bg-emerald-700"
            title={status === "playing" ? "일시정지" : "재생"}
            aria-label={status === "playing" ? "일시정지" : "재생"}
          >
            {status === "playing" ? <Pause size={20} /> : <Play size={20} className="ml-0.5" />}
          </button>
          <button
            type="button"
            onClick={() => onSkip(1)}
            disabled={currentIndex >= total - 1}
            className={transportBtn}
            title="다음 문장"
            aria-label="다음 문장"
          >
            <SkipForward size={18} />
          </button>
          <button
            type="button"
            onClick={onStop}
            className={transportBtn}
            title="정지"
            aria-label="정지"
          >
            <Square size={16} />
          </button>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-1 sm:justify-end">
          <span className="text-[10px] text-neutral-400 mr-1">속도</span>
          {RATES.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => onRateChange(r)}
              className={`inline-flex min-h-[36px] min-w-[36px] items-center justify-center rounded px-2 py-1 text-xs font-medium sm:min-h-0 sm:min-w-0 sm:px-1.5 sm:py-0.5 sm:text-[10px] ${
                rate === r
                  ? "bg-emerald-600 text-white"
                  : "text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
              }`}
            >
              {r}×
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <label className="flex flex-1 min-w-0 items-center gap-2 text-[10px] text-neutral-500">
          <span className="shrink-0">음성</span>
          <select
            value={voiceURI ?? ""}
            onChange={(e) => onVoiceChange(e.target.value || null)}
            className="min-w-0 flex-1 rounded border border-[var(--border-subtle)] bg-transparent px-2 py-1 text-[10px] text-neutral-700 dark:text-neutral-300"
          >
            <option value="">자동 (추천)</option>
            {voices.map((v) => (
              <option key={v.voiceURI} value={v.voiceURI}>
                {voiceLabel(v)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-[10px] text-neutral-500 shrink-0">
          <span>톤</span>
          <select
            value={pitch}
            onChange={(e) => onPitchChange(parseFloat(e.target.value))}
            className="rounded border border-[var(--border-subtle)] bg-transparent px-2 py-1 text-[10px]"
          >
            <option value={0.9}>낮음</option>
            <option value={0.95}>보통</option>
            <option value={1}>기본</option>
          </select>
        </label>
      </div>

      <p className="text-[9px] text-neutral-400 text-center sm:text-left leading-relaxed">
        브라우저 무료 음성 · Mac「유나」· Windows「Heami」 설치 시 더 자연스럽습니다 · Chrome/Safari 권장
      </p>
    </div>
  );
}
