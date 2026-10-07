// 간병 안내 화면 (care.html). 기능 스위치별로 보이는 칸이 다르다
// - careGuide: 간병 안내 (꺼져 있으면 '준비 중' 안내만)
// - careCompanies: 간병 업체 정보 목록
// - caregiverMatch: 간병인 찾기·간병인 등록 (유료직업소개사업 등록 뒤에 켤 것)
import { kb } from './data.ts';
import { SITE, consultReady } from './site.ts';
import { sendWithReceipt, requestId } from './submission.ts';
import companiesJson from '../../data/care_companies.json' with { type: 'json' };
import caregiversJson from '../../data/caregivers.json' with { type: 'json' };
import { loadFeatures, applyFeatures, isOn } from './features.ts';
import { esc, attr } from './ui/html.ts';
import { CG_EXPERIENCE, CG_CERTS, CG_PLACES, CG_SHIFTS, emptyCaregiver, validateCaregiver, buildCaregiverPayload, type CaregiverForm } from './engine/caregiver.ts';
import { formatPhone } from './engine/consult.ts';

interface Company { id: string; name: string; regions: string[]; area: string; phone: string; url: string; services: string[]; price: string; registered: boolean; updated: string; example?: boolean }
interface Caregiver { id: string; display_name: string; gender: string; age_band: string; regions: string[]; area: string; experience: string; certs: string[]; places: string[]; shift: string; rate: string; intro: string; example?: boolean }
const companies = (companiesJson as { companies: Company[] }).companies;
const caregivers = (caregiversJson as { caregivers: Caregiver[] }).caregivers;

const app = document.getElementById('app')!;
let region = '';
let cg: CaregiverForm = emptyCaregiver();
let cgErrors: Record<string, string> = {};
let cgSent = false;
let cgNotice = '';
let sending = false;

const ICON = {
  back: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg>',
  right: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>',
};
const pressed = (b: boolean) => `aria-pressed="${b}"`;
const err = (k: string) => (cgErrors[k] ? `<p class="cs-err" role="alert">${esc(cgErrors[k])}</p>` : '');
function src(ids: string[]): string {
  const u = ids.filter((id) => kb.rules.has(id));
  return u.length ? `<span class="src">근거: ${u.map((id) => esc(kb.rule(id).sources.map((s) => `${kb.sources.get(s.src)?.title ?? s.src} ${s.article}`).join(', '))).join(' · ')}</span>` : '';
}
const ex = (b?: boolean) => (b ? '<span class="care-ex">예시</span>' : '');

function guide(): string {
  return `
    <div class="sec">
      <div class="sec-h"><span>입원 중이라면</span></div>
      <div class="cards">
        <div class="cardlet"><span class="t">병원에 '간호·간병통합 병동'이 있는지 먼저 물어보세요</span><span class="d">보호자나 개인 간병인 없이 간호사·간호조무사·간병지원인력이 함께 돌보는 병동이에요. 건강보험이 돼서 개인 간병보다 훨씬 적게 내요.</span>${src(['R-CARE-02'])}</div>
        <div class="cardlet"><span class="t">개인 간병비는 보험이 안 돼요</span><span class="d">입원해 있는 동안은 장기요양 서비스(방문요양 등)를 쓸 수 없고, 개인 간병인 비용은 직접 내요. 가입한 실손·간병보험에 '간병인 지원'이나 '간병인 사용 일당'이 있는지 보험사에 확인해 보세요.</span>${src(['R-HOME-09'])}</div>
        <div class="cardlet"><span class="t">정부가 요양병원 간병비 건강보험 적용을 추진 중이에요</span><span class="d">2027년부터 일부 요양병원에서 간병비 본인부담을 낮추는 방안이 발표됐어요. 아직 확정 전이라, 확정되면 여기서 알려드릴게요.</span></div>
      </div>
    </div>
    <div class="sec">
      <div class="sec-h"><span>퇴원했거나 곧 퇴원한다면</span></div>
      <div class="cards">
        <div class="cardlet"><span class="t">장기요양등급이 있으면 방문요양·방문간호를 쓸 수 있어요</span><span class="d">등급이 없다면 지금 신청해도 돼요. 3분 체크로 예상 등급과 쓸 수 있는 돌봄을 먼저 알아보세요.</span><a class="link" href="check.html#need=care">3분 체크 시작${ICON.right}</a></div>
        <div class="cardlet"><span class="t">퇴원 직후라면 시·군·구청에 '통합지원'을 신청할 수 있어요</span><span class="d">의료·요양·일상돌봄을 묶어 계획을 세워 줘요. 장기요양 신청이 기각된 분도 신청할 수 있어요.</span>${src(['R-COMM-02'])}</div>
        <div class="cardlet"><span class="t">노인맞춤돌봄 '퇴원후돌봄' (2026년 기준)</span><span class="d">65세 이상이고 기초생활수급·차상위·기초연금을 받으시면, 퇴원 뒤 월 44시간까지 식사·가사·병원 동행 같은 집중 돌봄을 받을 수 있어요. 주소지 행정복지센터에 신청해요. 장기요양 등급이 있으면 대상이 아니에요.</span>${src(['R-COMM-01'])}</div>
      </div>
    </div>`;
}

