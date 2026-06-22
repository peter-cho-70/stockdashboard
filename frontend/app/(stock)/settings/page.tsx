"use client";

import { useCallback, useEffect, useState } from "react";
import { KeyRound, Bell, Server, CheckCircle2, XCircle, Loader2, Eye, Database, RotateCcw, Trash2 } from "lucide-react";
import { api, settingsApi, systemApi, type DemoModeStatus, type DbBackupItem, type DbInfo } from "@/lib/api";

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

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export default function SettingsPage() {
  const [apiStatus, setApiStatus] = useState<"idle" | "checking" | "ok" | "error">("idle");
  const [demoStatus, setDemoStatus] = useState<DemoModeStatus | null>(null);
  const [demoLoading, setDemoLoading] = useState(true);
  const [demoEnabled, setDemoEnabled] = useState(false);
  const [demoPin, setDemoPin] = useState("");
  const [demoSaving, setDemoSaving] = useState(false);
  const [demoError, setDemoError] = useState<string | null>(null);

  const [dbInfo, setDbInfo] = useState<DbInfo | null>(null);
  const [backups, setBackups] = useState<DbBackupItem[]>([]);
  const [dbLoading, setDbLoading] = useState(true);
  const [dbBusy, setDbBusy] = useState(false);
  const [dbMsg, setDbMsg] = useState<string | null>(null);
  const [dbError, setDbError] = useState<string | null>(null);
  const [restarting, setRestarting] = useState(false);

  const loadDbBackups = useCallback(async () => {
    setDbLoading(true);
    setDbError(null);
    try {
      const res = await systemApi.listBackups();
      setDbInfo(res.db);
      setBackups(res.backups);
    } catch (e) {
      setDbError(e instanceof Error ? e.message : "백업 목록을 불러오지 못했습니다.");
    } finally {
      setDbLoading(false);
    }
  }, []);

  const loadDemoStatus = useCallback(async () => {
    setDemoLoading(true);
    setDemoError(null);
    try {
      const s = await settingsApi.getDemoMode();
      setDemoStatus(s);
      setDemoEnabled(s.demo_mode);
    } catch {
      setDemoError("데모 모드 상태를 불러오지 못했습니다.");
    } finally {
      setDemoLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDemoStatus();
    loadDbBackups();
  }, [loadDemoStatus, loadDbBackups]);

  async function handleCreateBackup() {
    setDbBusy(true);
    setDbMsg(null);
    setDbError(null);
    try {
      const res = await systemApi.createBackup("manual");
      await loadDbBackups();
      setDbMsg(`백업 완료: ${res.backup.filename}`);
    } catch (e) {
      setDbError(e instanceof Error ? e.message : "백업 실패");
    } finally {
      setDbBusy(false);
    }
  }

  async function handleBackendRestart() {
    if (!confirm("DB를 백업한 뒤 백엔드를 재시작합니다.\n(프론트는 유지됩니다)\n계속할까요?")) return;
    setRestarting(true);
    setDbMsg(null);
    setDbError(null);
    try {
      const res = await systemApi.devRestart("pre_restart");
      setDbMsg(`재시작 요청 완료 (백업: ${res.backup.filename}). 잠시 후 자동으로 연결됩니다...`);
      // 백엔드가 내려갔다가 다시 올라오므로 health 체크를 몇 번 시도
      const start = Date.now();
      while (Date.now() - start < 20_000) {
        try {
          await api.health();
          setDbMsg(`백엔드 재시작 완료 (백업: ${res.backup.filename})`);
          await loadDbBackups();
          return;
        } catch {
          await new Promise((r) => setTimeout(r, 800));
        }
      }
      setDbMsg("재시작 요청은 보냈습니다. 아직 연결이 복구되지 않았습니다. 잠시 후 다시 확인해 주세요.");
    } catch (e) {
      setDbError(e instanceof Error ? e.message : "재시작 실패");
    } finally {
      setRestarting(false);
    }
  }

  async function handleRestore(filename: string) {
    if (!confirm(`"${filename}" 으로 DB를 복원합니다.\n현재 DB는 자동으로 pre_restore 백업됩니다. 계속할까요?`)) {
      return;
    }
    setDbBusy(true);
    setDbMsg(null);
    setDbError(null);
    try {
      const res = await systemApi.restoreBackup(filename);
      setDbMsg(res.message);
      await loadDbBackups();
    } catch (e) {
      setDbError(e instanceof Error ? e.message : "복원 실패");
    } finally {
      setDbBusy(false);
    }
  }

  async function handleDeleteBackup(filename: string) {
    if (!confirm(`백업 "${filename}" 을 삭제할까요?`)) return;
    setDbBusy(true);
    setDbError(null);
    try {
      const res = await systemApi.deleteBackup(filename);
      setBackups(res.backups);
      await loadDbBackups();
    } catch (e) {
      setDbError(e instanceof Error ? e.message : "삭제 실패");
    } finally {
      setDbBusy(false);
    }
  }

  async function applyDemoMode() {
    if (!demoPin.trim()) {
      setDemoError("PIN을 입력하세요.");
      return;
    }
    setDemoSaving(true);
    setDemoError(null);
    try {
      await settingsApi.setDemoMode(demoEnabled, demoPin.trim());
      setDemoPin("");
      window.location.reload();
    } catch (e) {
      setDemoError(e instanceof Error ? e.message : "적용에 실패했습니다.");
    } finally {
      setDemoSaving(false);
    }
  }

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
              <CheckCircle2 size={15} /> 서버 연결됨
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
          <p className="text-neutral-800 dark:text-neutral-200">python3 main.py</p>
        </div>
      </Section>

      <Section title="데이터 백업 (개발용)" icon={<Database size={15} />}>
        <p className="text-sm text-neutral-600 dark:text-neutral-400">
          미국 증시 리포트·AI 분석·포트폴리오 등 SQLite DB 전체를 백업합니다.
          개발 중 재시작해도 데이터를 유지하려면 복원하세요.
          <code className="ml-1 rounded bg-neutral-100 px-1 text-xs dark:bg-neutral-800">./start-dev.sh</code>
          실행 시에도 자동 백업됩니다.
        </p>

        {dbLoading ? (
          <div className="flex items-center gap-2 text-sm text-neutral-400">
            <Loader2 size={14} className="animate-spin" /> 불러오는 중...
          </div>
        ) : (
          <>
            {dbInfo && (
              <div className="rounded-md bg-[var(--surface-elevated)] p-3 text-xs text-neutral-600 dark:text-neutral-400 space-y-1">
                <p>
                  <span className="text-neutral-500">DB</span>{" "}
                  <span className="font-mono text-neutral-800 dark:text-neutral-200">{dbInfo.db_path}</span>
                </p>
                {dbInfo.exists && (
                  <>
                    <p>크기 {fmtBytes(dbInfo.size_bytes ?? 0)} · 백업 {dbInfo.backup_count}개</p>
                    {dbInfo.summary?.counts && (
                      <p>
                        미국증시 리포트 {dbInfo.summary.counts.us_market_reports ?? 0}건 · 종목{" "}
                        {dbInfo.summary.counts.stocks ?? 0} · AI 분석{" "}
                        {dbInfo.summary.counts.intel_contents ?? 0}
                      </p>
                    )}
                  </>
                )}
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={handleCreateBackup}
                disabled={dbBusy || !dbInfo?.exists}
                className="flex items-center gap-2 rounded-md border border-[var(--border-subtle)] px-3 py-2 text-sm font-medium hover:bg-neutral-100 disabled:opacity-50 dark:hover:bg-neutral-800"
              >
                {dbBusy ? <Loader2 size={14} className="animate-spin" /> : <Database size={14} />}
                지금 백업
              </button>
              <button
                type="button"
                onClick={handleBackendRestart}
                disabled={dbBusy || restarting || !dbInfo?.exists}
                className="flex items-center gap-2 rounded-md border border-[var(--border-subtle)] px-3 py-2 text-sm font-medium hover:bg-neutral-100 disabled:opacity-50 dark:hover:bg-neutral-800"
                title="DB 백업 후 백엔드 프로세스를 재시작합니다."
              >
                {restarting ? <Loader2 size={14} className="animate-spin" /> : <Server size={14} />}
                백업 후 재시작
              </button>
              <button
                type="button"
                onClick={loadDbBackups}
                disabled={dbBusy}
                className="flex items-center gap-2 rounded-md border border-[var(--border-subtle)] px-3 py-2 text-sm font-medium hover:bg-neutral-100 dark:hover:bg-neutral-800"
              >
                <RotateCcw size={14} />
                새로고침
              </button>
            </div>

            {dbMsg && (
              <p className="text-sm text-emerald-600 dark:text-emerald-400">{dbMsg}</p>
            )}
            {dbError && (
              <p className="text-sm text-red-600 dark:text-red-400">{dbError}</p>
            )}

            {backups.length === 0 ? (
              <p className="text-xs text-neutral-400">저장된 백업이 없습니다.</p>
            ) : (
              <ul className="divide-y divide-[var(--border-subtle)] rounded-md border border-[var(--border-subtle)]">
                {backups.map((b) => (
                  <li key={b.filename} className="flex flex-wrap items-center gap-2 px-3 py-2 text-xs">
                    <div className="min-w-0 flex-1">
                      <p className="font-mono text-neutral-800 dark:text-neutral-200 truncate">
                        {b.filename}
                      </p>
                      <p className="text-neutral-400">
                        {b.label} · {fmtBytes(b.size_bytes)} ·{" "}
                        {new Date(b.created_at).toLocaleString("ko-KR")}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleRestore(b.filename)}
                      disabled={dbBusy}
                      className="rounded px-2 py-1 font-medium text-blue-600 hover:bg-blue-50 disabled:opacity-50 dark:text-blue-400 dark:hover:bg-blue-950/30"
                    >
                      복원
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteBackup(b.filename)}
                      disabled={dbBusy || b.label === "pre_restore"}
                      className="rounded p-1 text-neutral-400 hover:text-red-500 disabled:opacity-30"
                      title="삭제"
                    >
                      <Trash2 size={14} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </Section>

      <Section title="데모 모드 (공개 시연)" icon={<Eye size={15} />}>
        <p className="text-sm text-neutral-600 dark:text-neutral-400">
          실제 보유를 숨기고 <code className="text-xs">backend/data/demo_portfolio.json</code> 의 샘플 종목·수량만
          표시합니다. 차트·AI 분석은 동일 종목코드 데이터를 사용합니다.
        </p>
        {demoLoading ? (
          <p className="flex items-center gap-2 text-sm text-neutral-500">
            <Loader2 size={14} className="animate-spin" /> 상태 불러오는 중…
          </p>
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-neutral-800 dark:text-neutral-200">
                  데모 모드 {demoStatus?.demo_mode ? "켜짐" : "꺼짐"}
                </p>
                <p className="text-xs text-neutral-500">
                  적용 출처: {demoStatus?.source === "database" ? "설정 저장값" : "환경 변수 DEMO_MODE"}
                  {demoStatus?.env_default && demoStatus?.source === "env" ? " (true)" : ""}
                </p>
              </div>
              <label className="relative inline-flex cursor-pointer items-center">
                <input
                  type="checkbox"
                  className="peer sr-only"
                  checked={demoEnabled}
                  onChange={(e) => setDemoEnabled(e.target.checked)}
                  disabled={demoSaving || !demoStatus?.pin_configured}
                />
                <span className="h-6 w-11 rounded-full bg-neutral-300 after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:bg-white after:transition-all peer-checked:bg-amber-500 peer-checked:after:translate-x-full peer-disabled:opacity-40 dark:bg-neutral-600" />
              </label>
            </div>
            {!demoStatus?.pin_configured && (
              <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
                서버 <code className="rounded bg-amber-100/80 px-1 dark:bg-amber-900/40">DEMO_PIN</code> 이 설정되어야
                토글할 수 있습니다. (<code className="text-[11px]">backend/.env</code>)
              </div>
            )}
            <Field label="PIN" description="DEMO_PIN과 동일한 값 (서버 .env에만 저장)">
              <input
                type="password"
                inputMode="numeric"
                autoComplete="off"
                value={demoPin}
                onChange={(e) => setDemoPin(e.target.value)}
                disabled={demoSaving || !demoStatus?.pin_configured}
                placeholder="••••"
                className="w-full max-w-xs rounded-md border border-[var(--border-subtle)] bg-[var(--surface)] px-3 py-2 text-sm text-neutral-800 dark:text-neutral-200 disabled:opacity-50"
              />
            </Field>
            <button
              type="button"
              onClick={applyDemoMode}
              disabled={demoSaving || !demoStatus?.pin_configured}
              className="flex items-center gap-2 rounded-md bg-amber-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-amber-700 disabled:opacity-50"
            >
              {demoSaving ? <Loader2 size={14} className="animate-spin" /> : <Eye size={14} />}
              적용 (페이지 새로고침)
            </button>
            {demoError && (
              <p className="text-sm text-red-600 dark:text-red-400">{demoError}</p>
            )}
          </div>
        )}
        <div className="rounded-md bg-[var(--surface-elevated)] p-3 font-mono text-xs text-neutral-600 dark:text-neutral-400 space-y-1">
          <p># API .env</p>
          <p className="text-neutral-800 dark:text-neutral-200">DEMO_PIN=1234</p>
          <p className="text-neutral-800 dark:text-neutral-200">DEMO_MODE=false</p>
          <p className="text-amber-700 dark:text-amber-400"># demo_portfolio.json 수정 후 서버 재시작</p>
        </div>
      </Section>

      {/* KIS API 설정 */}
      <Section title="한국투자증권 (KIS) API" icon={<KeyRound size={15} />}>
        <p className="text-sm text-neutral-600 dark:text-neutral-400">
          계좌마다 App Key / Secret이 다릅니다.{" "}
          <a
            href="https://apiportal.koreainvestment.com"
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-500 hover:underline"
          >
            apiportal.koreainvestment.com
          </a>
          에서 계좌별로 발급받고, 백엔드{" "}
          <code className="rounded bg-neutral-100 px-1 py-0.5 text-xs dark:bg-neutral-800">.env</code>에 입력하세요.
        </p>
        <div className="rounded-md bg-[var(--surface-elevated)] p-3 font-mono text-xs text-neutral-600 dark:text-neutral-400 space-y-0.5">
          <p className="text-neutral-500 dark:text-neutral-500"># 단일 계좌</p>
          <p>KIS_APP_KEY=<span className="text-amber-600 dark:text-amber-400">your_app_key</span></p>
          <p>KIS_APP_SECRET=<span className="text-amber-600 dark:text-amber-400">your_app_secret</span></p>
          <p>KIS_ACCOUNT_NO=<span className="text-amber-600 dark:text-amber-400">12345678-01</span></p>
          <p>KIS_HTS_ID=<span className="text-amber-600 dark:text-amber-400">your_hts_id</span>&nbsp;&nbsp;# HTS 로그인 ID (선택)</p>
          <p className="pt-2 text-neutral-500 dark:text-neutral-500"># 복수 계좌 (계좌별 키 — 한 줄)</p>
          <p>KIS_ACCOUNTS=<span className="text-amber-600 dark:text-amber-400">12345678-01|key1|secret1;12345678-22|key2|secret2</span></p>
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
          <p>ANALYSIS_PROVIDER=<span className="text-amber-600 dark:text-amber-400">gemini</span></p>
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
            { time: "평일 08:05", desc: "미국 증시 아침 리포트 자동 생성" },
            { time: "0·6·12·18시 30분", desc: "지식 허브 — 분야별 뉴스 RSS 수집" },
            { time: "매일 08:00", desc: "지식 허브 — 오늘의 리마인드 카드" },
            { time: "일요일 20:00", desc: "지식 허브 — 주간 다이제스트 생성" },
            { time: "평일 08:50", desc: "국내 장 시작 전 — 리포트 백업·Signal 점검" },
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
