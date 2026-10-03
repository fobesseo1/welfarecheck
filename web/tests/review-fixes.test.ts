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

describe('3-2. 숨겨진 질문의 옛 답은 계산에 쓰지 않음 (2026-10-03 재검증 보고서)', () => {
  const base: Answers = { insurance: 'health', grade: 'none', ...items('1'), b_wash: '1', b_dress: '1', b_eat: '1', b_move: '1', b_toilet: '1', b_limbs: '1', b_joints: '1', nursing_gate: 'no', memory_gate: 'no', behavior_gate: 'no', carer: 'family_ok', place: 'home', housing: [] };
  test.each(['none', 'suspected', 'unknown'])('65세 미만·치매 선택 후 남은 치매 답 %s → 처음부터 입력한 것과 같은 결과', (stale) => {
    const fresh = { ...base, age: 'under65', disease: 'dementia' };
    const edited = { ...fresh, dementia: stale };
    expect(expandAnswers(kb, edited).dementia).toBe('diagnosed');
    const f = buildResult(kb, fresh, TODAY), e = buildResult(kb, edited, TODAY);
    expect(e.estimate.label).toBe(f.estimate.label);
    expect(e.verdict).toEqual(f.verdict);
  });

  // 어떤 현재 답이든: 숨겨진 질문마다 옛 답(첫 선택지)을 끼워 넣어도 결과가 같아야 한다
  const profiles: Answers[] = [
    { ...base, age: 'under65', disease: 'dementia' },
    { ...base, age: 'under65', disease: 'none', dementia: 'none' },
    { ...base, age: 'over65', dementia: 'none' },
    { ...base, age: 'over65', dementia: 'diagnosed', memory_gate: 'yes', memory: ['COG-01'], dem_adl: 'partial' },
    { ...base, age: 'over65', dementia: 'none', grade: '4', facility_in_cert: 'no', grade_feel: 'ok', validity_end: '2027-05-01' },
    { ...base, age: 'over65', dementia: 'none', grade: 'pending', applied_date: '2026-09-20' },
    { ...base, age: 'over65', dementia: 'suspected', place: 'home_service', behavior_service: 'ok' },
  ];
  test.each(profiles.map((p, i) => [i, p] as const))('사례 %i: 옛 답을 끼워도 결과가 같음', (_i, fresh) => {
    const shown = new Set(visibleSteps(kb, fresh).map((s) => s.id));
    const edited: Answers = { ...fresh };
    for (const s of kb.questionnaire.steps) {
      if (shown.has(s.id) || s.gate) continue;
      const first = s.options?.[0]?.value;
      if (first !== undefined) edited[s.id] = s.type === 'chips' ? [first] : first;
      else if (s.type === 'date') edited[s.id] = '2026-01-01';
    }
    const f = buildResult(kb, fresh, TODAY), e = buildResult(kb, edited, TODAY);
    expect(visibleSteps(kb, edited).map((s) => s.id)).toEqual([...shown]);
    expect(e.estimate.label).toBe(f.estimate.label);
    expect(e.verdict).toEqual(f.verdict);
    expect(e.actions.map((x) => x.id)).toEqual(f.actions.map((x) => x.id));
    expect(e.decide.documents.map((d) => d.id)).toEqual(f.decide.documents.map((d) => d.id));
  });
});
