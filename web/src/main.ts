// 화면 제어: 시작 → 질문 하나씩 → 결과. 답은 이 브라우저의 localStorage 에만 저장한다.
import { kb, formDef } from './data.ts';
import type { Answers } from './engine/types.ts';
import { visibleSteps, expandAnswers, itemValues, dementiaAnswer, adlAnswer, isAnswered, otherKey, UNKNOWN } from './engine/answers.ts';
import { estimate } from './engine/scoring.ts';
import { buildResult } from './engine/result.ts';
import { copyText } from './engine/guide.ts';
import { renderStart, renderStep, renderIntroDialog } from './ui/questions.ts';
import { renderResult } from './ui/result.ts';
import { buildForm } from './engine/form.ts';
import { renderForm } from './ui/form.ts';

const STORE_KEY = 'ltc-selfcheck-v2';
type Screen = 'start' | 'result' | 'form' | string; // string = 질문 ID
interface State { answers: Answers; screen: Screen; returnToResult?: boolean; finished?: boolean; checks?: Record<string, boolean> } // checks: 결과 화면 서류·입소 준비 체크 (이 브라우저에만) // returnToResult: 결과 화면의 '다시 답하기'로 들어온 경우, finished: 결과까지 본 적 있음

function load(): State {
  try {
    const s = JSON.parse(localStorage.getItem(STORE_KEY) ?? 'null');
    // 새로고침하면 늘 시작 화면에서 '이어서 하기 / 결과 다시 보기 / 처음부터'를 고르게 한다 (같은 화면에 갇힌 것처럼 보이지 않게)
    if (s && typeof s === 'object' && s.answers && typeof s.answers === 'object') return { answers: s.answers, screen: 'start', finished: !!s.finished || s.screen === 'result' || s.screen === 'form', checks: s.checks && typeof s.checks === 'object' ? s.checks : {} };
  } catch { /* 저장소를 쓸 수 없으면 새로 시작 */ }
  try { localStorage.removeItem('ltc-selfcheck-v1'); } catch { /* 예전 버전 저장값 */ }
  return { answers: {}, screen: 'start' };
}
let state = load();
const persist = () => { try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch { /* 개인정보 보호 모드 등 */ } };
const app = document.getElementById('app')!;
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const steps = () => visibleSteps(kb, state.answers);

/** 몸 상태 질문을 절반 넘게 답하면 지금까지의 예상 등급을 작게 보여준다 */
function liveEstimate(): string | undefined {
  const body = kb.questionnaire.steps.filter((s) => s.stage === 'body' && s.type === 'single');
  if (body.filter((s) => typeof state.answers[s.id] === 'string' && state.answers[s.id] !== UNKNOWN).length < Math.ceil(body.length / 2)) return undefined;
  const a = expandAnswers(kb, state.answers);
  return estimate(kb, { values: itemValues(kb, a), dementia: dementiaAnswer(a), adl: adlAnswer(a) }).label + ' 예상';
}

/** 화면을 바꿀 때마다 브라우저 기록을 하나 남긴다 → 핸드폰 뒤로 가기·쓸어넘기기가 이전 질문으로 간다 (사이트를 나가지 않음) */
interface Hist { screen: Screen; depth: number; rtr?: boolean }
const hist = (): Hist | null => (history.state && typeof history.state.depth === 'number' ? history.state : null);
function go(screen: Screen) {
  if (screen !== state.screen) { try { history.pushState({ screen, depth: (hist()?.depth ?? 0) + 1, rtr: !!state.returnToResult } satisfies Hist, ''); } catch { /* 기록을 못 남겨도 화면은 바뀜 */ } }
  show(screen);
}
function show(screen: Screen) {
  state.screen = screen; persist(); render();
  window.scrollTo({ top: 0 });
  (app.querySelector('h1, h2') as HTMLElement | null)?.focus({ preventScroll: true });
}

/** 화면 그리기. 저장된 답이 예전 형식이라 오류가 나면 빈 화면으로 멈추지 않고 새로 시작한다 */
function render() {
  try { draw(); } catch (e) {
    console.error('[화면 오류 → 새로 시작]', e);
    state = { answers: {}, screen: 'start' }; persist();
    app.innerHTML = renderStart(false, steps().length, false, true);
  }
}

