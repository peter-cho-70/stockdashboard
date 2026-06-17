"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  flattenListenScript,
  tokenizeWords,
  wordIndexAtChar,
  type ListenScript,
} from "@/lib/listenScript";
import {
  applyUtteranceVoice,
  getSpeechSynth,
  listKoreanVoices,
  pickKoreanVoice,
  primeSpeechOnUserGesture,
  resolveVoiceByUri,
  startSpeechKeepAlive,
  stopSpeechKeepAlive,
} from "@/lib/speechEngine";
import {
  DEFAULT_TTS_PITCH,
  DEFAULT_TTS_RATE,
  loadTtsPitch,
  loadTtsRate,
  loadTtsVoiceUri,
  saveTtsPitch,
  saveTtsRate,
  saveTtsVoiceUri,
} from "@/lib/speechText";

export type SpeechListenStatus = "idle" | "playing" | "paused";

const SENTENCE_PAUSE_MS = 220;
const SECTION_PAUSE_MS = 500;

export function useSpeechListen(script: ListenScript | null) {
  const flat = useMemo(() => (script ? flattenListenScript(script) : []), [script]);
  const [status, setStatus] = useState<SpeechListenStatus>("idle");
  const [currentIndex, setCurrentIndex] = useState(0);
  const [currentWordIndex, setCurrentWordIndex] = useState(-1);
  const [rate, setRateState] = useState(DEFAULT_TTS_RATE);
  const [pitch, setPitchState] = useState(DEFAULT_TTS_PITCH);
  const [voiceURI, setVoiceURIState] = useState<string | null>(null);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [supported, setSupported] = useState(true);

  const indexRef = useRef(0);
  const rateRef = useRef(DEFAULT_TTS_RATE);
  const pitchRef = useRef(DEFAULT_TTS_PITCH);
  const statusRef = useRef<SpeechListenStatus>("idle");
  const flatRef = useRef(flat);
  const generationRef = useRef(0);
  const wordTimerRef = useRef<number | null>(null);
  const pauseTimerRef = useRef<number | null>(null);
  const boundarySeenRef = useRef(false);

  useEffect(() => {
    flatRef.current = flat;
  }, [flat]);

  useEffect(() => {
    rateRef.current = rate;
  }, [rate]);

  useEffect(() => {
    pitchRef.current = pitch;
  }, [pitch]);

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  useEffect(() => {
    setRateState(loadTtsRate());
    setPitchState(loadTtsPitch());
    setVoiceURIState(loadTtsVoiceUri());
    setSupported(typeof window !== "undefined" && "speechSynthesis" in window);
  }, []);

  const refreshVoices = useCallback(() => {
    setVoices(listKoreanVoices());
  }, []);

  useEffect(() => {
    const synth = getSpeechSynth();
    if (!synth) return;

    const warm = () => {
      for (let i = 0; i < 3; i++) synth.getVoices();
      refreshVoices();
    };

    synth.onvoiceschanged = warm;
    warm();

    return () => {
      synth.onvoiceschanged = null;
    };
  }, [refreshVoices]);

  const setRate = useCallback((r: number) => {
    rateRef.current = r;
    setRateState(r);
    saveTtsRate(r);
  }, []);

  const setPitch = useCallback((p: number) => {
    pitchRef.current = p;
    setPitchState(p);
    saveTtsPitch(p);
  }, []);

  const setVoiceURI = useCallback((uri: string | null) => {
    setVoiceURIState(uri);
    saveTtsVoiceUri(uri);
  }, []);

  const clearWordTimer = useCallback(() => {
    if (wordTimerRef.current != null) {
      window.clearTimeout(wordTimerRef.current);
      wordTimerRef.current = null;
    }
  }, []);

  const clearPauseTimer = useCallback(() => {
    if (pauseTimerRef.current != null) {
      window.clearTimeout(pauseTimerRef.current);
      pauseTimerRef.current = null;
    }
  }, []);

  const bumpGeneration = useCallback(() => {
    generationRef.current += 1;
    clearWordTimer();
    clearPauseTimer();
    return generationRef.current;
  }, [clearWordTimer, clearPauseTimer]);

  const cancelSpeech = useCallback(() => {
    stopSpeechKeepAlive();
    const synth = getSpeechSynth();
    if (synth) synth.cancel();
  }, []);

  const stop = useCallback(() => {
    bumpGeneration();
    cancelSpeech();
    statusRef.current = "idle";
    setStatus("idle");
    setCurrentWordIndex(-1);
  }, [bumpGeneration, cancelSpeech]);

  const pause = useCallback(() => {
    bumpGeneration();
    cancelSpeech();
    statusRef.current = "paused";
    setStatus("paused");
    setCurrentWordIndex(-1);
  }, [bumpGeneration, cancelSpeech]);

  const resolveVoice = useCallback(() => {
    return resolveVoiceByUri(voiceURI) ?? pickKoreanVoice();
  }, [voiceURI]);

  const startWordFallback = useCallback(
    (text: string, gen: number) => {
      clearWordTimer();
      boundarySeenRef.current = false;
      const tokens = tokenizeWords(text);
      if (!tokens.length) return;

      setCurrentWordIndex(0);
      let wi = 0;
      const step = () => {
        if (gen !== generationRef.current || boundarySeenRef.current) return;
        wi += 1;
        if (wi >= tokens.length) return;
        setCurrentWordIndex(wi);
        const delay = Math.max(120, Math.round(300 / rateRef.current));
        wordTimerRef.current = window.setTimeout(step, delay);
      };
      wordTimerRef.current = window.setTimeout(step, Math.max(120, Math.round(300 / rateRef.current)));
    },
    [clearWordTimer],
  );

  const speakAt = useCallback(
    (startIndex: number, langOnly = false) => {
      const synth = getSpeechSynth();
      if (!synth) return;

      const items = flatRef.current;
      if (!items.length || startIndex >= items.length) {
        statusRef.current = "idle";
        setStatus("idle");
        setCurrentWordIndex(-1);
        stopSpeechKeepAlive();
        return;
      }

      const wasActive = synth.speaking || synth.pending;
      if (wasActive) synth.cancel();

      const gen = bumpGeneration();

      indexRef.current = startIndex;
      setCurrentIndex(startIndex);
      setCurrentWordIndex(-1);
      statusRef.current = "playing";
      setStatus("playing");
      startSpeechKeepAlive();

      const run = (i: number, forceLangOnly = langOnly) => {
        if (gen !== generationRef.current) return;
        if (i >= items.length) {
          statusRef.current = "idle";
          setStatus("idle");
          setCurrentWordIndex(-1);
          stopSpeechKeepAlive();
          return;
        }

        const item = items[i];
        const text = item.sentence.text;
        const utter = new SpeechSynthesisUtterance(text);
        utter.rate = rateRef.current;
        utter.pitch = pitchRef.current;
        applyUtteranceVoice(utter, forceLangOnly ? null : resolveVoice());

        let started = false;
        let retried = false;

        const retryOrSkip = () => {
          if (gen !== generationRef.current) return;
          if (!retried && !forceLangOnly) {
            retried = true;
            run(i, true);
            return;
          }
          if (i + 1 < items.length) {
            const next = items[i + 1];
            const pauseMs =
              next.sectionId !== item.sectionId ? SECTION_PAUSE_MS : SENTENCE_PAUSE_MS;
            pauseTimerRef.current = window.setTimeout(() => {
              pauseTimerRef.current = null;
              run(i + 1, langOnly);
            }, pauseMs);
          } else {
            statusRef.current = "idle";
            setStatus("idle");
            stopSpeechKeepAlive();
          }
        };

        utter.onstart = () => {
          if (gen !== generationRef.current) return;
          started = true;
          indexRef.current = i;
          setCurrentIndex(i);
          setCurrentWordIndex(0);
          startWordFallback(text, gen);
        };

        utter.onboundary = (e) => {
          if (gen !== generationRef.current) return;
          boundarySeenRef.current = true;
          clearWordTimer();
          const wi = wordIndexAtChar(tokenizeWords(text), e.charIndex);
          setCurrentWordIndex(wi);
        };

        utter.onend = () => {
          if (gen !== generationRef.current) return;
          clearWordTimer();
          setCurrentWordIndex(-1);
          if (i + 1 >= items.length) {
            statusRef.current = "idle";
            setStatus("idle");
            stopSpeechKeepAlive();
            return;
          }
          const next = items[i + 1];
          const pauseMs =
            next.sectionId !== item.sectionId ? SECTION_PAUSE_MS : SENTENCE_PAUSE_MS;
          pauseTimerRef.current = window.setTimeout(() => {
            pauseTimerRef.current = null;
            run(i + 1, langOnly);
          }, pauseMs);
        };

        utter.onerror = (ev) => {
          if (gen !== generationRef.current) return;
          clearWordTimer();
          setCurrentWordIndex(-1);
          const err = (ev as SpeechSynthesisErrorEvent).error;
          if (err === "interrupted" || err === "canceled") return;
          retryOrSkip();
        };

        synth.resume();
        synth.speak(utter);

        window.setTimeout(() => {
          if (started || gen !== generationRef.current) return;
          if (!synth.speaking && !synth.pending) retryOrSkip();
        }, 900);
      };

      const startRun = () => {
        if (gen !== generationRef.current) return;
        synth.resume();
        run(startIndex, langOnly);
      };

      if (wasActive) {
        window.setTimeout(startRun, 100);
      } else {
        startRun();
      }
    },
    [bumpGeneration, clearWordTimer, resolveVoice, startWordFallback],
  );

  const play = useCallback(() => {
    if (!flatRef.current.length) return;
    primeSpeechOnUserGesture();
    refreshVoices();
    speakAt(indexRef.current);
  }, [speakAt, refreshVoices]);

  const toggle = useCallback(() => {
    if (statusRef.current === "playing") pause();
    else play();
  }, [pause, play]);

  const seekSentence = useCallback(
    (index: number) => {
      const clamped = Math.max(0, Math.min(index, flat.length - 1));
      indexRef.current = clamped;
      setCurrentIndex(clamped);
      setCurrentWordIndex(-1);
      if (statusRef.current === "playing") speakAt(clamped);
    },
    [flat.length, speakAt],
  );

  const skip = useCallback(
    (delta: number) => {
      seekSentence(indexRef.current + delta);
    },
    [seekSentence],
  );

  useEffect(() => {
    return () => {
      bumpGeneration();
      cancelSpeech();
    };
  }, [bumpGeneration, cancelSpeech]);

  const current = flat[currentIndex] ?? null;

  return {
    supported,
    flat,
    status,
    currentIndex,
    currentWordIndex,
    current,
    rate,
    pitch,
    voices,
    voiceURI,
    setRate,
    setPitch,
    setVoiceURI,
    play,
    pause,
    stop,
    toggle,
    seekSentence,
    skip,
    total: flat.length,
  };
};
