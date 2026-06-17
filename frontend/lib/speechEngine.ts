/** Web Speech API 브라우저별 호환 (Chrome·Whale·Safari) */

import { loadTtsVoiceUri } from "@/lib/speechText";

export function isWhaleBrowser(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Whale/i.test(navigator.userAgent);
}

export function isChromiumFamily(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Chrome|Chromium|Edg|Whale/i.test(navigator.userAgent);
}

export function getSpeechSynth(): SpeechSynthesis | null {
  if (typeof window === "undefined") return null;
  return window.speechSynthesis ?? null;
}

/** 클릭 직후 호출 — Whale/Chrome 음성 엔진 깨우기 */
export function primeSpeechOnUserGesture(): void {
  const synth = getSpeechSynth();
  if (!synth) return;

  synth.resume();

  for (let i = 0; i < 5; i++) {
    synth.getVoices();
  }
}

function voiceQualityScore(v: SpeechSynthesisVoice): number {
  let score = 0;
  const name = v.name.toLowerCase();
  if (v.localService) score += 10;
  if (/premium|enhanced|neural|natural|quality/i.test(name)) score += 8;
  if (v.lang === "ko-KR") score += 4;
  else if (v.lang.startsWith("ko")) score += 2;
  if (/compact|low/i.test(name)) score -= 5;
  return score;
}

export function listKoreanVoices(): SpeechSynthesisVoice[] {
  const synth = getSpeechSynth();
  if (!synth) return [];
  const voices = synth.getVoices().filter((v) => v.lang.startsWith("ko"));
  return [...voices].sort((a, b) => voiceQualityScore(b) - voiceQualityScore(a));
}

export function resolveVoiceByUri(voiceURI: string | null | undefined): SpeechSynthesisVoice | null {
  if (!voiceURI || isWhaleBrowser()) return null;
  const synth = getSpeechSynth();
  if (!synth) return null;
  return synth.getVoices().find((v) => v.voiceURI === voiceURI) ?? null;
}

/** 저장된 URI → 없으면 품질 좋은 한국어 음성 자동 선택 */
export function pickKoreanVoice(): SpeechSynthesisVoice | null {
  if (isWhaleBrowser()) return null;

  const saved = resolveVoiceByUri(loadTtsVoiceUri());
  if (saved) return saved;

  const voices = listKoreanVoices();
  if (!voices.length) return null;
  return voices[0];
}

export function applyUtteranceVoice(utter: SpeechSynthesisUtterance, voice: SpeechSynthesisVoice | null) {
  utter.lang = "ko-KR";
  utter.volume = 1;
  if (voice && !isWhaleBrowser()) {
    try {
      utter.voice = voice;
    } catch {
      /* lang fallback */
    }
  }
}

/** Chrome·Whale: 긴 재생 중 speechSynthesis가 멈추는 버그 방지 */
let keepAliveTimer: number | null = null;

export function startSpeechKeepAlive() {
  stopSpeechKeepAlive();
  if (!isChromiumFamily()) return;

  keepAliveTimer = window.setInterval(() => {
    const synth = getSpeechSynth();
    if (!synth) return;
    if (synth.speaking || synth.pending) {
      synth.pause();
      synth.resume();
    }
  }, 8000);
}

export function stopSpeechKeepAlive() {
  if (keepAliveTimer != null) {
    window.clearInterval(keepAliveTimer);
    keepAliveTimer = null;
  }
}
