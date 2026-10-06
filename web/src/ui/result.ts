// 결과 화면 (Claude Design 캔버스 4·5번 시안). 펼쳐진 것은 ① 요양원 가능 여부 ② 예상 등급 ③ 지금 할 일 뿐, 나머지는 접는 칸.
import type { Kb } from '../engine/kb.ts';
import type { GuideResult, Tone } from '../engine/result.ts';
import { DOMAIN_KO, type DocPrep, type GradeCode } from '../engine/types.ts';
import { LIKELIHOOD_KO } from '../engine/answers.ts';
import { esc, attr } from './html.ts';
import type { GuideDoc } from '../engine/guide.ts';
import { won, type CareView, type CareData } from '../engine/care.ts';

const SCALE: [GradeCode, string][] = [['1', '1'], ['2', '2'], ['3', '3'], ['4', '4'], ['5', '5'], ['cognitive', '인지'], ['none', '등급외']];
const SCEN_KO = { possible: '가능', conditional: '조건부', not_possible: '어려움' };
const TONE_KO: Record<Tone, string> = { good: '요양원 입소 · 가능', maybe: '요양원 입소 · 조건부', wait: '요양원 입소 · 등급부터', no: '요양원 입소 · 어려움' };
const PREP_KO: Record<DocPrep, string> = { self: '직접 작성', issued: '발급받기', nhis: '공단이 보내줌' };
const PREP_ORDER: DocPrep[] = ['self', 'issued', 'nhis'];

const chev = (size = 16) => `<svg class="chev" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>`;
const ICON = {
  save: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4v11"/><path d="M7.5 10.5L12 15l4.5-4.5"/><path d="M5 20h14"/></svg>',
  right: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>',
  out: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 17L17 7"/><path d="M8 7h9v9"/></svg>',
};

/** 접는 칸: 제목 + 한 줄 요약 (+ 숫자) + 열고 닫는 화살표 */
const acc = (id: string, title: string, summary: string, body: string, badge?: number) =>
  `<details class="acc" id="acc-${attr(id)}"><summary><span class="acc-h"><span class="acc-t">${esc(title)}</span>${summary ? `<span class="acc-s">${esc(summary)}</span>` : ''}</span>${badge ? `<span class="badge">${badge}</span>` : ''}${chev()}</summary><div class="acc-b">${body}</div></details>`;
const more = (label: string, body: string) => `<details class="more"><summary>${esc(label)}${chev(14)}</summary><div>${body}</div></details>`;

function src(kb: Kb, ids: string[]): string {
  const u = [...new Set(ids)].filter((id) => kb.rules.has(id));
  if (!u.length) return '';
  return `<span class="src">근거: ${u.map((id) => esc(kb.rule(id).sources.map((s) => `${kb.sources.get(s.src)?.title ?? s.src} ${s.article}`).join(', '))).join(' · ')}</span>`;
}

const ext = (url: string, label: string, cls = 'link') => `<a class="${cls}" href="${attr(url)}" target="_blank" rel="noopener noreferrer">${esc(label)}${ICON.out}</a>`;
const copyBtn = (kind: string, label = '복사하기') => `<button type="button" class="mini no-print" data-act="copy" data-kind="${attr(kind)}">${esc(label)}</button>`;
const check = (key: string, on: boolean, title: string, sub = '', tag = '') =>
  `<li><button type="button" class="chk${on ? ' on' : ''}" role="checkbox" aria-checked="${on}" data-act="check" data-id="${attr(key)}"><span class="box" aria-hidden="true"></span><span class="dn">${esc(title)}${sub ? `<small>${esc(sub)}</small>` : ''}</span>${tag}</button></li>`;
const progress = (keys: string[], checks: Record<string, boolean>) =>
  `<p class="prog" data-prog="${attr(keys.join(' '))}"><b>${keys.filter((k) => checks[k]).length}</b>/${keys.length}개 준비</p>`;

