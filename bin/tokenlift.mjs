#!/usr/bin/env node
// tokenlift - Claude Code(Bedrock) 고비용 토큰 작업을 로컬 Ollama 로 위임하는 브리지 CLI
import fs from 'node:fs';
import { loadConfig, configPaths } from '../src/config.mjs';
import * as ollama from '../src/ollama-client.mjs';
import { buildTask, TASK_LIST } from '../src/tasks.mjs';
import { pickModel, recommend } from '../src/router.mjs';
import { estimateSavings, logUsage, readStats, formatStats } from '../src/logger.mjs';
import {
  readFileSafe, writeFileSafe, extractCode, stripThink,
  readStdin, eprint, fmtUsd, fmtMs,
} from '../src/util.mjs';

const VERSION = '0.1.0';
const CODE_TASKS = new Set(['gen', 'edit', 'test', 'refactor', 'translate', 'complete']);

// ---------- 인자 파서 ----------
function parseArgs(argv) {
  const flags = { files: [], _: [] };
  const aliases = { m: 'model', f: 'file', o: 'out', q: 'quiet', h: 'help' };
  for (let i = 0; i < argv.length; i++) {
    let a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      if (['quiet', 'json', 'no-log', 'apply', 'help', 'version'].includes(key)) {
        flags[key === 'no-log' ? 'noLog' : key] = true;
      } else {
        const val = argv[++i];
        if (key === 'file') flags.files.push(val);
        else flags[key] = val;
      }
    } else if (a.startsWith('-') && a.length > 1 && !/^-?\d/.test(a)) {
      const key = aliases[a.slice(1)] || a.slice(1);
      if (key === 'quiet' || key === 'help') flags[key] = true;
      else {
        const val = argv[++i];
        if (key === 'file') flags.files.push(val);
        else flags[key] = val;
      }
    } else {
      flags._.push(a);
    }
  }
  return flags;
}

// ---------- 헬프 ----------
const HELP = `tokenlift v${VERSION} — Ollama 위임 브리지

사용법:
  tokenlift <command> [텍스트...] [옵션]
  echo "프롬프트" | tokenlift <command> [옵션]

코딩 위임 명령 (stdout = 코드):
  gen        명세로 새 코드 생성        예) tokenlift gen "JWT 검증 미들웨어" --lang ts
  edit       파일을 지시대로 수정        예) tokenlift edit "널 체크 추가" -f a.js -o a.js
  test       대상 코드의 단위테스트 생성  예) tokenlift test -f service.py
  refactor   동작 유지 리팩터링          예) tokenlift refactor "함수 분리" -f big.js --apply
  translate  언어/프레임워크 이식        예) tokenlift translate -f a.py --lang python --to go
  complete   FIM 중간 코드 채우기        예) tokenlift complete --prefix "def add(" --suffix "):"

분석/문서 명령 (stdout = 텍스트):
  explain    코드 설명/요약(컨텍스트 절감) 예) tokenlift explain -f huge.log
  review     로컬 코드 리뷰              예) tokenlift review -f patch.diff
  docs       문서/주석 생성             예) tokenlift docs "README 초안" -f api.ts
  ask        임의 프롬프트              예) tokenlift ask "정규식 설명"

라우팅/운영 명령:
  route      위임 여부/모델 추천         예) tokenlift route "전체 결제 모듈 보안 설계"
  models     설치된 모델 + 라우팅 매핑
  stats      누적 절감 통계
  warmup     모델 메모리 선적재          예) tokenlift warmup -m qwen2.5-coder:14b
  doctor     환경 점검
  help       이 도움말

옵션:
  -m, --model <name>   사용할 Ollama 모델 강제 지정
  -f, --file <path>    입력 파일(여러 번 가능)
  -o, --out <path>     결과를 파일로 저장
      --apply          (edit/refactor) 입력 파일에 결과를 덮어쓰기
      --lang <l>       소스 언어 힌트
      --to <l>         (translate) 대상 언어 / (complete) suffix
      --prefix/--suffix  (complete) FIM 접두/접미
      --host <url>     Ollama 호스트 (기본 http://localhost:11434)
      --timeout <ms>   요청 타임아웃
      --temp <n>       temperature
      --num-ctx <n>    컨텍스트 윈도우 토큰 수
      --json           기계 판독용 JSON 출력
  -q, --quiet          stderr 메타(토큰/비용) 출력 억제
      --no-log         사용량 로깅 비활성화
`;

