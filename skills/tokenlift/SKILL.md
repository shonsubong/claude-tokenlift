---
name: tokenlift
description: >-
  Claude Code(Bedrock)의 토큰 비용을 줄이기 위해, 토큰을 많이 쓰는 코딩 작업을 로컬 Ollama
  코드 특화 LLM으로 위임한다. 대량 코드 생성·단위테스트 작성·일괄 리팩터링·언어 이식·대용량
  파일 요약/설명처럼 출력이 길거나 컨텍스트가 큰 기계적 작업에 사용한다. 아키텍처·설계·복잡한
  디버깅·보안 판단 등 고난도 추론은 Claude가 직접 처리한다. "토큰 아끼기", "Ollama로 돌려",
  "로컬 모델로", "비용 절감" 요청 시에도 사용.
---

# TokenLift — 로컬 Ollama 위임으로 Bedrock 토큰 절감

## 핵심 원리 (왜 토큰이 절감되는가)

Bedrock 과금에서 **출력 토큰이 입력보다 약 5배 비싸다**. TokenLift는 비싼 토큰 소비를
로컬 Ollama(무료/온프레미스)로 옮긴다.

1. **생성 위임 (출력 절감)** — 길게 생성되는 코드(보일러플레이트, 테스트, 리팩터링 결과)를
   Ollama가 생성. Claude는 짧은 결과만 읽고 검토 → 비싼 **출력 토큰**을 아낌.
2. **컨텍스트 위임 (입력 절감)** — 대용량 파일/로그를 Ollama가 로컬에서 읽고 요약. Claude는
   원문 대신 짧은 요약만 받음 → 비싼 **입력 토큰**을 아낌.

Claude의 역할은 **오케스트레이션 + 검토**로 축소된다. 생성의 무거운 부분은 로컬에서 처리된다.

## 위임 판단 규칙 (가장 중요)

| 작업 성격 | 처리 주체 | 이유 |
|---|---|---|
| 명세가 명확한 코드 생성, 보일러플레이트, 스캐폴딩 | **Ollama** | 출력 多, 판단 少 |
| 단위 테스트 생성 | **Ollama** | 반복적·패턴적 |
| 일괄 리팩터링(이름변경, 패턴치환, 함수분리) | **Ollama** | 기계적·대량 |
| 언어/프레임워크 이식(translate) | **Ollama** | 규칙 기반 변환 |
| 대용량 파일/로그 요약·설명 | **Ollama** | 입력 컨텍스트 절감 |
| docstring/주석/문서 초안 | **Ollama** | 정형적 생성 |
| **아키텍처·시스템 설계, API/인터페이스 설계** | **Claude** | 고난도 판단 |
| **복잡한 디버깅(근본원인 추적), 전체시스템 영향 분석** | **Claude** | 깊은 추론 |
| **보안 민감 로직, 인증/권한, 취약점 판단** | **Claude** | 위험·정확성 |
| **요구사항 모호, 트레이드오프 의사결정** | **Claude** | 맥락·책임 |
| **Ollama 산출물의 최종 검토·통합** | **Claude** | 품질 게이트 |

판단이 애매하면 `tokenlift route "<작업 설명>"` 으로 추천을 받거나, 기본적으로 Claude가 처리한다.

휴리스틱 임계값(이 이상이면 위임 고려): 생성 코드 30줄+, 처리 파일 300줄+, 동일 패턴 3파일+.

## 표준 작업 절차

1. **감지** — 사용자 요청 중 위 표의 "Ollama" 행에 해당하는 무거운 부분을 식별한다.
2. **위임** — 해당 부분만 잘라 `tokenlift <task>` 로 로컬 실행한다(아래 명령 참조).
   직접 코드를 길게 생성하지 말 것 — 그게 토큰 절감의 핵심이다.
3. **검토** — 로컬 모델은 Claude보다 약하다. 반환된 코드를 **반드시 검토**한다:
   요구사항 충족 여부, 명백한 버그, 스타일 일치, 보안 문제. 필요한 부분만 Claude가 보정한다.