function companyList(): string {
  const list = companies.filter((c) => !region || c.regions.includes(region));
  return `
    <div class="sec" id="companies">
      <div class="sec-h"><span>간병 업체 찾기</span><span>${list.length}곳</span></div>
      <div class="cs-pills care-regions">${['', ...new Set(companies.flatMap((c) => c.regions))].map((r) => `<button type="button" class="pill cs-pill" data-act="region" data-val="${attr(r)}" ${pressed(region === r)}>${esc(r || '전체')}</button>`).join('')}</div>
      ${list.length ? `<div class="cards">${list.map((c) => `
        <div class="cardlet care-co">
          <span class="t">${esc(c.name)}${ex(c.example)}</span>
          <span class="d">${esc(c.area)} · ${esc(c.services.join(', '))}</span>
          <span class="d">요금: ${esc(c.price)}</span>
          <div class="links">${c.phone ? `<a class="link" href="tel:${attr(c.phone.replace(/[^0-9]/g, ''))}">${esc(c.phone)}${ICON.right}</a>` : ''}${c.url ? `<a class="link" href="${attr(c.url)}" target="_blank" rel="noopener noreferrer">홈페이지${ICON.right}</a>` : ''}</div>
          <span class="src">정보 확인일 ${esc(c.updated)}</span>
        </div>`).join('')}</div>` : '<p class="meta">이 지역은 아직 정리된 업체가 없어요. 무료 상담을 신청하시면 같이 알아봐 드릴게요.</p>'}
      <p class="cs-note">업체 정보는 보호자가 직접 연락하실 수 있게 보여 드리는 거예요. 업체에서 소개비를 받지 않아요. 요금·조건은 업체에 직접 확인해 주세요.</p>
    </div>`;
}

function caregiverList(): string {
  const list = caregivers.filter((c) => !region || c.regions.includes(region));
  return `
    <div class="sec" id="caregivers">
      <div class="sec-h"><span>간병인 찾기</span><span>${list.length}명</span></div>
      ${list.length ? `<div class="cards">${list.map((c) => `
        <div class="cardlet care-cg">
          <span class="t">${esc(c.display_name)}${ex(c.example)}</span>
          <span class="d">${esc([c.gender, c.age_band, `경력 ${c.experience}`].filter(Boolean).join(' · '))}</span>
          <span class="d">${esc(c.area)} · ${esc(c.places.join('·'))} · ${esc(c.shift)}</span>
          <span class="d">자격: ${esc(c.certs.join(', ') || '없음')} · 일당: ${esc(c.rate)}</span>
          ${c.intro ? `<span class="memo">${esc(c.intro)}</span>` : ''}
          <a class="mini" href="consult.html?help=care&cg=${attr(encodeURIComponent(c.id))}">이 분으로 상담 요청</a>
        </div>`).join('')}</div>` : '<p class="meta">이 지역에 등록된 간병인이 아직 없어요. 무료 상담을 신청하시면 같이 찾아 드릴게요.</p>'}
    </div>`;
}

