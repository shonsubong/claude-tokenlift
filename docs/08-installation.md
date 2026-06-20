# 08. 설치 / 설정

## 8.1 사전 요구사항

| 항목 | 버전 | 확인 |
|---|---|---|
| Node.js | 18+ | `node --version` |
| Ollama | 0.6+ | `ollama --version` |
| 코드 모델 | 1개+ | `ollama list` |

### Ollama 준비
```bash
# 서버 실행(데스크톱 앱이면 자동 실행됨)
ollama serve

# 주력 코드 모델 설치(최소 1개)
ollama pull qwen2.5-coder:14b
# 선택: 추가 모델
ollama pull devstral:24b
ollama pull deepcoder
```

## 8.2 자동 설치 (권장)

저장소 루트(`TokenLift/`)에서:

### Windows (PowerShell)
```powershell
./scripts/install.ps1
```

### macOS / Linux
```bash
bash scripts/install.sh
```

설치 스크립트가 수행하는 일:
1. `npm link` 로 `tokenlift` 전역 명령 등록(가능 시).
2. 스킬을 `~/.claude/skills/tokenlift/` 로 복사.
3. 서브에이전트를 `~/.claude/agents/ollama-delegate.md` 로 복사.
4. `tokenlift doctor` 로 환경 점검.
5. (안내) 자동 감지 훅 등록 방법 출력.

> 스크립트는 기존 파일을 덮어쓰기 전 `~/.claude/.tokenlift-backup/` 에 백업을 남긴다.
> (백업을 `skills/` 안에 두면 그 안의 `SKILL.md` 때문에 중복 스킬로 인식되므로 스캔 범위 밖에 둔다.)

## 8.3 수동 설치

### (1) CLI 전역 명령
```bash
cd TokenLift
npm link          # 또는: npm install -g .
tokenlift doctor
```
`npm link` 가 막히면 직접 실행 경로를 사용한다:
```bash
node "<설치경로>/TokenLift/bin/tokenlift.mjs" doctor
# 편의를 위해 TOKENLIFT_HOME 환경변수 설정 권장
```

### (2) Claude Code 스킬 배포
스킬 폴더를 사용자 스킬 디렉토리로 복사:
```
복사:  TokenLift/skills/tokenlift/   →   ~/.claude/skills/tokenlift/
```
- Windows: `C:\Users\<이름>\.claude\skills\tokenlift\`
- macOS/Linux: `~/.claude/skills/tokenlift/`

`SKILL.md` 와 `reference/` 가 함께 있어야 한다.

### (3) 서브에이전트 배포
```
복사:  TokenLift/agents/ollama-delegate.md   →   ~/.claude/agents/ollama-delegate.md
```

## 8.4 자동 감지 훅 등록 (선택)

프롬프트를 분석해 위임 힌트를 주입하는 훅이다. **선택 기능**이며 사용자 `settings.json` 을
수정한다.

`~/.claude/settings.json` (또는 프로젝트 `.claude/settings.json`)의 `hooks` 에 추가:

```jsonc
{
  "hooks": {
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node \"X:/Work_TokenLift/TokenLift/hooks/suggest-delegation.mjs\""
          }
        ]
      }
    ]
  }
}
```

> 경로는 실제 설치 경로로 바꿔라(Windows 는 `/` 또는 `\\`). 훅은 LLM 을 호출하지 않아 즉시
> 실행되며, 어떤 경우에도 프롬프트를 차단하지 않는다(실패 시 조용히 통과).

훅이 과하다고 느끼면 등록하지 않아도 된다 — 스킬만으로 위임은 충분히 동작한다.

## 8.5 개인 설정 (선택)

팀 기본값을 개인적으로 덮어쓰려면 `~/.tokenlift/config.json` 생성:

```jsonc
{
  "ollama": { "host": "http://내부-ollama:11434" },
  "routing": { "byTask": { "gen": "devstral:24b" } },
  "pricing": { "label": "opus", "inputPer1M": 15, "outputPer1M": 75 }
}
```

지정한 키만 병합되며 나머지는 팀 기본값이 유지된다.

## 8.6 사내(원격) Ollama 사용

로컬이 아닌 사내 GPU 서버의 Ollama 를 쓰려면:
```bash
export OLLAMA_HOST=http://ollama.internal:11434   # bash
$env:OLLAMA_HOST="http://ollama.internal:11434"   # PowerShell
# 또는 호출마다: tokenlift gen "..." --host http://ollama.internal:11434
# 또는 config 의 ollama.host 수정
```

## 8.7 설치 검증

```bash
tokenlift doctor    # Node/설정/Ollama 연결/필수 모델 모두 ✅ 여야 함
tokenlift models    # 라우팅 매핑이 설치 모델과 일치하는지
tokenlift gen "hello world 출력 함수" --lang python   # 실제 생성 1회
```

Claude Code 쪽 검증: 새 세션에서 "이 파일 테스트를 Ollama로 작성해줘" 요청 시
`tokenlift` 스킬이 발동하면 정상.

## 8.8 제거

```bash
npm uninstall -g tokenlift           # 전역 명령 제거(또는 npm unlink)
rm -rf ~/.claude/skills/tokenlift    # 스킬 제거
rm ~/.claude/agents/ollama-delegate.md
# settings.json 에서 훅 항목 제거(등록했다면)
rm -rf ~/.tokenlift                  # 로그/개인설정 제거(원하면)
```