function guideDocs(docs: GuideDoc[], checks: Record<string, boolean>): string {
  const sorted = [...docs].sort((a, b) => PREP_ORDER.indexOf(a.prep) - PREP_ORDER.indexOf(b.prep));
  return `<ul class="docs">${sorted.map((d) => check(d.key, !!checks[d.key], d.name, d.where, `<span class="who ${d.prep}">${PREP_KO[d.prep]}</span>`)).join('')}</ul>`;
}

const CARE_ST: Record<string, string> = { yes: 'possible', limited: 'conditional', conditional: 'conditional', mixed: 'conditional', no: 'none' };

/** '이용할 수 있는 돌봄' 표 (기능 스위치 careMatrix 가 켜졌을 때만) */
export function careSection(c: CareView, data: CareData, kb: Kb): string {
  return `
    <div class="sec care-sec" id="care">
      <div class="sec-h"><span>이용할 수 있는 돌봄</span><span>${esc(c.gradeLabel)} 기준</span></div>
      <p class="care-q">지금 가장 필요한 도움은요?</p>
      <div class="care-needs">${data.needs.map((n) => `<button type="button" class="pill care-need" data-act="need" data-val="${attr(n.id)}" aria-pressed="${c.need === n.id}">${esc(n.label)}<small>${esc(n.hint)}</small></button>`).join('')}</div>
      <div class="rows care-rows">${c.rows.map((row) => `
        <div class="row care-row${row.match ? ' match' : ''}">
          <span class="txt"><b>${esc(row.name)}</b><small>${esc(row.short)}</small>${row.detail.map((d) => `<small class="care-d">${esc(d)}</small>`).join('')}</span>
          <span class="st ${CARE_ST[row.status]}">${esc(row.label)}</span>
        </div>`).join('')}
      </div>
      ${c.limit ? `<div class="cardlet care-limit"><span class="t">한 달 한도 ${c.limit.low === c.limit.high ? `약 ${won(c.limit.low)}` : `약 ${won(c.limit.low)}~${won(c.limit.high)}`} (${c.limit.year}년)</span><span class="d">다 쓰면 본인부담 약 ${c.limit.copayLow === c.limit.copayHigh ? won(c.limit.copayLow) : `${won(c.limit.copayLow)}~${won(c.limit.copayHigh)}`}. ${esc(c.limit.note)}</span></div>` : ''}
      ${c.outside.length ? `<div class="cards care-out">${c.outside.map((o) => `<div class="cardlet${o.match ? ' match' : ''}"><span class="t">${esc(o.name)}</span><span class="d">${esc(o.short)}</span>${o.id === 'carer_private' ? `<a class="link" href="care.html" data-feature="careGuide" hidden>간병 안내 자세히${ICON.right}</a>` : ''}</div>`).join('')}</div>` : ''}
      ${more('근거 보기', src(kb, [...c.rows.flatMap((x) => x.rules), ...(c.limit?.rules ?? []), ...c.outside.flatMap((o) => o.rules)]))}
    </div>`;
}

