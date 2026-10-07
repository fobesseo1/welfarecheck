import { SITE } from './site.ts';
import { GUIDES, currentAnswers, recommendedGuides, deliveryErrors } from './engine/delivery.ts';
import type { Answers } from './engine/types.ts';
import type { Kb } from './engine/kb.ts';
import { esc, attr } from './ui/html.ts';
import { requestId, sendWithReceipt } from './submission.ts';
import './delivery.css';

export function mountDelivery(app: HTMLElement, kb: Kb, answers: Answers, summary: string) {
  const host = app.querySelector<HTMLElement>('[data-delivery]');
  if (!host) return;
  const ready = Boolean(SITE.deliveryEndpoint);
  if (!ready && !import.meta.env.DEV) { host.remove(); return; }
  const rec = recommendedGuides(currentAnswers(kb, answers));
  host.innerHTML = `<details class="delivery"><summary>결과와 준비 안내서를 이메일로 받기 <span>선택</span></summary>
  <form><p>지금 필요한 안내서 1~2개를 보내드려요. 연락처를 남기지 않아도 화면의 결과는 그대로 볼 수 있어요.</p>
  ${!ready ? '<p class="delivery-preview">화면 미리보기 · 아직 저장하거나 이메일을 보내지 않아요.</p>' : ''}
  <fieldset><legend>어떤 안내서가 필요하세요?</legend><p class="delivery-hint">이번 답변을 참고해 골랐어요. 다른 안내서로 바꿀 수 있어요.</p>
  ${GUIDES.map(([id, title]) => `<label><input type="checkbox" name="guide" value="${id}" ${rec.includes(id) ? 'checked' : ''}>${esc(title)}</label>`).join('')}</fieldset>
  <label for="delivery-email">받으실 이메일</label><input id="delivery-email" name="email" type="email" autocomplete="email" maxlength="254" placeholder="이메일 주소" required>
  <label for="delivery-phone">휴대전화 번호</label><input id="delivery-phone" name="phone" type="tel" autocomplete="tel" maxlength="13" placeholder="010-0000-0000" required><p class="delivery-hint">자료 전달에 문제가 생기면 확인할 수 있는 번호를 남겨 주세요.</p>
  <label><input name="consult" type="checkbox">상담도 받고 싶어요</label>
  <fieldset><legend>자료 전달과 정보 이용</legend>
  <label><input name="privacy" type="checkbox" required>[필수] 자료 전달을 위한 개인정보 수집·이용 동의</label>
  <p class="delivery-hint">모심듀오가 이메일·전화번호·선택한 자료·동의 기록을 자료 전달과 전달 문제 확인에 이용합니다. 상담 요청 시 상담 연락에도 이용합니다. ${esc(SITE.retention)} 보관 후 삭제합니다. 자료 요청만 하시면 발송 처리 완료를 상담 종료로 봅니다.</p>
  <label><input name="sensitive" type="checkbox">[선택] 현재 체크 답변·결과 저장 및 이메일 전달 동의</label>
  <p class="delivery-hint">부모님의 질병·몸 상태 등 건강정보가 포함됩니다. 모심듀오가 결과 전달과 요청하신 상담에 이용하며 같은 기간 보관합니다. 동의하지 않아도 고른 일반 안내서는 받을 수 있어요.</p>
  <label><input name="marketing" type="checkbox">[선택] 추후 모심듀오의 돌봄 정보를 이메일로 받기</label>
  <p class="delivery-hint">언제든 ${esc(SITE.email)}로 수신 중단을 요청할 수 있어요. 동의하지 않아도 자료와 상담을 받을 수 있어요.</p></fieldset>
  <input name="website" tabindex="-1" autocomplete="off" class="delivery-trap" aria-hidden="true">
  <p data-status role="status" aria-live="polite"></p><button type="submit" class="btn">${ready ? '이메일로 받기' : '요청 화면 확인하기'}</button>
  </form></details>`;
  const form = host.querySelector('form')!;
  let id = requestId(); let submittedBody = ''; let busy = false;
  form.addEventListener('submit', async event => {
    event.preventDefault(); if (busy) return;
    const data = new FormData(form); const status = host.querySelector<HTMLElement>('[data-status]')!;
    const f = { email: String(data.get('email') || '').trim(), phone: String(data.get('phone') || '').trim(), guides: data.getAll('guide').map(String), privacy: data.has('privacy'), sensitive: data.has('sensitive'), marketing: data.has('marketing'), consult: data.has('consult') };
    const errors = deliveryErrors(f); if (errors.length) { status.textContent = errors.join(' '); return; }
    if (!ready) { status.textContent = '입력 항목을 확인했어요. 미리보기에서는 저장·발송하지 않아요.'; return; }
    const payload = { kind: 'guide_request', email: f.email, phone: f.phone, guide_ids: f.guides, privacy_consent: 'Y', sensitive_consent: f.sensitive ? 'Y' : 'N', marketing_consent: f.marketing ? 'Y' : 'N', consult_requested: f.consult, answers: f.sensitive ? currentAnswers(kb, answers) : {}, result_summary: f.sensitive ? summary : '', version: '2026-10-06', website: String(data.get('website') || '') };
    const body = JSON.stringify(payload); if (submittedBody && submittedBody !== body) id = requestId(); submittedBody = body;
    const button = form.querySelector<HTMLButtonElement>('button[type=submit]')!;
    busy = true; button.disabled = true; status.textContent = '자료 요청을 접수하고 있어요…';
    try {
      await sendWithReceipt(SITE.deliveryEndpoint, payload, id);
      host.innerHTML = `<div class="delivery"><h3>자료 요청을 접수했어요</h3><p>${esc(f.email)}로 준비 안내서를 보내드릴게요. 보통 5~10분 안에 발송하며, 발송 한도나 오류가 있으면 더 걸릴 수 있어요.</p>${f.consult ? '<p>상담 요청도 함께 남겼어요. 운영시간에 연락드릴게요.</p>' : ''}<p>메일이 오지 않으면 스팸함을 확인하거나 <a href="mailto:${attr(SITE.email)}">${esc(SITE.email)}</a>로 문의해 주세요.</p><p class="delivery-hint">접수 번호 ${esc(id)}</p></div>`;
    } catch { status.textContent = '접수를 확인하지 못했어요. 같은 내용으로 다시 누르면 저장 여부부터 확인합니다.'; button.disabled = false; }
    finally { busy = false; }
  });
}