4. **통합** — 검증된 결과를 파일에 반영한다(`-o`/`--apply` 로 Ollama가 직접 쓰게 하거나,
   stdout 을 받아 Claude가 Edit 으로 반영).
5. **보고** — 무엇을 위임했고 어떤 검토를 했는지 간단히 알린다. `tokenlift stats` 로 누적 절감 확인.

## CLI 빠른 참조

> 전제: `tokenlift` 가 PATH에 있어야 한다(`npm link` 설치 시). 없으면
> `node "<설치경로>/bin/tokenlift.mjs"` 로 호출한다. 설치는 `reference/cli-reference.md` 참조.

```bash
# 코드 생성 (stdout = 코드)
tokenlift gen "Express 에러 핸들링 미들웨어" --lang ts

# 파일 수정 후 그 파일에 덮어쓰기
tokenlift edit "모든 함수에 입력 검증 추가" -f src/api.js --apply

# 단위 테스트 생성 → 파일로 저장
tokenlift test -f src/service.py -o tests/test_service.py

# 일괄 리팩터링 (동작 보존)
tokenlift refactor "거대 함수를 작은 함수로 분리" -f big.js --apply

# 언어 이식
tokenlift translate -f util.py --lang python --to go -o util.go

# 대용량 파일 요약 (입력 토큰 절감)
tokenlift explain -f huge_module.ts "핵심 데이터 흐름만"

# 라우팅 추천 (위임할지/모델 무엇)
tokenlift route "결제 모듈 단위테스트 작성"

# 백엔드 선택 (로컬 Ollama 기본 / 온프렘 NemoClaw·NIM)
tokenlift gen "..." --provider nemoclaw   # OpenAI 호환 온프렘으로 위임
tokenlift providers  # 설정된 백엔드 목록/활성 확인

# 운영
tokenlift models     # (활성 provider) 모델 + 라우팅 매핑
tokenlift doctor     # 환경 점검 (--provider 로 특정 백엔드 점검)
tokenlift warmup -m qwen2.5-coder:14b   # 모델 선적재(연속 위임 전 권장)
tokenlift stats      # 누적 절감 통계(백엔드별 집계)
```

**백엔드(provider):** 기본은 로컬 `ollama`. 사내 온프렘 `nemoclaw`(NVIDIA NemoClaw/NIM,
OpenAI 호환)로 위임하려면 `--provider nemoclaw`. 어느 백엔드든 stdout=결과물 계약은 동일하다.
설정/모델명은 `reference/cli-reference.md` 와 `docs/11-providers.md` 참조.

자세한 플래그/모델 매핑/예시는 같은 폴더의 참고 문서를 읽어라:
- `reference/cli-reference.md` — 전체 명령·플래그·백엔드·설치
- `reference/routing-rules.md` — 위임 판단 상세 규칙과 예시

## 검토 원칙 (필수)

- 로컬 모델 산출물을 **그대로 신뢰하지 말 것.** 항상 Claude가 정확성을 책임진다.
- 보안·인증·결제·데이터 무결성 관련 코드는 위임하더라도 **Claude가 반드시 재검토**한다.
- 위임 결과가 요구와 다르면, 재위임(프롬프트 보강)하거나 Claude가 직접 마무리한다.
- 연속으로 여러 번 위임할 땐 먼저 `tokenlift warmup` 으로 모델을 적재해 지연을 줄인다.

## 운영 팁

- 같은 모델을 연속 사용하면 빠르다(모델 교체 시 재적재 비용 발생). 한 세션에선 가능한
  하나의 코드 모델(`qwen2.5-coder:14b`)로 묶어 위임한다.
- 백엔드가 꺼져 있으면 `tokenlift doctor` 가 알려준다. 그 경우 Claude가 직접 처리하거나
  사용자에게 백엔드 기동(`ollama serve` 또는 사내 NIM 확인)을 요청한다.
- 가벼운 작업은 로컬 `ollama`, 대형 모델이 필요한 작업은 사내 `nemoclaw` 로 나눠 위임할 수 있다.