function draw() {
  const list = steps();
  if (state.screen === 'start') { app.innerHTML = renderStart(Object.keys(state.answers).length > 0, list.length, !!state.finished); return; }
  if (state.screen === 'result' || state.screen === 'form') {
    state.finished = true; persist();
    const r = buildResult(kb, state.answers, today());
    const form = buildForm(kb, formDef, state.answers, r);
    if (state.screen === 'form' && form) { app.innerHTML = renderForm(form); return; }
    app.innerHTML = renderResult(r, kb, form ? formDef.online : null, state.checks ?? {}); return;
  }
  let i = list.findIndex((s) => s.id === state.screen);
  if (i < 0) { i = firstUnanswered(); state.screen = list[i]?.id ?? 'result'; if (state.screen === 'result') return draw(); }
  app.innerHTML = renderStep(kb, list[i], state.answers, { index: i, total: list.length, next: list[i + 1], live: liveEstimate(), returnToResult: !!state.returnToResult });
}

function firstUnanswered(): number {
  const list = steps();
  return list.findIndex((s) => !isAnswered(s, state.answers) && !(s.optional && state.answers[s.id] !== undefined)); // -1 = 모두 답함
}

function next() {
  if (state.returnToResult) { state.returnToResult = false; go('result'); return; }
  const list = steps();
  const i = list.findIndex((s) => s.id === state.screen);
  go(list[i + 1]?.id ?? 'result');
}
/** 화면의 '이전' 버튼: 기록이 있으면 브라우저 뒤로 가기와 똑같이, 없으면 바로 앞 질문으로 */
function back() {
  if ((hist()?.depth ?? 0) > 0) { history.back(); return; }
  const list = steps();
  const i = list.findIndex((s) => s.id === state.screen);
  go(i <= 0 ? 'start' : list[i - 1].id);
}

/** 결과 화면을 다시 그리되, 펼쳐 둔 칸과 스크롤 위치는 그대로 둔다 */
function redrawKeep() {
  const open = [...app.querySelectorAll('details[open]')].map((d, i) => d.id || `#${i}`);
  const y = window.scrollY;
  render();
  app.querySelectorAll('details').forEach((d, i) => { if (open.includes(d.id || `#${i}`)) (d as HTMLDetailsElement).open = true; });
  window.scrollTo({ top: y });
}

let toastTimer: number | undefined;
function toast(msg: string) {
  let el = document.getElementById('toast');
  if (!el) { el = document.createElement('div'); el.id = 'toast'; el.className = 'toast'; el.setAttribute('role', 'status'); document.body.appendChild(el); }
  el.textContent = msg; el.classList.add('show');
  window.clearTimeout(toastTimer); toastTimer = window.setTimeout(() => el!.classList.remove('show'), 1800);
}
async function copy(text: string) {
  try { await navigator.clipboard.writeText(text); toast('복사했어요'); return; } catch { /* 권한 없음 → 아래 방식 */ }
  const ta = document.createElement('textarea'); ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
  document.body.appendChild(ta); ta.select();
  let ok = false; try { ok = document.execCommand('copy'); } catch { /* 지원 안 함 */ }
  ta.remove(); toast(ok ? '복사했어요' : '복사하지 못했어요. 길게 눌러 직접 복사해 주세요');
}

