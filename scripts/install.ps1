# TokenLift 설치 스크립트 (Windows PowerShell)
# - tokenlift CLI 전역 등록(npm link, 실패 허용)
# - 스킬/서브에이전트를 ~/.claude 로 배포(기존 파일 백업)
# - 환경 점검 및 훅 등록 안내
$ErrorActionPreference = 'Stop'

$RepoRoot = Split-Path -Parent $PSScriptRoot
$ClaudeHome = Join-Path $HOME '.claude'
$SkillsDir = Join-Path $ClaudeHome 'skills'
$AgentsDir = Join-Path $ClaudeHome 'agents'
# 백업은 skills/agents 스캔 범위 "밖"에 둔다.
# (skills/ 안에 *.bak 디렉토리를 두면 그 안의 SKILL.md 때문에 중복 스킬로 인식됨)
$BackupDir = Join-Path $ClaudeHome '.tokenlift-backup'

Write-Host "== TokenLift 설치 ==" -ForegroundColor Cyan
Write-Host "저장소: $RepoRoot"

function Backup-IfExists($path, $name) {
  if (Test-Path $path) {
    New-Item -ItemType Directory -Force -Path $BackupDir | Out-Null
    $dest = Join-Path $BackupDir $name
    if (Test-Path $dest) { Remove-Item $dest -Recurse -Force }
    Copy-Item $path $dest -Recurse -Force
    Write-Host "  기존 항목 백업: $dest" -ForegroundColor Yellow
  }
}

# 1) 디렉토리 보장
New-Item -ItemType Directory -Force -Path $SkillsDir | Out-Null
New-Item -ItemType Directory -Force -Path $AgentsDir | Out-Null

# 2) 스킬 배포
$skillSrc = Join-Path $RepoRoot 'skills\tokenlift'
$skillDst = Join-Path $SkillsDir 'tokenlift'
Backup-IfExists $skillDst 'skills-tokenlift'
if (Test-Path $skillDst) { Remove-Item $skillDst -Recurse -Force }
Copy-Item $skillSrc $skillDst -Recurse -Force
Write-Host "  스킬 배포 완료 → $skillDst" -ForegroundColor Green

# 3) 서브에이전트 배포 (agents/*.md 전체)
Get-ChildItem (Join-Path $RepoRoot 'agents') -Filter '*.md' | ForEach-Object {
  $agentDst = Join-Path $AgentsDir $_.Name
  Backup-IfExists $agentDst $_.Name
  Copy-Item $_.FullName $agentDst -Force
  Write-Host "  서브에이전트 배포 완료 → $agentDst" -ForegroundColor Green
}

# 4) CLI 전역 등록
# 주의: 네이티브 명령(npm)은 try/catch 로 실패가 안 잡힌다. 반드시 $LASTEXITCODE 로 확인.
Write-Host "`n== tokenlift 전역 명령 등록 ==" -ForegroundColor Cyan
Push-Location $RepoRoot
npm link 2>&1 | Out-Host
$linkOk = ($LASTEXITCODE -eq 0)
Pop-Location

if ($linkOk) {
  Write-Host "  npm link 완료. 'tokenlift' 명령 사용 가능." -ForegroundColor Green
} else {
  Write-Host "  npm link 실패(저장소가 C: 외 드라이브면 전역 심볼릭 링크가 막힘). 셸 shim 으로 대체합니다." -ForegroundColor Yellow
  # npm 전역 prefix(보통 %AppData%\npm, 이미 PATH 에 포함)에 shim 직접 생성
  $npmPrefix = (& npm config get prefix 2>$null)
  if (-not $npmPrefix -or -not (Test-Path $npmPrefix)) { $npmPrefix = Join-Path $env:APPDATA 'npm' }
  New-Item -ItemType Directory -Force -Path $npmPrefix | Out-Null
  $entry = Join-Path $RepoRoot 'bin\tokenlift.mjs'
  $entryUnix = $entry -replace '\\','/'
  # cmd / PowerShell 용 shim
  $cmdShim = Join-Path $npmPrefix 'tokenlift.cmd'
  Set-Content -Path $cmdShim -Encoding ASCII -Value "@echo off`r`nnode `"$entry`" %*"
  # git-bash 용 shim
  $shShim = Join-Path $npmPrefix 'tokenlift'
  Set-Content -Path $shShim -Encoding ASCII -Value "#!/usr/bin/env bash`nexec node `"$entryUnix`" `"`$@`""
  Write-Host "  shim 생성 완료: $cmdShim" -ForegroundColor Green
  Write-Host "  ('$npmPrefix' 이 PATH 에 있으면 새 터미널에서 'tokenlift' 사용 가능)" -ForegroundColor Gray
  Write-Host "  PATH 미포함 시 직접 실행: node `"$entry`" <command>" -ForegroundColor Gray
}

# 5) 환경 점검
Write-Host "`n== 환경 점검(doctor) ==" -ForegroundColor Cyan
node (Join-Path $RepoRoot 'bin\tokenlift.mjs') doctor

# 6) 훅 등록 안내(선택)
$hookPath = (Join-Path $RepoRoot 'hooks\suggest-delegation.mjs') -replace '\\','/'
Write-Host "`n== (선택) 자동 감지 훅 등록 ==" -ForegroundColor Cyan
Write-Host "~/.claude/settings.json 의 hooks.UserPromptSubmit 에 추가:"
Write-Host @"
  {
    "hooks": {
      "UserPromptSubmit": [
        { "hooks": [ { "type": "command",
          "command": "node \"$hookPath\"" } ] }
      ]
    }
  }
"@ -ForegroundColor Gray

Write-Host "`n설치 완료." -ForegroundColor Green
