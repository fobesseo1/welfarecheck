// 기능 스위치: 새 기능을 다 만들어 두고, 관리자가 켜기 전에는 보호자에게 보이지 않게 한다.
// - 사이트 전체 값: public/features.json (GitHub에서 true/false 만 바꾸면 몇 분 뒤 모두에게 반영)
// - 관리자 미리보기: admin.html 에서 켠 값은 그 브라우저에만 저장되어 관리자만 본다
// - HTML: data-feature="이름" 은 켜졌을 때만 보이고(처음엔 hidden), data-feature-off="이름" 은 켜지면 숨는다

export const FEATURES = [
  { id: 'homeHub', name: '홈 새 첫 화면', desc: '제목 "부모님 돌봄, 어디서부터 시작할까요?", 상황 카드 4개, 돌봄 종류에 간병 카드' },
  { id: 'careMatrix', name: '결과: 이용할 수 있는 돌봄', desc: '3분 체크 결과에 등급별 방문요양·주간보호·단기보호·요양원 가능 여부와 월 한도액 표, "필요한 도움" 선택' },
  { id: 'careGuide', name: '간병 안내 페이지', desc: 'care.html: 간병비·간호간병통합 병동·간병보험·퇴원 후 지자체 돌봄 안내' },
  { id: 'careCompanies', name: '간병 업체 목록', desc: 'care.html 안 간병 업체 정보(상호·지역·연락처·요금). data/care_companies.json' },
  { id: 'caregiverMatch', name: '간병인 찾기·등록 (매칭)', desc: '간병인 프로필, 간병인 등록 신청, 특정 간병인 상담 요청. ⚠ 유료직업소개사업 등록 뒤에 켜세요 (직업안정법 제18·19조)' },
  { id: 'consultMore', name: '상담 신청 선택지 확장', desc: '간병·방문요양·주간보호 선택지와 간병 추가 질문(언제부터·병원/집)' },
] as const;
export type FeatureId = (typeof FEATURES)[number]['id'];
export type Flags = Record<FeatureId, boolean>;

export const ADMIN_KEY = 'mosim-admin-flags';
export const allOff = (): Flags => Object.fromEntries(FEATURES.map((f) => [f.id, false])) as Flags;

/** 사이트 값 위에 관리자 미리보기 값을 덮는다. 모르는 이름·true/false 아닌 값은 버린다 */
export function mergeFlags(site: unknown, preview: unknown): Flags {
  const out = allOff();
  for (const src of [site, preview]) {
    if (!src || typeof src !== 'object') continue;
    for (const f of FEATURES) { const v = (src as Record<string, unknown>)[f.id]; if (typeof v === 'boolean') out[f.id] = v; }
  }
  return out;
}

let flags: Flags = allOff();
let siteFlags: Flags = allOff();
export const isOn = (id: FeatureId) => flags[id];
export const getSiteFlags = () => ({ ...siteFlags });

export function readPreview(): Partial<Flags> | null {
  try { const v = JSON.parse(localStorage.getItem(ADMIN_KEY) ?? 'null'); return v && typeof v === 'object' ? v : null; } catch { return null; }
}
export function writePreview(p: Partial<Flags> | null) {
  try { if (p && Object.keys(p).length) localStorage.setItem(ADMIN_KEY, JSON.stringify(p)); else localStorage.removeItem(ADMIN_KEY); } catch { /* 저장 불가 */ }
}

/** features.json 을 읽어 스위치를 정한다. 못 읽으면 모두 꺼진 상태(보호자에게 새 기능이 새지 않게) */
export async function loadFeatures(): Promise<Flags> {
  let site: unknown = null;
  try { const r = await fetch('features.json', { cache: 'no-store' }); if (r.ok) site = await r.json(); } catch { /* 오프라인 등 */ }
  siteFlags = mergeFlags(site, null);
  flags = mergeFlags(site, readPreview());
  return flags;
}

/** 화면 안 data-feature / data-feature-off 요소를 스위치에 맞게 보이고 숨긴다. 미리보기 중이면 작은 표시를 띄운다 */
export function applyFeatures(root: ParentNode = document) {
  const ids = (v?: string) => (v ? v.split(/\s+/).filter(Boolean) as FeatureId[] : []);
  root.querySelectorAll<HTMLElement>('[data-feature], [data-feature-off]').forEach((el) => {
    el.hidden = !(ids(el.dataset.feature).every((id) => flags[id]) && !ids(el.dataset.featureOff).some((id) => flags[id]));
  });
  const preview = readPreview();
  if (preview && Object.keys(preview).length && typeof document !== 'undefined' && !document.getElementById('admin-preview-badge')) {
    const b = document.createElement('a');
    b.id = 'admin-preview-badge'; b.href = 'admin.html'; b.textContent = '관리자 미리보기 중';
    b.setAttribute('style', 'position:fixed;right:12px;bottom:12px;z-index:99;padding:8px 12px;border-radius:999px;background:#2B3036;color:#fff;font-size:12px;font-weight:700;text-decoration:none;box-shadow:0 6px 16px rgba(0,0,0,.2)');
    document.body.appendChild(b);
  }
}
