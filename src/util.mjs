// util.mjs - 공용 유틸리티 (외부 의존성 없음)
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';

/** 선두의 ~ 를 홈 디렉토리로 확장 */
export function expandHome(p) {
  if (!p) return p;
  if (p === '~') return os.homedir();
  if (p.startsWith('~/') || p.startsWith('~\\')) {
    return path.join(os.homedir(), p.slice(2));
  }
  return p;
}

/** 디렉토리 보장 생성 */
export function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

/** 텍스트 파일 안전 읽기 (없으면 null) */
export function readFileSafe(p) {
  try {
    return fs.readFileSync(expandHome(p), 'utf8');
  } catch {
    return null;
  }
}

/** 텍스트 파일 쓰기 (상위 디렉토리 자동 생성) */
export function writeFileSafe(p, content) {
  const full = expandHome(p);
  ensureDir(path.dirname(full));
  fs.writeFileSync(full, content, 'utf8');
  return full;
}

/** JSON 파일 읽기 (없거나 깨지면 null) */
export function readJson(p) {
  const raw = readFileSafe(p);
  if (raw == null) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** deepseek-r1 / qwq 등이 내보내는 <think>...</think> 추론 블록 제거 */
export function stripThink(text) {
  if (!text) return text;
  return text
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<thinking>[\s\S]*?<\/thinking>/gi, '')
    .trim();
}

/**
 * 마크다운 코드펜스(```lang ... ```)에서 코드만 추출.
 * - 펜스가 여러 개면 모두 이어 붙임
 * - 펜스가 없으면 원문 그대로 반환
 */
export function extractCode(text) {
  if (!text) return '';
  const cleaned = stripThink(text);
  const fence = /```[a-zA-Z0-9_+\-]*\n([\s\S]*?)```/g;
  const blocks = [];
  let m;
  while ((m = fence.exec(cleaned)) !== null) {
    blocks.push(m[1].replace(/\s+$/, ''));
  }
  if (blocks.length === 0) return cleaned.trim();
  return blocks.join('\n\n');
}

/** 대략적 토큰 수 추정 (실측 불가 시 fallback, 영문 기준 ~4자/토큰) */
export function approxTokens(str) {
  if (!str) return 0;
  return Math.ceil(str.length / 4);
}

/** 깔끔한 USD 표기 */
export function fmtUsd(n) {
  if (n == null || Number.isNaN(n)) return '$0.0000';
  if (n >= 1) return '$' + n.toFixed(2);
  return '$' + n.toFixed(4);
}

/** ms 를 사람이 읽기 쉬운 형태로 */
export function fmtMs(ms) {
  if (ms == null) return '-';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

/**
 * stdin 전체를 문자열로 읽기 (파이프 입력 지원).
 * 비대화형 셸에서 "파이프 입력이 없는" 경우 EOF 를 무한 대기하지 않도록,
 * 첫 데이터가 graceMs 안에 도착하지 않으면 빈 문자열로 즉시 반환한다.
 * (echo/cat 등 실제 파이프는 즉시 데이터를 흘리므로 안전하다.)
 */
export function readStdin(graceMs = 400) {
  return new Promise((resolve) => {
    if (process.stdin.isTTY) return resolve('');
    const chunks = [];
    let settled = false;
    let committed = false;

    const finish = () => {
      if (settled) return;
      settled = true;
      process.stdin.removeListener('data', onData);
      process.stdin.removeListener('end', onEnd);
      process.stdin.removeListener('error', onEnd);
      resolve(Buffer.concat(chunks).toString('utf8'));
    };
    const onData = (c) => {
      committed = true; // 데이터가 오기 시작하면 끝까지 읽는다
      chunks.push(c);
    };
    const onEnd = () => finish();

    process.stdin.on('data', onData);
    process.stdin.once('end', onEnd);
    process.stdin.once('error', onEnd);

    // 유예 시간 내 데이터가 없으면(파이프 입력 없음으로 간주) 빈 문자열 반환
    const timer = setTimeout(() => {
      if (!committed) finish();
    }, graceMs);
    if (typeof timer.unref === 'function') timer.unref();
  });
}

/** stderr 로 진단/메타 출력 (stdout 은 순수 결과물 전용) */
export function eprint(...args) {
  process.stderr.write(args.join(' ') + '\n');
}
