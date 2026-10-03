// 2026-10-03 점검 보고서(docs/PROJECT_REVIEW_2026-10-03.md)의 버그 3개 회귀 테스트
import { test, expect, describe } from 'vitest';
import { kb, items } from './helpers.ts';
import { buildResult } from '../src/engine/result.ts';
import { visibleSteps, expandAnswers } from '../src/engine/answers.ts';
import { renderResult } from '../src/ui/result.ts';
import type { Answers } from '../src/engine/types.ts';

const TODAY = '2026-10-03';

describe('1. 유효기간이 지난 등급', () => {
  const a: Answers = { age: 'over65', dementia: 'none', insurance: 'health', grade: '1', validity_end: '2026-09-01', ...items('1'), carer: 'family_hard', place: 'home', housing: [] };
  test('첫 줄은 "요양원에 모실 수 있어요"가 아니라 유효기간 확인', () => {
    const r = buildResult(kb, a, TODAY);
    expect(r.verdict.title).toBe('유효기간부터 확인해야 해요');
    expect(r.verdict.body).toContain('2026-09-01');
    expect(r.verdict.tone).not.toBe('good');
    expect(r.decide.decisions.find((d) => d.id === 'C')!.result).not.toBe('MET');
  });
  test('할 일에 요양원 상담·계약이 없고, 입소 준비 칸도 숨김', () => {
    const r = buildResult(kb, a, TODAY);
    const ids = r.actions.map((x) => x.id);
    expect(ids).toContain('ACT-EXPIRED');
    expect(ids).not.toContain('ACT-ADM-CHOOSE');
    expect(ids).not.toContain('ACT-ADM-CONTRACT');
    expect(r.guide.admission.show).toBe(false);
    expect(r.guide.situation).toBe('expired');
    expect(renderResult(r, kb)).toContain('요양원 입소 · 유효기간 확인');
  });
  test('3~5등급이 만료됐으면 급여종류 변경 신청도 안내하지 않음', () => {
    const r = buildResult(kb, { ...a, grade: '4', facility_in_cert: 'no' }, TODAY);
    expect(r.actions.map((x) => x.id)).not.toContain('ACT-CHTYPE');
    expect(r.verdict.title).toBe('유효기간부터 확인해야 해요');
  });
  test('만료 전이면 그대로 "요양원에 모실 수 있어요"', () => {
    const r = buildResult(kb, { ...a, validity_end: '2027-06-01' }, TODAY);
    expect(r.verdict.title).toBe('요양원에 모실 수 있어요');
    expect(r.actions.map((x) => x.id)).toContain('ACT-ADM-CHOOSE');
  });
});

describe('2. 신청 대상이 아닌 경우', () => {
  const heavy: Answers = { age: 'under65', disease: 'none', insurance: 'health', grade: 'none', b_wash: 'bath', b_dress: '4', b_eat: '4', b_move: '4', b_toilet: '4', b_limbs: '3', b_joints: '3', ...items('3'), carer: 'family_hard', place: 'home', housing: [] };
  test('첫 줄이 신청 대상 확인, "나오면 바로 입소 가능" 없음', () => {
    const r = buildResult(kb, heavy, TODAY);
    expect(r.decide.decisions.find((d) => d.id === 'A')!.result).toBe('NOT_ELIGIBLE');
    expect(r.verdict.title).toBe('먼저 신청 대상인지 확인해야 해요');
    expect(r.verdict.body).toContain('65세 미만');
    expect(r.verdict.body).not.toContain('입소 가능');
    expect(r.verdict.detail).toContain('신청 대상이 아니면 등급을 받을 수 없어요');
    expect(r.facility.scenarios).toEqual([]);
    expect(r.actions.map((x) => x.id)).toContain('ACT-DIAG');
  });
  test('노인성 질병이 있으면 평소처럼 등급 전망', () => {
    const r = buildResult(kb, { ...heavy, disease: 'cerebrovascular' }, TODAY);
    expect(r.verdict.title).toBe('먼저 등급을 받아야 해요');
    expect(r.facility.scenarios.length).toBeGreaterThan(0);
  });
});

describe('3. 나이를 바꾼 뒤 남은 질병 답', () => {
  test('65세 이상으로 바꾸면 치매 질문이 다시 보이고, 질병 답은 쓰이지 않음', () => {
    const a: Answers = { age: 'over65', disease: 'dementia' };
    const ids = visibleSteps(kb, a).map((s) => s.id);
    expect(ids).toContain('dementia');
    expect(ids).not.toContain('disease');
    expect(expandAnswers(kb, a).dementia).toBeUndefined();
    expect(expandAnswers(kb, { ...a, dementia: 'none' }).dementia).toBe('none');
  });
  test('65세 미만에서 치매를 고르면 치매 질문은 그대로 생략', () => {
    const a: Answers = { age: 'under65', disease: 'dementia' };
    expect(visibleSteps(kb, a).map((s) => s.id)).not.toContain('dementia');
    expect(expandAnswers(kb, a).dementia).toBe('diagnosed');
  });
});
