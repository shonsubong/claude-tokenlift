// tasks.mjs - 태스크 타입별 프롬프트 빌더
// 로컬 코드 모델이 "잡담 없이 결과물만" 내도록 시스템 프롬프트를 엄격히 구성한다.

const CODE_ONLY_SYSTEM =
  '당신은 정밀한 코딩 어시스턴트입니다. 요청된 코드만 출력합니다. ' +
  '설명, 사과, 머리말/꼬리말 없이 단 하나의 마크다운 코드펜스(```)로 감싼 코드만 반환하세요. ' +
  '기존 코드 스타일/들여쓰기/네이밍 규칙을 그대로 따르고, 임의의 기능을 추가하지 마세요.';

/** 파일 묶음을 프롬프트용 텍스트로 직렬화 */
export function serializeFiles(files) {
  // files: [{path, content}]
  if (!files || files.length === 0) return '';
  return files
    .map((f) => `--- FILE: ${f.path} ---\n${f.content}`)
    .join('\n\n');
}

/**
 * 태스크 → {system, user, mode}
 * mode: 'chat' | 'fim'
 * opts: { instruction, spec, files, lang, to, context }
 */
export function buildTask(task, opts = {}) {
  const { instruction = '', files = [], lang = '', to = '', context = '' } = opts;
  const fileBlock = serializeFiles(files);
  const ctxBlock = context ? `\n\n# 참고 컨텍스트\n${context}` : '';

  switch (task) {
    case 'gen':
      return {
        mode: 'chat',
        system: CODE_ONLY_SYSTEM,
        user:
          `# 작업: 코드 생성\n` +
          `다음 명세에 맞는 ${lang || ''} 코드를 작성하세요.\n\n` +
          `# 명세\n${instruction}` +
          (fileBlock ? `\n\n# 관련 파일(참고)\n${fileBlock}` : '') +
          ctxBlock,
      };

    case 'edit':
      return {
        mode: 'chat',
        system: CODE_ONLY_SYSTEM + ' 수정된 파일 "전체"를 반환하세요(부분 발췌 금지).',
        user:
          `# 작업: 파일 수정\n` +
          `아래 파일을 지시대로 수정한 "전체 내용"을 반환하세요.\n\n` +
          `# 수정 지시\n${instruction}\n\n` +
          `# 원본 파일\n${fileBlock}` +
          ctxBlock,
      };

    case 'test':
      return {
        mode: 'chat',
        system: CODE_ONLY_SYSTEM + ' 테스트 코드만 반환하세요.',
        user:
          `# 작업: 테스트 생성\n` +
          `아래 대상 코드에 대한 단위 테스트를 작성하세요. ` +
          `정상/경계/예외 케이스를 포함하고, 대상 코드와 동일한 언어/테스트 프레임워크 관례를 따르세요.\n` +
          (instruction ? `\n# 추가 요구사항\n${instruction}\n` : '') +
          `\n# 대상 코드\n${fileBlock}` +
          ctxBlock,
      };

    case 'refactor':
      return {
        mode: 'chat',
        system: CODE_ONLY_SYSTEM + ' 동작(기능)을 절대 바꾸지 말고 리팩터링된 전체 코드를 반환하세요.',
        user:
          `# 작업: 리팩터링\n` +
          `아래 코드를 지시에 따라 리팩터링하세요. 외부 동작은 동일해야 합니다.\n\n` +
          `# 리팩터링 지시\n${instruction}\n\n` +
          `# 원본 코드\n${fileBlock}` +
          ctxBlock,
      };

    case 'translate':
      return {
        mode: 'chat',
        system: CODE_ONLY_SYSTEM,
        user:
          `# 작업: 코드 이식/번역\n` +
          `아래 코드를 ${lang || '원본 언어'} 에서 ${to || '대상 언어'} (으)로 ` +
          `동등한 동작을 유지하며 이식하세요. 관용적 표현을 사용하세요.\n` +
          (instruction ? `\n# 추가 지시\n${instruction}\n` : '') +
          `\n# 원본 코드\n${fileBlock}` +
          ctxBlock,
      };

    case 'explain':
      return {
        mode: 'chat',
        system:
          '당신은 코드 분석가입니다. 군더더기 없이 한국어로 간결하고 구조화된 요약을 제공합니다. ' +
          '핵심만 bullet 로 정리하고 추측은 명시하세요.',
        user:
          `# 작업: 코드 설명/요약\n` +
          (instruction ? `질문/초점: ${instruction}\n\n` : '') +
          `다음 항목으로 요약하세요: (1) 목적 한 줄 (2) 주요 구성요소/함수와 역할 ` +
          `(3) 데이터 흐름 (4) 외부 의존성 (5) 주의점/위험.\n\n` +
          `# 대상\n${fileBlock || instruction}` +
          ctxBlock,
      };

    case 'review':
      return {
        mode: 'chat',
        system:
          '당신은 시니어 코드 리뷰어입니다. 한국어로, 발견된 문제만 심각도(높음/중간/낮음)와 ' +
          '위치, 근거, 수정 제안 형태로 간결히 보고합니다. 칭찬/마케팅 표현 금지.',
        user:
          `# 작업: 코드 리뷰\n` +
          (instruction ? `리뷰 초점: ${instruction}\n\n` : '') +
          `버그/보안/성능/가독성 관점에서 점검하고 발견사항만 나열하세요.\n\n` +
          `# 대상 코드\n${fileBlock}` +
          ctxBlock,
      };

    case 'docs':
      return {
        mode: 'chat',
        system: '당신은 기술 문서 작성자입니다. 한국어로 명확하고 정확한 문서를 작성합니다.',
        user:
          `# 작업: 문서/주석 생성\n${instruction}\n` +
          (fileBlock ? `\n# 대상\n${fileBlock}` : '') +
          ctxBlock,
      };

    case 'ask':
      return {
        mode: 'chat',
        system: '당신은 유능한 어시스턴트입니다. 한국어로 간결하고 정확하게 답합니다.',
        user: instruction + (fileBlock ? `\n\n# 참고\n${fileBlock}` : '') + ctxBlock,
      };

    case 'complete':
      // FIM: opts.context = prefix, opts.to = suffix
      return {
        mode: 'fim',
        prompt: opts.prefix ?? instruction ?? '',
        suffix: opts.suffix ?? '',
      };

    default:
      throw new Error(`알 수 없는 task: ${task}`);
  }
}

export const TASK_LIST = [
  'gen', 'edit', 'test', 'refactor', 'translate',
  'explain', 'review', 'docs', 'ask', 'complete',
];
