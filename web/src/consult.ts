// 상담 신청 화면: 1분 신청서 → (구글 시트로 보냄) → 신청 완료
// 연락처는 이 화면에서 상담을 원할 때만, 동의를 받고 받는다. 3분 체크 결과(건강 정보)는 따로 동의한 경우에만 함께 보낸다.
import { kb } from './data.ts';
import { SITE, telHref, consultMode } from './site.ts';
import { sendWithReceipt, requestId } from './submission.ts';
import caregiversJson from '../../data/caregivers.json' with { type: 'json' };
import { CONTACT_OPTIONS, CARE_WHEN, CARE_PLACE, emptyForm, validate, resultSummary, buildPayload, formatPhone, helpOptions, helpLabel, type ConsultForm, type HelpValue } from './engine/consult.ts';
import { loadFeatures, applyFeatures, isOn } from './features.ts';
import { esc, attr } from './ui/html.ts';

const app = document.getElementById('app')!;
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const fromResult = new URLSearchParams(location.search).get('from') === 'result';

/** 이 기기에 저장된 3분 체크 답 (있으면 결과 요약을 만들 수 있음) */
function savedAnswers() {
  try { const saved = JSON.parse(localStorage.getItem('ltc-selfcheck-v2') ?? 'null'); return saved && (saved.finished || saved.screen === 'result' || saved.screen === 'form') ? saved.answers : null; } catch { return null; }
}
const summary = (() => { try { return resultSummary(kb, savedAnswers(), today()); } catch { return null; } })();

