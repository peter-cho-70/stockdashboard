#!/bin/bash
# doc/ + README.md 를 peter-cho-70/stockdashboard-docs (GitHub Pages, 독립 저장소)로 발행.
# 개인 문서 허브(peter-cho-70.github.io)는 이 저장소로 연결되는 카드 하나만 갖고 있고,
# 이 스크립트에서는 건드리지 않는다.
set -e

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
DOCS_REPO="peter-cho-70/stockdashboard-docs"
WORKDIR="$PROJECT_DIR/.docs-site"

cd "$PROJECT_DIR"

if [ ! -d "$WORKDIR/.git" ]; then
  echo "-> $DOCS_REPO 클론 중..."
  gh repo clone "$DOCS_REPO" "$WORKDIR" -- -q
  git -C "$WORKDIR" config user.name "조충남"
  git -C "$WORKDIR" config user.email "274662803+peter-cho-70@users.noreply.github.com"
else
  echo "-> 기존 클론 갱신 중..."
  git -C "$WORKDIR" fetch -q origin main
  git -C "$WORKDIR" reset -q --hard origin/main
fi

echo "-> doc/ + README.md 동기화..."
rsync -a --delete --exclude ".DS_Store" doc/ "$WORKDIR/doc/"
cp README.md "$WORKDIR/README.md"

echo "-> 앱 내 참고자료(frontend/public/docs) 동기화..."
rsync -a --delete --exclude ".DS_Store" doc/ frontend/public/docs/

if [ ! -f "$WORKDIR/index.html" ]; then
  cat > "$WORKDIR/index.html" <<'HTML'
<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta http-equiv="refresh" content="0; url=doc/index.html">
<title>StockMind 문서 모음</title>
</head>
<body>
<p><a href="doc/index.html">문서 모음으로 이동</a></p>
</body>
</html>
HTML
fi

echo "-> 개인정보/사설 IP 마스킹 확인..."
python3 - "$WORKDIR/doc" "$WORKDIR/README.md" <<'PYEOF'
import re, sys, pathlib
TARGET_EXT = {".md", ".html", ".htm", ".js", ".json", ".txt"}
IP_RE = re.compile(
    r'\b(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}'
    r'|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}'
    r'|192\.168\.\d{1,3}\.\d{1,3})\b'
)
roots = [pathlib.Path(p) for p in sys.argv[1:]]
files = []
for r in roots:
    if r.is_file():
        files.append(r)
    elif r.is_dir():
        files.extend(p for p in r.rglob("*") if p.is_file() and p.suffix.lower() in TARGET_EXT)
found = False
for f in sorted(set(files)):
    text = f.read_text(encoding="utf-8", errors="ignore")
    if IP_RE.search(text):
        found = True
        print(f"   경고: {f} 에 사설 IP로 보이는 문자열이 있습니다 — 직접 확인하세요.")
if not found:
    print("   내부 IP 없음")
PYEOF

cd "$WORKDIR"
git add -A
if git diff --cached --quiet; then
  echo "-> 변경 사항 없음, 발행 생략"
  exit 0
fi

git commit -q -m "Update StockMind docs $(date +%Y-%m-%d)"
git push -q origin main

echo ""
echo "완료: https://peter-cho-70.github.io/stockdashboard-docs/"
