"""작업지시서 웹 버전 서버 (Flask).

app 폴더의 화면(index.html, data.js 등)을 비밀번호 로그인 뒤에서 제공한다.
휴대폰에서는 start_web_remote.bat 으로 띄운 외부 주소(https)로 접속한다.
(카메라 촬영은 https 에서만 안정적으로 동작하므로 외부 주소를 쓴다.)

    python web_server.py                    (이 PC에서만: http://127.0.0.1:8790)
    python web_server.py --host 0.0.0.0     (같은 네트워크 기기에서 접속)

비밀번호는 환경변수 WORKORDER_PASSWORD 로 주거나, 실행할 때 물어본다.
"""
import argparse
import getpass
import hmac
import os
import secrets
import sys
from datetime import timedelta
from functools import wraps
from pathlib import Path

from flask import Flask, abort, redirect, request, send_from_directory, session, url_for

APP_DIR = Path(__file__).resolve().parent / "app"
DATA_DIR = Path(os.environ.get("LOCALAPPDATA", str(Path.home()))) / "WorkOrder"
SECRET_FILE = DATA_DIR / "web_secret.key"

app = Flask(__name__)
app.config.update(SESSION_COOKIE_HTTPONLY=True, SESSION_COOKIE_SAMESITE="Lax",
                  PERMANENT_SESSION_LIFETIME=timedelta(days=30))


def _secret_key() -> str:
    """로그인 서명 키. 파일에 보관해서 서버를 다시 켜도 로그인이 유지되게 한다."""
    if SECRET_FILE.exists():
        return SECRET_FILE.read_text(encoding="utf-8").strip()
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    key = secrets.token_hex(32)
    SECRET_FILE.write_text(key, encoding="utf-8")
    return key


app.secret_key = _secret_key()
PASSWORD = ""


def _login_required(view):
    @wraps(view)
    def wrapper(*args, **kwargs):
        if not session.get("ok"):
            return redirect(url_for("login"))
        return view(*args, **kwargs)

    return wrapper


LOGIN_HTML = """<!doctype html><html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>작업지시서 v__VERSION__</title>
<style>
body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#F4F5F9;
font-family:"Malgun Gothic",sans-serif;color:#1F2937}
form{background:#fff;padding:28px;border-radius:14px;width:min(320px,88vw);box-shadow:0 4px 16px rgba(0,0,0,.06)}
h1{font-size:18px;margin:0 0 16px}
input{width:100%;box-sizing:border-box;padding:10px;border:1px solid #E5E7EB;border-radius:8px;font-size:15px}
button{margin-top:12px;width:100%;padding:10px;border:0;border-radius:8px;background:#4F6BED;color:#fff;
font-size:15px;font-weight:bold;cursor:pointer}
.err{color:#DC2626;font-size:13px;margin-top:8px}
</style></head><body>
<form method="post">
<h1>작업지시서 v__VERSION__</h1>
<input type="password" name="password" placeholder="비밀번호" autocomplete="current-password" autofocus required>
<button type="submit">들어가기</button>
__ERROR__
</form></body></html>"""


def _version() -> str:
    import re
    text = (APP_DIR / "version.js").read_text(encoding="utf-8")
    return re.search(r'APP_VERSION\s*=\s*"([^"]+)"', text).group(1)


@app.route("/login", methods=["GET", "POST"])
def login():
    error = ""
    if request.method == "POST":
        given = request.form.get("password", "")
        if hmac.compare_digest(given.encode("utf-8"), PASSWORD.encode("utf-8")):
            session.permanent = True
            session["ok"] = True
            return redirect(url_for("index"))
        error = '<div class="err">비밀번호가 맞지 않습니다.</div>'
    return LOGIN_HTML.replace("__VERSION__", _version()).replace("__ERROR__", error)


@app.route("/logout")
def logout():
    session.clear()
    return redirect(url_for("login"))


@app.route("/")
@_login_required
def index():
    return send_from_directory(APP_DIR, "index.html")


@app.route("/<path:name>")
@_login_required
def static_file(name):
    # app 폴더 밖 파일은 열지 않는다
    if name.startswith(".") or not (APP_DIR / name).is_file():
        abort(404)
    return send_from_directory(APP_DIR, name)


def main():
    global PASSWORD
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8790)
    args = parser.parse_args()

    PASSWORD = os.environ.get("WORKORDER_PASSWORD", "") or getpass.getpass("웹 접속 비밀번호: ")
    if not PASSWORD:
        sys.exit("비밀번호가 없으면 서버를 시작하지 않습니다.")
    app.run(host=args.host, port=args.port, debug=False)


if __name__ == "__main__":
    main()
