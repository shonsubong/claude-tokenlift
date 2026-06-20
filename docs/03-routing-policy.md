# 03. 라우팅 정책

"무엇을 Ollama로 보내고, 무엇을 Claude가 직접 할 것인가"의 기준 문서.
(스킬 내부용 요약은 `skills/tokenlift/reference/routing-rules.md` 에도 있다.)

## 3.1 3단계 판단 알고리즘

```
입력: 작업 설명
1) Claude 유지 신호 포함?  ── yes ──►  Claude 직접 처리
        │ no
2) 위임 신호 + 임계값 초과? ── yes ──►  Ollama 위임(task/model 결정)
        │ no
3) (애매)                            ►  기본 Claude (안전 우선)
```

이 로직은 `src/router.mjs` 의 `recommend()` 로 구현되어 있고, `tokenlift route "<설명>"`
명령으로 직접 확인할 수 있다.

## 3.2 Claude 유지 신호 (위임 금지)

다음 키워드/의도가 보이면 **무조건 Claude**:

`아키텍처 / architecture / 설계 / design / 전략 / 보안 / security / 취약점 / 인증 /
복잡한 디버깅 / root cause / 근본 원인 / 왜(why) / 트레이드오프 / 의사결정 / 마이그레이션 계획 /
전체 시스템(system-wide)`

이유: 고난도 추론·광범위 영향·정확성/위험이 핵심이라 로컬 모델 품질로는 부족하고,
실수 시 비용이 크다.

## 3.3 Ollama 위임 신호 (task 분류)

| task | 트리거 키워드(일부) |
|---|---|
| `test` | 테스트, unit test, 테스트 코드 작성 |
| `translate` | 이식, 포팅, port, 변환, convert to |
| `refactor` | 리팩터, refactor, 이름 변경, rename, 일괄, bulk |
| `review` | 리뷰, review, 검토 |
| `docs` | 문서, docstring, 주석, comment |
| `explain` | 요약, summarize, 설명, explain, what does |
| `gen` | 생성, 작성, 구현, implement, 스캐폴드, boilerplate |
| `edit` | 수정, 변경, 추가, edit, change |

> 분류 순서가 중요하다. 구체적 태스크(test/translate/...)를 범용(gen/edit)보다 **먼저**
> 검사한다. 그래야 "테스트 코드 작성"이 `gen` 이 아닌 `test` 로 분류된다.

## 3.4 위임 임계값

사소한 작업까지 위임하면 왕복 지연이 절감보다 커진다. 다음 이상일 때 위임을 권장한다
(`config.thresholds`):

| 항목 | 기본값 | 의미 |
|---|---|---|
| `delegateMinOutputLines` | 30 | 생성 코드가 30줄 이상 예상 |
| `delegateMinFileLines` | 300 | 처리 대상 파일이 300줄 이상 |
| `delegateMinFiles` | 3 | 동일 패턴이 3개 파일 이상 |

이 값은 휴리스틱이며 `tokenlift route` 자동 판단에는 반영되지 않는 "Claude 용 가이드"다.
Claude 는 SKILL.md 의 이 기준을 보고 사람처럼 판단한다.

## 3.5 결정 매트릭스 (요약)

| 작업 | 주체 | 명령 |
|---|---|---|
| 명세 명확한 구현체/보일러플레이트 | Ollama | `gen` |
| 단위 테스트 | Ollama | `test` |
| 일괄 리팩터링 | Ollama | `refactor` |
| 언어/프레임워크 이식 | Ollama | `translate` |
| 대용량 파일/로그 요약 | Ollama | `explain` |
| 문서/주석 | Ollama | `docs` |
| 시스템/ API 설계 | Claude | — |
| 복잡 디버깅·근본원인 | Claude | — |
| 보안/인증/결제 로직 | Claude | — |
| 모호한 요구·트레이드오프 | Claude | — |
| **위임 결과 검토·통합** | Claude | — |

## 3.6 하이브리드 워크플로우 (현실 패턴)

대부분 작업은 한쪽으로 딱 떨어지지 않는다. **설계=Claude → 생산=Ollama → 검토=Claude**
로 쪼갠다.

```
"결제 알림 모듈 만들어줘"
 ├─ Claude : 인터페이스·에러전략·보안요건 설계        (고난도, 짧은 출력)
 ├─ Ollama : 채널 구현체 3종 생성  tokenlift gen ...   (대량 출력 → 위임)
 ├─ Ollama : 각 구현체 테스트 생성  tokenlift test ...  (대량 출력 → 위임)
 └─ Claude : 보안 점검·통합·최종 검토                  (책임)
```

## 3.7 안전장치

- **기본값은 Claude.** 위임 신호가 불명확하면 위임하지 않는다.
- **보안 민감 코드**는 위임하더라도 Claude 재검토를 필수로 한다(SKILL.md 강제).
- **Ollama 장애 시** 작업이 막히지 않도록 Claude 가 직접 처리로 전환한다.
- 자동 감지 훅은 **힌트만 주입**하며 실제 실행을 강제하지 않는다(Claude 가 최종 판단).

## 3.8 라우팅 커스터마이즈

`config/tokenlift.config.json`(팀) 또는 `~/.tokenlift/config.json`(개인)에서:

```jsonc
{
  "routing": {
    "default": "qwen2.5-coder:14b",
    "byTask": { "test": "deepcoder:latest", "gen": "devstral:24b" }
  },
  "thresholds": { "delegateMinOutputLines": 20 }
}
```

자세한 모델 선택은 [04. 모델 가이드](04-model-guide.md) 참조.
