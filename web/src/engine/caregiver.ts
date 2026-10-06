// 간병인 등록 신청 (care.html, 기능 스위치 caregiverMatch): 검사·보낼 내용 (화면과 분리된 순수 함수)
// 등록 신청은 '공개'가 아니다. 상담원이 확인·동의를 다시 받은 뒤에만 data/caregivers.json 에 넣는다
import { normalizePhone, formatPhone } from './consult.ts';

export const CG_EXPERIENCE = ['1년 미만', '1~3년', '3~5년', '5년 이상'] as const;
export const CG_CERTS = ['요양보호사', '간호조무사', '간병사 교육 수료', '없음'] as const;
export const CG_PLACES = ['병원', '집'] as const;
export const CG_SHIFTS = ['24시간 상주', '시간제'] as const;

export interface CaregiverForm {
  name: string;
  phone: string;
  regions: string[];
  experience: string;
  certs: string[];
  places: string[];
  shifts: string[];
  intro: string;
  agreePrivacy: boolean;
  website: string;
}
export const emptyCaregiver = (): CaregiverForm => ({ name: '', phone: '', regions: [], experience: '', certs: [], places: [], shifts: [], intro: '', agreePrivacy: false, website: '' });

export function validateCaregiver(f: CaregiverForm): Record<string, string> {
  const e: Record<string, string> = {};
  if (f.name.trim().length < 2) e.name = '성함을 적어 주세요.';
  if (!/^01[016789][0-9]{7,8}$/.test(normalizePhone(f.phone))) e.phone = '휴대폰 번호를 확인해 주세요. (예: 010-1234-5678)';
  if (!f.regions.length) e.regions = '활동할 수 있는 지역을 골라 주세요.';
  if (!f.experience) e.experience = '간병 경력을 골라 주세요.';
  if (!f.places.length) e.places = '가능한 곳을 골라 주세요.';
  if (!f.agreePrivacy) e.agreePrivacy = '개인정보 수집·이용에 동의해야 등록할 수 있어요.';
  return e;
}

/** 구글 시트 '간병인등록' 탭으로 보낼 한 줄 (Apps Script 가 kind 로 탭을 나눈다) */
export function buildCaregiverPayload(f: CaregiverForm, submittedAt: string) {
  return {
    kind: 'caregiver',
    submitted_at: submittedAt,
    name: f.name.trim().slice(0, 30),
    phone: formatPhone(f.phone),
    regions: f.regions.join(', '),
    experience: f.experience,
    certs: f.certs.join(', '),
    places: f.places.join(', '),
    shifts: f.shifts.join(', '),
    intro: f.intro.trim().slice(0, 300),
    privacy_consent: f.agreePrivacy ? 'Y' : 'N',
    status: '신규',
  };
}
