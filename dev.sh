#!/usr/bin/env bash
# StockMind 개발 서버 헬퍼
# 사용법:
#   ./dev.sh start              # 백엔드+프론트 시작 (start-dev.sh)
#   ./dev.sh stop-backend       # 백엔드만 강제 종료
#   ./dev.sh restart-backend    # 백엔드 강제 종료 후 재시작
#   ./dev.sh stop               # 백엔드+프론트 모두 종료
#   ./dev.sh restart            # 전체 종료 후 다시 시작

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

BACKEND_PORT="${BACKEND_PORT:-8000}"
FRONTEND_PORT="${FRONTEND_PORT:-4000}"
API_URL="http://localhost:${BACKEND_PORT}/api"

kill_port() {
  local port="$1"
  local label="${2:-포트 ${port}}"
  local pids

  pids="$(lsof -t -i ":${port}" -sTCP:LISTEN 2>/dev/null || true)"
  if [[ -z "$pids" ]]; then
    pids="$(lsof -t -i ":${port}" 2>/dev/null || true)"
  fi
  if [[ -z "$pids" ]]; then
    echo "ℹ️  ${label}: 실행 중인 프로세스 없음"
    return 0
  fi

  echo "🔪 ${label} 종료 중 (PID: ${pids})"
  kill -TERM ${pids} 2>/dev/null || true
  sleep 0.6

  pids="$(lsof -t -i ":${port}" 2>/dev/null || true)"
  if [[ -n "$pids" ]]; then
    echo "⚠️  강제 종료 (SIGKILL): ${pids}"
    kill -9 ${pids} 2>/dev/null || true
    sleep 0.3
  fi

  if lsof -i ":${port}" &>/dev/null; then
    echo "❌ ${label} 종료 실패"
    return 1
  fi
  echo "✅ ${label} 종료 완료"
}

backend_up() {
  curl -sf "http://localhost:${BACKEND_PORT}/docs" >/dev/null 2>&1
}

stop_backend() {
  kill_port "$BACKEND_PORT" "백엔드 (:${BACKEND_PORT})"
}

stop_frontend() {
  kill_port "$FRONTEND_PORT" "프론트 (:${FRONTEND_PORT})"
}

stop_all() {
  stop_frontend || true
  stop_backend || true
}

restart_backend() {
  echo "════════════════════════════════════════"
  echo " 백엔드 재시작"
  echo "════════════════════════════════════════"

  # 1) graceful restart (DB 백업 후 exit → start-dev.sh 루프가 재기동)
  if curl -sf -X POST "${API_URL}/system/dev/restart" \
      -H "Content-Type: application/json" \
      -d '{"label":"cli_restart"}' >/dev/null 2>&1; then
    echo "♻️  API로 정상 재시작 요청"
    sleep 2
    if backend_up; then
      echo "✅ 백엔드 재시작 완료"
      return 0
    fi
  fi

  # 2) 강제 종료
  stop_backend || true

  # 3) start-dev.sh 루프가 재기동했는지 확인
  sleep 2
  if backend_up; then
    echo "✅ 백엔드 재시작 완료 (자동 루프)"
    return 0
  fi

  # 4) start-dev.sh 없을 때 단독 기동
  echo "▶ 백엔드 단독 시작..."
  if [[ ! -f backend/.env ]]; then
    echo "❌ backend/.env 가 없습니다."
    exit 1
  fi
  if [[ ! -x backend/venv/bin/python3 ]]; then
    echo "❌ backend/venv 가 없습니다. 먼저 ./dev.sh start 로 의존성을 설치하세요."
    exit 1
  fi

  mkdir -p backend/data
  (
    cd backend
    export DB_PATH="${DB_PATH:-./stockmind.db}"
    export FRONTEND_PORT="${FRONTEND_PORT}"
    export DEV_RESTART="${DEV_RESTART:-true}"
    nohup "${ROOT}/backend/venv/bin/python3" main.py \
      > "${ROOT}/backend/data/backend.log" 2>&1 &
    echo $! > "${ROOT}/backend/data/backend.pid"
  )
  sleep 2
  if backend_up; then
    echo "✅ 백엔드 단독 시작 완료 (로그: backend/data/backend.log)"
  else
    echo "❌ 백엔드 시작 실패 — backend/data/backend.log 확인"
    exit 1
  fi
}

start_all() {
  exec "${ROOT}/start-dev.sh"
}

case "${1:-start}" in
  start)
    start_all
    ;;
  stop-backend)
    stop_backend
    ;;
  stop-frontend)
    stop_frontend
    ;;
  stop)
    stop_all
    ;;
  restart-backend)
    restart_backend
    ;;
  restart)
    stop_all
    sleep 1
    start_all
    ;;
  *)
    echo "사용법: $0 {start|stop|stop-backend|stop-frontend|restart|restart-backend}"
    exit 1
    ;;
esac
