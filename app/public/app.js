// 최소 웹 화면 (프레임워크 없음)
const $ = (s) => document.querySelector(s);
let sid = new URLSearchParams(location.search).get('session');
try { sid = sid || localStorage.getItem('ltc_session'); } catch {}

const FACT_LABEL = {
  relation: '관계', age: '나이', age_over65: '65세 이상', insurance: '보험', low_income: '저소득', grade_status: '등급 상태', grade: '등급',
  validity_end: '유효기간', facility_in_cert: '인정서에 시설급여', current_home_services: '재가급여 이용 중', dementia: '치매', diseases: '노인성 질병 코드',
  other_condition: '기타 상태', living: '거주 형태', main_caregiver: '주 돌봄자', caregiver_difficulty: '가족 돌봄 곤란', housing_poor: '주거환경 열악',
  behavior_problem: '문제행동', home_service_unusable: '재가급여 이용 곤란', goal: '희망', in_nursing_hospital: '요양병원 입원', applied_date: '신청일',
  notice_date: '통지일', dissatisfied_result: '판정 불만', condition_worsened: '상태 악화',
  items: '조사 항목(진술)',
};
const STATUS = { stated_by_guardian: '보호자 말씀', confirmed_by_document: '서류 확인', unknown: '미확인' };
const RESULT = { MET: '조건 충족', PROCEDURE_REQUIRED: '추가 절차 필요', NEEDS_CHECK: '확인 필요', NOT_ELIGIBLE: '현재 대상 아님', NEEDS_EXPERT: '전문가·기관 확인', NOT_APPLICABLE: '해당 없음' };
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const VAL = { graded: '등급 있음', none: '없음', pending: '판정 대기', out_of_grade: '등급외', cognitive: '인지지원', health: '건강보험', medical_aid_basic: '의료급여(기초생활수급)', medical_aid_other: '의료급여', alone: '혼자 사심', elderly_only: '노인끼리만', minor_or_elderly_only: '미성년 손자녀와', with_family: '가족과 함께', diagnosed: '진단 받음', suspected: '의심(진단 전)', facility: '요양원 입소', home: '집에서 돌봄', info: '알아보는 중', needs_help: '도움 필요', independent: '혼자 가능', yes: '있음', observe: '조사원 확인' };
const fmt = (v) => (v === true ? '예' : v === false ? '아니요' : typeof v === 'string' && VAL[v] ? VAL[v] : typeof v === 'object' ? (Array.isArray(v) ? v.join(', ') : Object.entries(v).map(([k, x]) => `${k}:${VAL[x] || x}`).join(', ')) : String(v));

async function api(method, url, body) {
  const r = await fetch(url, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || r.statusText);
  return j;
}

