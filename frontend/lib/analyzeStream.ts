import type { AnalysisLog, AnalysisResult } from "./api";

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000/api";

export class AnalyzeStreamError extends Error {
  status: number;
  logs: AnalysisLog[];

  constructor(message: string, status: number, logs: AnalysisLog[]) {
    super(message);
    this.name = "AnalyzeStreamError";
    this.status = status;
    this.logs = logs;
  }
}

function parseSseBlock(block: string): { event: string; data: string } | null {
  let event = "message";
  let data = "";
  for (const line of block.split("\n")) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) data = line.slice(5).trim();
  }
  if (!data) return null;
  return { event, data };
}

/** SSE 스트리밍 AI 분석 — onLog로 진행 로그 실시간 수신 */
export async function streamAnalyze<T = AnalysisResult>(
  path: string,
  body: Record<string, unknown>,
  onLog: (log: AnalysisLog) => void,
): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(err || `HTTP ${res.status}`);
  }

  if (!res.body) throw new Error("스트림 응답 없음");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const blocks = buffer.split("\n\n");
    buffer = blocks.pop() || "";

    for (const block of blocks) {
      if (!block.trim()) continue;
      const parsed = parseSseBlock(block);
      if (!parsed) continue;

      const payload = JSON.parse(parsed.data);

      if (parsed.event === "log") {
        onLog(payload as AnalysisLog);
      } else if (parsed.event === "result") {
        return payload as T;
      } else if (parsed.event === "error") {
        throw new AnalyzeStreamError(
          payload.message || "분석 실패",
          payload.status || 500,
          (payload.logs as AnalysisLog[]) || [],
        );
      }
    }
  }

  throw new Error("분석이 완료되지 않았습니다 (연결 종료)");
}
