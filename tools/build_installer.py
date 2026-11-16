"""작업지시서 빌드: 실행파일(PyInstaller) → 설치파일(Inno Setup) → 바탕화면 복사.

사용법:  python tools/build_installer.py
버전은 app/version.js 의 APP_VERSION 한 곳에서만 읽는다.
"""
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

PROJECT = Path(__file__).resolve().parent.parent
ISCC_CANDIDATES = [
    Path(os.environ.get("LOCALAPPDATA", "")) / "Programs" / "Inno Setup 6" / "ISCC.exe",
    Path(r"C:\Program Files (x86)\Inno Setup 6\ISCC.exe"),
]


def read_version() -> str:
    text = (PROJECT / "app" / "version.js").read_text(encoding="utf-8")
    m = re.search(r'APP_VERSION\s*=\s*"([^"]+)"', text)
    if not m:
        raise SystemExit("app/version.js 에서 APP_VERSION 을 찾지 못했습니다.")
    return m.group(1)


def run(cmd):
    print(">", " ".join(map(str, cmd)))
    subprocess.run(cmd, cwd=PROJECT, check=True)


def main() -> None:
    version = read_version()
    print("빌드 버전:", version)

    run([sys.executable, "-m", "PyInstaller", "--noconfirm", "--clean", "--onefile", "--noconsole",
         "--name", "WorkOrder", "launcher/main.py"])

    iscc = next((p for p in ISCC_CANDIDATES if p.exists()), None)
    if iscc is None:
        raise SystemExit("Inno Setup(ISCC.exe)이 없습니다. 설치 후 다시 실행하세요.")
    run([str(iscc), f"/DMyAppVersion={version}", "installer.iss"])

    setup = PROJECT / "installer_output" / f"WorkOrder_Setup_{version}.exe"
    desktop = Path(os.path.expanduser("~")) / "Desktop" / setup.name
    shutil.copy2(setup, desktop)
    print("설치파일:", setup)
    print("바탕화면 복사:", desktop)


if __name__ == "__main__":
    main()
