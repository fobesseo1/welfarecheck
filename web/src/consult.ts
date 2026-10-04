// 상담 신청 화면: 1분 신청서 → (구글 시트로 보냄) → 신청 완료
// 연락처는 이 화면에서 상담을 원할 때만, 동의를 받고 받는다. 3분 체크 결과(건강 정보)는 따로 동의한 경우에만 함께 보낸다.
import { kb } from './data.ts';
import { SITE, telHref } from './site.ts';
import { HELP_OPTIONS, CONTACT_OPTIONS, emptyForm, validate, resultSummary, buildPayload, formatPhone, type ConsultForm, type HelpValue } from './engine/consult.ts';
import { esc, attr } from './ui/html.ts';

const app = document.getElementById('app')!;
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const fromResult = new URLSearchParams(location.search).get('from') === 'result';

/** 이 기기에 저장된 3분 체크 답 (있으면 결과 요약을 만들 수 있음) */
function savedAnswers() {
  try { return JSON.parse(localStorage.getItem('ltc-selfcheck-v2') ?? 'null')?.answers ?? null; } catch { return null; }
}
const summary = (() => { try { return resultSummary(kb, savedAnswers(), today()); } catch { return null; } })();

// 건강 정보 동의는 보호자가 직접 체크해야 한다(기본값 해제)
let form: ConsultForm = emptyForm();
let errors: Record<string, string> = {};
let screen: 'form' | 'done' = 'form';
let sending = false;
let notice = '';

const ICON = {
  back: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg>',
  check: '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12l5 5 9-10"/></svg>',
  plus: '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" aria-hidden="true"><path d="M12 6v12M6 12h12"/></svg>',
  ok: '<svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.2 4.2L19 7"/></svg>',
};
const err = (k: string) => (errors[k] ? `<p class="cs-err" role="alert">${esc(errors[k])}</p>` : '');
const pressed = (b: boolean) => `aria-pressed="${b}"`;

/** 바로 연락할 수 있는 버튼 (정해진 것만) */
function directButtons(): string {
  const b: string[] = [];
  if (SITE.kakaoUrl) b.push(`<a class="cs-alt" href="${attr(SITE.kakaoUrl)}" target="_blank" rel="noopener noreferrer">카톡으로 바로 물어보기</a>`);
  if (SITE.phone) b.push(`<a class="cs-alt" href="${attr(telHref(SITE.phone))}">${esc(SITE.phone)}로 전화하기</a>`);
  return b.join('');
}

function companyLine(): string {
  const c = SITE.company;
  const parts = [c.name, c.ceo && `대표 ${c.ceo}`, c.bizNo && `사업자등록번호 ${c.bizNo}`, c.address, SITE.phone].filter(Boolean);
  return parts.length ? `<br>${esc(parts.join(' · '))}` : '';
}

