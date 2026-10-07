// 시작 화면 + 질문 화면 (한 화면에 질문 하나). Claude Design 캔버스 시안(1~3번 화면)을 옮김.
import type { Kb, Step } from '../engine/kb.ts';
import type { Answers } from '../engine/types.ts';
import { UNKNOWN, isAnswered, otherKey } from '../engine/answers.ts';
import { esc, attr } from './html.ts';

const pressed = (b: boolean) => `aria-pressed="${b}"`;
const ICON = {
  back: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg>',
  next: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>',
  play: '<svg width="12" height="12" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4.5v15l13-7.5z" fill="currentColor"/></svg>',
  check: '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12l5 5 9-10"/></svg>',
};

export function renderStart(hasSaved: boolean, stepCount: number, finished = false, recovered = false): string {
  const buttons = finished && hasSaved
    ? `<div class="links no-print"><button type="button" class="link" data-act="edit">답 고치기</button><button type="button" class="link" data-act="restart">처음부터 다시</button></div>`
    : hasSaved ? `<div class="links no-print"><button type="button" class="link" data-act="restart">처음부터 다시</button></div>` : '';
  const act = finished && hasSaved ? 'show-result' : hasSaved ? 'resume' : 'begin';
  const label = finished && hasSaved ? '결과 다시 보기' : hasSaved ? '이어서 하기' : '시작하기';
  return `
  <section class="card" aria-labelledby="start-title">
    <div class="topbar"><a class="brand" href="index.html"><img src="brand/mosimduo-symbol.svg" alt="" width="22" height="22" />모심듀오</a><button type="button" class="intro-btn no-print" data-act="intro">${ICON.play}소개 영상</button></div>
    <p class="greet">${hasSaved ? '다시 오셨네요' : '시작해 볼게요'}</p>
    <div class="bar"><i style="width:${hasSaved ? 50 : 4}%"></i></div>
    <h1 id="start-title" class="question" tabindex="-1">부모님을 요양원에<br>모실 수 있을까요?</h1>
    <p class="lead">질문에 하나씩 누르기만 하면<br>무엇이 되는지, 무엇을 준비할지 알려드려요.</p>
    <ul class="gets"><li>요양원에 모실 수 있는지</li><li>예상 장기요양등급</li><li>해야 할 일과 서류</li></ul>
    <p class="meta" style="margin-top:34px">질문 ${stepCount}개 안팎 · 약 3분 · 이름·주민번호는 묻지 않아요</p>
    ${recovered ? '<p class="meta" style="margin-top:8px">저장된 답을 불러오지 못해 처음부터 시작해요.</p>' : ''}
    ${buttons}
    <div class="foot row">
      <div class="preview"><small>${esc(label)}</small><p>${finished && hasSaved ? '지난 결과를<br>다시 볼게요' : hasSaved ? '멈춘 곳부터<br>이어서 할게요' : '어르신 연세가<br>어떻게 되세요?'}</p></div>
      <button type="button" class="round" data-act="${act}">${esc(finished && hasSaved ? '결과 보기' : hasSaved ? '이어서' : '시작하기')}${ICON.next}</button>
    </div>
    <p class="fine">참고용 안내예요. 등급과 급여는 국민건강보험공단이 결정해요.</p>
  </section>`;
}

function greeting(i: number, n: number): string {
  if (i === n - 1) return '마지막 질문이에요';
  const r = i / n;
  if (r < 0.2) return '시작해 볼게요';
  if (r < 0.5) return '잘하고 계세요';
  if (r < 0.8) return '절반 넘었어요';
  return '거의 다 왔어요';
}

function single(s: Step, v: unknown): string {
  const opts = (s.options ?? []).map((o) =>
    `<button type="button" class="pill${o.wide ? ' wide' : ''}" data-act="pick" data-id="${attr(s.id)}" data-val="${attr(o.value)}" ${pressed(v === o.value)}>${esc(o.label)}${o.hint ? `<small>${esc(o.hint)}</small>` : ''}</button>`).join('');
  return `<div class="pills${s.layout === 'grid' ? ' grid' : ''}" role="group" aria-label="${attr(s.text)}">${opts}
    <button type="button" class="pill unknown${s.layout === 'grid' ? ' wide' : ''}" data-act="pick" data-id="${attr(s.id)}" data-val="${UNKNOWN}" ${pressed(v === UNKNOWN)}>잘 모르겠어요</button></div>`;
}

