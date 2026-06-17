/** TTS 읽기용 텍스트 변환 · 사용자 설정 (localStorage) */

export const TTS_STORAGE_KEYS = {
  voice: "stockmind-tts-voice",
  rate: "stockmind-tts-rate",
  pitch: "stockmind-tts-pitch",
} as const;

export const DEFAULT_TTS_RATE = 0.9;
export const DEFAULT_TTS_PITCH = 0.95;

export function loadTtsRate(): number {
  if (typeof window === "undefined") return DEFAULT_TTS_RATE;
  const raw = localStorage.getItem(TTS_STORAGE_KEYS.rate);
  const n = raw ? parseFloat(raw) : DEFAULT_TTS_RATE;
  return Number.isFinite(n) && n >= 0.5 && n <= 2 ? n : DEFAULT_TTS_RATE;
}

export function saveTtsRate(rate: number): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(TTS_STORAGE_KEYS.rate, String(rate));
}

export function loadTtsPitch(): number {
  if (typeof window === "undefined") return DEFAULT_TTS_PITCH;
  const raw = localStorage.getItem(TTS_STORAGE_KEYS.pitch);
  const n = raw ? parseFloat(raw) : DEFAULT_TTS_PITCH;
  return Number.isFinite(n) && n >= 0.5 && n <= 2 ? n : DEFAULT_TTS_PITCH;
}

export function saveTtsPitch(pitch: number): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(TTS_STORAGE_KEYS.pitch, String(pitch));
}

export function loadTtsVoiceUri(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(TTS_STORAGE_KEYS.voice);
}

export function saveTtsVoiceUri(voiceURI: string | null): void {
  if (typeof window === "undefined") return;
  if (voiceURI) localStorage.setItem(TTS_STORAGE_KEYS.voice, voiceURI);
  else localStorage.removeItem(TTS_STORAGE_KEYS.voice);
}

/** 약어·기호를 TTS가 자연스럽게 읽도록 변환 */
export function speakFriendly(text: string): string {
  return (
    text
      .replace(/\bPER\b/gi, "피이알")
      .replace(/\bPBR\b/gi, "피비알")
      .replace(/\bEPS\b/gi, "이피에스")
      .replace(/\bBPS\b/gi, "비피에스")
      .replace(/\bMACD\b/g, "맥디")
      .replace(/\bRSI\b/g, "알에스아이")
      .replace(/\bMA(\d+)\b/g, "$1일 이동평균")
      .replace(/\bKIS\b/g, "케이아이에스")
      .replace(/(\d+)배/g, "$1 배")
      .replace(/·/g, ", ")
      .replace(/…/g, ". ")
      .replace(/\.{2,}/g, ". ")
      .replace(/\s{2,}/g, " ")
      .trim()
  );
}
