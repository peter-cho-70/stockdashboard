#!/usr/bin/env bash
# StockMind 로컬 개발 — 백엔드 + 프론트 동시 실행 (macOS / Linux)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

BACKEND_PORT="${BACKEND_PORT:-8000}"
FRONTEND_PORT="${FRONTEND_PORT:-3000}"
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
  "${ROOT}/backend/venv/bin/python3" main.py
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

wait -n "$BACK_PID" "$FRONT_PID" 2>/dev/null || wait
