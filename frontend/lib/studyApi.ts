const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000/api";

async function fetchApi<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) {
    const err = await res.text();
    let message = err || `HTTP ${res.status}`;
    try {
      const parsed = JSON.parse(err) as { detail?: unknown };
      if (typeof parsed.detail === "string") message = parsed.detail;
    } catch {
      /* keep raw */
    }
    throw new Error(message);
  }
  return res.json();
}

export interface StudyLessonSummary {
  id: string;
  order: number;
  title: string;
  subtitle: string;
  chart_link: string | null;
  topic_keywords: string[];
}

export interface StudyCurriculum {
  title: string;
  source: string;
  intro_markdown: string;
  disclaimer: string;
  lessons: StudyLessonSummary[];
}

export interface StudyLessonDetail extends StudyLessonSummary {
  section_title?: string;
  body_markdown: string;
}

export interface StudyQuizItem {
  question: string;
  answer: string;
  explanation?: string;
}

export interface StudyCard {
  id: number;
  content_id: number | null;
  lesson_id: string | null;
  title: string;
  summary: string | null;
  body_markdown: string | null;
  key_points: string[];
  study_topics: string[];
  quiz: StudyQuizItem[];
  source_title: string | null;
  source_url: string | null;
  source_type: string | null;
  created_at: string | null;
}

export interface RelatedContentItem {
  id: number;
  source_type: string;
  source_title: string | null;
  source_url: string | null;
  channel_name: string | null;
  summary: string;
  analyzed_at: string | null;
}

export interface StudyLessonImage {
  id: number;
  lesson_id: string;
  url: string;
  original_name: string | null;
  mime_type: string;
  caption: string | null;
  sort_order: number;
  created_at: string | null;
}

async function fetchFormApi<T>(path: string, form: FormData): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { method: "POST", body: form });
  if (!res.ok) {
    const err = await res.text();
    let message = err || `HTTP ${res.status}`;
    try {
      const parsed = JSON.parse(err) as { detail?: unknown };
      if (typeof parsed.detail === "string") message = parsed.detail;
    } catch {
      /* keep raw */
    }
    throw new Error(message);
  }
  return res.json();
}

export const studyApi = {
  getCurriculum: () => fetchApi<StudyCurriculum>("/study/curriculum"),

  getLesson: (lessonId: string) => fetchApi<StudyLessonDetail>(`/study/lessons/${lessonId}`),

  getRelatedContent: (lessonId: string) =>
    fetchApi<{ lesson_id: string; items: RelatedContentItem[] }>(
      `/study/lessons/${lessonId}/related-content`,
    ),

  listCards: (lessonId?: string) => {
    const q = lessonId ? `?lesson_id=${encodeURIComponent(lessonId)}` : "";
    return fetchApi<{ items: StudyCard[] }>(`/study/cards${q}`);
  },

  getCard: (cardId: number) => fetchApi<StudyCard>(`/study/cards/${cardId}`),

  createCardFromContent: (contentId: number, opts?: { lesson_id?: string; force?: boolean }) =>
    fetchApi<StudyCard>(`/study/cards/from-content/${contentId}`, {
      method: "POST",
      body: JSON.stringify(opts ?? {}),
    }),

  deleteCard: (cardId: number) =>
    fetchApi<{ ok: boolean }>(`/study/cards/${cardId}`, { method: "DELETE" }),

  listLessonImages: (lessonId: string) =>
    fetchApi<{ lesson_id: string; items: StudyLessonImage[] }>(
      `/study/lessons/${encodeURIComponent(lessonId)}/images`,
    ),

  uploadLessonImage: (lessonId: string, file: File, caption?: string) => {
    const form = new FormData();
    form.append("file", file);
    if (caption) form.append("caption", caption);
    return fetchFormApi<StudyLessonImage>(
      `/study/lessons/${encodeURIComponent(lessonId)}/images`,
      form,
    );
  },

  deleteLessonImage: (lessonId: string, imageId: number) =>
    fetchApi<{ ok: boolean }>(
      `/study/lessons/${encodeURIComponent(lessonId)}/images/${imageId}`,
      { method: "DELETE" },
    ),
};
