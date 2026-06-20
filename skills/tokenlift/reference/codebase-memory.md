# codebase-memory-mcp — 지식 그래프 탐색 (탐색 위임 = 토큰 절감 1번 기둥)

코드베이스를 **파일 통독 없이** 구조 쿼리로 이해/검색/추적한다. 파일별 grep/read 수십 회를
그래프 쿼리 1회로 대체 → 입력 토큰 ~99% 절감(논문 기준 10×). 모두 로컬, 코드 유출 없음.

> 도구 이름은 `mcp__codebase-memory-mcp__<tool>` 형식. MCP 가 연결되어 있지 않으면 이 절차를
> 건너뛰고 평소대로(Read/Grep) 처리한다. tokenlift CLI(Ollama/NemoClaw 위임)와는 독립적이며
> **상호 보완**된다(그래프=입력 절감, CLI=출력 절감).

## 기본 워크플로우

```
0) list_projects                      # 현재 프로젝트가 인덱싱됐는지
   └ 없으면 index_repository(repo_path)  # 1회. 평균 수 초(대형도 분 단위)
1) get_architecture(project)          # 레이어·진입점·핫스팟·경계·클러스터 한 번에
2) search_graph(project, query="자연어")  # 정의/구현 위치 (grep/glob 대신)
3) trace_path(project, function_name) # 호출자/피호출자·데이터흐름·영향분석 (grep 대신)
4) get_code_snippet(project, qualified_name)  # 확정된 그 함수만 읽기 (파일 통독 대신)
```

## 14개 도구 요약

### 인덱싱/관리
| 도구 | 용도 |
|---|---|
| `index_repository(repo_path, mode?)` | 인덱싱. mode: `full`(유사도/시맨틱 포함)·`moderate`·`fast`·`cross-repo-intelligence`. `persistence:true` 면 팀 공유 아티팩트 저장 |
| `index_status(project)` | 인덱싱 진행 상태 |
| `list_projects()` | 인덱싱된 프로젝트 목록(노드/엣지 수) |
| `delete_project(project)` | 프로젝트 그래프 삭제 |

### 탐색/쿼리 (grep/read 대체)
| 도구 | 용도 |
|---|---|
| `get_architecture(project)` | 언어·패키지·진입점·핫스팟·경계·레이어·클러스터 개요 |
| `search_graph(project, query \| name_pattern \| semantic_query)` | 심볼 검색. `query`=BM25 자연어(camelCase 분해), `name_pattern`=정규식, `semantic_query`=벡터(어휘 차이 보정). 페이지네이션(`total`/`has_more`/`offset`) |
| `search_code(project, pattern)` | 그래프 보강 grep(인덱싱된 파일만). `compact`(기본)/`full`/`files` |
| `trace_path(project, function_name, mode?)` | 경로 추적. `calls`(호출자/피호출자)·`data_flow`·`cross_service`. `direction`/`depth`/`risk_labels` |
| `get_code_snippet(project, qualified_name)` | 심볼 소스 읽기. **먼저 search_graph 로 qualified_name 확정 후** 호출 |
| `query_graph(project, query)` | Cypher 쿼리. 복잡도/병목(`transitive_loop_depth`,`linear_scan_in_loop` 등)·다중홉 분석 |
| `get_graph_schema(project)` | 라벨별 노드/엣지 수·관계 패턴 |
| `detect_changes(project, since?)` | git diff → 영향 심볼·블래스트 반경·리스크(CRITICAL/HIGH/...) |

### 고급
| 도구 | 용도 |
|---|---|
| `manage_adr(project, mode)` | 아키텍처 결정 기록(ADR) CRUD — 세션 간 결정 보존 |
| `ingest_traces(...)` | 런타임 트레이스로 HTTP_CALLS 엣지 검증 |

## grep/Read → 그래프 치환 가이드

| 하려는 일 | ❌ 비싼 방식 | ✅ 그래프 |
|---|---|---|
| "이 함수 어디 있지?" | 여러 파일 grep+read | `search_graph(query=...)` |
| "이거 누가 호출하지?" | 전역 grep | `trace_path(function_name, direction="inbound")` |
| "이 변경 영향 범위?" | 관련 파일 통독 | `detect_changes(since="HEAD~5")` |
| "전체 구조 파악" | 디렉토리/파일 다수 read | `get_architecture()` |
| "이 함수 구현 보기" | 파일 전체 Read | `get_code_snippet(qualified_name)` |
| "O(n²) 병목 찾기" | 코드 정독 | `query_graph("MATCH (f:Function) WHERE f.transitive_loop_depth>=3 ...")` |

## 위임과 결합 (그래프 → CLI)

그래프로 **정확한 스니펫/시그니처**만 뽑아 그걸 생성 위임의 입력으로 넘긴다 → 입력·출력 동시 절감.

```
1) search_graph → get_code_snippet 로 대상 함수 본문 확보(파일 통독 X)
2) 그 스니펫을 지시에 넣어 tokenlift 로 위임:
   tokenlift test "<스니펫 기반 테스트>" --provider ollama -o foo.test.ts
3) Claude 가 검토·통합
```

## 주의

- **검색 도구는 search_graph/trace_path, 읽기 도구는 get_code_snippet** — 역할이 다르다.
  먼저 검색해 `qualified_name` 을 확정한 뒤 스니펫을 읽는다.
- 결과가 잘릴 수 있다(`has_more`/`total`/`total_results` 확인 후 `offset`/`limit` 또는
  `file_pattern`/`path_filter` 로 좁힌다).
- 인덱스는 백그라운드 워처가 자동 동기화하지만, 큰 변경 후 결과가 이상하면 `index_status`
  확인 또는 재인덱싱.
- 보안 민감 코드의 최종 판단은 여전히 Claude 몫(그래프는 현황 파악용).
