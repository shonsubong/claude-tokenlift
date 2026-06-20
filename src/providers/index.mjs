// providers/index.mjs
// Provider 추상화: 설정에서 활성 백엔드 프로파일을 해석하고 어댑터를 생성한다.
//
// 통합 인터페이스 (모든 provider 공통):
//   chat({model, messages, options, timeoutMs})   -> {content, inTokens, outTokens, durationMs, model, raw}
//   generate({model, prompt, suffix, options, timeoutMs}) -> {...}   (FIM)
//   listModels({timeoutMs})                        -> [{name, ...}]
//   warmup({model, timeoutMs})                     -> {model, durationMs}
//   ping({timeoutMs})                              -> boolean
//   name, type, supportsFIM
import { createOllamaProvider } from './ollama.mjs';
import { createOpenAICompatProvider } from './openai-compat.mjs';

/** 설정에 존재하는 모든 provider 이름 (ollama 는 항상 내장) */
export function listProviderNames(config) {
  const extra = config.providers ? Object.keys(config.providers) : [];
  return ['ollama', ...extra.filter((n) => n !== 'ollama')];
}

/** 활성 provider 이름 해석: 플래그 > config.provider > 'ollama' */
export function resolveProviderName(config, flagProvider) {
  return flagProvider || config.provider || 'ollama';
}

/**
 * provider 프로파일 객체 반환(라우팅 포함). config 를 변형하지 않는 새 객체.
 * - 'ollama' 는 하위호환을 위해 최상위 config.ollama + config.routing 에서 합성.
 * - 그 외는 config.providers[name] 에서 가져옴.
 */
export function getProviderProfile(config, name) {
  const pname = resolveProviderName(config, name);

  if (pname === 'ollama') {
    return {
      name: 'ollama',
      type: 'ollama',
      host: config.ollama?.host || 'http://localhost:11434',
      keepAlive: config.ollama?.keepAlive,
      numCtx: config.ollama?.numCtx,
      timeoutMs: config.ollama?.timeoutMs,
      routing: config.routing || {},
    };
  }

  const p = config.providers?.[pname];
  if (!p) {
    throw new Error(
      `알 수 없는 provider: '${pname}'. 사용 가능: ${listProviderNames(config).join(', ')}`
    );
  }
  return { name: pname, routing: {}, ...p };
}

/** 프로파일로부터 어댑터 생성 */
export function createProvider(profile) {
  switch (profile.type) {
    case 'ollama':
      return createOllamaProvider(profile);
    case 'openai-compat':
      return createOpenAICompatProvider(profile);
    default:
      throw new Error(`지원하지 않는 provider type: '${profile.type}' (ollama | openai-compat)`);
  }
}

/** 편의: config + 이름 → 어댑터 (+ 프로파일) */
export function getProvider(config, name) {
  const profile = getProviderProfile(config, name);
  return { provider: createProvider(profile), profile };
}