// ---------- 메인 ----------
async function main() {
  const argv = process.argv.slice(2);
  const flags = parseArgs(argv);
  const cmd = flags._.shift();

  if (flags.version) return console.log(VERSION);
  if (!cmd || cmd === 'help' || flags.help) return console.log(HELP);

  const config = loadConfig();
  if (flags.host) config.ollama.host = flags.host;
  if (flags.timeout) config.ollama.timeoutMs = Number(flags.timeout);
  if (flags.noLog) config.logging.enabled = false;
  const host = config.ollama.host;
  const timeoutMs = config.ollama.timeoutMs;

  // 운영 명령 분기
  if (cmd === 'models') return cmdModels(config);
  if (cmd === 'stats') return console.log(formatStats(readStats(config)));
  if (cmd === 'doctor') return cmdDoctor(config);
  if (cmd === 'warmup') return cmdWarmup(config, flags);
  if (cmd === 'route') return cmdRoute(config, flags);

  if (![...TASK_LIST].includes(cmd)) {
    eprint(`알 수 없는 명령: ${cmd}\n'tokenlift help' 로 사용법 확인`);
    process.exit(2);
  }

  // ---- 태스크 명령 처리 ----
  // 입력 텍스트: 위치인자 우선, 비었을 때만 stdin 을 읽는다.
  // (무조건 stdin 을 읽으면 비대화형 셸에서 파이프 입력이 없을 때 EOF 를 무한 대기함)
  let instruction = flags._.join(' ').trim();
  if (!instruction) {
    const piped = await readStdin();
    if (piped) instruction = piped.trim();
  }

  // 파일 로드
  const files = [];
  for (const fp of flags.files) {
    const content = readFileSafe(fp);
    if (content == null) {
      eprint(`파일을 읽을 수 없음: ${fp}`);
      process.exit(2);
    }
    files.push({ path: fp, content });
  }

  // complete(FIM) 는 별도 처리
  const options = {};
  if (flags.temp != null) options.temperature = Number(flags.temp);
  else options.temperature = config.generation?.temperature ?? 0.1;
  if (flags['num-ctx']) options.num_ctx = Number(flags['num-ctx']);
  else if (config.ollama?.numCtx) options.num_ctx = config.ollama.numCtx;

  const model = pickModel(cmd, config, flags.model);

  let result;
  if (cmd === 'complete') {
    const built = buildTask('complete', {
      prefix: flags.prefix ?? instruction,
      suffix: flags.suffix ?? flags.to ?? '',
    });
    result = await ollama.generate({
      host, model, prompt: built.prompt, suffix: built.suffix,
      options, keepAlive: config.ollama.keepAlive, timeoutMs,
    });
  } else {
    if (!instruction && files.length === 0) {
      eprint(`입력이 비었습니다. 텍스트 인자나 -f 파일, 또는 파이프 입력이 필요합니다.`);
      process.exit(2);
    }
    const built = buildTask(cmd, {
      instruction, files,
      lang: flags.lang || '', to: flags.to || '',
      context: flags.context || '',
    });
    result = await ollama.chat({
      host, model,
      messages: [
        { role: 'system', content: built.system },
        { role: 'user', content: built.user },
      ],
      options, keepAlive: config.ollama.keepAlive, timeoutMs,
    });
  }

  // 결과물 가공: 코드 태스크는 코드펜스 추출, 그 외는 think 제거
  const payload = CODE_TASKS.has(cmd) ? extractCode(result.content) : stripThink(result.content);

  // 출력 라우팅
  const sav = estimateSavings({ inTokens: result.inTokens, outTokens: result.outTokens, pricing: config.pricing });
  logUsage({ task: cmd, model: result.model, inTokens: result.inTokens, outTokens: result.outTokens, grossUsd: sav.grossUsd, durationMs: result.durationMs }, config);

  // 파일 저장 결정
  let outPath = flags.out;
  if (!outPath && flags.apply && files.length === 1) outPath = files[0].path;

  if (flags.json) {
    console.log(JSON.stringify({
      task: cmd, model: result.model, payload,
      inTokens: result.inTokens, outTokens: result.outTokens,
      durationMs: result.durationMs, estimate: sav, outPath: outPath || null,
    }, null, 2));
  } else if (outPath) {
    const saved = writeFileSafe(outPath, payload + (payload.endsWith('\n') ? '' : '\n'));
    console.log(saved); // stdout = 저장 경로 (Claude 가 위치 파악)
  } else {
    console.log(payload); // stdout = 결과물
  }

  if (!flags.quiet && !flags.json) {
    eprint(
      `\n— TokenLift — model=${result.model} | ` +
      `tok in/out=${result.inTokens}/${result.outTokens} | ${fmtMs(result.durationMs)} | ` +
      `Bedrock 환산 절감(추정) ${fmtUsd(sav.grossUsd)}`
    );
  }
}