// 건강 정보 동의는 보호자가 직접 체크해야 한다(기본값 해제)
let form: ConsultForm = emptyForm();
// 다른 화면에서 넘어온 값 (?help=care&cg=간병인ID) — 기능 스위치가 켜졌을 때만 받는다(아래 시작부)
const query = new URLSearchParams(location.search);
let errors: Record<string, string> = {};
let screen: 'form' | 'done' = 'form';
let sending = false;
let notice = '';
let submissionId = requestId();
let step: 0 | 1 = 0;
const mode = consultMode();
const preview = mode === 'preview';
const options = () => helpOptions(true).filter((o) => o.value !== 'care' || isOn('consultMore'));

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
  const back = step === 1 ? `<button type="button" class="icon-btn" data-act="back" aria-label="상황 선택으로 돌아가기">${ICON.back}</button>` : fromResult ? `<a class="icon-btn" href="check.html?view=result" aria-label="결과로 돌아가기">${ICON.back}</a>` : `<a class="icon-btn" href="index.html" aria-label="홈으로">${ICON.back}</a>`;
  if (mode === 'closed') return `<section class="card cs" aria-labelledby="cs-title"><div class="topbar">${back}<span class="count">무료 상담 안내</span></div><h1 id="cs-title" class="cs-h">상담 접수를 준비하고 있어요</h1><p class="lead">지금은 상담 신청서를 받지 않아요. 연락처를 입력하지 않고 3분 체크와 신청 준비 안내를 이용하실 수 있어요.</p>${directButtons()}<div class="links"><a class="link" href="check.html${fromResult ? '?view=result' : ''}">${fromResult ? '결과 다시 보기' : '3분 체크 시작'}</a><a class="link" href="index.html">홈으로</a></div></section>`;
  return `
  <section class="card cs" aria-labelledby="cs-title">
    <div class="topbar">${back}<span class="count">무료 상담 · ${step + 1}/2</span></div>
    ${preview ? '<p class="cs-demo" role="note"><b>신청 화면 테스트</b><br>실제 상담은 접수되지 않아요. 예시 번호로 확인해 주세요. 입력 내용은 전송하거나 저장하지 않아요.</p>' : ''}
    <ol class="cs-stages" aria-label="상담 신청 단계"><li class="${step === 0 ? 'active' : ''}" ${step === 0 ? 'aria-current="step"' : ''}>1. 어르신 상황</li><li class="${step === 1 ? 'active' : ''}" ${step === 1 ? 'aria-current="step"' : ''}>2. 연락처 남기기</li></ol>
    <h1 id="cs-title" class="cs-h" tabindex="-1">${step === 0 ? '어르신께 맞는 돌봄,<br>같이 찾아볼게요' : '편하게 연락받을<br>번호만 남겨 주세요'}</h1>
    <p class="lead">${step === 0 ? '등급이 없어도, 어떤 돌봄이 맞을지 몰라도 괜찮아요.<br>사시는 곳과 필요한 도움부터 알려 주세요.' : '말씀해 주신 상황을 듣고 가까운 기관을 함께 찾아드려요.<br>상담비나 소개비는 받지 않아요.'}</p>

    <div ${step !== 0 ? 'hidden' : ''}>

    <fieldset class="cs-q"><legend>어르신이 어디 사세요?</legend>
      <p class="hint">가까운 기관을 찾을 수 있도록 사시는 곳을 알려 주세요.</p>
      <label class="cs-label" for="cs-region">거주 지역 (시·군·구)</label>
      <input id="cs-region" class="cs-input" data-field="region" type="text" maxlength="40" placeholder="시·군·구를 적어 주세요" value="${attr(form.region)}" autocomplete="off" />
      ${err('region')}
      <label class="cs-label" for="cs-dong">동네 (선택 · 안 적어도 돼요)</label>
      <input id="cs-dong" class="cs-input" data-field="dong" type="text" maxlength="40" placeholder="읍·면·동을 적어 주세요" value="${attr(form.dong)}" autocomplete="off" />
    </fieldset>

    <fieldset class="cs-q"><legend>어떤 도움이 필요하세요?</legend>
      <p class="hint">여러 개 골라도 돼요</p>
      <div class="checks cs-checks">${options().map((o) => {
        const on = form.help.includes(o.value);
        const dot = on ? ICON.check : o.value === 'other' ? ICON.plus : '';
        return `<button type="button" class="check${o.value === 'unknown' ? ' cs-soft' : ''}" data-act="help" data-val="${o.value}" ${pressed(on)}><span class="dot">${dot}</span>${esc(o.label)}</button>`;
      }).join('')}</div>
      ${form.help.includes('other') ? `<div class="other"><label for="cs-help">어떤 도움이 필요하세요?</label><textarea id="cs-help" data-field="helpText" maxlength="300" rows="3" placeholder="예: 퇴원 후 집에서 돌볼 사람이 필요해요">${esc(form.helpText)}</textarea></div>` : ''}
      <p class="cs-note">요양원·주간보호·방문요양 중 어떤 게 맞는지는 상담하면서 같이 정해요.</p>
      ${err('help')}
    </fieldset>
    ${form.help.includes('care') ? `<fieldset class="cs-q"><legend>간병은 언제부터 필요하세요?</legend>
      <div class="cs-pills">${CARE_WHEN.map((o) => `<button type="button" class="pill cs-pill" data-act="careWhen" data-val="${o.value}" ${pressed(form.careWhen === o.value)}>${esc(o.label)}</button>`).join('')}</div>
      ${err('careWhen')}
      <p class="cs-label">어디서 돌봐야 하나요? (선택)</p>
      <div class="cs-two">${CARE_PLACE.map((o) => `<button type="button" class="pill cs-pill" data-act="carePlace" data-val="${o.value}" ${pressed(form.carePlace === o.value)}>${esc(o.label)}</button>`).join('')}</div>
      ${form.caregiverId ? `<p class="cs-note">간병인 찾기에서 고르신 ${esc(caregiversJson.caregivers.find((c) => c.id === form.caregiverId)?.display_name ?? '간병인')}으로 먼저 알아볼게요.</p>` : ''}
      <p class="cs-note">급하시면 운영 시간 안에 바로 전화드릴게요.</p>
    </fieldset>` : ''}

    <button type="button" class="round cs-submit" data-act="next">다음 · 연락받을 방법 선택</button>
    <p class="cs-note">연락처는 다음 단계에서 남겨 주세요. 상담 신청은 약 1분 걸려요.</p>
    </div>

    <div ${step !== 1 ? 'hidden' : ''}>
    <div class="cs-chosen"><span>${esc([form.region, form.dong].filter(Boolean).join(' · '))}</span><b>${esc(form.help.map(helpLabel).join(' · '))}</b><button type="button" class="link" data-act="back">수정</button></div>

    <fieldset class="cs-q"><legend>어떻게 연락드릴까요?</legend>
      <div class="cs-two">${CONTACT_OPTIONS.map((o) => `<button type="button" class="pill cs-pill" data-act="contact" data-val="${o.value}" ${pressed(form.contact === o.value)}>${esc(o.label)}</button>`).join('')}</div>
      ${err('contact')}
      <label class="cs-label" for="cs-phone">연락받을 휴대폰 번호</label>
      <input id="cs-phone" class="cs-input cs-phone" data-field="phone" type="tel" inputmode="numeric" maxlength="13" placeholder="010-0000-0000" value="${attr(form.phone)}" autocomplete="${preview ? 'off' : 'tel'}" />
      ${preview ? '<button type="button" class="link cs-example" data-act="example">예시 연락처로 채우기</button>' : '<p class="cs-note">상담 연락에만 사용해요. 기관에 전달할 때는 먼저 동의를 여쭤봐요.</p>'}
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
      <label class="cs-agree"><input type="checkbox" data-field="agreePrivacy" ${form.agreePrivacy ? 'checked' : ''} /><span>${preview ? '(테스트) 실제 신청 시 필요한 개인정보 동의 안내를 확인했어요' : '(필수) 상담을 위한 개인정보 수집·이용에 동의해요'}</span></label>
      <details class="cs-detail"><summary>무엇을, 얼마나 보관하나요?</summary>
        <ul>
          <li>받는 정보: 사시는 지역·동네, 필요한 도움, 연락 방법, 휴대폰 번호, 호칭${summary ? ', (따로 동의한 경우) 3분 체크 결과 요약' : ''}</li>
          <li>쓰는 곳: 상담 연락과 맞는 돌봄 기관 안내에만 써요. 기관에 연락처를 넘겨야 할 때는 먼저 여쭤보고 따로 동의를 받아요.</li>
          <li>${preview ? '테스트에서는 입력 내용을 전송하거나 저장하지 않아요. 실제 서비스의 운영 주체와 보관 기간은 접수 시작 전 안내해요.' : `운영 주체: ${esc(SITE.company.name)}. 보관 기간: ${esc(SITE.retention)}. 언제든 삭제를 요청할 수 있어요.`}</li>
          <li>${preview ? '실제 상담 신청 시 필요한 동의 안내예요. 테스트 확인은 실제 정보 수집에 대한 동의가 아니에요.' : '동의하지 않으면 신청서를 낼 수 없지만, 3분 체크는 그대로 쓸 수 있어요.'}</li>
        </ul>
      </details>
      ${err('agreePrivacy')}
    </div>

    <button type="button" class="round cs-submit" data-act="submit" ${sending ? 'disabled' : ''}>${sending ? '보내는 중…' : preview ? '신청 완료 화면 미리보기' : '무료 상담 신청하기'}</button>
    ${notice ? `<p class="cs-notice" role="status">${esc(notice)}</p>` : ''}
    ${directButtons()}
    <p class="fine">상담은 무료예요. 기관에서 소개비를 받지 않아요.${companyLine()}</p>
    </div>
  </section>`;
}

