"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, ImagePlus, Loader2, Trash2, X } from "lucide-react";
import { studyApi, type StudyLessonImage } from "@/lib/studyApi";

function imageSrc(url: string): string {
  if (url.startsWith("http")) return url;
  const origin =
    typeof window !== "undefined"
      ? window.location.origin
      : (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000/api").replace(
          /\/api\/?$/,
          "",
        ) || "http://localhost:8000";
  return `${origin}${url}`;
}

interface LessonImagePastePanelProps {
  lessonId: string;
}

export function LessonImagePastePanel({ lessonId }: LessonImagePastePanelProps) {
  const [images, setImages] = useState<StudyLessonImage[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [focused, setFocused] = useState(false);
  const [previewId, setPreviewId] = useState<number | null>(null);
  const zoneRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const previewIndex = previewId == null ? -1 : images.findIndex((img) => img.id === previewId);
  const previewImage = previewIndex >= 0 ? images[previewIndex] : null;

  useEffect(() => {
    if (previewId == null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPreviewId(null);
      if (e.key === "ArrowLeft" && previewIndex > 0) {
        setPreviewId(images[previewIndex - 1].id);
      }
      if (e.key === "ArrowRight" && previewIndex >= 0 && previewIndex < images.length - 1) {
        setPreviewId(images[previewIndex + 1].id);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [previewId, previewIndex, images]);

  const loadImages = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await studyApi.listLessonImages(lessonId);
      setImages(res.items);
    } catch (e) {
      setError(e instanceof Error ? e.message : "이미지 불러오기 실패");
    } finally {
      setLoading(false);
    }
  }, [lessonId]);

  useEffect(() => {
    loadImages();
  }, [loadImages]);

  const uploadFile = useCallback(
    async (file: File) => {
      if (!file.type.startsWith("image/")) {
        setError("이미지 파일만 붙여넣을 수 있습니다.");
        return;
      }
      setUploading(true);
      setError(null);
      try {
        const item = await studyApi.uploadLessonImage(lessonId, file);
        setImages((prev) => [...prev, item]);
      } catch (e) {
        setError(e instanceof Error ? e.message : "업로드 실패");
      } finally {
        setUploading(false);
      }
    },
    [lessonId],
  );

  const handlePaste = useCallback(
    (e: React.ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of items) {
        if (item.type.startsWith("image/")) {
          e.preventDefault();
          const file = item.getAsFile();
          if (file) uploadFile(file);
          return;
        }
      }
    },
    [uploadFile],
  );

  const handleDelete = async (imageId: number) => {
    if (!confirm("이 참고 이미지를 삭제할까요?")) return;
    try {
      await studyApi.deleteLessonImage(lessonId, imageId);
      setImages((prev) => prev.filter((img) => img.id !== imageId));
      if (previewId === imageId) setPreviewId(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "삭제 실패");
    }
  };

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-sm font-semibold text-neutral-800 dark:text-neutral-200 flex items-center gap-1.5">
          <ImagePlus size={15} className="text-emerald-500" />
          참고 이미지
        </h2>
        <p className="text-[11px] text-neutral-500 mt-0.5">
          캔들·패턴 예시 스크린샷을 붙여넣어 두세요 (Ctrl+V / ⌘+V)
        </p>
      </div>

      <div
        ref={zoneRef}
        tabIndex={0}
        role="button"
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onPaste={handlePaste}
        onClick={() => zoneRef.current?.focus()}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") fileInputRef.current?.click();
        }}
        className={`rounded-xl border-2 border-dashed px-4 py-6 text-center transition-colors outline-none cursor-pointer ${
          focused
            ? "border-emerald-400 bg-emerald-50/50 dark:border-emerald-600 dark:bg-emerald-950/20"
            : "border-[var(--border-subtle)] bg-[var(--surface-elevated)] hover:border-emerald-300 dark:hover:border-emerald-800"
        }`}
      >
        {uploading ? (
          <div className="flex items-center justify-center gap-2 text-sm text-neutral-500">
            <Loader2 size={16} className="animate-spin" />
            업로드 중…
          </div>
        ) : (
          <>
            <p className="text-sm text-neutral-600 dark:text-neutral-400">
              여기를 클릭한 뒤 <strong>붙여넣기</strong>
            </p>
            <p className="text-[11px] text-neutral-400 mt-1">또는</p>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                fileInputRef.current?.click();
              }}
              className="mt-2 text-xs rounded-md border border-emerald-300 bg-emerald-50 text-emerald-800 px-3 py-1.5 dark:border-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-200"
            >
              파일 선택
            </button>
          </>
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) uploadFile(file);
            e.target.value = "";
          }}
        />
      </div>

      {error && (
        <p className="text-xs text-red-600 bg-red-50 dark:bg-red-900/20 rounded-md px-2 py-1.5">{error}</p>
      )}

      {loading ? (
        <p className="text-xs text-neutral-400">이미지 불러오는 중…</p>
      ) : images.length > 0 ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {images.map((img) => (
            <div
              key={img.id}
              className="group relative rounded-lg border border-[var(--border-subtle)] overflow-hidden bg-[var(--surface)]"
            >
              <button
                type="button"
                onClick={() => setPreviewId(img.id)}
                className="block w-full text-left cursor-zoom-in"
                title="원본 보기"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={imageSrc(img.url)}
                  alt={img.caption || img.original_name || "참고 이미지"}
                  className="w-full h-32 object-contain bg-neutral-100 dark:bg-neutral-900"
                />
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  handleDelete(img.id);
                }}
                className="absolute top-1.5 right-1.5 rounded-md bg-black/50 p-1 text-white opacity-0 group-hover:opacity-100 transition-opacity"
                title="삭제"
              >
                <Trash2 size={12} />
              </button>
              {img.caption && (
                <p className="text-[10px] text-neutral-500 px-2 py-1 truncate">{img.caption}</p>
              )}
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs text-neutral-400">등록된 참고 이미지가 없습니다.</p>
      )}

      {previewImage && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="참고 이미지 원본"
          onClick={() => setPreviewId(null)}
        >
          <button
            type="button"
            onClick={() => setPreviewId(null)}
            className="absolute top-4 right-4 rounded-full bg-black/60 p-2 text-white hover:bg-black/80"
            title="닫기"
          >
            <X size={20} />
          </button>

          {previewIndex > 0 && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setPreviewId(images[previewIndex - 1].id);
              }}
              className="absolute left-3 sm:left-6 top-1/2 -translate-y-1/2 rounded-full bg-black/60 p-2 text-white hover:bg-black/80"
              title="이전"
            >
              <ChevronLeft size={24} />
            </button>
          )}

          {previewIndex >= 0 && previewIndex < images.length - 1 && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setPreviewId(images[previewIndex + 1].id);
              }}
              className="absolute right-3 sm:right-6 top-1/2 -translate-y-1/2 rounded-full bg-black/60 p-2 text-white hover:bg-black/80"
              title="다음"
            >
              <ChevronRight size={24} />
            </button>
          )}

          <div
            className="flex max-h-[90vh] max-w-[min(96vw,1200px)] flex-col items-center"
            onClick={(e) => e.stopPropagation()}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={imageSrc(previewImage.url)}
              alt={previewImage.caption || previewImage.original_name || "참고 이미지"}
              className="max-h-[calc(90vh-3rem)] max-w-full object-contain rounded-lg"
            />
            {(previewImage.caption || previewImage.original_name) && (
              <p className="mt-3 max-w-full truncate text-center text-sm text-neutral-200">
                {previewImage.caption || previewImage.original_name}
              </p>
            )}
            <p className="mt-1 text-xs text-neutral-400">
              {previewIndex + 1} / {images.length} · Esc로 닫기
            </p>
          </div>
        </div>
      )}
    </section>
  );
}
