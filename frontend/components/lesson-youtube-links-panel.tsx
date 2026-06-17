"use client";

import { useCallback, useEffect, useState } from "react";
import { ExternalLink, Link2, Loader2, Trash2, Video } from "lucide-react";
import { studyApi, type StudyLessonLink, type YoutubePreview } from "@/lib/studyApi";

interface LessonYoutubeLinksPanelProps {
  lessonId: string;
}

export function LessonYoutubeLinksPanel({ lessonId }: LessonYoutubeLinksPanelProps) {
  const [links, setLinks] = useState<StudyLessonLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [urlInput, setUrlInput] = useState("");
  const [preview, setPreview] = useState<YoutubePreview | null>(null);
  const [fetching, setFetching] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadLinks = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await studyApi.listLessonLinks(lessonId);
      setLinks(res.items);
    } catch (e) {
      setError(e instanceof Error ? e.message : "링크 불러오기 실패");
    } finally {
      setLoading(false);
    }
  }, [lessonId]);

  useEffect(() => {
    loadLinks();
  }, [loadLinks]);

  const fetchTitle = async () => {
    const raw = urlInput.trim();
    if (!raw) {
      setError("YouTube URL을 입력하세요.");
      return;
    }
    setFetching(true);
    setError(null);
    setPreview(null);
    try {
      const meta = await studyApi.previewYoutube(raw);
      setPreview(meta);
      setUrlInput(meta.url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "제목 가져오기 실패");
    } finally {
      setFetching(false);
    }
  };

  const saveLink = async () => {
    const raw = (preview?.url || urlInput).trim();
    if (!raw) {
      setError("YouTube URL을 입력하세요.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const item = await studyApi.addLessonLink(lessonId, raw);
      setLinks((prev) => {
        const without = prev.filter((l) => l.video_id !== item.video_id);
        return [...without, item].sort((a, b) => a.sort_order - b.sort_order);
      });
      setUrlInput("");
      setPreview(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "저장 실패");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (linkId: number) => {
    if (!confirm("이 유튜브 링크를 삭제할까요?")) return;
    try {
      await studyApi.deleteLessonLink(lessonId, linkId);
      setLinks((prev) => prev.filter((l) => l.id !== linkId));
    } catch (e) {
      setError(e instanceof Error ? e.message : "삭제 실패");
    }
  };

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-sm font-semibold text-neutral-800 dark:text-neutral-200 flex items-center gap-1.5">
          <Video size={15} className="text-red-500" />
          참고 유튜브
        </h2>
        <p className="text-[11px] text-neutral-500 mt-0.5">
          레슨과 관련된 영상 링크를 붙여 넣으면 제목을 자동으로 가져옵니다.
        </p>
      </div>

      <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-elevated)] p-4 space-y-3">
        <div className="flex flex-col sm:flex-row gap-2">
          <div className="relative flex-1">
            <Link2 size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
            <input
              type="url"
              value={urlInput}
              onChange={(e) => {
                setUrlInput(e.target.value);
                setPreview(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  fetchTitle();
                }
              }}
              placeholder="https://www.youtube.com/watch?v=..."
              className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--surface)] pl-9 pr-3 py-2 text-sm outline-none focus:border-red-300 dark:focus:border-red-700"
            />
          </div>
          <button
            type="button"
            onClick={fetchTitle}
            disabled={fetching || !urlInput.trim()}
            className="shrink-0 rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-700 hover:bg-neutral-50 disabled:opacity-50 dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-200 dark:hover:bg-neutral-700"
          >
            {fetching ? (
              <span className="inline-flex items-center gap-1.5">
                <Loader2 size={14} className="animate-spin" />
                가져오는 중…
              </span>
            ) : (
              "제목 가져오기"
            )}
          </button>
        </div>

        {preview && (
          <div className="flex gap-3 rounded-lg border border-red-200 bg-red-50/50 p-3 dark:border-red-900 dark:bg-red-950/20">
            {preview.thumbnail && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={preview.thumbnail}
                alt=""
                className="h-16 w-28 shrink-0 rounded object-cover bg-neutral-200"
              />
            )}
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium line-clamp-2">{preview.title}</p>
              {preview.channel_name && (
                <p className="text-[11px] text-neutral-500 mt-0.5">{preview.channel_name}</p>
              )}
              <a
                href={preview.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 mt-1 text-[11px] text-red-600 hover:underline dark:text-red-400"
              >
                <ExternalLink size={11} />
                미리보기
              </a>
            </div>
          </div>
        )}

        <button
          type="button"
          onClick={saveLink}
          disabled={saving || (!preview && !urlInput.trim())}
          className="w-full sm:w-auto rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
        >
          {saving ? (
            <span className="inline-flex items-center gap-1.5">
              <Loader2 size={14} className="animate-spin" />
              저장 중…
            </span>
          ) : (
            "레슨에 추가"
          )}
        </button>
      </div>

      {error && (
        <p className="text-xs text-red-600 bg-red-50 dark:bg-red-900/20 rounded-md px-2 py-1.5">{error}</p>
      )}

      {loading ? (
        <p className="text-xs text-neutral-400">링크 불러오는 중…</p>
      ) : links.length > 0 ? (
        <div className="space-y-2">
          {links.map((link) => (
            <div
              key={link.id}
              className="group flex gap-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface)] p-3"
            >
              {link.thumbnail ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={link.thumbnail}
                  alt=""
                  className="h-14 w-24 shrink-0 rounded object-cover bg-neutral-100 dark:bg-neutral-900"
                />
              ) : (
                <div className="flex h-14 w-24 shrink-0 items-center justify-center rounded bg-neutral-100 dark:bg-neutral-900">
                  <Video size={20} className="text-red-500" />
                </div>
              )}
              <div className="min-w-0 flex-1">
                <a
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm font-medium line-clamp-2 hover:text-red-600 dark:hover:text-red-400"
                >
                  {link.title}
                </a>
                {link.channel_name && (
                  <p className="text-[11px] text-neutral-500 mt-0.5">{link.channel_name}</p>
                )}
              </div>
              <button
                type="button"
                onClick={() => handleDelete(link.id)}
                className="shrink-0 self-start rounded-md p-1.5 text-neutral-400 opacity-0 group-hover:opacity-100 hover:bg-red-50 hover:text-red-600 transition-opacity dark:hover:bg-red-900/20"
                title="삭제"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs text-neutral-400">등록된 참고 유튜브가 없습니다.</p>
      )}
    </section>
  );
}