function renderDone(): string {
  const rows: [string, string][] = [
    ['지역', [form.region, form.dong.trim()].filter(Boolean).join(' · ')],
    ['필요한 도움', form.help.map(helpLabel).join(' · ')],
    ['연락', `${CONTACT_OPTIONS.find((o) => o.value === form.contact)?.label ?? ''} · ${formatPhone(form.phone)}`],
  ];
  if (form.agreeSensitive && summary) rows.push(['함께 보낸 결과', summary.split(' · ')[0]]);
  const direct = directButtons();
  return `
  <section class="card cs" aria-labelledby="cs-done">
    <div class="topbar"><a class="brand" href="index.html"><img src="brand/mosimduo-symbol.svg" alt="" width="22" height="22" />${esc(SITE.name)}</a></div>
    <div class="cs-ok">${ICON.ok}</div>
    <h1 id="cs-done" class="cs-h" tabindex="-1">${preview ? '신청 흐름을 확인했어요' : '상담 신청이 됐어요'}</h1>
    <p class="cs-promise">${preview ? '테스트가 끝났어요. 실제 접수나 상담 연락은 진행되지 않으며, 입력 내용은 저장하지 않았어요.' : `${esc(SITE.hours)}, ${esc(SITE.promise.replace('운영 시간에는 ', ''))}`}</p>
    <dl class="cs-sumbox"><dt class="cs-sumh">${preview ? '확인한 신청 내용' : '보내 주신 내용'}</dt>${rows.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>
    ${preview ? '<button type="button" class="round cs-submit" data-act="preview-reset">다시 테스트하기</button>' : ''}
    ${direct ? `<p class="meta" style="margin-top:26px">기다리기 어려우시면</p>${direct}` : ''}
    <div class="links"><a class="link" href="index.html">홈으로</a>${savedAnswers() ? '<a class="link" href="check.html?view=result">결과 다시 보기</a>' : '<a class="link" href="check.html">3분 등급 체크</a>'}</div>
  </section>`;
}