function renderForm(): string {
  const back = fromResult ? `<a class="icon-btn" href="check.html" aria-label="결과로 돌아가기">${ICON.back}</a>` : `<a class="icon-btn" href="index.html" aria-label="홈으로">${ICON.back}</a>`;
  return `
  <section class="card cs" aria-labelledby="cs-title">
    <div class="topbar">${back}<span class="count">무료 상담</span></div>
    <h1 id="cs-title" class="cs-h" tabindex="-1">1분이면 신청돼요</h1>
    <p class="lead">누르기만 하면 돼요. 연락처만 직접 적어 주세요.<br>${esc(SITE.hours)}, ${esc(SITE.promise.replace('운영 시간에는 ', ''))}</p>

    <fieldset class="cs-q"><legend>어르신이 어디 사세요?</legend>
      <div class="cs-pills">${SITE.regions.map((r) => `<button type="button" class="pill cs-pill" data-act="region" data-val="${attr(r)}" ${pressed(form.region === r)}>${esc(r)}</button>`).join('')}</div>
      ${err('region')}
      <label class="cs-label" for="cs-dong">동네 (선택 · 안 적어도 돼요)</label>
      <input id="cs-dong" class="cs-input" data-field="dong" type="text" maxlength="40" placeholder="예: 안양 평촌동" value="${attr(form.dong)}" autocomplete="off" />
    </fieldset>

    <fieldset class="cs-q"><legend>어떤 도움이 필요하세요?</legend>
      <p class="hint">여러 개 골라도 돼요</p>
      <div class="checks cs-checks">${HELP_OPTIONS.map((o) => {
        const on = form.help.includes(o.value);
        const dot = on ? ICON.check : o.value === 'other' ? ICON.plus : '';
        return `<button type="button" class="check${o.value === 'unknown' ? ' cs-soft' : ''}" data-act="help" data-val="${o.value}" ${pressed(on)}><span class="dot">${dot}</span>${esc(o.label)}</button>`;
      }).join('')}</div>
      ${form.help.includes('other') ? `<div class="other"><label for="cs-help">어떤 도움이 필요하세요?</label><textarea id="cs-help" data-field="helpText" maxlength="300" rows="3" placeholder="예: 퇴원 후 집에서 돌볼 사람이 필요해요">${esc(form.helpText)}</textarea></div>` : ''}
      <p class="cs-note">요양원·주간보호·방문요양 중 어떤 게 맞는지는 상담하면서 같이 정해요.</p>
      ${err('help')}
    </fieldset>

    <fieldset class="cs-q"><legend>어떻게 연락드릴까요?</legend>
      <div class="cs-two">${CONTACT_OPTIONS.map((o) => `<button type="button" class="pill cs-pill" data-act="contact" data-val="${o.value}" ${pressed(form.contact === o.value)}>${esc(o.label)}</button>`).join('')}</div>
      ${err('contact')}
      <label class="cs-label" for="cs-phone">연락받을 휴대폰 번호</label>
      <input id="cs-phone" class="cs-input cs-phone" data-field="phone" type="tel" inputmode="numeric" maxlength="13" placeholder="010-0000-0000" value="${attr(form.phone)}" autocomplete="tel" />
      ${err('phone')}
      <label class="cs-label" for="cs-name">어떻게 불러 드릴까요? (선택)</label>
      <input id="cs-name" class="cs-input" data-field="name" type="text" maxlength="30" placeholder="예: 김 보호자, 딸" value="${attr(form.name)}" autocomplete="off" />
      <input class="cs-hp" data-field="website" type="text" tabindex="-1" autocomplete="off" aria-hidden="true" value="" />
    </fieldset>

    ${summary ? `<div class="cs-box">
      <label class="cs-agree"><input type="checkbox" data-field="agreeSensitive" ${form.agreeSensitive ? 'checked' : ''} /><span>(선택) 3분 체크 결과도 함께 보낼게요</span></label>
      <p class="cs-sum">${esc(summary)}</p>
      <p class="cs-note">건강 관련 정보라 따로 동의를 받아요. 함께 보내면 상담원이 처음부터 다시 묻지 않아도 돼요.</p>
    </div>` : ''}

    <div class="cs-agree-wrap">
      <label class="cs-agree"><input type="checkbox" data-field="agreePrivacy" ${form.agreePrivacy ? 'checked' : ''} /><span>(필수) 상담을 위한 개인정보 수집·이용에 동의해요</span></label>
      <details class="cs-detail"><summary>무엇을, 얼마나 보관하나요?</summary>
        <ul>
          <li>받는 정보: 사시는 지역·동네, 필요한 도움, 연락 방법, 휴대폰 번호, 호칭${summary ? ', (따로 동의한 경우) 3분 체크 결과 요약' : ''}</li>
          <li>쓰는 곳: 상담 연락과 맞는 돌봄 기관 안내에만 써요. 기관에 연락처를 넘겨야 할 때는 먼저 여쭤보고 따로 동의를 받아요.</li>
          <li>보관 기간: ${SITE.retention ? esc(SITE.retention) : '개인정보처리방침에서 알려드려요'}. 언제든 삭제를 요청할 수 있어요.</li>
          <li>동의하지 않으면 신청서를 낼 수 없지만, 3분 체크는 그대로 쓸 수 있어요.</li>
        </ul>
      </details>
      ${err('agreePrivacy')}
    </div>

    <button type="button" class="round cs-submit" data-act="submit" ${sending ? 'disabled' : ''}>${sending ? '보내는 중…' : '상담 신청하기'}</button>
    ${notice ? `<p class="cs-notice" role="status">${esc(notice)}</p>` : ''}
    ${directButtons()}
    <p class="fine">상담은 무료예요. 기관에서 소개비를 받지 않아요.${companyLine()}</p>
  </section>`;
}