let advanceTimer: number | undefined;
app.addEventListener('click', (ev) => {
  const t = (ev.target as HTMLElement).closest('[data-act]') as HTMLElement | null;
  if (!t) return;
  const { act, id, val } = t.dataset;
  switch (act) {
    case 'begin': state.answers = {}; go(steps()[0].id); return;
    case 'resume': { const i = firstUnanswered(); go(i < 0 ? 'result' : steps()[i].id); return; }
    case 'show-result': go('result'); return;
    case 'restart': state = { answers: {}, screen: 'start', checks: {} }; persist(); go(steps()[0].id); return;
    case 'edit': state.returnToResult = false; go(steps()[0].id); return;
    case 'form': go('form'); return;
    case 'jump-step': state.returnToResult = true; go(id!); return;
    case 'to-result': state.returnToResult = false; go('result'); return;
    case 'back': back(); return;
    case 'next': next(); return;
    case 'check': {
      const c = (state.checks ??= {}); c[id!] = !c[id!]; if (!c[id!]) delete c[id!]; persist();
      t.classList.toggle('on', !!c[id!]); t.setAttribute('aria-checked', String(!!c[id!]));
      // 준비 개수만 고친다 (다시 그리지 않음)
      app.querySelectorAll<HTMLElement>('[data-prog]').forEach((p) => { const b = p.querySelector('b'); if (b) b.textContent = String(p.dataset.prog!.split(' ').filter((k) => c[k]).length); });
      return;
    }
    case 'role': state.answers.applicant = val; persist(); redrawKeep(); return;
    case 'role-other': state.answers.applicant_other = val; persist(); redrawKeep(); return;
    case 'copy': {
      const r = buildResult(kb, state.answers, today());
      void copy(copyText(t.dataset.kind!, r.guide, kb.guide, state.checks ?? {}));
      return;
    }
    case 'intro': {
      // 소개 영상: 열 때 만들고, 닫으면 멈추고 지운다 (화면을 다시 그려도 영향 없게 body 에 붙임)
      document.querySelector('dialog.intro-dlg')?.remove();
      document.body.insertAdjacentHTML('beforeend', renderIntroDialog(matchMedia('(max-width: 600px)').matches));
      const dlg = document.querySelector('dialog.intro-dlg') as HTMLDialogElement;
      const v = dlg.querySelector('video')!;
      dlg.addEventListener('close', () => { v.pause(); dlg.remove(); });
      dlg.addEventListener('click', (e) => { const el = e.target as HTMLElement; if (e.target === dlg || el.closest('[data-act="intro-close"]')) dlg.close(); });
      dlg.showModal();
      v.play().catch(() => { /* 자동 재생이 막히면 재생 버튼을 누르면 됨 */ });
      return;
    }
    case 'print': app.querySelectorAll('details').forEach((d) => ((d as HTMLDetailsElement).open = true)); window.print(); return;
    case 'pick': {
      state.answers[id!] = val; persist(); render();
      window.clearTimeout(advanceTimer);
      advanceTimer = window.setTimeout(next, 260); // 고르면 바로 다음 질문으로
      return;
    }
    case 'chip': {
      const cur = Array.isArray(state.answers[id!]) ? [...(state.answers[id!] as string[])] : [];
      const k = cur.indexOf(val!); if (k >= 0) cur.splice(k, 1); else cur.push(val!);
      state.answers[id!] = cur; persist(); render(); return;
    }
    case 'chip-none': state.answers[id!] = []; persist(); render(); window.clearTimeout(advanceTimer); advanceTimer = window.setTimeout(next, 260); return;
    case 'other-toggle': {
      // 목록에 없어요 · 직접 적기: 열기 / (비어 있으면) 닫기. 적은 내용이 있으면 닫지 않는다
      const k = otherKey(id!); const cur = state.answers[k];
      if (cur === undefined) state.answers[k] = '';
      else if (typeof cur === 'string' && cur.trim() === '') delete state.answers[k];
      persist(); render();
      (app.querySelector(`textarea[data-id="${CSS.escape(id!)}"]`) as HTMLTextAreaElement | null)?.focus();
      return;
    }
  }
});
// 직접 적기: 입력 중에는 화면을 다시 그리지 않고 저장만 (커서가 튀지 않게)
app.addEventListener('input', (ev) => {
  const el = ev.target as HTMLTextAreaElement;
  if (el.dataset.act !== 'other-text') return;
  state.answers[otherKey(el.dataset.id!)] = el.value.slice(0, 300); persist();
  const round = app.querySelector('[data-act="next"]') as HTMLButtonElement | null;
  const s = steps().find((x) => x.id === el.dataset.id);
  if (round && s) round.disabled = !isAnswered(s, state.answers);
});
app.addEventListener('change', (ev) => {
  const el = ev.target as HTMLInputElement;
  if (el.dataset.act === 'date') { state.answers[el.dataset.id!] = el.value || undefined; persist(); render(); }
});
window.addEventListener('popstate', (ev) => {
  const h = ev.state as Hist | null;
  window.clearTimeout(advanceTimer);
  const screen = h?.screen ?? 'start';
  // 지금 답으로는 보이지 않는 질문이면 (앞 답을 바꿔 갈래가 달라진 경우) 그 앞의 보이는 질문으로
  const isStep = !['start', 'result', 'form'].includes(screen);
  state.returnToResult = isStep && !!h?.rtr;
  show(isStep && !steps().some((s) => s.id === screen) ? (steps().find((s) => !isAnswered(s, state.answers))?.id ?? 'result') : screen);
});
window.addEventListener('beforeprint', () => app.querySelectorAll('details').forEach((d) => ((d as HTMLDetailsElement).open = true)));

const errs = kb.integrity();
if (errs.length) console.error('[근거 DB 무결성 오류]', errs);
try { history.replaceState({ screen: state.screen, depth: 0 } satisfies Hist, ''); } catch { /* 무시 */ }
render();
