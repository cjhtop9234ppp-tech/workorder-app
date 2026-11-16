@echo off
chcp 65001 >nul
cd /d "%~dp0"

rem 1) 이 PC에서 웹 서버 실행 (127.0.0.1 에만 열림, 비밀번호 입력 창이 뜸)
start "작업지시서 웹서버" python web_server.py --host 127.0.0.1 --port 8790

rem 2) Cloudflare 터널로 외부 주소 발급 (창에 표시되는 https://...trycloudflare.com 주소로 접속)
echo.
echo 아래에 나오는 https://...trycloudflare.com 주소를 휴대폰이나 다른 PC에서 여세요.
echo 이 창을 닫으면 외부 접속이 끊깁니다.
echo.
"C:\Program Files (x86)\cloudflared\cloudflared.exe" tunnel --url http://127.0.0.1:8790
pause