export function renderResult(r: GuideResult, kb: Kb, form?: { url: string } | null, checks: Record<string, boolean> = {}, care: string = ''): string {
  const e = r.estimate; const f = r.facility; const v = r.verdict; const g = r.guide; const G = kb.guide;
  const inRange = new Set(e.grades);

  const head = `
    <div class="topbar"><a class="brand" href="index.html"><img src="brand/mosimduo-symbol.svg" alt="" width="22" height="22" />모심듀오</a><button type="button" class="icon-btn no-print" data-act="print" aria-label="결과 저장·인쇄">${ICON.save}</button></div>
    <p class="greet">결과가 나왔어요</p>
    <div class="bar"><i style="width:100%"></i></div>`;

  const verdict = `
    <div class="verdict">
      <span class="status ${v.tone}">${esc(v.label ?? TONE_KO[v.tone])}</span>
      <h2 id="res-title" tabindex="-1">${esc(v.title)}</h2>
      <p class="vb">${esc(v.body)}</p>
      ${v.detail ? more('왜 그런가요', `<p>${esc(v.detail)}</p>${src(kb, f.rule_ids)}`) : ''}
    </div>`;

  // 무료 상담 연결 (결과 바로 아래). 등급이 있으면 맞는 곳 찾기, 없으면 등급 받기부터
  const graded = !!r.decide.decisions.find((d) => d.id === 'B' && d.inputs_used?.grade_status === 'graded');
  const consult = `
    <div class="consult no-print">
      <span class="consult-tag">무료 상담</span>
      <p class="consult-t">${graded ? '딱 맞는 곳 찾기,<br>같이 도와드릴게요' : '등급 받기부터 맞는 곳 찾기까지,<br>같이 준비해 드릴게요'}</p>
      <ul class="consult-l"><li>사시는 동네 가까이에서 요양원·주간보호·방문요양</li><li>지금 답하신 결과를 보고 상담해요</li><li>기관에서 소개비를 받지 않아요</li></ul>
      <a class="consult-btn" href="consult.html?from=result">1분 상담 신청${ICON.right}</a>
      <p class="consult-h">오전 10시~오후 7시 · 보통 2~3시간 안에 연락드려요</p>
    </div>`;

  const grade = `
    <div class="sec">
      <div class="sec-h"><span>예상 등급</span><span>추정 · 신뢰도 ${esc(e.confidence)}</span></div>
      <p class="grade-big">${esc(e.label)}</p>
      <div class="scale" aria-hidden="true">${SCALE.map(([g]) => `<i class="${inRange.has(g) ? 'on' : ''}"></i>`).join('')}</div>
      <div class="scale-l" aria-label="예상 등급 ${attr(e.label)}">${SCALE.map(([g, l]) => `<span class="${inRange.has(g) ? 'on' : ''}">${esc(l)}</span>`).join('')}</div>
      ${r.gradeNote ? `<p class="line">${esc(r.gradeNote)}</p>` : ''}
      ${more('왜 이렇게 나왔나요', `
        ${e.influences.length ? `<p>가장 크게 영향을 준 답: ${e.influences.map((i) => `${esc(i.name)}(${esc(DOMAIN_KO[i.domain])})`).join(', ')}</p>` : ''}
        ${e.unknown.count ? `<p>'잘 모르겠어요' ${e.unknown.count}개는 가장 가벼운~무거운 경우를 모두 넣어 범위를 넓혔어요.</p>` : ''}
        <p>고시의 공식 항목 점수와 100점 환산표로 계산했고, 마지막 합산은 공식 산정식이 아닌 추정식이에요. 추정 점수 약 ${e.score.low}~${e.score.high}점.</p>
        ${e.notes.filter((n) => !n.startsWith('이 점수는')).map((n) => `<p>${esc(n)}</p>`).join('')}
        <p>1등급 95점↑ · 2등급 75~95 · 3등급 60~75 · 4등급 51~60 · 5등급 45~51(치매) · 인지지원 45 미만(치매)</p>`)}
    </div>`;

  const todo = r.actions.length ? `
    <div class="sec">
      <div class="sec-h"><span>지금 할 일</span></div>
      <ol class="todo">${r.actions.map((a, i) => `<li><span class="num">${i + 1}</span>${a.detail ? more(a.text, `<p>${esc(a.detail)}</p>`) : `<span class="tt">${esc(a.text)}</span>`}</li>`).join('')}</ol>
      ${g.cta || form ? `<div class="cta no-print">
        ${g.cta ? `<a class="btn-mint" href="${attr(g.cta.url)}"${g.cta.kind === 'tel' ? '' : ' target="_blank" rel="noopener noreferrer"'}>${esc(g.cta.label)}${g.cta.kind === 'tel' ? ICON.right : ICON.out}</a>` : ''}
        ${form ? `<button type="button" class="btn-line" data-act="form">신청서 미리 채워 보기${ICON.right}</button>` : ''}
        ${g.cta?.note ? `<p class="meta">${esc(g.cta.note)}</p>` : ''}
      </div>` : ''}
    </div>` : '';

  // ---------- 상황별 안내 (등급외·결과 대기·유효기간 지남) ----------
  const sit = g.situation ? G.situations[g.situation] : null;
  const situation = sit ? `
    <div class="sec">
      <div class="sec-h"><span>${esc(sit.title)}</span></div>
      <div class="cards">
        ${sit.text ? `<div class="cardlet"><span class="d">${esc(sit.text)}</span></div>` : ''}
        ${sit.reapply ? `<div class="cardlet"><span class="t">다시 신청</span><span class="d">${esc(sit.reapply)}</span></div>` : ''}
        ${sit.appeal ? `<div class="cardlet"><span class="t">이의신청</span><span class="d">${esc(sit.appeal)}</span>${ext(G.links.appeal.url, G.links.appeal.label)}</div>` : ''}
        ${g.situation === 'pending' ? `<div class="cardlet">${ext(G.links.result.url, G.links.result.label)}</div>` : ''}
      </div>
      ${src(kb, sit.rules)}
    </div>` : '';

  // ---------- 접는 칸 ----------
  const panels: string[] = [];
  if (r.tips.length) {
    panels.push(acc('tips', '답을 보완하면 더 정확해져요', `확인할 것 ${r.tips.length}개`, `
      <p class="meta" style="margin-bottom:12px">사실대로 빠짐없이 답할수록 실제 판정과 가까워져요.</p>
      <div class="cards">${r.tips.map((t) => `<div class="cardlet${t.kind === 'boundary' || t.kind === 'unknown' ? ' warn' : ''}"><span class="t">${esc(t.text)}</span>${t.detail ? `<span class="d">${esc(t.detail)}</span>` : ''}${t.jump ? `<button type="button" class="mini" data-act="jump-step" data-id="${attr(t.jump)}">다시 답하기</button>` : ''}</div>`).join('')}</div>`, r.tips.length));
  }
  if (g.channels.show) {
    panels.push(acc('where', '어디서 신청하나요', g.channels.under65Blocked ? '지사 방문 · 우편 · 팩스' : '인터넷 · 앱 · 방문 · 우편 · 팩스', `
      ${g.channels.under65Blocked ? `<div class="cardlet warn"><span class="t">65세 미만 처음 신청</span><span class="d">${esc(G.channels.under65_blocked)}</span></div>` : `<p class="sub-h">인터넷</p><p class="line">${esc(G.channels.online)}</p>${ext(G.links.apply.url, G.links.apply.label)}`}
      <p class="sub-h">다른 방법</p>
      <div class="rows">${G.channels.cards.filter((c) => !(g.channels.under65Blocked && c.t === '앱·정부24')).map((c) => `<div class="row"><span class="lab">${esc(c.t)}</span><span class="txt">${esc(c.d)}</span></div>`).join('')}</div>
      <div class="links">${ext(G.links.branch.url, G.links.branch.label)}<a class="link" href="${attr(G.links.tel.url)}">${esc(G.links.tel.label)}${ICON.right}</a></div>
      <p class="meta">${esc(G.channels.branch_note)}</p>
      <p class="meta">${esc(G.channels.call_hours)} · 연결되면 “${esc(G.channels.call_script)}”</p>
      ${g.channels.acute ? `<div class="cardlet warn" style="margin-top:12px"><span class="t">최근 입원·수술했다면</span><span class="d">${esc(G.channels.acute)}</span></div>` : ''}
      ${src(kb, ['R-APPLY-01'])}`));
  }
  if (g.visit.show) {
    panels.push(acc('visit', '방문조사 준비', g.visit.typed.length ? `메모 ${g.visit.notes.length}개 · 직접 적은 내용 ${g.visit.typed.length}개` : `메모 ${g.visit.notes.length}개`, `
      <p class="line">${esc(G.visit.intro)}</p>
      <p class="sub-h">미리 적어 두면 좋은 것</p>
      <ul class="plain">${g.visit.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>
      ${g.visit.typed.length ? `<p class="sub-h">직접 적은 내용 (점수에는 넣지 않았어요)</p>
        <div class="cards">${r.notes.map((n) => `<div class="cardlet"><span class="t">${esc(n.title)}</span><span class="memo">${esc(n.text)}</span><button type="button" class="mini no-print" data-act="jump-step" data-id="${attr(n.stepId)}">고치기</button></div>`).join('')}</div>` : ''}
      <p class="meta" style="margin-top:12px">${esc(G.visit.example)}</p>
      <div class="links">${copyBtn('visit', '메모 복사하기')}</div>
      ${src(kb, G.visit.rules)}`));
  } else if (r.notes.length) {
    panels.push(acc('notes', '방문조사 때 말씀할 내용', `직접 적은 내용 ${r.notes.length}개`, `
      <p class="meta" style="margin-bottom:12px">점수에는 넣지 않았어요. 방문조사원에게 그대로 말씀하시거나 신청서 사유에 적으세요.</p>
      <div class="cards">${r.notes.map((n) => `<div class="cardlet"><span class="t">${esc(n.title)}</span><span class="memo">${esc(n.text)}</span><button type="button" class="mini" data-act="jump-step" data-id="${attr(n.stepId)}">고치기</button></div>`).join('')}</div>`));
  }
  if (f.scenarios.length || f.showReasons) {
    const hits = f.reasons.filter((x) => x.likelihood === 'high' || x.likelihood === 'possible').length;
    const summary = f.showReasons ? (hits ? `인정 사유 ${hits}개 해당 가능` : '인정 사유 확인 필요') : f.scenarios.map((s) => `${s.label} ${SCEN_KO[s.status]}`).join(' · ');
    panels.push(acc('facility', '요양원 입소 조건', summary, `
      ${f.scenarios.length ? `<p class="sub-h">등급별로 보면</p><div class="rows">${f.scenarios.map((s) => `<div class="row"><span class="lab">${esc(s.label)}</span><span class="txt">${esc(s.text)}${s.detail ? `<small>${esc(s.detail)}</small>` : ''}</span><span class="st ${s.status}">${SCEN_KO[s.status]}</span></div>`).join('')}</div>` : ''}
      ${f.showReasons ? `<p class="sub-h">3~5등급이 요양원에 가려면 (하나라도 인정되면 돼요)</p>
        <div class="rows">${f.reasons.map((x) => `<div class="row"><span class="txt">${esc(x.short)}${x.why ? `<small>${esc(x.why)}</small>` : ''}</span><span class="st ${x.likelihood === 'possible' ? 'maybe' : x.likelihood}">${esc(LIKELIHOOD_KO[x.likelihood].replace('해당 가능성 ', ''))}</span></div>`).join('')}</div>` : ''}
      ${src(kb, f.rule_ids)}`));
  }

  const ADDON = new Set(['PROC-INITIAL-UNDER65', 'PROC-PROXY', 'PROC-EARLY', 'PROC-COST-RELIEF', 'PROC-MEDAID-ADMISSION']);
  const main = r.decide.procedures.filter((p) => !ADDON.has(p.id));
  const addons = r.decide.procedures.filter((p) => ADDON.has(p.id));
  if (main.length || addons.length) {
    const tail = f.basis === 'expected_grade' && v.tone !== 'no';
    panels.push(acc('steps', '진행 순서', main[0] ? `지금: ${main[0].title}` : '', `
      <ol class="timeline">${main.map((p, i) => `<li class="${i === 0 ? 'now' : ''}"><span class="t">${esc(p.title)}</span>${i === 0 ? '<span class="now-badge">지금</span>' : ''}
        <ol class="sub">${p.steps.map((s) => `<li>${esc(s.text)}</li>`).join('')}</ol></li>`).join('')}
        ${tail ? '<li><span class="t">등급이 나오면 요양원 상담·계약</span></li>' : ''}</ol>
      ${addons.length ? `<p class="sub-h">함께 챙길 것</p><ul class="addons">${addons.map((p) => `<li>${esc(p.steps.map((s) => s.text).join(' '))}</li>`).join('')}</ul>` : ''}`));
  }

  const later = [...r.docsLater, ...r.docsCheck];
  const now = g.docs.filter((d) => d.when === 'now'); const next = g.docs.filter((d) => d.when !== 'now');
  const role = g.role;
  panels.push(acc('docs', '준비할 서류', `지금 ${now.length}개 · 나중 ${next.length}개`, `
    ${now.some((d) => d.id === 'DOC-05') ? `<p class="sub-h">누가 신청하나요</p>
      <div class="seg no-print" role="radiogroup" aria-label="누가 신청하나요">${G.roles.options.map((o) => `<button type="button" class="seg-b${role.value === o.value ? ' on' : ''}" role="radio" aria-checked="${role.value === o.value}" data-act="role" data-val="${attr(o.value)}">${esc(o.label)}</button>`).join('')}</div>
      ${role.value === 'other' ? `<div class="seg sm no-print" role="radiogroup" aria-label="대리인 종류">${G.roles.other_options.map((o) => `<button type="button" class="seg-b${role.other === o.value ? ' on' : ''}" role="radio" aria-checked="${role.other === o.value}" data-act="role-other" data-val="${attr(o.value)}">${esc(o.label)}</button>`).join('')}</div>` : ''}` : ''}
    <div class="legend" style="margin-top:16px"><span class="self">직접 작성</span><span class="issued">발급받기</span><span class="nhis">공단이 보내줌</span></div>
    <p class="sub-h">지금</p>${now.length ? guideDocs(now, checks) + progress(now.map((d) => d.key), checks) : '<p class="meta">지금 낼 서류는 없어요.</p>'}
    ${next.length ? `<p class="sub-h">나중에</p>${guideDocs(next, checks)}` : ''}
    ${r.decide.excluded_documents.length ? `<p class="meta" style="margin-top:12px">건강진단서 등 일부 서류는 입소할 요양원에 필요 여부를 물어보세요.</p>` : ''}
    <p class="meta" style="margin-top:12px">${esc(G.forms_note)}</p>
    <div class="links">${ext(G.links.forms.url, G.links.forms.label)}${copyBtn('docs', '목록 복사하기')}</div>
    ${src(kb, G.roles.rules)}`));

  if (g.doctor.show) {
    const D = G.doctor;
    panels.push(acc('doctor', '병원 · 의사소견서', g.doctor.lines[0]?.startsWith('65세 미만') ? '신청할 때 함께 내요' : '공단 안내를 받은 뒤 받아요', `
      <ol class="flow">${D.flow.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>
      ${g.doctor.lines.map((l) => `<p class="line">${esc(l)}</p>`).join('')}
      <p class="line">${esc(D.validity)}</p>
      <p class="sub-h">병원 찾기</p>
      <p class="meta">${esc(D.search_note)}</p>
      <div class="links">${ext(G.links.hospital.url, G.links.hospital.label)}</div>
      <p class="sub-h">병원에 전화할 때</p>
      <p class="memo quote">${esc(g.doctor.script)}</p>
      <div class="links">${copyBtn('hospital', '문구 복사하기')}</div>
      <p class="sub-h">가기 전에 확인</p>
      <ul class="plain">${D.checklist.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>
      <p class="sub-h">비용 (발급의뢰서가 있을 때)</p>
      <div class="rows">${D.cost.map((c) => `<div class="row"><span class="txt">${esc(c.who)}</span><span class="lab r">${esc(c.pay)}</span></div>`).join('')}</div>
      <p class="meta" style="margin-top:8px">${esc(D.cost_note)}</p>
      <p class="meta" style="margin-top:8px">${esc(D.exempt)}</p>
      ${src(kb, D.rules)}`));
  }

  if (g.admission.show) {
    const A = G.admission; const keys = [...g.admission.common, ...g.admission.facility].map((x) => x.id);
    panels.push(acc('admission', '입소 준비', `꼭 확인할 것 ${g.admission.common.length}개 · 요양원별 ${g.admission.facility.length}개`, `
      <p class="line">${esc(A.intro)}</p>
      <p class="sub-h">꼭 확인할 것</p>
      <ul class="docs">${g.admission.common.map((x) => check(x.id, !!checks[x.id], x.t, x.d)).join('')}</ul>
      <p class="sub-h">요양원마다 다른 것</p>
      <p class="meta">${esc(A.facility_intro)}</p>
      <ul class="docs">${g.admission.facility.map((x) => check(x.id, !!checks[x.id], x.t)).join('')}</ul>
      ${progress(keys, checks)}
      <div class="links">${copyBtn('admission', '목록 복사하기')}</div>
      ${src(kb, A.rules)}`));
  }

  const official = ['guide', 'apply', 'result', 'appeal', 'law_act', 'law_rule'].map((k) => G.links[k]).filter(Boolean);
  panels.push(acc('detail', '자세히 보기', '점수표 · 법령 근거 · 공식 링크', `
    <p class="sub-h">공식 안내</p>
    <div class="links col">${official.map((l) => ext(l.url, l.label)).join('')}</div>
    <p class="meta" style="margin-bottom:16px">공단은 조사 항목 중 고시에 정한 52개 항목으로 점수를 계산해요. 이 도구도 같은 52개 항목 점수표를 썼어요.</p>
    <table><thead><tr><th>영역</th><th>원점수</th><th>100점 환산</th></tr></thead>
    <tbody>${r.domainTable.map((d) => `<tr><td>${esc(d.name)}</td><td>${d.rawLow === d.rawHigh ? d.rawLow : `${d.rawLow}~${d.rawHigh}`}</td><td>${d.convLow === d.convHigh ? d.convLow.toFixed(1) : `${d.convLow.toFixed(1)}~${d.convHigh.toFixed(1)}`}</td></tr>`).join('')}</tbody></table>
    ${e.treeReference ? `<p class="meta">참고: 고시 원문에서 복원한 공식 트리(원문 대조 전)로 계산하면 약 ${e.treeReference.low}~${e.treeReference.high}점, ${esc(e.treeReference.label)}.</p>` : ''}
    <ul class="basis">${r.decide.decisions.filter((d) => d.result !== 'NOT_APPLICABLE' && d.id !== 'E').map((d) => `<li><b>${esc(d.title)}</b> ${esc(d.summary)}${src(kb, d.rule_ids)}</li>`).join('')}
    ${[...r.docsNow, ...later].map((d) => `<li><b>${esc(d.name)}</b>${src(kb, d.sources.map((s) => s.rule))}</li>`).join('')}</ul>`));

  return `
  <section class="card" aria-labelledby="res-title">
    ${head}${verdict}${consult}${grade}${care}${situation}${todo}
    <div class="accs">${panels.join('')}</div>
    <div class="bottom-btns no-print">
      <button type="button" class="btn-line" data-act="edit">답 고치기</button>
      <button type="button" class="btn-line" data-act="restart">처음부터</button>
    </div>
    <p class="note">${esc(r.disclaimer)}<br>문의 국민건강보험공단 1577-1000 · 작성일 ${esc(r.today)}</p>
  </section>`;
}
