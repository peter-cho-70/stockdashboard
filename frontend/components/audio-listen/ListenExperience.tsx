"use client";

import { Headphones, X } from "lucide-react";
import type { ListenScope, ListenScript } from "@/lib/listenScript";
import type { useSpeechListen } from "@/lib/useSpeechListen";
import { AudioListenBar } from "@/components/audio-listen/AudioListenBar";
import { SyncedListenView } from "@/components/audio-listen/SyncedListenView";

type ListenController = ReturnType<typeof useSpeechListen>;

export function ListenExperience({
  title,
  script,
  listen,
  hasDocument = false,
  scope,
  onScopeChange,
  onClose,
}: {
  title: string;
  script: ListenScript;
  listen: ListenController;
  hasDocument?: boolean;
  scope?: ListenScope;
  onScopeChange?: (scope: ListenScope) => void;
  onClose: () => void;
}) {
  return (
    <div className="space-y-3">
      <div
        data-listen-controls
        className="space-y-3 rounded-xl border border-emerald-200/60 bg-[var(--surface)] p-3 dark:border-emerald-900/40"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Headphones size={14} className="text-emerald-600" />
          <span className="text-xs font-semibold text-emerald-800 dark:text-emerald-300">듣기 모드</span>
        </div>
        <div className="flex items-center gap-2">
          {onScopeChange && scope && (
            <select
              value={scope}
              onChange={(e) => onScopeChange(e.target.value as ListenScope)}
              className="text-[10px] rounded border border-[var(--border-subtle)] bg-transparent px-2 py-1"
            >
              <option value="summary">요약만</option>
              <option value="analysis">요약+핵심+매크로</option>
              {hasDocument && <option value="document">전체(문서 포함)</option>}
            </select>
          )}
          <button
            type="button"
            onClick={onClose}
            className="flex items-center gap-1 rounded-md border border-[var(--border-subtle)] px-2 py-1 text-[10px] text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
          >
            <X size={12} /> 닫기
          </button>
        </div>
      </div>

      <AudioListenBar
        title={title}
        sectionLabel={listen.current?.sectionLabel ?? null}
        status={listen.status}
        currentIndex={listen.currentIndex}
        total={listen.total}
        rate={listen.rate}
        pitch={listen.pitch}
        voices={listen.voices}
        voiceURI={listen.voiceURI}
        onRateChange={(r) => {
          listen.setRate(r);
          if (listen.status === "playing") {
            listen.pause();
            window.setTimeout(() => listen.play(), 80);
          }
        }}
        onPitchChange={(p) => {
          listen.setPitch(p);
          if (listen.status === "playing") {
            listen.pause();
            window.setTimeout(() => listen.play(), 80);
          }
        }}
        onVoiceChange={(uri) => {
          listen.setVoiceURI(uri);
          if (listen.status === "playing") {
            listen.pause();
            window.setTimeout(() => listen.play(), 80);
          }
        }}
        onToggle={listen.toggle}
        onStop={() => {
          listen.stop();
          listen.seekSentence(0);
        }}
        onSkip={listen.skip}
      />
      </div>

      <SyncedListenView
        script={script}
        currentFlatIndex={listen.currentIndex}
        currentWordIndex={listen.currentWordIndex}
      />
    </div>
  );
}
