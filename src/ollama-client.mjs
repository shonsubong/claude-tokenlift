// ollama-client.mjs - Ollama REST API 클라이언트 (Node 내장 fetch 사용, 무의존성)
import { eprint } from './util.mjs';

class OllamaError extends Error {
  constructor(message, { cause, code } = {}) {
    super(message);
    this.name = 'OllamaError';
    this.cause = cause;
    this.code = code;
  }
}

function friendlyConnError(host, err) {
  const hint =
    `Ollama 서버(${host})에 연결할 수 없습니다.\n` +
    `  - Ollama 가 실행 중인지 확인: 'ollama serve' 또는 데스크톱 앱 실행\n` +
    `  - 호스트 변경: 환경변수 OLLAMA_HOST 또는 --host 플래그`;
  return new OllamaError(hint, { cause: err, code: 'ECONN' });
}

async function postJson(host, pathname, body, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(host.replace(/\/$/, '') + pathname, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new OllamaError(`Ollama API ${res.status}: ${text.slice(0, 300)}`, { code: 'EHTTP' });
    }
    return await res.json();
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new OllamaError(`요청 타임아웃(${timeoutMs}ms). 대형 모델은 콜드 로드가 느릴 수 있습니다. --timeout 으로 늘리세요.`, { code: 'ETIMEOUT' });
    }
    if (err instanceof OllamaError) throw err;
    if (err.cause?.code === 'ECONNREFUSED' || /fetch failed/i.test(err.message)) {
      throw friendlyConnError(host, err);
    }
    throw new OllamaError(`Ollama 호출 실패: ${err.message}`, { cause: err });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 채팅 호출.
 * @returns {{content, inTokens, outTokens, durationMs, model, raw}}
 */
export async function chat({ host, model, messages, options = {}, keepAlive, timeoutMs }) {
  const body = { model, messages, stream: false, options };
  if (keepAlive != null) body.keep_alive = keepAlive;
  const j = await postJson(host, '/api/chat', body, timeoutMs);
  return {
    content: j.message?.content ?? '',
    inTokens: j.prompt_eval_count ?? 0,
    outTokens: j.eval_count ?? 0,
    durationMs: Math.round((j.total_duration ?? 0) / 1e6),
    model: j.model ?? model,
    raw: j,
  };
}

/**
 * 단발 생성 호출. FIM(코드 중간 채우기)은 suffix 지정.
 * @returns {{content, inTokens, outTokens, durationMs, model, raw}}
 */
export async function generate({ host, model, prompt, suffix, options = {}, keepAlive, timeoutMs }) {
  const body = { model, prompt, stream: false, options };
  if (suffix != null) body.suffix = suffix;
  if (keepAlive != null) body.keep_alive = keepAlive;
  const j = await postJson(host, '/api/generate', body, timeoutMs);
  return {
    content: j.response ?? '',
    inTokens: j.prompt_eval_count ?? 0,
    outTokens: j.eval_count ?? 0,
    durationMs: Math.round((j.total_duration ?? 0) / 1e6),
    model: j.model ?? model,
    raw: j,
  };
}

/** 설치된 모델 목록 */
export async function listModels({ host, timeoutMs = 10000 }) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(host.replace(/\/$/, '') + '/api/tags', { signal: ctrl.signal });
    if (!res.ok) throw new OllamaError(`Ollama API ${res.status}`);
    const j = await res.json();
    return (j.models || []).map((m) => ({
      name: m.name,
      sizeGb: +(m.size / 1e9).toFixed(1),
      params: m.details?.parameter_size,
      family: m.details?.family,
    }));
  } catch (err) {
    if (err.cause?.code === 'ECONNREFUSED' || /fetch failed/i.test(err.message)) {
      throw friendlyConnError(host, err);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/** 모델을 메모리에 미리 적재(워밍업) */
export async function warmup({ host, model, keepAlive = '30m', timeoutMs = 600000 }) {
  // 빈 프롬프트로 호출하면 Ollama 가 모델만 로드함
  const j = await postJson(host, '/api/generate', { model, prompt: '', keep_alive: keepAlive }, timeoutMs);
  return { model, loaded: true, durationMs: Math.round((j.total_duration ?? 0) / 1e6) };
}

/** 헬스 체크 */
export async function ping({ host, timeoutMs = 5000 }) {
  try {
    await listModels({ host, timeoutMs });
    return true;
  } catch {
    return false;
  }
}

export { OllamaError };