let caregiverSubmissionId = requestId();
function caregiverForm(): string {
  if (!consultReady()) return '<div class="sec"><p class="meta">간병인 등록 접수를 준비하고 있어요. 지금은 개인정보를 받지 않아요.</p></div>';
  if (cgSent) return `<div class="sec" id="cg-form"><div class="cardlet"><span class="t">간병인 등록 신청이 됐어요</span><span class="d">${esc(SITE.hours)} 안에 확인하고 연락드릴게요. 공개하기 전에 한 번 더 여쭤보고 동의를 받아요.</span></div></div>`;
  const chips = (key: 'regions' | 'certs' | 'places' | 'shifts', opts: readonly string[]) =>
    `<div class="cs-pills">${opts.map((o) => `<button type="button" class="pill cs-pill" data-act="cg-multi" data-key="${key}" data-val="${attr(o)}" ${pressed(cg[key].includes(o))}>${esc(o)}</button>`).join('')}</div>`;
  return `
    <div class="sec" id="cg-form">
      <div class="sec-h"><span>간병인으로 등록하기</span></div>
      <p class="meta">간병 일을 하시는 분이라면 등록해 주세요. 확인 후 연락드려요.</p>
      <label class="cs-label" for="cg-name">성함</label>
      <input id="cg-name" class="cs-input" data-cg="name" type="text" maxlength="30" value="${attr(cg.name)}" autocomplete="name" />${err('name')}
      <label class="cs-label" for="cg-phone">휴대폰 번호</label>
      <input id="cg-phone" class="cs-input cs-phone" data-cg="phone" type="tel" inputmode="numeric" maxlength="13" placeholder="010-0000-0000" value="${attr(cg.phone)}" autocomplete="tel" />${err('phone')}
      <label class="cs-label" for="cg-regions">활동할 수 있는 지역</label><input id="cg-regions" class="cs-input" data-cg="regions" type="text" maxlength="150" placeholder="활동 가능한 시·군·구를 쉼표로 나눠 적어 주세요" value="${attr(cg.regions.join(', '))}" />${err('regions')}
      <p class="cs-label">간병 경력</p>
      <div class="cs-pills">${CG_EXPERIENCE.map((o) => `<button type="button" class="pill cs-pill" data-act="cg-exp" data-val="${attr(o)}" ${pressed(cg.experience === o)}>${esc(o)}</button>`).join('')}</div>${err('experience')}
      <p class="cs-label">자격 (여러 개 가능)</p>${chips('certs', CG_CERTS)}
      <p class="cs-label">가능한 곳</p>${chips('places', CG_PLACES)}${err('places')}
      <p class="cs-label">근무 형태 (선택)</p>${chips('shifts', CG_SHIFTS)}
      <label class="cs-label" for="cg-intro">짧은 소개 (선택)</label>
      <textarea id="cg-intro" class="cs-input care-ta" data-cg="intro" maxlength="300" rows="3" placeholder="예: 치매 어르신 돌봄 경험이 많아요">${esc(cg.intro)}</textarea>
      <input class="cs-hp" data-cg="website" type="text" tabindex="-1" autocomplete="off" aria-hidden="true" value="" />
      <div class="cs-agree-wrap"><label class="cs-agree"><input type="checkbox" data-cg="agreePrivacy" ${cg.agreePrivacy ? 'checked' : ''} /><span>(필수) 간병인 등록을 위한 개인정보 수집·이용에 동의해요</span></label>
        <details class="cs-privacy"><summary>수집·이용 내용 보기</summary><ul><li>운영 주체: ${esc(SITE.company.name)}</li><li>목적: 간병인 등록 신청 확인과 연락</li><li>항목: 성함·연락처·활동 지역·경력·자격·가능한 곳·근무 형태·소개</li><li>보관 기간: ${esc(SITE.retention)}. 언제든 삭제를 요청할 수 있어요.</li><li>동의하지 않으면 등록 신청을 낼 수 없어요. 신청 내용은 별도 공개 동의를 받기 전에는 공개하지 않아요.</li></ul></details>${err('agreePrivacy')}</div>
      <button type="button" class="round cs-submit" data-act="cg-submit" ${sending ? 'disabled' : ''}>${sending ? '보내는 중…' : '간병인 등록 신청'}</button>
      ${cgNotice ? `<p class="cs-notice" role="status">${esc(cgNotice)}</p>` : ''}
      <p class="cs-note">등록 신청만으로 공개되지 않아요. 상담원이 확인하고 공개 동의를 다시 받은 뒤에만 '간병인 찾기'에 보여요. 수수료는 법에서 정한 한도 안에서만 받아요.</p>
      ${src(['R-CARE-01'])}
    </div>`;
}

