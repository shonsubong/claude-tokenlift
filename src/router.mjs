// router.mjs - 모델 선택 + Claude vs Ollama 위임 판단 휴리스틱

/** task 타입과 설정으로 사용할 Ollama 모델 결정 */
export function pickModel(task, config, override) {
  if (override) return override;
  const byTask = config.routing?.byTask || {};
  return byTask[task] || config.routing?.default || 'qwen2.5-coder:14b';
}

// Claude(고급 추론)에 남겨야 하는 신호 키워드
const KEEP_ON_CLAUDE = [
  '아키텍처', 'architecture', '설계', 'design', '전략', 'strategy',
  '보안', 'security', '취약점', 'vulnerab', '인증', 'auth ',
  '복잡한 디버깅', 'root cause', '근본 원인', '왜', 'why is',
  '트레이드오프', 'trade-off', 'tradeoff', '의사결정', 'decision',
  '마이그레이션 계획', 'migration plan', '전체 시스템', 'system-wide',
];

// Ollama 위임에 적합한 신호 키워드 (대량 생성/반복 작업)
// 주의: 구체적 태스크를 먼저 검사해야 한다. 범용 'gen'('작성' 등)이 위에 있으면
//       "테스트 코드 작성"이 test 가 아닌 gen 으로 오분류된다.
const DELEGATE_TO_OLLAMA = {
  test: ['테스트', 'unit test', 'test 작성', '테스트 코드', 'spec 작성'],
  translate: ['이식', '포팅', 'port ', '변환', 'translate', 'convert to'],
  refactor: ['리팩터', 'refactor', '이름 변경', 'rename', '일괄', 'bulk'],
  review: ['리뷰', 'review', '검토'],
  docs: ['문서', 'docstring', '주석', 'comment', 'document'],
  explain: ['요약', 'summarize', '설명', 'explain', '무슨 일', 'what does'],
  gen: ['생성', 'generate', '작성', 'write a', '구현', 'implement', '스캐폴드', 'scaffold', 'boilerplate', '보일러플레이트'],
  edit: ['수정', 'edit', '변경', 'change', '추가', 'add '],
};

/**
 * 자연어 작업 설명을 받아 라우팅 추천.
 * @returns {{route:'ollama'|'claude', task, model, confidence, reason}}
 */
export function recommend(description, config) {
  const text = (description || '').toLowerCase();

  // 1) Claude 유지 신호 우선
  for (const kw of KEEP_ON_CLAUDE) {
    if (text.includes(kw.toLowerCase())) {
      return {
        route: 'claude',
        task: null,
        model: null,
        confidence: 'high',
        reason: `고난도 판단 신호 감지("${kw}") → Claude 유지 권장`,
      };
    }
  }

  // 2) Ollama 위임 신호 탐지 (task 분류 포함)
  let best = null;
  for (const [task, kws] of Object.entries(DELEGATE_TO_OLLAMA)) {
    for (const kw of kws) {
      if (text.includes(kw.toLowerCase())) {
        best = task;
        break;
      }
    }
    if (best) break;
  }

  if (best) {
    return {
      route: 'ollama',
      task: best,
      model: pickModel(best, config),
      confidence: 'medium',
      reason: `대량/반복 코딩 신호 → '${best}' 태스크로 Ollama 위임 권장`,
    };
  }

  // 3) 판단 불가 → 기본은 Claude (안전)
  return {
    route: 'claude',
    task: null,
    model: null,
    confidence: 'low',
    reason: '명확한 위임 신호 없음 → 기본적으로 Claude 처리(필요시 수동 위임)',
  };
}
