# 12. 코드 탐색 위임 — codebase-memory-mcp 지식 그래프 (기본)

TokenLift의 **첫 번째 절감 기둥**. 코드베이스를 파일 통독 대신 **지식 그래프 구조 쿼리**로
탐색해 **입력 토큰**을 대폭 절감한다. [codebase-memory-mcp](https://github.com/DeusData/codebase-memory-mcp)
(MIT, 단일 정적 바이너리, 158개 언어, 로컬 100%)를 사용한다.

## 12.1 왜 기본인가

코드 작업의 큰 비용은 "생성"만이 아니라 **"이해를 위한 탐색"** 이다. 에이전트가 파일을
반복해서 읽고 grep 하면 입력 토큰이 폭증한다. 지식 그래프는 이를 구조 쿼리로 대체한다.

- **벤치마크**: 5개 구조 쿼리 ≈ **3,400 토큰** vs 파일별 grep/read ≈ **412,000 토큰**
  (약 **99% 절감**). 논문(arXiv:2603.27277, 31개 실repo) 기준 **10× 적은 토큰, 2.1× 적은
  도구 호출, 83% 답변 품질**.
- **로컬·무유출**: 모든 처리는 로컬 바이너리. 코드가 외부로 나가지 않음(사내 보안 친화적).
- **TokenLift 3기둥**: ① 탐색=그래프(입력↓) ② 생성=Ollama/NemoClaw(출력↓) ③ 판단=Claude.
  세 번째 기둥(Claude)을 제외한 두 위임이 합쳐져 비용을 끌어내린다.

## 12.2 설치 (MCP 서버)

codebase-memory-mcp 는 TokenLift CLI 와 **별개의 MCP 서버**다. 한 번 설치하면 `install` 이
Claude Code 를 자동 구성한다(`~/.claude/.mcp.json` 항목, 스킬, Grep/Glob 보강 PreToolUse 훅).

```bash
# macOS / Linux
curl -fsSL https://raw.githubusercontent.com/DeusData/codebase-memory-mcp/main/install.sh | bash

# Windows (PowerShell)
Invoke-WebRequest -Uri https://raw.githubusercontent.com/DeusData/codebase-memory-mcp/main/install.ps1 -OutFile install.ps1
# (검토 후) .\install.ps1
```

설치 후 Claude Code 를 재시작하면 `mcp__codebase-memory-mcp__*` 도구가 활성화된다.
자동 인덱싱: `codebase-memory-mcp config set auto_index true`.

> 이미 환경에 연결돼 있으면 추가 설치 불필요. 연결 여부는 도구 가용성으로 판단한다.
> MCP 가 없으면 TokenLift 는 이 기둥을 건너뛰고 평소대로(Read/Grep) 동작한다(graceful).

## 12.3 표준 탐색 워크플로우

```
0) list_projects                         # 인덱싱 여부 확인
   └ 없으면 index_repository(repo_path)     # 1회(평균 수 초)
1) get_architecture(project)             # 레이어·진입점·핫스팟·경계·클러스터 한 번에
2) search_graph(project, query="자연어")   # 정의/구현 위치 (grep/glob 대체)
3) trace_path(project, function_name)    # 호출자/피호출자·데이터흐름 (영향분석)
4) get_code_snippet(project, qualified_name)  # 확정된 함수만 읽기 (파일 통독 대체)
```

## 12.4 14개 도구

| 분류 | 도구 | 용도 |
|---|---|---|
| 인덱싱 | `index_repository` | 인덱싱(`full`/`moderate`/`fast`/`cross-repo-intelligence`, `persistence`) |
| | `index_status` / `list_projects` / `delete_project` | 상태·목록·삭제 |
| 탐색 | `get_architecture` | 언어·패키지·진입점·핫스팟·경계·레이어·클러스터 |
| | `search_graph` | 심볼 검색(BM25 `query` / 정규식 `name_pattern` / 벡터 `semantic_query`) |
| | `search_code` | 그래프 보강 grep(인덱싱 파일) |
| | `trace_path` | 호출/데이터흐름/교차서비스 경로 추적 |
| | `get_code_snippet` | qualified_name 으로 소스 읽기 |
| | `query_graph` | Cypher(복잡도·병목·다중홉) |
| | `get_graph_schema` / `detect_changes` | 스키마 / git diff 영향분석 |
| 고급 | `manage_adr` / `ingest_traces` | ADR 관리 / 런타임 트레이스 검증 |

## 12.5 grep/Read → 그래프 치환

| 의도 | ❌ 비싼 방식 | ✅ 그래프 |
|---|---|---|
| 함수 위치 찾기 | 다중 파일 grep+read | `search_graph(query=...)` |
| 호출자 추적 | 전역 grep | `trace_path(direction="inbound")` |
| 변경 영향 | 관련 파일 통독 | `detect_changes(since="HEAD~5")` |
| 전체 구조 | 다수 파일 read | `get_architecture()` |
| 구현 보기 | 파일 전체 Read | `get_code_snippet(qualified_name)` |
| O(n²) 병목 | 코드 정독 | `query_graph("... transitive_loop_depth>=3 ...")` |

## 12.6 생성 위임과의 결합

그래프로 **정확한 스니펫**만 뽑아 그걸 `tokenlift` 위임의 입력으로 넘기면 입력·출력을 동시에 절감.

```
search_graph → get_code_snippet 으로 대상 함수 본문만 확보(파일 통독 X)
   → tokenlift test "<스니펫 기반>" -o foo.test.ts (Ollama/NemoClaw 생성)
   → Claude 가 검토·통합
```

## 12.7 실측 (이 저장소에 적용)

TokenLift 저장소를 인덱싱(`437 노드 / 599 엣지`)한 뒤 `get_architecture` **한 번**으로
레이어(core: `util`/`providers`/`ollama-client`, entry: `tokenlift`), 진입점, 핫스팟
(`eprint`,`expandHome`,`buildActiveProvider`,`getProviderProfile`), 패키지 경계(호출 수),
클러스터, 파일트리를 모두 파악했다 — **소스 파일을 하나도 Read 하지 않고**.
`search_graph("select model for task and provider routing")` → `pickModel`
(`src/router.mjs:8`), `buildActiveProvider`, `createProvider` 를 정확히 랭킹했다.

## 12.8 주의

- 검색은 `search_graph`/`trace_path`, 읽기는 `get_code_snippet` — 먼저 검색해 `qualified_name`
  확정 후 스니펫을 읽는다.
- 결과 잘림은 `has_more`/`total` 로 감지하고 `offset`/`limit`/`file_pattern` 으로 좁힌다.
- 보안·설계 최종 판단은 Claude 몫(그래프는 현황 파악용).
- MCP 미연결/인덱싱 실패 시 평소대로 Read/Grep 으로 처리(가용성 우선).
