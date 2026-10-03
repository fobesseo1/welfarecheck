// 상담 신청: 검사, 결과 요약, 보낼 내용 (건강 정보는 따로 동의할 때만)
import { test, expect, describe } from 'vitest';
import { kb, items, TODAY } from './helpers.ts';
import { emptyForm, validate, resultSummary, buildPayload, formatPhone, type ConsultForm } from '../src/engine/consult.ts';
import type { Answers } from '../src/engine/types.ts';

const ok = (): ConsultForm => ({ ...emptyForm(), region: '경기', help: ['grade', 'match'], contact: 'phone', phone: '010-1234-5678', agreePrivacy: true });
const persona: Answers = { age: 'over65', dementia: 'diagnosed', insurance: 'health', grade: 'none', ...items('2'), b_wash: '2', b_dress: '2', b_eat: '1', b_move: '2', b_toilet: '2', b_limbs: '1', b_joints: '1', nursing_gate: 'no', memory_gate: 'no', behavior_gate: 'no', carer: 'family_hard', place: 'home', housing: [] };

describe('신청서 검사', () => {
  test('필수: 지역·도움·연락 방법·휴대폰·개인정보 동의. 동네·호칭은 선택', () => {
    expect(validate(ok())).toEqual({});
    const e = validate(emptyForm());
    expect(Object.keys(e).sort()).toEqual(['agreePrivacy', 'help', 'phone', 'region']);
  });
  test('직접 입력만 골랐으면 내용이 있어야 함', () => {
    expect(validate({ ...ok(), help: ['other'] }).help).toBeTruthy();
    expect(validate({ ...ok(), help: ['other'], helpText: '퇴원 후 돌봄' }).help).toBeUndefined();
  });
  test('휴대폰 번호 형식', () => {
    expect(validate({ ...ok(), phone: '0101234' }).phone).toBeTruthy();
    expect(validate({ ...ok(), phone: '02-123-4567' }).phone).toBeTruthy();
    expect(validate({ ...ok(), phone: '01012345678' }).phone).toBeUndefined();
    expect(formatPhone('01012345678')).toBe('010-1234-5678');
  });
});

describe('결과 요약과 보낼 내용', () => {
  test('3분 체크 답이 있으면 예상 등급·첫 줄·상황을 한 줄로', () => {
    const s = resultSummary(kb, persona, TODAY)!;
    expect(s.startsWith('예상 ')).toBe(true);
    expect(s).toContain('먼저 등급을 받아야 해요');
    expect(s).toContain('치매: 네, 받았어요');
    expect(resultSummary(kb, null, TODAY)).toBeNull();
    expect(resultSummary(kb, {}, TODAY)).toBeNull();
  });
  test('건강 정보(결과 요약)는 따로 동의했을 때만 보냄', () => {
    const s = resultSummary(kb, persona, TODAY);
    const no = buildPayload(ok(), s, 'T');
    expect(no.result_summary).toBe('');
    expect(no.sensitive_consent).toBe('N');
    const yes = buildPayload({ ...ok(), agreeSensitive: true }, s, 'T');
    expect(yes.result_summary).toBe(s);
    expect(yes.sensitive_consent).toBe('Y');
  });
  test('보낼 내용: 라벨로 바꾸고, 직접 입력은 골랐을 때만, 길이 제한', () => {
    const p = buildPayload({ ...ok(), help: ['match'], helpText: '안 보냄', dong: ' 평촌동 ', name: '딸' }, null, '2026-10-03T10:00:00Z');
    expect(p).toMatchObject({ region: '경기', dong: '평촌동', help: '시설 매칭', help_text: '', contact: '전화', phone: '010-1234-5678', name: '딸', privacy_consent: 'Y', status: '신규' });
    const long = buildPayload({ ...ok(), help: ['other'], helpText: 'x'.repeat(500) }, null, 'T');
    expect(long.help_text.length).toBe(300);
  });
});