/** 목록에서 여러 개 고르기 (묶음 제목 + 체크 알약 + 목록에 없어요·직접 적기) */
function checklist(s: Step, raw: Answers): string {
  const v = raw[s.id];
  const sel = Array.isArray(v) ? (v as string[]) : [];
  const opts = s.options ?? [];
  const groups: { title: string; items: typeof opts }[] = [];
  for (const o of opts) {
    const g = o.group ?? '';
    const last = groups[groups.length - 1];
    if (last && last.title === g) last.items.push(o); else groups.push({ title: g, items: [o] });
  }
  const btn = (value: string, label: string, on: boolean, act = 'chip') =>
    `<button type="button" class="check" data-act="${act}" data-id="${attr(s.id)}" data-val="${attr(value)}" ${pressed(on)}><span class="dot">${on ? ICON.check : ''}</span>${esc(label)}</button>`;
  let html = groups.map((g) => `${g.title ? `<p class="group-h">${esc(g.title)}</p>` : ''}<div class="checks"${g.title ? '' : ' style="margin-top:30px"'}>${g.items.map((o) => btn(o.value, o.label, sel.includes(o.value))).join('')}</div>`).join('');

  if (s.other) {
    const k = otherKey(s.id);
    const open = raw[k] !== undefined;
    html += `<p class="group-h">목록에 없는 것</p>
      <div class="other">
        ${btn('other', '목록에 없어요 · 직접 적기', open, 'other-toggle')}
        ${open ? `<label for="o-${attr(s.id)}">어떤 점이 달라지셨나요?</label>
        <textarea id="o-${attr(s.id)}" data-act="other-text" data-id="${attr(s.id)}" maxlength="300" rows="4" placeholder="예: 밤마다 가스레인지를 켜려고 하세요">${esc(raw[k] ?? '')}</textarea>
        <p>적은 내용은 점수에 넣지 않고, 결과의 '방문조사 때 말씀할 내용'과 신청서 사유 예시에 그대로 보여드려요. 기본적으로 이 기기에 저장되며, 자료 요청에서 답변 저장에 따로 동의하면 모심듀오에도 전달돼요.</p>` : ''}
      </div>`;
  }
  if (!s.gate) {
    // 먼저 묻기가 없는 여러 개 고르기(주거 문제): 해당 없음·잘 모르겠어요를 함께 둔다
    html += `<div class="pills" style="margin-top:20px;flex-direction:row;flex-wrap:wrap;gap:10px">
      <button type="button" class="pill unknown" data-act="chip-none" data-id="${attr(s.id)}" ${pressed(Array.isArray(v) && sel.length === 0)}>${esc(s.none_label ?? '해당 없어요')}</button>
      <button type="button" class="pill unknown" data-act="pick" data-id="${attr(s.id)}" data-val="${UNKNOWN}" ${pressed(v === UNKNOWN)}>잘 모르겠어요</button></div>`;
  }
  return html;
}

function date(s: Step, v: unknown): string {
  return `<div class="pills">
    <input type="date" aria-label="${attr(s.text)}" data-act="date" data-id="${attr(s.id)}" value="${typeof v === 'string' && v !== UNKNOWN ? attr(v) : ''}" style="margin-top:0" />
    <button type="button" class="pill unknown" data-act="pick" data-id="${attr(s.id)}" data-val="${UNKNOWN}" ${pressed(v === UNKNOWN)}>몰라요 · 건너뛰기</button></div>`;
}

export function renderStep(kb: Kb, s: Step, raw: Answers, pos: { index: number; total: number; next?: Step; live?: string; returnToResult?: boolean }): string {
  const v = raw[s.id];
  const stages = kb.questionnaire.stages;
  const stageIdx = stages.findIndex((x) => x.id === s.stage);
  const pct = Math.round((pos.index / pos.total) * 100);
  const body = s.type === 'single' ? single(s, v) : s.type === 'chips' ? checklist(s, raw) : date(s, v);
  const canNext = isAnswered(s, raw) || !!s.optional;
  const chosen = s.type === 'chips' && Array.isArray(v) ? (v as string[]).length : 0;
  const top = pos.returnToResult
    ? '<button type="button" class="mini" data-act="to-result">결과로 돌아가기</button>'
    : `<span class="count">${pos.index + 1} / ${pos.total}</span>`;
  const previewLabel = pos.returnToResult ? '답을 고르면' : chosen ? `<b>${chosen}개</b> 골랐어요` : pos.next ? '다음 질문' : '다 왔어요';
  const previewText = pos.returnToResult ? '결과로<br>돌아가요' : pos.next ? esc(pos.next.text) : '결과<br>보기';
  return `
  <section class="card" aria-labelledby="q-${attr(s.id)}">
    <div class="topbar"><a class="brand" href="index.html"><img src="brand/mosimduo-symbol.svg" alt="" width="22" height="22" />모심듀오</a>${top}</div>
    <p class="greet">${esc(greeting(pos.index, pos.total))}</p>
    <div class="bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}" aria-label="진행"><i style="width:${Math.max(4, pct)}%"></i></div>
    <p class="stage"><span>${stageIdx + 1}단계 · ${esc(stages[stageIdx]?.title ?? '')}</span>${pos.live ? `<span>지금까지 보면 <b>${esc(pos.live)}</b></span>` : ''}</p>
    <h2 id="q-${attr(s.id)}" class="question" tabindex="-1">${esc(s.text)}</h2>
    ${s.note ? `<div class="note-box"><span>${esc(s.note).replace('꼭 &#39;있어요&#39;', '<b>꼭 &#39;있어요&#39;</b>')}</span></div>` : ''}
    ${s.hint ? `<p class="hint">${esc(s.hint)}</p>` : ''}
    ${body}
    <div class="foot">
      <div class="preview"><small>${previewLabel}</small><p>${previewText}</p></div>
      <div class="nav">
      <button type="button" class="round prev" data-act="back">${ICON.back}이전</button>
      <button type="button" class="round" data-act="next" ${canNext ? '' : 'disabled'}>${pos.returnToResult ? '결과로' : pos.next ? '다음' : '결과 보기'}${ICON.next}</button>
      </div>
    </div>
  </section>`;
}
