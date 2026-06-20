// providers/openai-compat.mjs
// OpenAI 호환 추론 백엔드 어댑터.
// 대상: NVIDIA NemoClaw/NIM, vLLM, TensorRT-LLM, TGI, llama.cpp(server), LocalAI 등
// /v1/chat/completions · /v1/completions(FIM) · /v1/models 표준을 따른다.
import { eprint } from '../util.mjs';

class ProviderError extends Error {
  constructor(message, { code, cause } = {}) {
    super(message);
    this.name = 'ProviderError';
    this.code = code;
    this.cause = cause;
  }
}

function resolveApiKey(profile) {
  if (profile.apiKey) return profile.apiKey;
  if (profile.apiKeyEnv && process.env[profile.apiKeyEnv]) return process.env[profile.apiKeyEnv];
  return null;
}

function headers(profile) {
  const h = { 'content-type': 'application/json' };
  const key = resolveApiKey(profile);
  if (key) h['authorization'] = `Bearer ${key}`;
  // NIM/NemoClaw 일부 게이트웨이는 추가 헤더를 요구할 수 있음
  if (profile.extraHeaders && typeof profile.extraHeaders === 'object') {
    Object.assign(h, profile.extraHeaders);
  }
  return h;
}

function friendlyError(profile, url, err) {
  if (err.name === 'AbortError') {
    return new ProviderError(`요청 타임아웃. 온프렘 모델 콜드 로드가 느릴 수 있습니다. --timeout 으로 늘리세요.`, { code: 'ETIMEOUT' });
  }
  if (err.cause?.code === 'ECONNREFUSED' || /fetch failed/i.test(err.message)) {
    return new ProviderError(
      `'${profile.name}' 엔드포인트(${url})에 연결할 수 없습니다.\n` +
        `  - 호스트/포트 확인(config.providers.${profile.name}.host)\n` +
        `  - NIM/추론 서버가 기동되어 /v1 을 노출하는지 확인`,
      { code: 'ECONN', cause: err }
    );
  }
  return err instanceof ProviderError ? err : new ProviderError(`호출 실패: ${err.message}`, { cause: err });
}

async function postJson(profile, url, body, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: headers(profile),
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      if (res.status === 401 || res.status === 403) {
        throw new ProviderError(
          `인증 실패(${res.status}). API 키를 확인하세요` +
            (profile.apiKeyEnv ? ` (환경변수 ${profile.apiKeyEnv}).` : '.'),
          { code: 'EAUTH' }
        );
      }
      throw new ProviderError(`API ${res.status}: ${text.slice(0, 300)}`, { code: 'EHTTP' });
    }
    return await res.json();
  } catch (err) {
    throw friendlyError(profile, url, err);
  } finally {
    clearTimeout(timer);
  }
}

export function createOpenAICompatProvider(profile) {
  const base = String(profile.host || '').replace(/\/$/, '') + (profile.apiPath || '/v1');

  async function chat({ model, messages, options = {}, timeoutMs }) {
    const t0 = performance.now();
    const body = { model, messages, stream: false };
    if (options.temperature != null) body.temperature = options.temperature;
    if (options.top_p != null) body.top_p = options.top_p;
    if (options.num_predict != null) body.max_tokens = options.num_predict;
    const j = await postJson(profile, base + '/chat/completions', body, timeoutMs);
    const choice = j.choices?.[0];
    return {
      content: choice?.message?.content ?? '',
      inTokens: j.usage?.prompt_tokens ?? 0,
      outTokens: j.usage?.completion_tokens ?? 0,
      durationMs: Math.round(performance.now() - t0),
      model: j.model ?? model,
      raw: j,
    };
  }

  async function generate({ model, prompt, suffix, options = {}, timeoutMs }) {
    // 레거시 /v1/completions (FIM: suffix). 일부 NIM/모델은 미지원 → 호출 실패 시 안내.
    const t0 = performance.now();
    const body = { model, prompt, stream: false };
    if (suffix != null && suffix !== '') body.suffix = suffix;
    if (options.temperature != null) body.temperature = options.temperature;
    if (options.num_predict != null) body.max_tokens = options.num_predict;
    const j = await postJson(profile, base + '/completions', body, timeoutMs);
    const choice = j.choices?.[0];
    return {
      content: choice?.text ?? '',
      inTokens: j.usage?.prompt_tokens ?? 0,
      outTokens: j.usage?.completion_tokens ?? 0,
      durationMs: Math.round(performance.now() - t0),
      model: j.model ?? model,
      raw: j,
    };
  }

  async function listModels({ timeoutMs = 10000 } = {}) {
    // 수동 모델 목록이 설정되어 있으면 그대로 사용(/v1/models 미지원 게이트웨이 대비)
    if (Array.isArray(profile.models) && profile.models.length) {
      return profile.models.map((n) => ({ name: n }));
    }
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(base + '/models', { headers: headers(profile), signal: ctrl.signal });
      if (!res.ok) throw new ProviderError(`API ${res.status}`, { code: 'EHTTP' });
      const j = await res.json();
      return (j.data || []).map((m) => ({ name: m.id, family: m.owned_by }));
    } catch (err) {
      throw friendlyError(profile, base + '/models', err);
    } finally {
      clearTimeout(timer);
    }
  }

  async function warmup({ model, timeoutMs = 600000 }) {
    const t0 = performance.now();
    await chat({ model, messages: [{ role: 'user', content: 'ok' }], options: { num_predict: 1 }, timeoutMs });
    return { model, loaded: true, durationMs: Math.round(performance.now() - t0) };
  }

  async function ping({ timeoutMs = 5000 } = {}) {
    try {
      await listModels({ timeoutMs });
      return true;
    } catch {
      return false;
    }
  }

  return {
    name: profile.name,
    type: 'openai-compat',
    supportsFIM: !!profile.supportsFIM,
    chat,
    generate,
    listModels,
    warmup,
    ping,
  };
}

export { ProviderError };
