// 답 하나를 바꾸면 결과가 실제로 바뀌는지 (하드코딩 금지 확인)
import { describe, test, expect } from 'vitest';
import { run, items, est } from './helpers.ts';
import { GRADE_RANK } from '../src/engine/types.ts';

const B = { age: 'over65', insurance: 'health', dementia: 'diagnosed', grade: '4', facility_in_cert: 'no', validity_end: '2028-03-01', home_services: 'yes', hospital: 'no', living: 'elderly_only', caregiver: 'elderly_spouse', housing: [], behavior_service: 'no', goal: 'facility', dem_adl: 'incomplete', ...items('2') };

describe('등급', () => {
  test('4등급 → 2등급: 요양원 조건부 → 바로 가능, 변경신청 대신 입소 준비', () => {
    const four = run(B), two = run({ ...B, grade: '2' });
    expect(four.dec.C.result).toBe('PROCEDURE_REQUIRED');
    expect(four.procs).toContain('PROC-CHANGE-TYPE');
    expect(four.r.verdict.tone).toBe('maybe');
    expect(two.dec.C.result).toBe('MET');
    expect(two.procs).toContain('PROC-ADMISSION');
    expect(two.procs).not.toContain('PROC-CHANGE-TYPE');
    expect(two.r.verdict.tone).toBe('good');
    expect(two.docsNow).toEqual(expect.arrayContaining(['DOC-08', 'DOC-09']));
  });
  test('4등급 → 인지지원등급: 요양원 불가 + 재가급여 안내', () => {
    const r = run({ ...B, grade: 'cognitive' });
    expect(r.dec.C.result).toBe('NOT_ELIGIBLE');
    expect(r.procs).toContain('PROC-HOME-SERVICES');
    expect(r.r.verdict.tone).toBe('no');
    expect(r.r.verdict.body).toMatch(/주간보호/);
  });
  test('인정서에 시설급여가 있으면 변경신청 없이 입소 준비', () => {
    const r = run({ ...B, facility_in_cert: 'yes' });
    expect(r.dec.C.result).toBe('MET');
    expect(r.procs).toContain('PROC-ADMISSION');
    expect(r.procs).not.toContain('PROC-CHANGE-TYPE');
  });
  test('등급 없음: 요양원은 등급을 먼저 받아야 하고, 예상 등급 기준 시나리오를 보여준다', () => {
    const r = run({ ...B, grade: 'none', applicant: 'family' });
    expect(r.dec.C.result).toBe('NOT_ELIGIBLE');
    expect(r.r.facility.basis).toBe('expected_grade');
    expect(r.r.verdict.title).toBe('먼저 등급을 받아야 해요');
    expect(r.r.verdict.body).toContain(r.r.estimate.label);
    expect(r.r.facility.scenarios.length).toBeGreaterThan(0);
    expect(r.procs).toEqual(expect.arrayContaining(['PROC-INITIAL', 'PROC-PROXY']));
  });
});

describe('치매 진단', () => {
  // 신체기능 일부 도움 3개 → 추정 점수가 45~51 근처 (5등급 구간 포함)
  const mild = { ...items('1', [], { 'PHY-01': '2', 'PHY-04': '2', 'PHY-10': '2' }), dem_adl: 'incomplete' };
  test('진단 있음 → 없음: 5등급·인지지원등급이 예상 범위에서 빠진다', () => {
    const yes = est({ ...mild, dementia: 'diagnosed' }), no = est({ ...mild, dementia: 'none' });
    expect(yes.grades.some((g) => g === '5' || g === 'cognitive')).toBe(true);
    expect(no.grades.some((g) => g === '5' || g === 'cognitive')).toBe(false);
    expect(no.grades).toContain('none');
  });
  test('치매 진단이 있으면 요양원 시나리오에 인지지원등급 안내가 붙고, 의심이면 진료 권고가 할 일에 들어간다', () => {
    const r = run({ ...mild, age: 'over65', insurance: 'health', grade: 'none', dementia: 'diagnosed' });
    if (r.r.estimate.grades.includes('cognitive')) expect(r.r.facility.scenarios.some((s) => s.grades.includes('cognitive'))).toBe(true);
    const s = run({ ...mild, age: 'over65', insurance: 'health', grade: 'none', dementia: 'suspected' });
    expect(s.actions).toContain('ACT-DEMENTIA-DX');
    expect(r.actions).not.toContain('ACT-DEMENTIA-DX');
  });
});

