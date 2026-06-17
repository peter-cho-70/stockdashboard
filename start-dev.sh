#!/usr/bin/env bash
# StockMind 로컬 개발 — 백엔드 + 프론트 동시 실행 (macOS / Linux)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

BACKEND_PORT="${BACKEND_PORT:-8000}"
FRONTEND_PORT="${FRONTEND_PORT:-4000}"
API_URL="http://localhost:${BACKEND_PORT}/api"

echo "════════════════════════════════════════"
echo " StockMind 개발 서버 시작"
echo "════════════════════════════════════════"

if [[ ! -f backend/.env ]]; then
  echo "❌ backend/.env 가 없습니다."
  echo "   cp backend/.env.example backend/.env 후 API 키를 입력하세요."
  exit 1
fi

PYTHON="${PYTHON:-python3}"
if ! command -v "$PYTHON" &>/dev/null; then
  PYTHON=python
fi

VENV_PY="backend/venv/bin/python"
VENV_PIP="backend/venv/bin/pip"

ensure_backend_deps() {
  if [[ ! -d backend/venv ]]; then
    echo "📦 Python 가상환경 생성 중..."
    "$PYTHON" -m venv backend/venv
  fi
  if ! "$VENV_PY" -c "import fastapi" &>/dev/null; then
    echo "📦 백엔드 패키지 설치 중 (requirements.txt)..."
    "$VENV_PIP" install -r backend/requirements.txt
  fi
  if ! "$VENV_PY" -c "import fastapi" &>/dev/null; then
    echo "❌ fastapi 설치 실패. 수동 실행:"
    echo "   cd backend && source venv/bin/activate && pip install -r requirements.txt"
    exit 1
  fi
}

ensure_backend_deps

if [[ -f backend/stockmind.db ]]; then
  echo "💾 개발 DB 백업 중 (backend/data/backups)..."
  (
    cd backend
    export DB_PATH="${DB_PATH:-./stockmind.db}"
    "${ROOT}/backend/venv/bin/python3" -c "
from core.db_backup import create_backup, prune_old_backups
try:
    m = create_backup(label='pre_dev')
    prune_old_backups()
    print('   →', m['filename'])
except Exception as e:
    print('   ⚠️ 백업 생략:', e)
"
  ) || true
fi

if [[ ! -d frontend/node_modules ]]; then
  echo "📦 프론트 npm 패키지 설치 중..."
  (cd frontend && npm install)
fi

if [[ ! -f frontend/.env.local ]]; then
  echo "NEXT_PUBLIC_API_URL=${API_URL}" > frontend/.env.local
  echo "📝 frontend/.env.local 생성 (${API_URL})"
fi

cleanup() {
  echo ""
  echo "종료 중..."
  for pid in $(jobs -p); do
    kill "$pid" 2>/dev/null || true
  done
  wait 2>/dev/null || true
}
trap cleanup EXIT INT TERM

echo ""
echo "▶ 백엔드  http://localhost:${BACKEND_PORT}/docs"
echo "▶ 프론트  http://localhost:${FRONTEND_PORT}"
echo "   (종료: Ctrl+C)"
echo ""

(
  cd backend
  export DB_PATH="${DB_PATH:-./stockmind.db}"
  export FRONTEND_PORT="${FRONTEND_PORT}"
  export DEV_RESTART="${DEV_RESTART:-true}"
  export DEBUG="${DEBUG:-true}"  # 코드 변경 시 uvicorn 자동 reload
  # 백엔드가 SIGTERM(정상 종료)되면 자동 재기동
  while true; do
    "${ROOT}/backend/venv/bin/python3" main.py
    code=$?
    # 0: dev restart 요청으로 정상 종료
    # 143: SIGTERM 종료 (환경에 따라 0 대신 143으로 나올 수 있음)
    if [[ "$code" -eq 0 || "$code" -eq 143 ]]; then
      echo "♻️  백엔드 재시작 요청 감지. 재기동 중..."
      sleep 0.4
      continue
    fi
    echo "❌ 백엔드가 비정상 종료되었습니다. (exit=$code)"
    exit "$code"
  done
) &
BACK_PID=$!

sleep 2

if ! kill -0 "$BACK_PID" 2>/dev/null; then
  echo "❌ 백엔드 시작 실패. backend/.env 및 포트 ${BACKEND_PORT} 를 확인하세요."
  exit 1
fi

(
  cd frontend
  export NEXT_PUBLIC_API_URL="${API_URL}"
  npm run dev -- --port "${FRONTEND_PORT}"
) &
FRONT_PID=$!

# 프론트가 종료되면 전체 종료. 백엔드는 루프에서 계속 재기동됨.
wait "$FRONT_PID" 2>/dev/null || wait
