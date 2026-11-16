"""수정사항을 한 번에 반영한다.

    python tools/publish.py                  버전 +1 → 웹 배포 → 설치파일 빌드 → 바탕화면 복사
    python tools/publish.py --no-bump        버전을 올리지 않고 같은 버전으로 배포/빌드
    python tools/publish.py --web-only       웹(Cloudflare)만 배포, 설치파일은 만들지 않음
    python tools/publish.py --rebuild-data "엑셀폴더"   엑셀이 바뀌었을 때 data.js 를 먼저 다시 만든다

웹 배포는 npx wrangler(Cloudflare 로그인 필요)로 한다. 설치파일은 기존 build_installer.py 를 쓴다.
"""
import argparse
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

PROJECT = Path(__file__).resolve().parent.parent
APP = PROJECT / "app"
VERSION_JS = APP / "version.js"
SITE = Path(os.environ.get("LOCALAPPDATA", str(Path.home()))) / "WorkOrder" / "site"
SERVER = PROJECT / "tools" / "server"   # 저장 API(worker.js) 와 설정(wrangler.jsonc)


def read_version() -> str:
    m = re.search(r'APP_VERSION\s*=\s*"([^"]+)"', VERSION_JS.read_text(encoding="utf-8"))
    return m.group(1)


def bump_version() -> str:
    old = read_version()
    major, minor, patch = (int(x) for x in old.split("."))
    new = f"{major}.{minor}.{patch + 1}"
    text = VERSION_JS.read_text(encoding="utf-8").replace(f'"{old}"', f'"{new}"')
    VERSION_JS.write_text(text, encoding="utf-8")
    # 브라우저 캐시 무효화: 페이지의 css·js 주소(?v=번호)도 새 버전으로 맞춘다.
    # 이것을 빼먹으면 PC가 예전 코드(dept.js 등)를 계속 쓴다.
    for html in APP.glob("*.html"):
        src = html.read_text(encoding="utf-8")
        updated = re.sub(r'(\.(?:css|js))\?v=[0-9A-Za-z._-]+', lambda m: f"{m.group(1)}?v={new}", src)
        if updated != src:
            html.write_text(updated, encoding="utf-8")
    return new


def run(cmd, cwd=None):
    print(">", " ".join(map(str, cmd)))
    subprocess.run(cmd, cwd=cwd or PROJECT, check=True, shell=(os.name == "nt"))


def deploy_web() -> None:
    # 배포용 폴더를 매번 새로 만들어 app 파일만 올린다 (Wrangler 가 만드는 설정 파일이 프로젝트에 섞이지 않게)
    if SITE.exists():
        shutil.rmtree(SITE)
    shutil.copytree(APP, SITE)
    shutil.copy2(SERVER / "worker.js", SITE / "worker.js")
    shutil.copy2(SERVER / "wrangler.jsonc", SITE / "wrangler.jsonc")
    run(["npx", "-y", "wrangler@4", "deploy"], cwd=SITE)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--no-bump", action="store_true")
    parser.add_argument("--web-only", action="store_true")
    parser.add_argument("--rebuild-data", metavar="EXCEL_DIR")
    args = parser.parse_args()

    if args.rebuild_data:
        run([sys.executable, "tools/build_data.py", args.rebuild_data])

    version = read_version() if args.no_bump else bump_version()
    print("배포 버전:", version)

    deploy_web()
    print("웹 배포 완료: https://workorder.workorder-site.workers.dev")

    if not args.web_only:
        run([sys.executable, "tools/build_installer.py"])


if __name__ == "__main__":
    main()