// ---------- 서브명령 구현 ----------
async function cmdModels(config) {
  const installed = await ollama.listModels({ host: config.ollama.host }).catch((e) => {
    eprint(e.message);
    process.exit(1);
  });
  const names = new Set(installed.map((m) => m.name));
  console.log('# 설치된 모델');
  for (const m of installed) {
    console.log(`  ${m.name}  (${m.sizeGb}GB, ${m.params || '?'}, ${m.family || '?'})`);
  }
  console.log('\n# 라우팅 매핑 (task → model)');
  const byTask = config.routing.byTask;
  for (const [t, model] of Object.entries(byTask)) {
    const ok = names.has(model) ? '✅' : '⚠️ 미설치';
    console.log(`  ${t.padEnd(10)} → ${model}  ${ok}`);
  }
  console.log(`  ${'(default)'.padEnd(10)} → ${config.routing.default}`);
}

async function cmdDoctor(config) {
  console.log('# TokenLift 환경 점검');
  const paths = configPaths();
  console.log(`Node: ${process.version}`);
  console.log(`설정(패키지): ${paths.package}`);
  console.log(`설정(사용자): ${fs.existsSync(paths.user) ? paths.user : '(없음)'}`);
  console.log(`Ollama 호스트: ${config.ollama.host}`);
  const alive = await ollama.ping({ host: config.ollama.host });
  console.log(`Ollama 연결: ${alive ? '✅ OK' : '❌ 실패'}`);
  if (!alive) {
    console.log('  → Ollama 를 실행하세요: ollama serve');
    process.exit(1);
  }
  const installed = await ollama.listModels({ host: config.ollama.host });
  const names = new Set(installed.map((m) => m.name));
  const required = new Set([...Object.values(config.routing.byTask), config.routing.default, config.routing.fallback]);
  let missing = 0;
  console.log('필수 모델 점검:');
  for (const m of required) {
    const ok = names.has(m);
    if (!ok) missing++;
    console.log(`  ${ok ? '✅' : '❌'} ${m}${ok ? '' : '  → ollama pull ' + m}`);
  }
  console.log(missing === 0 ? '\n모든 라우팅 모델 사용 가능 ✅' : `\n${missing}개 모델 미설치 ⚠️`);
}

async function cmdWarmup(config, flags) {
  const model = flags.model || config.routing.default;
  eprint(`워밍업: ${model} 적재 중...`);
  const r = await ollama.warmup({ host: config.ollama.host, model, keepAlive: config.ollama.keepAlive, timeoutMs: config.ollama.timeoutMs });
  console.log(`✅ ${model} 적재 완료 (${fmtMs(r.durationMs)})`);
}

async function cmdRoute(config, flags) {
  const desc = flags._.join(' ').trim() || (await readStdin()).trim();
  if (!desc) {
    eprint('작업 설명을 입력하세요. 예) tokenlift route "결제 모듈 테스트 코드 작성"');
    process.exit(2);
  }
  const rec = recommend(desc, config);
  if (flags.json) return console.log(JSON.stringify(rec, null, 2));
  console.log(`라우팅 추천: ${rec.route.toUpperCase()}${rec.task ? ` (task=${rec.task})` : ''}`);
  if (rec.model) console.log(`권장 모델: ${rec.model}`);
  console.log(`신뢰도: ${rec.confidence}`);
  console.log(`근거: ${rec.reason}`);
  if (rec.route === 'ollama' && rec.task) {
    console.log(`\n실행 예: tokenlift ${rec.task} "<지시>" -f <파일> -m ${rec.model}`);
  }
}

main().catch((err) => {
  eprint(`오류: ${err.message}`);
  process.exit(1);
});
