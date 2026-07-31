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

echo "-> doc/index.html의 문서별 data-date를 실제 git 커밋일로 갱신(New 배지·정렬 기준)..."
# GitHub Pages의 HTTP Last-Modified는 "그 파일이 실제로 언제 바뀌었는지"가 아니라 "사이트가
# 마지막으로 언제 배포됐는지"만 반영한다(mars-master-docs에서 실측 확인) — 그래서 각 문서
# 링크가 가리키는 "원본 소스 파일"의 실제 git 커밋일을 이 저장소($PROJECT_DIR)에서 직접 읽어
# 매번 다시 채워 넣는다. data-date는 하드코딩이 아니라 이 발행 스크립트가 매번 실측해서 다시
# 쓰는 값이다.
python3 - "$PROJECT_DIR" "$WORKDIR/doc/index.html" <<'PYEOF'
import re, subprocess, sys, os

project_dir, index_path = sys.argv[1], sys.argv[2]

def resolve(href):
    m = re.match(r'viewer\.html\?file=(.+)', href)
    target = m.group(1) if m else href
    return os.path.normpath(os.path.join('doc', target))

def git_date(rel_path):
    full = os.path.join(project_dir, rel_path)
    if not os.path.exists(full):
        return None
    try:
        # 초 단위까지 남는 ISO datetime(%aI) — 같은 날 한꺼번에 커밋된 문서들이 day 단위
        # 비교에서는 전부 동률로 묶여 "최신 문서순" 버튼을 눌러도 순서가 안 바뀌는 것처럼
        # 보이는 문제가 실제로 있었다(2026-07-19 신고). doc/index.html의 parseDate()가
        # ISO datetime 문자열도 그대로 파싱하도록 같이 맞춰져 있다.
        out = subprocess.run(['git', 'log', '-1', '--format=%aI', '--', rel_path],
                              capture_output=True, text=True, check=True, cwd=project_dir).stdout.strip()
        return out or None
    except subprocess.CalledProcessError:
        return None

with open(index_path, encoding='utf-8') as f:
    html = f.read()

def repl(m):
    href = m.group(1)
    date = git_date(resolve(href)) or ''
    rest = m.group(2)
    if 'data-date=' in rest:
        rest = re.sub(r'data-date="[^"]*"', f'data-date="{date}"', rest)
    else:
        rest = f'data-date="{date}" ' + rest
    return f'<a class="doc" href="{href}" {rest}'

new_html = re.sub(r'<a class="doc" href="([^"]+)"\s+([^>]*data-tags="[^"]*")', repl, html)
changed = sum(1 for a, b in zip(re.findall(r'data-date="[^"]*"', html), re.findall(r'data-date="[^"]*"', new_html)) if a != b)
with open(index_path, 'w', encoding='utf-8') as f:
    f.write(new_html)
print(f'   data-date 갱신 완료 ({len(re.findall(r"data-date=", new_html))}개 문서, {changed}개 값 변경)')
PYEOF

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
