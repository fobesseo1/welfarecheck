// 상담 신청: 검사·결과 요약·보낼 내용 (화면과 분리된 순수 함수)
// 원칙(CLAUDE.md 5): 연락처는 상담을 원할 때만, 동의를 받고. 건강 정보(결과 요약)는 따로 동의한 경우에만 보낸다.
import type { Kb } from './kb.ts';
import type { Answers } from './types.ts';
import { buildResult } from './result.ts';
import { visibleSteps } from './answers.ts';

export const HELP_OPTIONS = [
  { value: 'grade', label: '등급 받기 준비' },
  { value: 'match', label: '시설 매칭' },
  { value: 'unknown', label: '아직 잘 모르겠어요' },
  { value: 'other', label: '직접 입력' },
] as const;
/** 기능 스위치 consultMore 가 켜지면 더 보이는 선택지 */
export const MORE_HELP_OPTIONS = [
  { value: 'care', label: '간병' },
  { value: 'home', label: '방문요양' },
  { value: 'day', label: '주간보호' },
] as const;
export type HelpValue = (typeof HELP_OPTIONS)[number]['value'] | (typeof MORE_HELP_OPTIONS)[number]['value'];
const ALL_HELP: readonly { value: HelpValue; label: string }[] = [...HELP_OPTIONS, ...MORE_HELP_OPTIONS];
/** 화면에 보일 순서: 등급 → 간병·방문요양·주간보호 → 시설 → 모름 → 직접 */
export function helpOptions(more: boolean): readonly { value: HelpValue; label: string }[] {
  if (!more) return HELP_OPTIONS;
  return [HELP_OPTIONS[0], ...MORE_HELP_OPTIONS, HELP_OPTIONS[1], HELP_OPTIONS[2], HELP_OPTIONS[3]];
}
export const helpLabel = (v: string) => ALL_HELP.find((o) => o.value === v)?.label ?? v;
export const CARE_WHEN = [
  { value: 'now', label: '오늘·내일부터' },
  { value: 'week', label: '이번 주 안에' },
  { value: 'later', label: '아직 정해지지 않았어요' },
] as const;
export const CARE_PLACE = [
  { value: 'hospital', label: '병원 (입원 중)' },
  { value: 'home', label: '집 (퇴원 후 등)' },
] as const;
export const CONTACT_OPTIONS = [
  { value: 'phone', label: '전화' },
  { value: 'kakao', label: '카톡 메시지' },
] as const;

export interface ConsultForm {
  region: string;
  dong: string;
  help: HelpValue[];
  helpText: string;
  contact: 'phone' | 'kakao' | '';
  phone: string;
  name: string;
  /** (선택) 건강 관련 정보인 결과 요약을 함께 보내는 데 동의 */
  agreeSensitive: boolean;
  /** (필수) 상담을 위한 개인정보 수집·이용 동의 */
  agreePrivacy: boolean;
  /** 자동 입력 방지용 숨은 칸 (사람은 비워 둠) */
  website: string;
  /** (간병을 골랐을 때) 언제부터 · 어디서 */
  careWhen: '' | (typeof CARE_WHEN)[number]['value'];
  carePlace: '' | (typeof CARE_PLACE)[number]['value'];
  /** 간병인 찾기에서 고른 간병인 (기능 스위치 caregiverMatch) */
  caregiverId: string;
}
export const emptyForm = (): ConsultForm => ({ region: '', dong: '', help: [], helpText: '', contact: 'phone', phone: '', name: '', agreeSensitive: false, agreePrivacy: false, website: '', careWhen: '', carePlace: '', caregiverId: '' });

export const normalizePhone = (p: string) => p.replace(/[^0-9]/g, '');
export const formatPhone = (p: string) => {
  const d = normalizePhone(p);
  if (d.length === 11) return `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
  return d;
};

/** 빠진 것 목록 (키 → 보호자에게 보일 문장) */
export function validate(f: ConsultForm): Record<string, string> {
  const e: Record<string, string> = {};
  if (!f.region) e.region = '어르신이 사시는 곳을 골라 주세요.';
  if (!f.help.length) e.help = '필요한 도움을 하나 이상 골라 주세요.';
  else if (f.help.length === 1 && f.help[0] === 'other' && !f.helpText.trim()) e.help = '직접 입력 칸에 짧게 적어 주세요.';
  if (!f.contact) e.contact = '연락 방법을 골라 주세요.';
  if (!/^01[016789][0-9]{7,8}$/.test(normalizePhone(f.phone))) e.phone = '휴대폰 번호를 확인해 주세요. (예: 010-1234-5678)';
  if (!f.agreePrivacy) e.agreePrivacy = '개인정보 수집·이용에 동의해야 신청할 수 있어요.';
  if (f.help.includes('care') && !f.careWhen) e.careWhen = '간병이 언제부터 필요한지 골라 주세요.';
  return e;
}

/** 3분 체크 결과 요약 (상담원이 처음부터 다시 묻지 않게). 답이 없으면 null */
export function resultSummary(kb: Kb, answers: Answers | null | undefined, today: string): string | null {
  if (!answers || !answers.age) return null;
  const r = buildResult(kb, answers, today);
  const label = (id: string) => {
    const s = visibleSteps(kb, answers).find((x) => x.id === id);
    const v = answers[id];
    return s && typeof v === 'string' ? s.options?.find((o) => o.value === v)?.label : undefined;
  };
  const parts = [
    `예상 ${r.estimate.label}`,
    r.verdict.title,
    label('grade') && `현재 등급: ${label('grade')}`,
    label('age'),
    label('disease') && `질병: ${label('disease')}`,
    label('dementia') && `치매: ${label('dementia')}`,
    label('carer') && `돌봄: ${label('carer')}`,
    label('place') && `지내는 곳: ${label('place')}`,
  ].filter(Boolean);
  return parts.join(' · ');
}

/** 구글 시트로 보낼 한 줄. 결과 요약은 따로 동의했을 때만 담는다 */
export function buildPayload(f: ConsultForm, summary: string | null, submittedAt: string) {
  const labels = f.help.map(helpLabel);
  return {
    submitted_at: submittedAt,
    region: f.region,
    dong: f.dong.trim().slice(0, 40),
    help: labels.join(', '),
    help_text: f.help.includes('other') ? f.helpText.trim().slice(0, 300) : '',
    contact: CONTACT_OPTIONS.find((o) => o.value === f.contact)?.label ?? '',
    phone: formatPhone(f.phone),
    name: f.name.trim().slice(0, 30),
    result_summary: f.agreeSensitive && summary ? summary : '',
    sensitive_consent: f.agreeSensitive && !!summary ? 'Y' : 'N',
    privacy_consent: f.agreePrivacy ? 'Y' : 'N',
    care_when: f.help.includes('care') ? CARE_WHEN.find((o) => o.value === f.careWhen)?.label ?? '' : '',
    care_place: f.help.includes('care') ? CARE_PLACE.find((o) => o.value === f.carePlace)?.label ?? '' : '',
    caregiver_id: f.caregiverId.trim().slice(0, 40),
    status: '신규',
  };
}
