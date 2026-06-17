import { Fragment, type ReactNode } from "react";
import { StudyTermLink } from "@/components/study-term-link";
import { STUDY_TERMS_BY_LENGTH } from "@/lib/studyTermGlossary";

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** 분석 텍스트 속 약어·용어를 클릭 가능한 링크(주식공부하기)로 변환 */
export function renderStudyTerms(text: string, keyPrefix = "term"): ReactNode {
  if (!text) return text;

  const pattern = STUDY_TERMS_BY_LENGTH.map((e) => escapeRegex(e.match)).join("|");
  if (!pattern) return text;

  const re = new RegExp(`(${pattern})`, "gi");
  const parts = text.split(re);

  return parts.map((part, i) => {
    if (!part) return null;
    const entry = STUDY_TERMS_BY_LENGTH.find(
      (e) => e.match.toLowerCase() === part.toLowerCase(),
    );
    if (entry) {
      return (
        <StudyTermLink key={`${keyPrefix}-${i}-${entry.match}`} entry={entry} matchedText={part} />
      );
    }
    return <Fragment key={`${keyPrefix}-${i}`}>{part}</Fragment>;
  });
}
