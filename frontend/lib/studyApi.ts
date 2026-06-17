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
  category_id: number | null;
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
  thumbnail: string | null;
  origin: string;
  sort_order: number;
  user_note: string | null;
  analysis_status: string;
  simple_analysis: SimpleAnalysis | null;
  created_at: string | null;
}

export interface SimpleAnalysis {
  summary: string;
  key_points: string[];
  analyzed_at?: string;
  source_type?: string;
}

export interface StudyCategory {
  id: number;
  name: string;
  description: string | null;
  sort_order: number;
  is_default: boolean;
  created_at: string | null;
}

export interface LinkPreview {
  source_type: string;
  url: string;
  title: string;
  channel_name: string;
  thumbnail: string;
  video_id?: string | null;
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

export interface YoutubePreview {
  video_id: string;
  url: string;
  title: string;
  channel_name: string;
  thumbnail: string;
  published_at?: string;
}

export interface StudyLessonLink {
  id: number;
  lesson_id: string;
  video_id: string;
  url: string;
  title: string;
  channel_name: string | null;
  thumbnail: string | null;
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

  listCards: (opts?: { lessonId?: string; categoryId?: number }) => {
    const params = new URLSearchParams();
    if (opts?.lessonId) params.set("lesson_id", opts.lessonId);
    if (opts?.categoryId != null) params.set("category_id", String(opts.categoryId));
    const q = params.toString() ? `?${params.toString()}` : "";
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

  listCategories: () => fetchApi<{ items: StudyCategory[] }>("/study/categories"),

  createCategory: (name: string, description?: string) =>
    fetchApi<StudyCategory>("/study/categories", {
      method: "POST",
      body: JSON.stringify({ name, description }),
    }),

  updateCategory: (id: number, data: { name?: string; description?: string }) =>
    fetchApi<StudyCategory>(`/study/categories/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),

  deleteCategory: (id: number, moveTo?: number) => {
    const q = moveTo != null ? `?move_to=${moveTo}` : "";
    return fetchApi<{ ok: boolean }>(`/study/categories/${id}${q}`, { method: "DELETE" });
  },

  previewLink: (url: string) =>
    fetchApi<LinkPreview>("/study/link-preview", {
      method: "POST",
      body: JSON.stringify({ url }),
    }),

  createManualCard: (data: {
    url: string;
    category_id?: number;
    title?: string;
    user_note?: string;
  }) =>
    fetchApi<StudyCard>("/study/cards/manual", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  updateCard: (id: number, data: { title?: string; category_id?: number; user_note?: string }) =>
    fetchApi<StudyCard>(`/study/cards/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),

  moveCard: (id: number, categoryId: number, sortOrder?: number) =>
    fetchApi<StudyCard>(`/study/cards/${id}/move`, {
      method: "PATCH",
      body: JSON.stringify({ category_id: categoryId, sort_order: sortOrder }),
    }),

  analyzeCard: (id: number, force?: boolean) => {
    const q = force ? "?force=true" : "";
    return fetchApi<StudyCard>(`/study/cards/${id}/analyze${q}`, { method: "POST" });
  },

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

  previewYoutube: (url: string) =>
    fetchApi<YoutubePreview>("/study/youtube/preview", {
      method: "POST",
      body: JSON.stringify({ url }),
    }),

  listLessonLinks: (lessonId: string) =>
    fetchApi<{ lesson_id: string; items: StudyLessonLink[] }>(
      `/study/lessons/${encodeURIComponent(lessonId)}/links`,
    ),

  addLessonLink: (lessonId: string, url: string) =>
    fetchApi<StudyLessonLink>(`/study/lessons/${encodeURIComponent(lessonId)}/links`, {
      method: "POST",
      body: JSON.stringify({ url }),
    }),

  deleteLessonLink: (lessonId: string, linkId: number) =>
    fetchApi<{ ok: boolean }>(
      `/study/lessons/${encodeURIComponent(lessonId)}/links/${linkId}`,
      { method: "DELETE" },
    ),
};
