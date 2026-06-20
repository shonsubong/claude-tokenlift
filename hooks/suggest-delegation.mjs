#!/usr/bin/env node
// suggest-delegation.mjs
// (선택) Claude Code UserPromptSubmit 훅. 사용자 프롬프트를 키워드 휴리스틱으로 분석해
// 대량/반복 코딩 작업이면 "Ollama 위임을 고려하라"는 힌트를 컨텍스트로 주입한다.
// LLM 호출 없음(즉시). 어떤 경우에도 프롬프트를 차단하지 않는다(항상 exit 0).
//
// settings.json 등록 예:
//   "hooks": {
//     "UserPromptSubmit": [
//       { "hooks": [ { "type": "command",
//         "command": "node \"X:/Work_TokenLift/TokenLift/hooks/suggest-delegation.mjs\"" } ] }
//     ]
//   }

import { loadConfig } from '../src/config.mjs';
import { recommend } from '../src/router.mjs';

async function readAll() {
  if (process.stdin.isTTY) return '';
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  return Buffer.concat(chunks).toString('utf8');
}

try {
  const raw = await readAll();
  let prompt = '';
  try {
    prompt = JSON.parse(raw).prompt || '';
  } catch {
    prompt = raw;
  }
  if (!prompt.trim()) process.exit(0);

  const cfg = loadConfig();
  const rec = recommend(prompt, cfg);

  if (rec.route === 'ollama' && rec.task) {
    const hint =
      `[TokenLift 힌트] 이 요청은 대량/반복 코딩 작업으로 보입니다(추정 task=${rec.task}). ` +
      `직접 길게 생성하지 말고 'tokenlift ${rec.task} ...' (${rec.model})로 로컬 Ollama 에 위임해 ` +
      `Bedrock 토큰을 절감하는 것을 우선 검토하세요. 생성물은 반드시 검토 후 통합하세요. ` +
      `보안/설계/복잡 디버깅이면 위임하지 말고 직접 처리하세요.`;
    // UserPromptSubmit: stdout 텍스트가 컨텍스트로 추가됨
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'UserPromptSubmit',
          additionalContext: hint,
        },
      })
    );
  }
  process.exit(0);
} catch {
  // 훅 오류는 사용자 작업을 방해하지 않는다
  process.exit(0);
}
