#!/usr/bin/env node
// 돌봄기관 매일 수집 진행 상황 (바탕화면 바로가기 "모심듀오 기관 수집 진행 상황 보기")
//
//   node tools/facilities/status.mjs           한 번 보여 주고 끝
//   node tools/facilities/status.mjs --watch   5초마다 다시 그림
//
// 읽기만 한다: data/facilities/raw/daily.log(run-daily.cmd 기록)와 받은 파일 수를 보고 단계별 진행을 그린다.
// 창을 닫아도 수집에는 영향이 없다.
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serviceOf } from './lib.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const RAW = join(ROOT, 'data', 'facilities', 'raw');
const LOG = join(RAW, 'daily.log');
const TASK = 'MosimDuo-FacilityCollect';
const DAILY_MAX = 9000; // run-daily.cmd 의 --max (기능별 하루 호출 상한)
const REFRESH_DAYS = 14; // run-daily.cmd 의 --days (이보다 오래된 기관을 다시 받음)

// 단계 순서는 run-daily.cmd 와 같다. 마지막 칸 = 그 단계가 끝났음을 알리는 로그 줄
const STEPS = [
  ['list', '기관 목록 받기', '새로 생기거나 문 닫은 기관 확인 (실패하면 이전 목록 유지)', /^장기요양기관 \d/],
  ['detail', '기관 상세 받기', `받은 지 ${REFRESH_DAYS}일 지난 기관을 다시 받음 (하루 9,000곳까지, 다음 날 이어 받음)`, /^상세 \d/],
  ['geo', '지도 좌표 ①', '도로명주소 API (키가 있을 때만, 없으면 건너뜀)', /^좌표 성공/],
  ['geo-addr', '지도 좌표 ②', '새 기관 위치 — 실제로 쓰는 길 (우체국 주소 → 브이월드)', /^좌표 성공/],
  ['build', '사이트 자료 만들기', '시도별 기관 목록 파일 생성', /^시도별 기관 수/],
  ['publish', '사이트에 올리기', '바뀐 자료를 커밋·푸시 → 사이트 다시 배포', /^(published facility data|no facility data change)/],
];

