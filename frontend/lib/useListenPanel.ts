"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  buildListenScriptFromIntel,
  buildListenScriptFromStudyCard,
  buildListenScriptFromStudyLesson,
  type ListenScope,
  type ListenScript,
} from "@/lib/listenScript";
import { useSpeechListen } from "@/lib/useSpeechListen";
import type { IntelDetailData } from "@/components/intel-detail-panel";
import type { StudyCard, StudyLessonDetail } from "@/lib/studyApi";

export type ListenSource =
  | { kind: "intel"; data: IntelDetailData }
  | { kind: "study"; card: StudyCard }
  | { kind: "lesson"; lesson: StudyLessonDetail };

function sourceKey(source: ListenSource | null): string | null {
  if (!source) return null;
  if (source.kind === "intel") return `intel:${source.data.id ?? source.data.source_url ?? "draft"}`;
  if (source.kind === "lesson") return `lesson:${source.lesson.id}`;
  return `study:${source.card.id}`;
}

export function useListenPanel(source: ListenSource | null) {
  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState<ListenScope>("analysis");
  const key = sourceKey(source);
  const prevScopeRef = useRef(scope);
  const stopRef = useRef<() => void>(() => {});

  const script: ListenScript | null = useMemo(() => {
    if (!source) return null;
    if (source.kind === "intel") return buildListenScriptFromIntel(source.data, scope);
    if (source.kind === "lesson") return buildListenScriptFromStudyLesson(source.lesson);
    return buildListenScriptFromStudyCard(source.card);
  }, [source, scope]);

  const listen = useSpeechListen(script);
  const canListen = !!script && listen.supported;

  stopRef.current = listen.stop;

  useEffect(() => {
    setOpen(false);
    stopRef.current();
  }, [key]);

  useEffect(() => {
    if (!open || !script) {
      prevScopeRef.current = scope;
      return;
    }
    if (prevScopeRef.current !== scope) {
      prevScopeRef.current = scope;
      listen.play();
    }
  }, [scope, open, script, listen.play]);

  const start = useCallback(() => {
    if (!script || !listen.supported) return;
    listen.play();
    setOpen(true);
  }, [script, listen.supported, listen.play]);

  const close = useCallback(() => {
    listen.stop();
    setOpen(false);
  }, [listen.stop]);

  const changeScope = useCallback(
    (next: ListenScope) => {
      listen.stop();
      setScope(next);
    },
    [listen.stop],
  );

  return {
    open,
    scope,
    script,
    listen,
    canListen,
    start,
    close,
    changeScope,
  };
}