function render() {
  const back = `<a class="icon-btn" href="index.html" aria-label="홈으로">${ICON.back}</a>`;
  if (!isOn('careGuide')) {
    app.innerHTML = `<section class="card cs"><div class="topbar">${back}</div><h1 class="cs-h" tabindex="-1">준비 중인 페이지예요</h1><p class="lead">간병 안내는 곧 열려요. 지금은 무료 상담으로 물어봐 주세요.</p><div class="links"><a class="link" href="consult.html">무료 상담 신청${ICON.right}</a><a class="link" href="index.html">홈으로</a></div></section>`;
    return;
  }
  const y = window.scrollY;
  app.innerHTML = `
  <section class="card cs care" aria-labelledby="care-title">
    <div class="topbar">${back}<span class="count">간병</span></div>
    <h1 id="care-title" class="cs-h" tabindex="-1">잠깐 간병이 필요할 때</h1>
    <p class="lead">입원 중이거나 막 퇴원하셨다면, 이것부터 확인해 보세요. 장기요양등급이 없어도 돼요.</p>
    ${guide()}
    ${isOn('careCompanies') ? companyList() : ''}
    ${isOn('caregiverMatch') ? caregiverList() + caregiverForm() : ''}
    <div class="sec">
      <a class="round cs-submit" href="consult.html?help=care">간병 무료 상담 신청${ICON.right}</a>
      <p class="fine">상담은 무료예요. 기관·업체에서 소개비를 받지 않아요.</p>
    </div>
  </section>`;
  if (sending) app.querySelectorAll<HTMLInputElement>('input, textarea, button').forEach((el) => { el.disabled = true; });
  window.scrollTo({ top: y });
}

async function submitCaregiver() {
  if (sending || !consultReady()) return;
  if (cg.website) return;
  cgErrors = validateCaregiver(cg); cgNotice = '';
  if (Object.keys(cgErrors).length) { render(); document.querySelector('#cg-form .cs-err')?.scrollIntoView({ block: 'center' }); return; }
  if (!SITE.consultEndpoint) { cgNotice = '등록 접수를 준비하고 있어요. 곧 열려요.'; render(); return; }
  sending = true; render();
  try {
    await sendWithReceipt(SITE.consultEndpoint, buildCaregiverPayload(cg, new Date().toISOString()), caregiverSubmissionId);
    cgSent = true;
  } catch { cgNotice = '등록 완료를 확인하지 못했어요. 잠시 후 다시 눌러 주세요. 같은 신청은 중복 접수되지 않아요.'; }
  sending = false; render();
}

app.addEventListener('click', (ev) => {
  const t = (ev.target as HTMLElement).closest('[data-act]') as HTMLElement | null;
  if (!t) return;
  const { act, val, key } = t.dataset;
  if (sending) return;
  if (act === 'cg-exp' || act === 'cg-multi') caregiverSubmissionId = requestId();
  if (act === 'region') { region = val ?? ''; render(); }
  else if (act === 'cg-exp') { cg.experience = val!; delete cgErrors.experience; render(); }
  else if (act === 'cg-multi') {
    const k = key as 'regions' | 'certs' | 'places' | 'shifts'; const arr = cg[k]; const i = arr.indexOf(val!);
    if (i >= 0) arr.splice(i, 1); else arr.push(val!);
    delete cgErrors[k]; render();
  } else if (act === 'cg-submit') void submitCaregiver();
});
app.addEventListener('input', (ev) => {
  const el = ev.target as HTMLInputElement;
  const f = el.dataset.cg as keyof CaregiverForm | undefined;
  if (!f) return;
  if (sending) return;
  caregiverSubmissionId = requestId();
  if (f === 'regions') cg.regions = el.value.split(',').map((r) => r.trim()).filter(Boolean);
  else if (el.type === 'checkbox') (cg as any)[f] = el.checked; else (cg as any)[f] = el.value;
});
app.addEventListener('change', (ev) => {
  const el = ev.target as HTMLInputElement;
  if (el.dataset.cg === 'phone') { cg.phone = formatPhone(el.value); el.value = cg.phone; }
});

void loadFeatures().then(() => { render(); applyFeatures(); });