const n = (v) => (Number.isFinite(v) ? v.toLocaleString('ko-KR') : '—');
const time = (v) => (v ? new Date(v).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }) : '—');
const when = (v) => (v ? new Date(v).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');
const dur = (ms) => { if (!Number.isFinite(ms)) return ''; const m = Math.round(ms / 60000); return m < 1 ? '1분 미만' : m < 60 ? `${m}분` : `${Math.floor(m / 60)}시간 ${m % 60}분`; };
const ago = (v) => { const m = Math.round((Date.now() - v) / 60000); return m < 1 ? '방금' : `${m}분 전`; };

// cmd 의 %date% %time% → "2026-11-04  9:00:01.80"
const cmdTime = (s) => { const m = s.match(/(\d{4})-(\d\d)-(\d\d)\s+(\d{1,2}):(\d\d):(\d\d)/); return m ? new Date(+m[1], m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime() : null; };

/** daily.log 를 실행 단위(start ~ end)로 나누고, 실행마다 단계별 시작·끝·결과를 정리 */
export function parseRuns(text) {
  const runs = [];
  let run = null;
  for (const line of text.split(/\r?\n/)) {
    if (/^===== .* start/.test(line)) {
      run = { start: cmdTime(line), end: null, steps: STEPS.map(() => ({ start: null, end: null, status: 'waiting', lines: [] })), idx: 0 };
      run.steps[0].start = run.start;
      runs.push(run);
      continue;
    }
    if (!run) continue;
    if (/^===== .* end/.test(line)) { run.end = cmdTime(line); continue; }
    const mark = line.match(/^>> (\S+) (start|end) (\S+)/);
    if (mark) {
      const i = STEPS.findIndex(([k]) => k === mark[1]);
      if (i < 0) continue;
      const at = Date.parse(mark[3]);
      if (mark[2] === 'start') {
        run.steps[i].start = at;
        if (i > 0 && !run.steps[i - 1].end) run.steps[i - 1].end = at;
        run.idx = i;
      } else {
        run.steps[i].end = at;
        if (run.steps[i].status !== 'failed' && run.steps[i].status !== 'skipped') run.steps[i].status = 'ok';
        run.idx = i + 1;
        if (run.steps[i + 1] && !run.steps[i + 1].start) run.steps[i + 1].start = at;
      }
      continue;
    }
    const s = run.steps[run.idx];
    if (!s) continue;
    s.lines.push(line);
    if (/^Node\.js v/.test(line)) { // node 가 오류로 멈춤 → 그 단계 실패, cmd 는 다음 단계로 넘어감
      s.status = 'failed';
      s.error = [...s.lines].reverse().map((l) => l.match(/Error: (.+)/)?.[1]).find(Boolean) ?? '오류';
      // 11/4 이전 기록: 도로명주소 키가 없어 멈춘 것은 실패가 아니라 건너뜀 (좌표는 ②가 받음)
      if (/JUSO_COORD_API_KEY/.test(s.error)) s.status = 'skipped';
      run.idx++;
    } else if (/^좌표 ① 건너뜀/.test(line)) {
      s.status = 'skipped';
    } else if (STEPS[run.idx][3].test(line)) {
      s.status = 'ok';
      if (STEPS[run.idx][0] === 'publish' || !s.end) run.idx++; // 끝 표시(>> end)가 없던 예전 기록
    } else if (STEPS[run.idx][0] === 'publish' && /^(error|fatal):|\[rejected\]/.test(line)) {
      s.warn = line.trim().slice(0, 60);
    }
  }
  for (const r of runs) {
    for (const s of r.steps) if (s.status === 'waiting' && s.lines.length) s.status = 'running';
    if (r.end) for (const s of r.steps) if (s.status === 'running' || s.status === 'waiting') s.status = s.lines.length ? 'ok' : 'skipped';
  }
  return runs;
}

// 상세를 받아야 하는 기관 (복지용구 사업소만 하는 곳은 받지 않음 — collect.mjs detail 과 같은 기준)
let targets = null, targetsAt = 0;
function detailTargets() {
  const p = join(RAW, 'ltc_list.json');
  const m = existsSync(p) ? statSync(p).mtimeMs : 0;
  if (!targets || m !== targetsAt) {
    const { items = [] } = existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : {};
    targets = new Set(items.filter((f) => f.types.some((t) => serviceOf(t) && serviceOf(t) !== 'welfare_tool')).map((f) => f.sym));
    targetsAt = m;
  }
  return targets;
}

/** 받은 기관 수(전체 누적)와, since 이후에 새로 받은 기관 수 */
function detailFiles(since) {
  const dir = join(RAW, 'detail');
  const want = detailTargets();
  let got = 0, recent = 0, due = 0;
  for (const f of existsSync(dir) ? readdirSync(dir) : []) {
    if (!want.has(f.slice(0, -5))) continue;
    got++;
    const at = statSync(join(dir, f)).mtimeMs;
    if (since && at >= since) recent++;
    if (Date.now() - at > REFRESH_DAYS * 864e5) due++;
  }
  return { total: want.size, got, recent, due };
}

function stepNote(key, s, run, prev, live) {
  const last = (re) => [...s.lines].reverse().map((l) => l.match(re)).find(Boolean);
  if (s.status === 'failed') return `실패 — ${s.error.slice(0, 50)}`;
  if (s.status === 'skipped') return key === 'geo' ? '건너뜀 (도로명주소 키 없이 ②로 받음 — 정상)' : '건너뜀';
  const took = s.start && s.end ? `${dur(s.end - s.start)} 걸림` : '';
  if (s.status === 'ok') {
    if (key === 'detail') {
      const m = last(/^상세 (\d+)곳 받음.*?(한도에서 멈춤)?/);
      return [took, m && `${n(+m[1])}곳 받음${m[2] ? ' (오늘 한도까지)' : ''}`].filter(Boolean).join(' · ');
    }
    if (key === 'geo' || key === 'geo-addr') { const m = last(/^좌표 성공 (\d+), 실패 (\d+)/); return [took, m && `성공 ${n(+m[1])} · 못 찾음 ${n(+m[2])}`].filter(Boolean).join(' · '); }
    if (key === 'publish') return [took, last(/^published/) ? '사이트에 올림' : last(/^no facility/) ? '바뀐 자료 없음' : '', s.warn && `주의: ${s.warn}`].filter(Boolean).join(' · ');
    return took;
  }
  if (s.status !== 'running') {
    const p = prev?.steps[STEPS.findIndex(([k]) => k === key)];
    return p?.start && p?.end ? `대기 · 보통 ${dur(p.end - p.start)}` : '대기';
  }
  const spent = Date.now() - (s.start ?? run.start);
  if (key === 'detail') {
    const rate = live.recent / Math.max(1, spent); // 곳/ms
    const goal = Math.min(DAILY_MAX, live.total - live.got + live.due + live.recent);
    s.left = rate > 0 ? Math.max(0, goal - live.recent) / rate : NaN;
    return `진행 중 ${dur(spent)} · 오늘 ${n(live.recent)} / 약 ${n(goal)}곳${Number.isFinite(s.left) ? ` · 약 ${dur(s.left)} 남음` : ''}`;
  }
  if (key === 'geo' || key === 'geo-addr') {
    const need = last(/좌표 필요 (\d+)곳 \(이번 실행 최대 (\d+)\)/);
    const done = last(/^\s*(\d+)곳 처리/);
    const goal = need ? Math.min(+need[1], +need[2]) : NaN, doneN = done ? +done[1] : 0;
    if (doneN > 0 && goal) s.left = (spent / doneN) * Math.max(0, goal - doneN);
    return `진행 중 ${dur(spent)}${need ? ` · ${n(doneN)} / ${n(goal)}곳` : ''}${Number.isFinite(s.left) ? ` · 약 ${dur(s.left)} 남음` : ''}`;
  }
  return `진행 중 ${dur(spent)}`;
}

function runLines(run, prev, live) {
  const out = [];
  STEPS.forEach(([key, name, what], i) => {
    const s = run.steps[i];
    const mark = { ok: '✔', failed: '✖', running: '▶', skipped: '-', waiting: '·' }[s.status];
    out.push(`  ${mark} ${i + 1}. ${name.padEnd(9, '　')} ${stepNote(key, s, run, prev, live)}`);
    out.push(`       ${what}`);
  });
  if (!run.end) {
    // 남은 시간: 지금 단계는 자기 속도로, 뒤 단계는 지난번 같은 단계 걸린 시간으로
    let left = 0, unknown = false;
    run.steps.forEach((s, i) => {
      if (s.status === 'running') { if (Number.isFinite(s.left)) left += s.left; else unknown = true; }
      if (s.status === 'waiting') {
        const p = prev?.steps[i];
        if (p?.start && p?.end) left += p.end - p.start; else unknown = true;
      }
    });
    const doneCount = run.steps.filter((s) => s.status !== 'running' && s.status !== 'waiting').length;
    out.push('');
    out.push(unknown
      ? `  진행: ${doneCount} / ${STEPS.length} 단계 완료 · 끝나는 시각은 아직 계산 못 함 (처음 재는 단계가 있음)`
      : `  진행: ${doneCount} / ${STEPS.length} 단계 완료 · 남은 시간 약 ${dur(left)} · 예상 종료 ${time(Date.now() + left)}`);
  }
  return out;
}

const result = (r) => (r.steps.some((s) => s.status === 'failed') ? '완료 (일부 단계 실패)' : '완료');

let taskCache = { at: 0, exists: true };
function taskExists() {
  if (Date.now() - taskCache.at > 60000) {
    try { execFileSync('schtasks', ['/Query', '/TN', TASK], { stdio: 'ignore' }); taskCache = { at: Date.now(), exists: true }; } catch { taskCache = { at: Date.now(), exists: false }; }
  }
  return taskCache.exists;
}

function lastPublish() {
  try { return Date.parse(execFileSync('git', ['log', '-1', '--format=%cI', '--', 'web/public/facilities'], { cwd: ROOT, encoding: 'utf8' }).trim()) || null; } catch { return null; }
}

function render() {
  const lines = [`모심듀오 기관 수집 진행 상황  ·  ${new Date().toLocaleString('ko-KR')}  (5초마다 갱신, 창을 닫아도 수집은 계속됩니다)`, ''];
  const text = existsSync(LOG) ? readFileSync(LOG, 'utf8') : '';
  const runs = parseRuns(text);
  const run = runs.at(-1), prev = runs.at(-2);
  const logAt = existsSync(LOG) ? statSync(LOG).mtimeMs : 0;
  const live = detailFiles(run && !run.end ? run.start : null);

  if (!run) lines.push('■ 아직 실행 기록 없음');
  else if (!run.end) {
    const stale = Date.now() - logAt > 30 * 60000;
    lines.push(`▶ 실행 중: 오늘 ${time(run.start)} 시작 · ${dur(Date.now() - run.start)}째 · 마지막 기록 ${ago(logAt)}`);
    if (stale) lines.push('  ! 30분 넘게 기록이 없습니다 — 컴퓨터가 꺼졌거나 중간에 멈췄을 수 있어요 (내일 9시에 이어서 받음)');
    lines.push('', ...runLines(run, prev, live));
  } else {
    lines.push(`■ ${result(run)}: ${when(run.start)} 시작 → ${time(run.end)} 끝 (${dur(run.end - run.start)})`, '', ...runLines(run, prev, live));
  }

  lines.push('', '── 전체 진행 ──');
  const left = live.total - live.got;
  const todo = left + live.due;
  lines.push(`  기관 상세  ${n(live.got)} / ${n(live.total)}곳 받음 (받을 차례 ${n(todo)}곳${todo > 0 ? ` · 하루 9,000곳씩이면 약 ${Math.ceil(todo / DAILY_MAX)}일` : ' · 모두 최근 자료'})`);
  const pub = lastPublish();
  lines.push(`  사이트 반영  마지막 ${pub ? when(pub) : '기록 없음'}`);
  lines.push(`  다음 실행  ${taskExists() ? `매일 오전 9시 (${REFRESH_DAYS}일 지난 기관만 다시 받음)` : '예약 없음'}`);

  const history = runs.slice(-5, -1).filter((r) => r.end).reverse(); // 맨 위에 보이는 실행은 빼고
  if (history.length) {
    lines.push('', '── 지난 실행 ──');
    for (const r of history) {
      const got = [...r.steps[STEPS.findIndex(([k]) => k === 'detail')].lines].reverse().map((l) => l.match(/^상세 (\d+)곳 받음/)).find(Boolean);
      lines.push(`  ${when(r.start)} → ${time(r.end)}  ${result(r)}${got ? ` · 상세 ${n(+got[1])}곳` : ''}`);
    }
  }
  return lines.join('\n');
}

if (process.argv.includes('--watch')) {
  for (;;) { process.stdout.write('\x1Bc' + render() + '\n'); await new Promise((r) => setTimeout(r, 5000)); }
} else console.log(render());
