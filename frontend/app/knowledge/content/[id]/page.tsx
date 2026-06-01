"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { knowledgeApi, type KnowledgeContent } from "@/lib/knowledgeApi";
import { IntelDetailPanel } from "@/components/intel-detail-panel";

export default function KnowledgeContentPage() {
  const params = useParams();
  const id = typeof params.id === "string" ? parseInt(params.id, 10) : 0;
  const [content, setContent] = useState<KnowledgeContent | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    knowledgeApi
      .getContentDetail(id)
      .then(setContent)
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) {
    return <div className="py-20 text-center text-sm text-neutral-400">불러오는 중...</div>;
  }

  if (!content) {
    return <div className="py-20 text-center text-sm text-neutral-400">콘텐츠를 찾을 수 없습니다.</div>;
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4 py-2">
      <Link href="/knowledge" className="text-sm text-neutral-400 hover:text-neutral-600">
        ← 지식 허브
      </Link>
      <h1 className="text-lg font-bold">{content.source_title || "지식 콘텐츠"}</h1>
      <IntelDetailPanel
        data={{
          ...content,
          source_type: content.source_type,
          source_url: content.source_url,
          key_points: content.key_points || [],
          content_scope: "knowledge",
        }}
      />
      {content.source_url && (
        <a
          href={content.source_url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm text-blue-500 hover:underline"
        >
          원문 열기 →
        </a>
      )}
    </div>
  );
}
