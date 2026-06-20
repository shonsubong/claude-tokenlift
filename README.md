# TokenLift

> Claude Code(Bedrock)의 고비용 토큰 작업을 **로컬 Ollama / 온프렘 NVIDIA NemoClaw(NIM)**
> 등 코드 특화 LLM으로 위임해 Bedrock 토큰 비용을 절감하는 브리지 CLI + Claude Code 스킬.

복잡한 설계·아키텍처·보안 판단은 Claude가 그대로 처리하고, **출력이 길거나 컨텍스트가 큰
기계적 코딩 작업**(코드 생성, 테스트 작성, 일괄 리팩터링, 언어 이식, 대용량 파일 요약)은
로컬 Ollama 또는 사내 온프렘 백엔드로 자동·수동 위임한다.

```
사용자 요청
   │
   ├─ 고난도 판단(설계/보안/디버깅)  ───────────►  Claude (Bedrock)   ← 비싸지만 똑똑함
   │
   └─ 대량/반복 코딩 작업            ──tokenlift──►  Provider           ← 무료/온프렘, 코드 특화
                                                  ├─ ollama (로컬)
                                                  └─ nemoclaw (NIM, OpenAI 호환)
                                                     │
                                          결과 검토·통합은 Claude가 책임
```

백엔드는 **provider 추상화**로 분리되어 `--provider ollama|nemoclaw` 로 전환·병행한다.
→ [11. 백엔드 확장](docs/11-providers.md)

## 왜 절감되는가

Bedrock 과금에서 **출력 토큰이 입력보다 약 5배 비싸다.** TokenLift는 두 가지로 비용을 옮긴다.

1. **생성 위임(출력 절감)** — 길게 생성되는 코드를 Ollama가 만들고, Claude는 짧게 검토만 한다.
2. **컨텍스트 위임(입력 절감)** — 대용량 파일을 Ollama가 로컬에서 읽고 요약해, Claude는 요약만 받는다.

## 빠른 시작

```bash
# 0) 전제: Ollama 실행 + 코드 모델 설치
ollama serve
ollama pull qwen2.5-coder:14b

# 1) CLI 설치(글로벌 명령 등록)
cd TokenLift && npm link

# 2) 환경 점검
tokenlift doctor

# 3) 위임 실행
tokenlift gen "Express 에러 핸들링 미들웨어" --lang ts
tokenlift test -f src/service.py -o tests/test_service.py
tokenlift explain -f huge_module.ts "핵심 데이터 흐름만"

# 4) 누적 절감 확인
tokenlift stats

# (선택) 온프렘 NemoClaw/NIM 으로 위임
export NEMOCLAW_API_KEY=...                 # 인증이 필요하면
tokenlift gen "..." --provider nemoclaw     # providers.nemoclaw.host 를 사내 주소로 설정
```

Claude Code 스킬/서브에이전트 설치는 [설치 가이드](docs/08-installation.md) 참조:

```bash
# Windows PowerShell
./scripts/install.ps1
# macOS/Linux
bash scripts/install.sh
```

설치 후 Claude Code 에서 "토큰 아끼게 이 테스트 Ollama로 작성해줘" 처럼 요청하면
`tokenlift` 스킬이 자동 발동한다.

## 구성 요소

| 구성 | 위치 | 역할 |
|---|---|---|
| 브리지 CLI | `bin/`, `src/` | 백엔드에 코딩 작업 위임, 절감 로깅 |
| **Provider 어댑터** | `src/providers/` | ollama / openai-compat(NemoClaw·NIM 등) 백엔드 추상화 |
| Claude Code 스킬 | `skills/tokenlift/` | 언제/어떻게 위임할지 Claude 에게 지시 |
| 서브에이전트 | `agents/ollama-delegate.md` | 위임 작업을 격리 실행 |
| 자동 감지 훅 | `hooks/suggest-delegation.mjs` | 프롬프트 분석 후 위임 힌트 주입(선택) |
| 설정 | `config/tokenlift.config.json` | 백엔드·모델 매핑·단가·임계값 |

## 문서

| # | 문서 | 내용 |
|---|---|---|
| 01 | [개요](docs/01-overview.md) | 문제정의·목표·절감 원리 |
| 02 | [아키텍처](docs/02-architecture.md) | 컴포넌트·데이터 흐름·설계 결정 |
| 03 | [라우팅 정책](docs/03-routing-policy.md) | 위임/유지 판단 기준 |
| 04 | [모델 가이드](docs/04-model-guide.md) | 작업별 로컬 모델 선택 |
| 05 | [구현 상세](docs/05-implementation.md) | 모듈·설정 스키마·입출력 계약 |
| 06 | [사용 방법](docs/06-usage.md) | 워크플로우·시나리오 예시 |
| 07 | [비용 분석](docs/07-cost-analysis.md) | 절감 계산·예시·한계 |
| 08 | [설치/설정](docs/08-installation.md) | CLI·스킬·에이전트·훅 설치 |
| 09 | [트러블슈팅](docs/09-troubleshooting.md) | 자주 겪는 문제 |
| 10 | [FAQ](docs/10-faq.md) | 자주 묻는 질문 |
| 11 | [백엔드 확장](docs/11-providers.md) | Ollama / NemoClaw(NIM) provider 설정 |

## 요구사항

- **Node.js 18+** (내장 `fetch` 사용, 외부 의존성 없음)
- 백엔드 **하나 이상**:
  - **Ollama 0.6+** (로컬/사내) + 코드 모델 (예: `qwen2.5-coder:14b`, `devstral:24b`)
  - 또는 **OpenAI 호환 온프렘 서버**(NVIDIA NemoClaw/NIM, vLLM, TGI 등)

## 한계 (정직한 고지)

- 로컬 모델은 Claude보다 약하다. **위임 결과는 항상 Claude가 검토**해야 한다.
- 절감액은 **추정치**다(로컬 처리 토큰을 Bedrock 단가로 환산한 gross 값). 실제 절감은
  작업 성격·검토 비용에 따라 달라진다. → [비용 분석](docs/07-cost-analysis.md)
- 사소한 작업은 위임 왕복 지연이 절감보다 클 수 있다.

## 라이선스

MIT
