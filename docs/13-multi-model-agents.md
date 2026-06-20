# 13. 멀티모델 에이전트 라우팅 (오케스트레이터-워커 + 온프렘 H200/V100)

[oh-my-openagent](https://github.com/code-yeongyu/oh-my-openagent)(OmO)의 에이전트 협업
설계를 참고해, 사내 제약(Claude=Bedrock 전용, 온프렘 H200×8/V100×8 오픈모델, 비용 최소화)에
맞춘 멀티모델 라우팅 구조다.

## 13.1 OmO 에서 가져온 설계 원칙

OmO 는 **계층적 오케스트레이션**을 쓴다(요지):
- 리드 에이전트(Sisyphus, Opus)가 직접 다 하지 않고 **위임**하며 메인 컨텍스트를 린하게 유지.
- 탐색·전문 작업은 **더 싸고 빠른 모델에 병렬 위임**("dev team lead / AI manager").
- 막히면 고지능 모델로 **전략적 에스컬레이션**.
- 역할별 분담: Oracle(설계/디버깅), Frontend, Librarian(문서/탐색), Explore(초고속 탐색).

TokenLift 는 이 패턴을 **사내 가용 모델**로 매핑한다(클라우드 GPT/Gemini 대신 온프렘 오픈모델).

## 13.2 제약 → 백엔드 매핑

| 자원 | 성격 | TokenLift 역할 |
|---|---|---|
| **Claude (AWS Bedrock 전용)** | 외부, 최고 판단력, 가장 비쌈(토큰 과금) | **lead / reviewer** — 오케스트레이션·설계·보안·최종검토 |
| **H200 ×8** (≈1.1TB HBM3e, FP8/대형 MoE) | 온프렘, 프런티어 오픈모델 가능 | **oracle** — 어려운 추론·알고리즘·대형/멀티파일 생성 |
| **V100 ×8** (≈256GB@32GB, **FP16 전용**) | 온프렘, 중소 모델, 최저 한계비용 | **coder** — 보일러플레이트·테스트·리팩터·이식(대량) |
| **codebase-memory-mcp** | 로컬 그래프, 무료 | **explorer** — 코드 탐색/검색/영향분석 |

## 13.3 에이전트 팀 (역할표)

`tokenlift roles` 로 확인. 설정은 `config.roles`.

```
lead     → claude              [Bedrock·직접]   의도파악·계획·위임·통합
explorer → codebase-memory-mcp [그래프·MCP]      코드 탐색/검색/영향분석 (무료)
coder    → onprem-v100         [CLI 위임]        대량·정형 생성 (최저가 GPU)
oracle   → onprem-h200         [CLI 위임]        어려운 추론·대형 생성 (프런티어 오픈)
reviewer → claude              [Bedrock·직접]    보안·최종 검토·의사결정
```

## 13.4 비용 최소화 에스컬레이션 사다리

```
① codebase-memory-mcp (무료)  ─▶  ② onprem-v100 (coder)  ─▶  ③ onprem-h200 (oracle)  ─▶  ④ claude (Bedrock)
   탐색/이해                       대량·정형 생성              어려운 추론·대형 생성        판단·보안·최종검토
   가장 쌈 ───────────────────────────────────────────────────────────────────────▶ 가장 비쌈
```

원칙:
- **충분히 처리되는 가장 싼 단계에서 멈춘다.** 위로 올라갈수록 비싸다.
- 한 단계가 막히면(품질 부족·반복 실패) 다음 단계로 **승급**. Claude(Bedrock)는 **최후**.
- 비용 직관: 온프렘은 한계비용 ≈ 전기료(고정비 상각) → Bedrock 토큰 과금보다 훨씬 저렴.
  V100 은 H200 보다 노후/저가라 대량 작업의 단위비용이 더 낮다.
- `tokenlift route "<작업>"` 가 역할·백엔드·**비용 티어(1~4)**를 추천한다.

자동 판단(휴리스틱):
- 보안/설계/근본원인/트레이드오프 신호 → **claude**(직접).
- 대량/정형(test/gen/refactor/translate/docs) → **coder(V100)**.
- 난도 신호(알고리즘·대규모·성능·동시성·멀티파일) → **oracle(H200)** 로 승급.

## 13.5 모델 선택 — H200 vs V100 (예시, 배포에 맞게 교체)

> 모델명은 `config.providers.onprem-h200|onprem-v100 .routing` 의 **예시**다. 실제 배포된
> 모델 ID로 교체하라. `tokenlift models --provider onprem-h200` 로 서버 제공 목록 확인.

### H200 ×8 — oracle (FP8 / 대형 MoE)
1.1TB HBM3e 로 프런티어 오픈모델을 FP8 텐서패러럴 서빙.
- **DeepSeek-R1 / V3** (671B MoE) — 추론·에이전트형 코딩
- **Qwen3-Coder-480B-A35B**, **Qwen3-235B-A22B** — 강력한 코딩/일반
- **Kimi-K2**(대형 MoE), **Llama-3.1-405B** — 대안
- 서빙: vLLM / SGLang(FP8, tensor-parallel=8).

### V100 ×8 — coder (**FP16 전용**, bf16/FP8 미지원)
Volta 세대라 bf16·FP8·FlashAttention-2 가 제한적. **FP16** 또는 **AWQ/GPTQ INT4** 로 적재.
- **Qwen2.5-Coder-32B-Instruct** (FP16 ≈64GB) — 코드 주력
- **Qwen3-Coder-30B-A3B**(지원 시), **DeepSeek-Coder-V2-Lite-16B**
- **Llama-3.1-70B**(FP16 ≈140GB, 8×32GB 에 적재) — 더 어려운 대량 작업
- 작은/요약: **Llama-3.1-8B-Instruct**
- 서빙: vLLM(`--dtype float16`) 또는 AWQ INT4 로 더 큰 모델 적재.

> ⚠️ V100 주의: bf16/FP8 모델을 그대로 올리면 실패하거나 느리다. FP16/INT4 가중치를 쓰고,
> 컨텍스트 길이·동시성은 32GB×8 한계 안에서 잡는다.

## 13.6 서빙 → provider 연결

각 클러스터를 OpenAI 호환으로 노출하면 TokenLift 의 `openai-compat` provider 로 바로 연결된다.

```jsonc
// ~/.tokenlift/config.json (사내 환경값으로 교체)
{
  "providers": {
    "onprem-h200": { "type": "openai-compat", "host": "http://h200.internal:8000",
      "apiPath": "/v1", "apiKeyEnv": "ONPREM_API_KEY",
      "routing": { "default": "deepseek-ai/DeepSeek-R1" } },
    "onprem-v100": { "type": "openai-compat", "host": "http://v100.internal:8000",
      "apiPath": "/v1", "apiKeyEnv": "ONPREM_API_KEY",
      "routing": { "default": "Qwen/Qwen2.5-Coder-32B-Instruct" } }
  }
}
```
```bash
export ONPREM_API_KEY="..."     # 게이트웨이 인증이 있으면(없으면 무인증)
tokenlift doctor --provider onprem-v100
tokenlift doctor --provider onprem-h200
```
NIM 으로 서빙한다면 `nemoclaw` provider 를 그대로 클러스터에 가리켜도 된다(같은 OpenAI 호환).

## 13.7 협업 워크플로우 예시 (하이브리드)

```
"결제 정산 모듈 신규 구현"
 1. [explorer/그래프]  get_architecture·search_graph 로 기존 결제 코드 구조 파악(입력↓)
 2. [lead/Claude]      인터페이스·정합성·보안 요건 설계(짧은 고판단)
 3. [coder/V100]       DTO·검증·CRUD·테스트 대량 생성   tokenlift gen/test --role coder
 4. [oracle/H200]      정산 금액 계산(정밀/동시성) 알고리즘 구현  tokenlift gen --role oracle
 5. [reviewer/Claude]  보안(금액·권한)·정합성 최종 검토·통합
 6. tokenlift stats 로 백엔드별 절감 확인
```
가장 비싼 Claude(Bedrock)는 2·5 의 **판단/검토**에만 쓰이고, 양이 많은 3·4 생성은 온프렘이,
탐색 1 은 그래프가 흡수한다 → 전체 Bedrock 토큰 최소화.

## 13.8 서브에이전트 (격리 위임)

| 에이전트 | 역할 | 백엔드 |
|---|---|---|
| `ollama-delegate` | coder — 대량·정형 생성 | V100 / ollama / NIM |
| `onprem-oracle` | oracle — 어려운 추론·대형 생성 | H200 |

메인 Claude(lead)는 무거운 작업을 이 서브에이전트로 **병렬 격리** 실행해 자신의 컨텍스트를
린하게 유지한다(OmO 의 "background task 로 영역 매핑" 패턴).

## 13.9 주의 / 한계

- 역할 자동 판단은 키워드 휴리스틱이라 완벽하지 않다 — `--role` 로 수동 지정 가능.
- 온프렘 호스트/모델명은 **예시 placeholder**다. 실제 엔드포인트·배포 모델로 교체해야 동작.
- 보안·금액·권한 등 위험 코드의 **최종 판단은 항상 Claude(reviewer)** 가 한다.
- 온프렘 장애 시 해당 단계는 한 칸 위(또는 Claude)로 폴백하거나 사용자에게 알린다.
