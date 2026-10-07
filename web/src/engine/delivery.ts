import type { Answers } from './types.ts';
import type { Kb } from './kb.ts';
import { visibleSteps, otherText } from './answers.ts';

export const GUIDES = [
  ['01', '장기요양등급 처음 신청'], ['02', '방문요양과 주간보호'],
  ['03', '요양원 방문·비교'], ['04', '판정 대기 중 돌봄 준비'],
  ['05', '퇴원 후 첫 일주일'], ['06', '등급 결과·서비스 다시 상담'],
  ['07', '등급 없이 필요한 도움'], ['08', '도움 거부·치매 걱정'],
] as const;
export function recommendedGuides(a: Answers): string[] {
  if (a.place === 'hospital') return ['05', '07'];
  if (a.grade_feel === 'low' || a.grade_feel === 'worse') return ['06'];
  if (a.grade === 'pending') return ['04', '07'];
  if (a.grade === 'out_of_grade' || (a.age === 'under65' && a.disease === 'none')) return ['07'];
  if (a.grade === 'none') return ['01'];
  if (a.goal === 'facility') return ['03'];
  return ['02'];
}
/** 현재 화면의 답만 전송. 숨겨진 옛 답, 내부 계산 키, 수정 이력은 제외한다. */
export function currentAnswers(kb: Kb, raw: Answers): Answers {
  const out: Answers = {};
  for (const s of visibleSteps(kb, raw)) {
    if (raw[s.id] !== undefined) out[s.id] = raw[s.id];
    if (s.other && otherText(raw, s.id)) out[`${s.id}_other`] = otherText(raw, s.id);
  }
  return out;
}
export interface DeliveryForm {
  email: string; phone: string; guides: string[]; privacy: boolean;
  sensitive: boolean; marketing: boolean; consult: boolean;
}
export function deliveryErrors(f: DeliveryForm): string[] {
  const errors: string[] = [];
  if (!/^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(f.email.trim()) || f.email.length > 254) errors.push('이메일 주소를 확인해 주세요.');
  if (!f.privacy) errors.push('자료 전달을 위한 개인정보 이용에 동의해 주세요.');
  if (f.guides.length < 1 || f.guides.length > 2 || f.guides.some(id => !GUIDES.some(g => g[0] === id))) errors.push('안내서를 1~2개 골라 주세요.');
  if (!/^01[016789]\d{7,8}$/.test(f.phone.replace(/-/g, ''))) errors.push('휴대전화 번호를 확인해 주세요.');
  return errors;
}
