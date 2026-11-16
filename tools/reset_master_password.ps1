# 마스터 비밀번호 재설정 (PowerShell 에서 실행)
#  1) 새 비밀번호를 Worker secret 에 저장한다 (입력 칸이 나오면 새 비밀번호를 입력)
#  2) 웹에서 바꾼 비밀번호 기록(master_auth)을 지워서 위 새 비밀번호가 바로 적용되게 한다
# 사용법: powershell -ExecutionPolicy Bypass -File tools\reset_master_password.ps1

$site = Join-Path $env:LOCALAPPDATA "WorkOrder\site"
if (-not (Test-Path (Join-Path $site "wrangler.jsonc"))) {
    Write-Host "배포 폴더를 찾지 못했습니다: $site" -ForegroundColor Red
    exit 1
}
Set-Location $site

Write-Host "[1/2] 새 마스터 비밀번호를 입력하세요 (화면에 글자가 보이지 않는 것이 정상입니다)" -ForegroundColor Cyan
npx -y wrangler@4 secret put WORKORDER_PASSWORD
if ($LASTEXITCODE -ne 0) { Write-Host "비밀번호 저장에 실패했습니다." -ForegroundColor Red; exit 1 }

Write-Host "[2/2] 웹에서 바꾼 비밀번호 기록을 지웁니다" -ForegroundColor Cyan
npx -y wrangler@4 d1 execute workorder --remote --command "DELETE FROM master_auth WHERE id = 1"
if ($LASTEXITCODE -ne 0) { Write-Host "기록 지우기에 실패했습니다." -ForegroundColor Red; exit 1 }

Write-Host "완료: 아이디 master 와 새 비밀번호로 로그인하세요." -ForegroundColor Green