function render(state) {
  sid = state.session.id;
  try { localStorage.setItem('ltc_session', sid); } catch {}
  history.replaceState(null, '', '?session=' + sid);
  const last = state.session.messages.at(-1);
  $('#meta').textContent = `세션 ${sid.slice(0, 8)} · 추출기: ${last ? last.provider : '-'} · 입력 ${state.session.messages.length}회`;

  // 질문
  const qs = state.questions;
  $('#qcard').hidden = !qs.length;
  $('#questions').innerHTML = qs.map((q) => {
    const opts = q.input === 'multi'
      ? q.options.map((o) => `<label style="margin-right:10px"><input type="checkbox" value="${esc(o.value)}"> ${esc(o.label)}</label>`).join('') + `<div class="row"><button data-q="${q.id}" data-multi="1">선택 완료</button></div>`
      : q.options.map((o) => `<button data-q="${q.id}" data-v="${esc(o.value)}">${esc(o.label)}</button>`).join(' ');
    const extra = q.input === 'date' ? `<input type="date" id="in-${q.id}"> <button data-q="${q.id}" data-input="1">입력</button>` : q.input === 'number' ? `<input type="number" id="in-${q.id}" style="width:80px"> 세 <button data-q="${q.id}" data-input="1">입력</button>` : '';
    return `<div class="q" data-qid="${q.id}"><div>${esc(q.text)}</div><div class="why">${esc(q.why)}</div><div class="row">${extra} ${opts}</div></div>`;
  }).join('');

  // 사실
  const facts = Object.entries(state.session.facts);
  $('#fcard').hidden = !facts.length;
  $('#facts').innerHTML = facts.map(([k, f]) => `<tr><td>${esc(FACT_LABEL[k] || k)}</td><td>${esc(fmt(f.value))}<div class="ev">“${esc(f.evidence)}”</div></td><td><span class="badge st-${f.status}">${STATUS[f.status]}</span></td><td><button data-del="${k}" title="삭제">삭제</button></td></tr>`).join('');

  // 결과
  const r = state.result;
  const dec = (d) => `<div style="margin:8px 0"><span class="badge ${d.result}">${RESULT[d.result]}</span> <b>${esc(d.title)}</b><div>${esc(d.summary)}</div>
    ${d.rule_ids.length ? `<details><summary>근거 보기 (${d.rule_ids.join(', ')})</summary><ul>${d.sources.map((s) => `<li>${esc(s.title)} ${esc(s.article)} <span class="muted">[${esc(s.rule)} · ${esc(s.status)}]</span></li>`).join('')}</ul><div class="muted">사용한 입력: ${esc(JSON.stringify(d.inputs_used))}</div></details>` : ''}</div>`;
  let html = `<div class="card"><div class="disclaimer">이 결과는 참고용 사전 안내이며, 등급과 급여는 국민건강보험공단이 결정합니다.</div>`;
  html += `</div>`;
  {
    const e = r.explanation;
    html += `<div class="card"><h2>⑤ 지금 가장 먼저 할 일</h2><pre class="sec">${esc(e.actions)}</pre></div>`;
    html += `<div class="card"><h2>① 현재 돌봄 상황</h2><pre class="sec">${esc(e.situation)}</pre></div>`;
    html += `<div class="card"><h2>② 등급 사전검토</h2><pre class="sec">${esc(e.grade_review)}</pre><p class="muted">${esc(r.assessment.note)}</p></div>`;
    html += `<div class="card"><h2>③ 요양원(시설급여) 이용 조건</h2><pre class="sec">${esc(e.facility)}</pre></div>`;
    html += `<div class="card"><h2>④ 필요한 서류와 신청 단계</h2><pre class="sec">${esc(e.documents)}</pre>
      ${r.documents.length ? `<details><summary>서류별 근거</summary><table><tr><th>서류</th><th>시점</th><th>제출처</th><th>근거</th></tr>${r.documents.map((d) => `<tr><td>${esc(d.name)}</td><td>${d.when === 'now' ? '지금' : '나중'}</td><td>${esc(d.submit_to || '')}</td><td>${d.sources.map((s) => esc(s.title + ' ' + s.article)).join('<br>')}</td></tr>`).join('')}</table></details>` : ''}</div>`;
    html += `<div class="card"><h2>판단 내역</h2>${r.decisions.map(dec).join('')}</div>`;
  }
  html += `<div class="card"><details><summary>판단 추적 로그 (${r.trace.length})</summary><ul>${r.trace.map((t) => `<li class="trace-${t.level}">[${esc(t.step)}] ${t.rule ? esc(t.rule) + ' — ' : ''}${esc(t.detail)}</li>`).join('')}</ul><div class="muted">엔진 ${esc(r.engine_version)}</div></details></div>`;
  $('#results').innerHTML = html;
}

async function load() { if (!sid) return; try { render(await api('GET', `/api/sessions/${sid}`)); } catch { sid = null; } }

$('#send').onclick = async () => {
  const text = $('#input').value.trim(); if (!text) return;
  $('#send').disabled = true;
  try { render(sid ? await api('POST', `/api/sessions/${sid}/messages`, { text }) : await api('POST', '/api/sessions', { text })); $('#input').value = ''; }
  catch (e) { alert(e.message); } finally { $('#send').disabled = false; }
};
$('#reset').onclick = () => { sid = null; try { localStorage.removeItem('ltc_session'); } catch {} location.href = '/'; };
document.addEventListener('click', async (ev) => {
  const b = ev.target.closest('button'); if (!b) return;
  if (b.dataset.q) {
    let value = b.dataset.v;
    if (b.dataset.input) value = document.getElementById('in-' + b.dataset.q).value;
    if (b.dataset.multi) value = [...b.closest('.q').querySelectorAll('input:checked')].map((i) => i.value).join(',');
    if (!value) return;
    render(await api('POST', `/api/sessions/${sid}/answers`, { questionId: b.dataset.q, value }));
  }
  if (b.dataset.del) render(await api('PATCH', `/api/sessions/${sid}/facts`, { key: b.dataset.del, value: null }));
});
load();
