"""작업지시서 PC 실행기.

웹 주소(WEB_URL)를 Edge 앱 창(주소창 없는 독립 창)으로 연다.
로그인·저장·목록·설정은 서버를 거쳐야 하므로 파일이 아니라 웹 주소로 열어야 한다.
웹 주소를 열 수 없으면 설치 폴더의 web 폴더(오프라인 사본)를 연다.
창 제목은 웹 페이지 제목(작업지시서 vX.Y.Z)이 그대로 쓰인다.
Edge 가 없으면 기본 브라우저로 연다.
"""
import os
import subprocess
import sys
from pathlib import Path

WEB_URL = "https://workorder.workorder-site.workers.dev/"

EDGE_PATHS = [
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
]


def main() -> None:
    url = WEB_URL

    # 전용 프로필을 써야 기존 Edge 창에 탭으로 붙지 않고 독립 창으로 열린다.
    profile = Path(os.environ.get("LOCALAPPDATA", str(Path.home()))) / "WorkOrder" / "edge-profile"
    for edge in EDGE_PATHS:
        if os.path.exists(edge):
            subprocess.Popen([
                edge,
                f"--app={url}",
                f"--user-data-dir={profile}",
                "--window-size=1100,800",
            ])
            return
    os.startfile(url)  # Edge 가 없으면 기본 브라우저


if __name__ == "__main__":
    main()