function renderDone(): string {
  const rows: [string, string][] = [
    ['지역', [form.region, form.dong.trim()].filter(Boolean).join(' · ')],
    ['필요한 도움', form.help.map((h) => HELP_OPTIONS.find((o) => o.value === h)!.label).join(' · ')],
    ['연락', `${CONTACT_OPTIONS.find((o) => o.value === form.contact)?.label ?? ''} · ${formatPhone(form.phone)}`],
  ];
  if (form.agreeSensitive && summary) rows.push(['함께 보낸 결과', summary.split(' · ')[0]]);
  const direct = directButtons();
  return `
  <section class="card cs" aria-labelledby="cs-done">
    <div class="topbar"><a class="brand" href="index.html"><img src="brand/mosimduo-symbol.svg" alt="" width="22" height="22" />${esc(SITE.name)}</a></div>
    <div class="cs-ok">${ICON.ok}</div>
    <h1 id="cs-done" class="cs-h" tabindex="-1">상담 신청이 됐어요</h1>
    <p class="cs-promise">${esc(SITE.hours)}, ${esc(SITE.promise.replace('운영 시간에는 ', ''))}</p>
    <dl class="cs-sumbox"><dt class="cs-sumh">보내 주신 내용</dt>${rows.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>
    ${direct ? `<p class="meta" style="margin-top:26px">기다리기 어려우시면</p>${direct}` : ''}
    <div class="links"><a class="link" href="index.html">홈으로</a>${savedAnswers() ? '<a class="link" href="check.html">결과 다시 보기</a>' : '<a class="link" href="check.html">3분 등급 체크</a>'}</div>
  </section>`;
}

function render() {
  app.innerHTML = screen === 'done' ? renderDone() : renderForm();
}
function focusFirstError() {
  const k = Object.keys(errors)[0]; if (!k) return;
  const el = app.querySelector(`[data-field="${k}"], [data-act="${k}"]`) as HTMLElement | null;
  (el ?? app.querySelector('.cs-err'))?.scrollIntoView({ block: 'center' });
  el?.focus({ preventScroll: true });
}

async function submit() {
  if (form.website) return; // 자동 입력 방지
  errors = validate(form);
  notice = '';
  if (Object.keys(errors).length) { render(); focusFirstError(); return; }
  if (!SITE.consultEndpoint) {
    notice = '상담 접수를 준비하고 있어요. 곧 열려요.' + (SITE.phone || SITE.kakaoUrl ? ' 지금은 아래로 바로 연락해 주세요.' : '');
    render(); return;
  }
  sending = true; render();
  const payload = buildPayload(form, summary, new Date().toISOString());
  try {
    // 구글 Apps Script 웹 앱: CORS 응답을 읽을 수 없어 no-cors 로 보낸다(전송 오류만 잡힘)
    await fetch(SITE.consultEndpoint, { method: 'POST', mode: 'no-cors', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(payload) });
    sending = false; screen = 'done'; render(); window.scrollTo({ top: 0 });
    (app.querySelector('h1') as HTMLElement | null)?.focus({ preventScroll: true });
  } catch {
    sending = false; notice = '보내지 못했어요. 인터넷 연결을 확인하고 다시 눌러 주세요.'; render();
  }
}

app.addEventListener('click', (ev) => {
  const t = (ev.target as HTMLElement).closest('[data-act]') as HTMLElement | null;
  if (!t) return;
  const { act, val } = t.dataset;
  if (act === 'region') { form.region = val!; delete errors.region; render(); }
  else if (act === 'contact') { form.contact = val as ConsultForm['contact']; delete errors.contact; render(); }
  else if (act === 'help') {
    const v = val as HelpValue; const i = form.help.indexOf(v);
    if (i >= 0) form.help.splice(i, 1); else form.help.push(v);
    delete errors.help; render();
    if (v === 'other' && form.help.includes('other')) (app.querySelector('#cs-help') as HTMLTextAreaElement | null)?.focus();
  } else if (act === 'submit') void submit();
});
// 입력 중에는 다시 그리지 않고 값만 저장 (커서가 튀지 않게)
app.addEventListener('input', (ev) => {
  const el = ev.target as HTMLInputElement;
  const f = el.dataset.field as keyof ConsultForm | undefined;
  if (!f) return;
  if (el.type === 'checkbox') (form as any)[f] = el.checked;
  else (form as any)[f] = el.value;
});
app.addEventListener('change', (ev) => {
  const el = ev.target as HTMLInputElement;
  if (el.dataset.field === 'phone') { form.phone = formatPhone(el.value); el.value = form.phone; }
});

render();