describe('주 돌봄자 상황 (시설급여 사유 ①)', () => {
  const base = { ...B, living: 'with_family', caregiver: 'ok', housing: [], behavior_service: 'no' };
  test('충분히 돌봄 + 다른 사유 없음 → 변경 사유 없음, 재가급여 안내', () => {
    const r = run(base);
    expect(r.dec.D.result).toBe('NOT_ELIGIBLE');
    expect(r.procs).not.toContain('PROC-CHANGE-TYPE');
    expect(r.procs).toContain('PROC-HOME-SERVICES');
    expect(r.r.facility.reasons.map((x) => x.likelihood)).toEqual(['low', 'low', 'low']);
  });
  test('고령 배우자 혼자 돌봄 → ① 해당 가능성, 급여종류 변경 신청', () => {
    const r = run({ ...base, caregiver: 'elderly_spouse' });
    expect(r.dec.D.result).toBe('PROCEDURE_REQUIRED');
    expect((r.dec.D.data as any).reasons.map((x: any) => x.code)).toEqual(['①']);
    expect(r.r.facility.reasons[0].likelihood).toBe('possible');
    expect(r.actions).toContain('ACT-CHTYPE');
  });
  test('돌볼 사람 없음 → ① 해당 가능성 높음', () => {
    expect(run({ ...base, caregiver: 'nobody' }).r.facility.reasons[0].likelihood).toBe('high');
  });
  test('주거 문제(난방) → ② 해당 가능성, 센터 거절 → ③ 해당 가능성 높음', () => {
    const r = run({ ...base, housing: ['heating'], behavior_service: 'refused' });
    expect(r.r.facility.reasons[1].likelihood).toBe('possible');
    expect(r.r.facility.reasons[2].likelihood).toBe('high');
    expect((r.dec.D.data as any).reasons.map((x: any) => x.code)).toEqual(['②', '③']);
  });
  test('돌봄 환경을 모르면 정보 부족으로 표시하고 확인이 필요하다고 판단', () => {
    const { living: _l, caregiver: _c, housing: _h, behavior_service: _b, ...rest } = base;
    const r = run(rest);
    expect(r.dec.D.result).toBe('NEEDS_CHECK');
    // ③ 은 행동 체크리스트에 답했고(문제행동 없음) 서비스 거절 질문은 서비스 이용자에게만 나오므로 '낮음'
    expect(r.r.facility.reasons.map((x) => x.likelihood)).toEqual(['unknown', 'unknown', 'low']);
    const { living: _l2, caregiver: _c2, housing: _h2, behavior_service: _b2, ...noItems } = { ...rest, ...Object.fromEntries(Object.keys(rest).filter((k) => k.startsWith('BEH-')).map((k) => [k, undefined])) } as any;
    expect(run(noItems).r.facility.reasons.map((x) => x.likelihood)).toEqual(['unknown', 'unknown', 'unknown']);
  });
  test('등급이 없을 때도 예상 3~5등급 시나리오에 현재 답변상 사유 가능성을 표시', () => {
    const r = run({ ...base, grade: 'none', caregiver: 'family_hard', ...items('1', [], { 'PHY-01': '2', 'PHY-02': '2', 'PHY-04': '3', 'PHY-10': '2', 'PHY-12': '2' }) });
    const mid = r.r.facility.scenarios.find((s) => s.status === 'conditional');
    expect(mid, JSON.stringify(r.r.estimate.grades)).toBeDefined();
    expect(mid!.detail).toMatch(/가족이 돌보기 어려움' 사유에 해당할 수 있어요/);
  });
});

describe('유효기간', () => {
  const G = { ...B, grade: '2', goal: 'facility' };
  test('많이 남음 → 충족, 갱신 기간 안내', () => {
    const r = run({ ...G, validity_end: '2027-12-31' });
    expect(r.dec.B.result).toBe('MET');
    expect(r.procs).not.toContain('PROC-RENEWAL');
  });
  test('50일 남음 → 갱신 절차 + 의사소견서', () => {
    const r = run({ ...G, validity_end: '2026-11-18' });
    expect(r.dec.B.result).toBe('PROCEDURE_REQUIRED');
    expect(r.procs).toContain('PROC-RENEWAL');
    expect(r.docsNow).toContain('DOC-02');
    expect((r.dec.B.data as any).renewal_window).toEqual(['2026-08-20', '2026-10-19']);
  });
  test('20일 남음 → 기한 촉박, 긴급 행동', () => {
    const r = run({ ...G, validity_end: '2026-10-19' });
    expect(r.dec.B.result).toBe('NEEDS_EXPERT');
    expect(r.actions[0]).toBe('ACT-RENEW-URGENT');
  });
  test('이미 지남 → 공단 문의', () => {
    const r = run({ ...G, validity_end: '2026-08-31' });
    expect(r.dec.B.result).toBe('NEEDS_EXPERT');
    expect(r.actions).toContain('ACT-EXPIRED');
  });
});

describe('기타 조합', () => {
  test('65세 미만: 질병 없음 → 신청 대상 아님, 치매로 바꾸면 신청 대상 + 진단서', () => {
    const base = { age: 'under65', insurance: 'health', grade: 'none' };
    const none = run({ ...base, disease: 'none' });
    expect(none.dec.A.result).toBe('NOT_ELIGIBLE');
    expect(none.procs).not.toContain('PROC-INITIAL');
    const dem = run({ ...base, disease: 'dementia' });
    expect(dem.dec.A.result).toBe('MET');
    expect(dem.procs).toContain('PROC-INITIAL-UNDER65');
    expect(dem.docsNow).toContain('DOC-04');
  });
  test('혼자 사심 → 신청일부터 급여 절차 추가', () => {
    const base = { age: 'over65', insurance: 'health', grade: 'none' };
    expect(run({ ...base, living: 'with_family' }).procs).not.toContain('PROC-EARLY');
    const alone = run({ ...base, living: 'alone' });
    expect(alone.procs).toContain('PROC-EARLY');
    expect(alone.docsNow).toContain('DOC-10');
  });
  test('기초생활수급 + 요양원 가능 → 본인부담 면제 안내와 시·군·구 입소신청서', () => {
    const r = run({ ...B, grade: '1', insurance: 'medical_aid_basic' });
    expect(r.dec.COST.summary).toMatch(/본인부담금이 없어요/);
    expect(r.docsNow).toEqual(expect.arrayContaining(['DOC-15', 'DOC-17']));
  });
  test('신체기능 답 하나(목욕: 혼자 → 전부 도와드림)를 바꾸면 추정 점수가 올라간다', () => {
    const a = { ...items('1'), dementia: 'none', dem_adl: 'independent' };
    const e1 = est(a), e2 = est({ ...a, 'PHY-04': '3' });
    expect(e2.score.mid).toBeGreaterThan(e1.score.mid);
    expect(e2.influences[0].itemId).toBe('PHY-04');
  });
  test('받은 등급보다 추정 등급이 무거우면 등급 변경 검토 안내', () => {
    const r = run({ ...B, grade: '5', ...items('3', ['NUR-04']) });
    expect(r.r.estimate.grades.every((g) => GRADE_RANK[g] > GRADE_RANK['5'])).toBe(true);
    expect(r.r.gradeNote).toMatch(/등급 변경 신청/);
  });
  test('질문지·결과에 119·진료 권유 같은 안내가 없다', () => {
    const r = run({ ...B, grade: 'none' });
    const text = JSON.stringify(r.r);
    expect(text).not.toMatch(/119|응급|진료를 먼저|진료가 먼저/);
  });
});
