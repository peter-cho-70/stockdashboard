@echo off
setlocal EnableExtensions
cd /d "%~dp0"

set "BACKEND_PORT=8000"
set "FRONTEND_PORT=3000"
set "API_URL=http://localhost:%BACKEND_PORT%/api"

echo ========================================
echo  StockMind 개발 서버 시작
echo ========================================

if not exist "backend\.env" (
  echo [ERROR] backend\.env 가 없습니다.
  echo         copy backend\.env.example backend\.env 후 API 키를 입력하세요.
  pause
  exit /b 1
)

where python >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Python 이 PATH 에 없습니다.
  pause
  exit /b 1
)

if not exist "backend\venv" (
  echo [INFO] Python 가상환경 생성 중...
  python -m venv backend\venv
)

call backend\venv\Scripts\python.exe -c "import fastapi" >nul 2>&1
if errorlevel 1 (
  echo [INFO] 백엔드 패키지 설치 중...
  call backend\venv\Scripts\pip.exe install -r backend\requirements.txt
  call backend\venv\Scripts\python.exe -c "import fastapi" >nul 2>&1
  if errorlevel 1 (
    echo [ERROR] fastapi 설치 실패. backend\venv 에서 pip install -r requirements.txt 를 실행하세요.
    pause
    exit /b 1
  )
)

if not exist "frontend\node_modules" (
  echo [INFO] 프론트 npm 패키지 설치 중...
  pushd frontend
  call npm install
  popd
)

if not exist "frontend\.env.local" (
  echo NEXT_PUBLIC_API_URL=%API_URL%> frontend\.env.local
  echo [INFO] frontend\.env.local 생성
)

echo.
echo Backend  http://localhost:%BACKEND_PORT%/docs
echo Frontend http://localhost:%FRONTEND_PORT%
echo 각 창을 닫으면 해당 서버가 종료됩니다.
echo.

set "DB_PATH=./stockmind.db"
start "StockMind Backend" cmd /k "cd /d %~dp0backend && call venv\Scripts\activate.bat && set DB_PATH=%DB_PATH% && python3 main.py"

timeout /t 2 /nobreak >nul

set "NEXT_PUBLIC_API_URL=%API_URL%"
start "StockMind Frontend" cmd /k "cd /d %~dp0frontend && set NEXT_PUBLIC_API_URL=%API_URL% && npm run dev -- --port %FRONTEND_PORT%"

echo.
echo 실행 중입니다.
pause