function render() {
  const active = document.activeElement as HTMLElement | null;
  const act = active?.dataset.act; const val = active?.dataset.val;
  app.innerHTML = screen === 'done' ? renderDone() : renderForm();
  if (sending) app.querySelectorAll<HTMLInputElement>('input, textarea, button').forEach((el) => { el.disabled = true; });
  if (act) [...app.querySelectorAll<HTMLElement>('[data-act]')].find((el) => el.dataset.act === act && el.dataset.val === val)?.focus({ preventScroll: true });
}
function focusFirstError() {
  const k = Object.keys(errors)[0]; if (!k) return;
  const el = app.querySelector(`[data-field="${k}"], [data-act="${k}"]`) as HTMLElement | null;
  (el ?? app.querySelector('.cs-err'))?.scrollIntoView({ block: 'center' });
  el?.focus({ preventScroll: true });
}

async function submit() {
  if (sending || mode === 'closed' || step !== 1) return;
  if (form.website) return; // 자동 입력 방지
  errors = validate(form);
  notice = '';
  if (Object.keys(errors).length) { render(); focusFirstError(); return; }
  if (preview) { screen = 'done'; render(); window.scrollTo({ top: 0 }); app.querySelector<HTMLElement>('h1')?.focus(); return; }
  sending = true; render();
  const payload = buildPayload(form, summary, new Date().toISOString());
  try {
    await sendWithReceipt(SITE.consultEndpoint, payload, submissionId);
    sending = false; screen = 'done'; render(); window.scrollTo({ top: 0 });
    (app.querySelector('h1') as HTMLElement | null)?.focus({ preventScroll: true });
  } catch {
    sending = false; notice = '접수 완료를 확인하지 못했어요. 잠시 후 다시 눌러 주세요. 같은 신청은 중복 접수되지 않아요.'; render();
  }
}

app.addEventListener('click', (ev) => {
  const t = (ev.target as HTMLElement).closest('[data-act]') as HTMLElement | null;
  if (!t) return;
  if (sending) return;
  const { act, val } = t.dataset;
  if (act === 'next') {
    errors = Object.fromEntries(Object.entries(validate(form)).filter(([key]) => ['region', 'help', 'careWhen'].includes(key)));
    if (Object.keys(errors).length) { render(); focusFirstError(); return; }
    step = 1; render(); window.scrollTo({ top: 0 }); app.querySelector<HTMLElement>('h1')?.focus(); return;
  }
  if (act === 'back') { step = 0; errors = {}; render(); window.scrollTo({ top: 0 }); app.querySelector<HTMLElement>('h1')?.focus(); return; }
  if (act === 'preview-reset' && preview) { form = emptyForm(); step = 0; screen = 'form'; errors = {}; submissionId = requestId(); render(); window.scrollTo({ top: 0 }); return; }
  if (act !== 'submit') submissionId = requestId();
  if (act === 'example' && preview) { form.phone = '010-0000-0000'; form.name = '테스트 보호자'; delete errors.phone; render(); }
  else if (act === 'contact') { form.contact = val as ConsultForm['contact']; delete errors.contact; render(); }
  else if (act === 'careWhen') { form.careWhen = val as ConsultForm['careWhen']; delete errors.careWhen; render(); }
  else if (act === 'carePlace') { form.carePlace = form.carePlace === val ? '' : val as ConsultForm['carePlace']; render(); }
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
  if (sending) return;
  submissionId = requestId();
  if (el.type === 'checkbox') (form as any)[f] = el.checked;
  else (form as any)[f] = el.value;
});
app.addEventListener('change', (ev) => {
  const el = ev.target as HTMLInputElement;
  if (el.dataset.field === 'phone') { form.phone = formatPhone(el.value); el.value = form.phone; }
});

// 기능 스위치를 읽은 뒤 그린다. 간병 상담 바로가기(?help=care)는 consultMore 가 켜졌을 때만 받는다
void loadFeatures().then(() => {
  if (isOn('consultMore')) {
    const h = query.get('help');
    if (h && helpOptions(true).some((o) => o.value === h)) form.help = [h as HelpValue];
    if (isOn('caregiverMatch')) form.caregiverId = (query.get('cg') ?? '').slice(0, 40);
  }
  render();
  applyFeatures();
});
