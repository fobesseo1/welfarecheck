// 신청서 작성 도우미 화면 (Claude Design 캔버스 6번 시안)
import type { FilledForm } from '../engine/form.ts';
import { esc, attr } from './html.ts';

const ICON = {
  back: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg>',
  out: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 17L17 7"/><path d="M8 7h9v9"/></svg>',
  print: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 9V3h10v6"/><rect x="4" y="9" width="16" height="8" rx="2"/><path d="M7 14h10v7H7z"/></svg>',
};
const SHORT: Record<string, string> = {
  '장기요양인정 신청서': '인정 신청', '장기요양인정 갱신신청서': '갱신', '장기요양등급 변경신청서': '등급 변경', '장기요양 급여종류ㆍ내용 변경신청서': '급여종류·내용 변경',
};

export function renderForm(f: FilledForm): string {
  return `
  <section class="card" aria-labelledby="form-title">
    <div class="topbar"><button type="button" class="icon-btn no-print" data-act="to-result" aria-label="결과로 돌아가기">${ICON.back}</button><span class="count">별지 제1호의2서식</span></div>
    <h2 id="form-title" class="greet" tabindex="-1">신청서, 이렇게 쓰면 돼요</h2>
    <p class="lead" style="margin-top:10px;font-size:13px">답하신 내용으로 채울 수 있는 칸은 채웠어요.<br>'직접' 칸만 쓰시면 돼요. 이 내용은 저장되지 않아요.</p>

    <a class="btn-mint no-print" style="align-self:flex-start;margin-top:22px" href="${attr(f.online.url)}" target="_blank" rel="noopener noreferrer">누리집에서 온라인 신청${ICON.out}</a>
    <span class="fhint no-print">${esc(f.online.note)}</span>

    <p class="sub-h" style="margin-top:36px;margin-bottom:12px">신청서 종류</p>
    <div class="kinds">${f.kinds.map((k) => `<span class="kind${k.on ? ' on' : ''}" title="${attr(k.desc)}">${esc(SHORT[k.label] ?? k.label)}</span>`).join('')}</div>

    ${f.sections.map((s) => `
      <p class="sub-h" style="margin-top:36px">${esc(s.title)}</p>
      ${s.fields.map((x) => {
        if (x.checks) return `<div class="frow plain"><span style="display:flex;gap:12px"><span class="fno">${esc(x.no)}</span><span class="flab">${esc(x.label)}</span></span>
          <div class="fchecks" style="padding-left:40px">${x.checks.slice(0, 3).map((c) => `<span class="kind${c.on ? ' on' : ''}">${esc(c.label)}</span>`).join('')}</div>
          ${x.hint ? `<p class="fhint" style="padding-left:40px;margin:0">${esc(x.hint)}</p>` : ''}</div>`;
        if (x.kind === 'draft') return `<div class="frow plain"><span style="display:flex;gap:12px"><span class="fno">${esc(x.no)}</span><span class="flab">${esc(x.label)} · 예시</span></span>
          ${x.value ? `<div class="fdraft" style="width:100%">${esc(x.value)}</div>` : ''}
          ${x.hint ? `<p class="fhint" style="margin:0">${esc(x.hint)}</p>` : ''}</div>`;
        return `<div class="frow"><span class="fno">${esc(x.no)}</span><span class="flab">${esc(x.label)}</span><span class="ftag">직접</span></div>${x.hint ? `<p class="fhint">${esc(x.hint)}</p>` : ''}`;
      }).join('')}`).join('')}

    <p class="sub-h" style="margin-top:36px">함께 낼 서류</p>
    <ul class="docs">${f.attachments.map((x) => `<li><span class="box" aria-hidden="true"></span><span class="dn">${esc(x.label)}<small>${esc(x.detail)}</small></span></li>`).join('')}</ul>

    ${f.cautions.map((c) => `<p class="note" style="margin-top:14px">${esc(c)}</p>`).join('')}

    <div class="foot no-print">
      <div class="preview"><small>다 쓰셨으면</small><p>인쇄해 두면<br>편해요</p></div>
      <button type="button" class="round" data-act="print">${ICON.print}인쇄하기</button>
    </div>
  </section>`;
}
