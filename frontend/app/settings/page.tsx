"use client";

import { useState } from "react";
import { KeyRound, Bell, Server, CheckCircle2, XCircle, Loader2 } from "lucide-react";
import { api } from "@/lib/api";

function Section({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface)] overflow-hidden">
      <div className="flex items-center gap-2 border-b border-[var(--border-subtle)] bg-[var(--surface-elevated)] px-4 py-3">
        <span className="text-neutral-500">{icon}</span>
        <h2 className="text-sm font-semibold text-neutral-700 dark:text-neutral-300">{title}</h2>
      </div>
      <div className="p-4 space-y-4">{children}</div>
    </div>
  );
}

function Field({ label, description, children }: { label: string; description?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300">{label}</label>
      {description && <p className="text-xs text-neutral-400">{description}</p>}
      {children}
    </div>
  );
}

export default function SettingsPage() {
  const [apiStatus, setApiStatus] = useState<"idle" | "checking" | "ok" | "error">("idle");

  async function checkApi() {
    setApiStatus("checking");
    try {
      await api.health();
      setApiStatus("ok");
    } catch {
      setApiStatus("error");
    }
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-neutral-900 dark:text-neutral-100">설정</h1>
        <p className="mt-0.5 text-xs text-neutral-400">API 키 및 알림 설정 안내</p>
      </div>

      {/* API 연결 상태 확인 */}
      <Section title="백엔드 서버 연결" icon={<Server size={15} />}>
        <div className="flex items-center gap-3">
          <button
            onClick={checkApi}
            disabled={apiStatus === "checking"}
            className="flex items-center gap-2 rounded-md border border-[var(--border-subtle)] px-3 py-2 text-sm font-medium text-neutral-700 transition-colors hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800 disabled:opacity-50"
          >
            {apiStatus === "checking" ? <Loader2 size={14} className="animate-spin" /> : <Server size={14} />}
            연결 확인
          </button>
          {apiStatus === "ok" && (
            <span className="flex items-center gap-1.5 text-sm text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 size={15} /> 서버 연결됨 (localhost:8000)
            </span>
          )}
          {apiStatus === "error" && (
            <span className="flex items-center gap-1.5 text-sm text-red-600 dark:text-red-400">
              <XCircle size={15} /> 연결 실패
            </span>
          )}
        </div>
        <div className="rounded-md bg-[var(--surface-elevated)] p-3 font-mono text-xs text-neutral-600 dark:text-neutral-400 space-y-1">
          <p># 백엔드 서버 시작</p>
          <p className="text-neutral-800 dark:text-neutral-200">cd stockdashboard/backend</p>
          <p className="text-neutral-800 dark:text-neutral-200">python main.py</p>
        </div>
      </Section>

      {/* KIS API 설정 */}
      <Section title="한국투자증권 (KIS) API" icon={<KeyRound size={15} />}>
        <p className="text-sm text-neutral-600 dark:text-neutral-400">
          <a
            href="https://apiportal.koreainvestment.com"
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-500 hover:underline"
          >
            apiportal.koreainvestment.com
          </a>
          에서 App Key / App Secret을 발급받고, 백엔드 폴더의{" "}
          <code className="rounded bg-neutral-100 px-1 py-0.5 text-xs dark:bg-neutral-800">.env</code> 파일에 입력하세요.
        </p>
        <div className="rounded-md bg-[var(--surface-elevated)] p-3 font-mono text-xs text-neutral-600 dark:text-neutral-400 space-y-0.5">
          <p>KIS_APP_KEY=<span className="text-amber-600 dark:text-amber-400">your_app_key</span></p>
          <p>KIS_APP_SECRET=<span className="text-amber-600 dark:text-amber-400">your_app_secret</span></p>
          <p>KIS_ACCOUNT_NO=<span className="text-amber-600 dark:text-amber-400">12345678-01</span></p>
          <p>KIS_IS_MOCK=<span className="text-amber-600 dark:text-amber-400">true</span>&nbsp;&nbsp;# 모의투자 / false=실전</p>
        </div>
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
          처음에는 <strong>KIS_IS_MOCK=true</strong>(모의투자)로 테스트 후, 검증되면 false(실전)로 전환하세요.
        </div>
      </Section>

      {/* Gemini API — YouTube 추출 + Gemini 분석 */}
      <Section title="Google Gemini AI (Flash-Lite)" icon={<KeyRound size={15} />}>
        <p className="text-sm text-neutral-600 dark:text-neutral-400">
          YouTube 문서 추출 및 UI에서 Gemini 선택 시 사용합니다. 모델: gemini-3.1-flash-lite (google-genai SDK).
          <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener noreferrer" className="ml-1 text-blue-500 hover:underline">aistudio.google.com</a>
        </p>
        <div className="rounded-md bg-[var(--surface-elevated)] p-3 font-mono text-xs text-neutral-600 dark:text-neutral-400 space-y-1">
          <p>GEMINI_API_KEY=<span className="text-amber-600 dark:text-amber-400">AIzaSy...</span></p>
          <p>GEMINI_MODEL=<span className="text-amber-600 dark:text-amber-400">gemini-3.1-flash-lite</span></p>
          <p>GEMINI_EXTRACT_MODEL=<span className="text-amber-600 dark:text-amber-400">gemini-3.1-flash-lite</span></p>
          <p>GEMINI_PROMPT_CACHE=<span className="text-amber-600 dark:text-amber-400">true</span></p>
        </div>
      </Section>

      {/* Anthropic Claude — 분석 옵션 */}
      <Section title="Anthropic Claude (분석 옵션)" icon={<KeyRound size={15} />}>
        <p className="text-sm text-neutral-600 dark:text-neutral-400">
          UI에서 Claude 선택 시 사용합니다. API Console 크레dit이 필요합니다.
          <a href="https://console.anthropic.com" target="_blank" rel="noopener noreferrer" className="ml-1 text-blue-500 hover:underline">console.anthropic.com</a>
        </p>
        <div className="rounded-md bg-[var(--surface-elevated)] p-3 font-mono text-xs text-neutral-600 dark:text-neutral-400 space-y-1">
          <p>ANTHROPIC_API_KEY=<span className="text-amber-600 dark:text-amber-400">your_anthropic_api_key</span></p>
          <p>ANTHROPIC_MODEL=<span className="text-amber-600 dark:text-amber-400">claude-3-5-haiku-latest</span></p>
        </div>
      </Section>

      {/* OpenAI GPT — 기본 구조화 분석 */}
      <Section title="OpenAI GPT (기본 분석)" icon={<KeyRound size={15} />}>
        <p className="text-sm text-neutral-600 dark:text-neutral-400">
          텍스트·뉴스 구조화 분석의 기본 AI입니다.
          <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener noreferrer" className="ml-1 text-blue-500 hover:underline">platform.openai.com</a>
        </p>
        <div className="rounded-md bg-[var(--surface-elevated)] p-3 font-mono text-xs text-neutral-600 dark:text-neutral-400 space-y-1">
          <p>OPENAI_API_KEY=<span className="text-amber-600 dark:text-amber-400">your_openai_api_key</span></p>
          <p>OPENAI_MODEL=<span className="text-amber-600 dark:text-amber-400">gpt-4o-mini</span></p>
          <p>ANALYSIS_PROVIDER=<span className="text-amber-600 dark:text-amber-400">openai</span></p>
        </div>
      </Section>

      {/* 알림 설정 */}
      <Section title="알림 임계값" icon={<Bell size={15} />}>
        <Field
          label="가격 변동 알림 기준 (%)"
          description="보유 종목이 기준 이상 변동 시 알림이 발생합니다. 기본값: 5%"
        >
          <div className="rounded-md bg-[var(--surface-elevated)] p-3 font-mono text-xs text-neutral-600 dark:text-neutral-400">
            <p>ALERT_THRESHOLD=<span className="text-amber-600 dark:text-amber-400">5.0</span></p>
          </div>
        </Field>
      </Section>

      {/* 자동 갱신 스케줄 */}
      <Section title="자동 갱신 스케줄 (KST)" icon={<Server size={15} />}>
        <div className="space-y-2 text-sm">
          {[
            { time: "평일 08:50", desc: "국내 장 시작 전 — 미국 전일 종가 확인" },
            { time: "평일 15:35", desc: "국내 장 마감 — 종가 동기화 + 5% 알림 체크" },
            { time: "평일 23:35", desc: "미국 장 오픈 확인" },
            { time: "화~토 07:05", desc: "미국 장 마감 — 미국 종가 동기화" },
          ].map(({ time, desc }) => (
            <div key={time} className="flex gap-4 text-sm">
              <span className="w-32 shrink-0 font-mono text-xs text-neutral-500 dark:text-neutral-400 pt-0.5">{time}</span>
              <span className="text-neutral-700 dark:text-neutral-300 text-xs">{desc}</span>
            </div>
          ))}
        </div>
      </Section>
    </div>
  );
}
