// providers/ollama.mjs
// 기존 Ollama REST 클라이언트를 통합 provider 인터페이스로 감싼다.
// (저수준 HTTP 로직은 검증된 src/ollama-client.mjs 를 재사용)
import * as oc from '../ollama-client.mjs';

export function createOllamaProvider(profile) {
  const host = profile.host;
  const keepAlive = profile.keepAlive;

  return {
    name: profile.name || 'ollama',
    type: 'ollama',
    supportsFIM: true,

    chat: ({ model, messages, options, timeoutMs }) =>
      oc.chat({ host, model, messages, options, keepAlive, timeoutMs }),

    generate: ({ model, prompt, suffix, options, timeoutMs }) =>
      oc.generate({ host, model, prompt, suffix, options, keepAlive, timeoutMs }),

    listModels: ({ timeoutMs } = {}) => oc.listModels({ host, timeoutMs }),

    warmup: ({ model, timeoutMs }) => oc.warmup({ host, model, keepAlive, timeoutMs }),

    ping: ({ timeoutMs } = {}) => oc.ping({ host, timeoutMs }),
  };
}
