import type { IntelDetailData } from "@/components/intel-detail-panel";
import { normalizeKeyPoints } from "@/lib/intelHighlights";
import { speakFriendly } from "@/lib/speechText";
import type { StudyCard, StudyLessonDetail } from "@/lib/studyApi";

export interface ListenSentence {
  id: string;
  text: string;
}

export interface ListenSection {
  id: string;
  label: string;
  sentences: ListenSentence[];
}

export interface ListenScript {
  title: string;
  sections: ListenSection[];
}

export type ListenScope = "summary" | "analysis" | "document";

function splitLongChunk(text: string, maxLen: number): string[] {
  if (text.length <= maxLen) return [text];
  const parts: string[] = [];
  let rest = text;
  while (rest.length > maxLen) {
    const slice = rest.slice(0, maxLen);
    const breakAt = Math.max(slice.lastIndexOf(", "), slice.lastIndexOf("，"), slice.lastIndexOf(" "));
    const cut = breakAt > 40 ? breakAt : maxLen;
    parts.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) parts.push(rest);
  return parts;
}

function splitSentences(text: string, maxLen = 4000): ListenSentence[] {
  const raw = speakFriendly(text || "");
  if (!raw.trim()) return [];

  const parts = raw
    .split(/(?<=[.!?。:;])\s+|\n{2,}/)
    .flatMap((p) => p.split(/\n+/))
    .flatMap((p) => splitLongChunk(p.trim(), 120))
    .map((s) => s.trim())
    .filter(Boolean);

  const out: ListenSentence[] = [];
  let buf = "";
  for (const part of parts) {
    if ((buf + " " + part).length > maxLen && buf) {
      out.push({ id: `s-${out.length}`, text: buf.trim() });
      buf = part;
    } else {
      buf = buf ? `${buf} ${part}` : part;
    }
  }
  if (buf.trim()) out.push({ id: `s-${out.length}`, text: buf.trim() });
  return out;
}

function markdownToPlain(md: string): string {
  return md
    .replace(/^#+\s+/gm, "")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]+\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/^>\s?/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*\d+\.\s+/gm, "")
    .replace(/```[\s\S]*?```/g, "")
    .replace(/\|/g, " ");
}

function section(id: string, label: string, text: string): ListenSection | null {
  const sentences = splitSentences(text);
  if (!sentences.length) return null;
  return { id, label, sentences };
}

export function flattenListenScript(script: ListenScript): Array<{
  flatIndex: number;
  sectionId: string;
  sectionLabel: string;
  sentence: ListenSentence;
}> {
  const items: Array<{
    flatIndex: number;
    sectionId: string;
    sectionLabel: string;
    sentence: ListenSentence;
  }> = [];
  let idx = 0;
  for (const sec of script.sections) {
    for (const sentence of sec.sentences) {
      items.push({
        flatIndex: idx,
        sectionId: sec.id,
        sectionLabel: sec.label,
        sentence,
      });
      idx += 1;
    }
  }
  return items;
}

export interface WordToken {
  text: string;
  start: number;
  end: number;
}

/** 듣기 하이라이트용 단어/어절 토큰 */
export function tokenizeWords(text: string): WordToken[] {
  const raw = text || "";
  if (typeof Intl !== "undefined" && "Segmenter" in Intl) {
    try {
      const seg = new Intl.Segmenter("ko", { granularity: "word" });
      const tokens: WordToken[] = [];
      for (const part of seg.segment(raw)) {
        if (part.isWordLike) {
          tokens.push({
            text: part.segment,
            start: part.index,
            end: part.index + part.segment.length,
          });
        }
      }
      if (tokens.length) return tokens;
    } catch {
      /* fallback below */
    }
  }
  const tokens: WordToken[] = [];
  const re = /\S+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) {
    tokens.push({ text: m[0], start: m.index, end: m.index + m[0].length });
  }
  return tokens;
}

export function wordIndexAtChar(tokens: WordToken[], charIndex: number): number {
  if (!tokens.length) return 0;
  for (let i = tokens.length - 1; i >= 0; i--) {
    if (charIndex >= tokens[i].start) return i;
  }
  return 0;
}

export function buildListenScriptFromIntel(
  data: IntelDetailData,
  scope: ListenScope = "analysis",
): ListenScript | null {
  const title = data.source_url ? "분석 콘텐츠" : "분석";
  const sections: ListenSection[] = [];

  const intro = section(
    "intro",
    "시작",
    "다음은 AI 분석 내용입니다. 투자 조언이 아니며 참고용입니다.",
  );
  if (intro) sections.push(intro);

  if (data.summary) {
    const s = section("summary", "요약", data.summary);
    if (s) sections.push(s);
  }

  if (scope !== "summary") {
    const keyPoints = normalizeKeyPoints(data.key_points);
    if (keyPoints.length) {
      sections.push({
        id: "key-points",
        label: "핵심 포인트",
        sentences: keyPoints.map((kp, i) => ({
          id: `kp-${i}`,
          text: speakFriendly(typeof kp === "string" ? kp : kp.text),
        })),
      });
    }

    if (data.macro_analysis?.summary) {
      const s = section("macro", "매크로", data.macro_analysis.summary);
      if (s) sections.push(s);
    }

    if (data.sector_analysis?.length) {
      const text = data.sector_analysis
        .map((s) => `${s.sector}. ${s.summary}${s.outlook ? ` 전망: ${s.outlook}` : ""}`)
        .join("\n");
      const sec = section("sectors", "섹터", text);
      if (sec) sections.push(sec);
    }
  }

  if (scope === "document" && data.source_document) {
    const doc = section("document", "추출 문서", data.source_document.slice(0, 12000));
    if (doc) sections.push(doc);
  }

  if (sections.length <= 1 && !data.summary) return null;
  return { title, sections };
}

export function buildListenScriptFromStudyCard(card: StudyCard): ListenScript | null {
  const sections: ListenSection[] = [];
  const intro = section("intro", "시작", `${card.title}. 학습 카드입니다.`);
  if (intro) sections.push(intro);

  const summary = card.simple_analysis?.summary || card.summary;
  if (summary) {
    const s = section("summary", "요약", summary);
    if (s) sections.push(s);
  }

  const points = card.simple_analysis?.key_points?.length
    ? card.simple_analysis.key_points
    : card.key_points;
  if (points?.length) {
    sections.push({
      id: "key-points",
      label: "핵심",
      sentences: points.map((p, i) => ({ id: `kp-${i}`, text: speakFriendly(p) })),
    });
  }

  if (card.body_markdown) {
    const plain = markdownToPlain(card.body_markdown);
    const s = section("body", "본문", plain.slice(0, 8000));
    if (s) sections.push(s);
  }

  if (sections.length === 0) return null;
  return { title: card.title, sections };
}

export function buildListenScriptFromStudyLesson(lesson: StudyLessonDetail): ListenScript | null {
  const sections: ListenSection[] = [];
  const introText = [
    lesson.title,
    lesson.subtitle,
    `레슨 ${lesson.order + 1}입니다.`,
    "투자 조언이 아니며 학습 참고용입니다.",
  ]
    .filter(Boolean)
    .join(". ");

  const intro = section("intro", "시작", introText);
  if (intro) sections.push(intro);

  if (lesson.body_markdown?.trim()) {
    const plain = markdownToPlain(lesson.body_markdown);
    const body = section("body", "본문", plain.slice(0, 12000));
    if (body) sections.push(body);
  }

  if (sections.length === 0) return null;
  return { title: lesson.title, sections };
}
