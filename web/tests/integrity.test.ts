// 근거 DB 무결성과 절대 조건(객관식만, 결과마다 '참고용 추정·공단 결정' 문구, 추천·광고·개인식별정보 없음), 질문 수
import { test, expect } from 'vitest';
import { kb, items, run, TODAY } from './helpers.ts';
import { renderResult } from '../src/ui/result.ts';
import { renderStep, renderStart } from '../src/ui/questions.ts';
import { buildResult } from '../src/engine/result.ts';
import { visibleSteps, expandAnswers, itemValues } from '../src/engine/answers.ts';
import approx from '../../data/approx_model.json' with { type: 'json' };
import type { Answers } from '../src/engine/types.ts';

const steps = kb.questionnaire.steps;

test('근거 DB 무결성: 규칙·출처·서류·절차·질문지 항목이 서로 연결된다', () => {
  expect(kb.integrity()).toEqual([]);
});

test('질문지가 고시 52개 조사 항목을 모두 채운다 (묶음 질문 포함)', () => {
  const covered = new Set<string>();
  for (const s of steps) for (const o of s.options ?? []) {
    if (s.type === 'chips') covered.add(o.value);
    for (const k of Object.keys(o.sets ?? {})) covered.add(k);
  }
  const v52 = kb.items.filter((i) => i.in_v52).map((i) => i.id);
  expect(v52.filter((id) => !covered.has(id))).toEqual([]);
});

test('묶음 질문에 답하면 52개 항목 값이 모두 채워진다', () => {
  const a: Answers = {};
  for (const s of steps) if (s.type === 'single') a[s.id] = s.options![0].value; else if (s.type === 'chips') a[s.id] = [];
  const vals = itemValues(kb, expandAnswers(kb, a));
  expect(kb.items.filter((i) => i.in_v52 && vals[i.id] === null).map((i) => i.id)).toEqual([]);
});

test('질문 수가 적다: 보통 경로 20개 이하, 한 화면에 질문 하나', () => {
  const typical: Answers = { age: 'over65', dementia: 'none', grade: 'none' };
  expect(visibleSteps(kb, typical).length).toBeLessThanOrEqual(20);
  const heavy: Answers = { age: 'under65', disease: 'cerebrovascular', dementia: 'suspected', grade: '4', grade_feel: 'low', place: 'home_service' };
  expect(visibleSteps(kb, heavy).length).toBeLessThanOrEqual(24);
});

test('처음 질문은 나이, 65세 미만이면 바로 치매·뇌졸중·파킨슨병을 묻는다', () => {
  expect(visibleSteps(kb, {})[0].id).toBe('age');
  const under = visibleSteps(kb, { age: 'under65' }).map((s) => s.id);
  expect(under.slice(0, 2)).toEqual(['age', 'disease']);
  const labels = steps.find((s) => s.id === 'disease')!.options!.map((o) => o.label).join(' ');
  expect(labels).toMatch(/치매/); expect(labels).toMatch(/뇌졸중/); expect(labels).toMatch(/파킨슨/);
  expect(visibleSteps(kb, { age: 'over65' }).map((s) => s.id)).not.toContain('disease');
  // 65세 미만 + 치매 진단이면 치매 질문을 다시 묻지 않는다
  expect(visibleSteps(kb, { age: 'under65', disease: 'dementia' }).map((s) => s.id)).not.toContain('dementia');
});

test('응급·119 같은 질문이나 안내가 없다', () => {
  const text = JSON.stringify(kb.questionnaire);
  expect(text).not.toMatch(/119|응급|진료/);
  const html = renderResult(buildResult(kb, { ...items('3'), age: 'over65', grade: 'none' }, TODAY), kb);
  expect(html).not.toMatch(/119|응급실|진료를 먼저|진료가 먼저|의료적 판단/);
});

test('모든 질문은 객관식(하나 고르기·여러 개 고르기·날짜)이고 자유 문장 입력이 없다', () => {
  const a: Answers = { age: 'under65', grade: 'pending', grade_feel: 'low', dementia: 'diagnosed', place: 'home_service' };
  const list = visibleSteps(kb, a);
  list.forEach((s, i) => {
    const html = renderStep(kb, s, a, { index: i, total: list.length, next: list[i + 1] });
    expect(html).not.toMatch(/<textarea|type="text"|type="search"|contenteditable/);
    expect(['single', 'chips', 'date']).toContain(s.type);
    expect(html).toMatch(/잘 모르겠어요|몰라요/);
  });
  expect(renderStart(false, 17)).toMatch(/시작하기/);
});

test('이름·주민번호·주소 같은 개인 식별정보를 묻지 않는다', () => {
  const text = JSON.stringify(steps);
  expect(text).not.toMatch(/주민(등록)?번호를|이름을|주소를|전화번호를/);
});

test('결과 화면마다 참고용 추정·공단 결정 문구가 있고, 추천·광고가 없다', () => {
  const cases: Answers[] = [
    { ...items('2'), age: 'over65', grade: 'none', dementia: 'diagnosed' },
    { ...items('3'), age: 'over65', grade: '2' },
    { age: 'over65', grade: '4', facility_in_cert: 'no', caregiver: 'nobody' },
    { age: 'over65', grade: 'cognitive' },
    {},
  ];
  for (const a of cases) {
    const html = renderResult(buildResult(kb, a, TODAY), kb);
    expect(html).toMatch(/참고용 추정/);
    expect(html).toMatch(/국민건강보험공단/);
    expect(html).not.toMatch(/추천 요양원|광고|제휴|최저가|바로 예약/);
  }
  expect(renderResult(buildResult(kb, cases[0], TODAY), kb)).toMatch(/공식 산정식이 아닌 추정/);
});

test('결과 첫 줄은 "요양원에 모실 수 있나"에 대한 답이다', () => {
  const tone = (a: Answers) => buildResult(kb, a, TODAY).verdict;
  expect(tone({ age: 'over65', grade: '1' }).tone).toBe('good');
  expect(tone({ age: 'over65', grade: '4', facility_in_cert: 'no' }).tone).toBe('maybe');
  expect(tone({ age: 'over65', grade: 'cognitive' }).tone).toBe('no');
  const none = tone({ ...items('3'), age: 'over65', grade: 'none', dementia: 'none' });
  expect(none.tone).toBe('wait');
  expect(none.title).toBe('먼저 등급을 받아야 해요');
});

test('자동 판단에 쓰인 규칙은 모두 OFFICIAL_VERIFIED 이고, 검증 전 서류는 목록에서 빠진다', () => {
  const r = run({ ...items('3'), age: 'over65', grade: '1', insurance: 'medical_aid_other' });
  for (const d of r.r.decide.decisions) for (const id of d.rule_ids) expect(kb.rule(id).verification_status).toBe('OFFICIAL_VERIFIED');
  for (const a of r.r.decide.all_actions) for (const id of a.rule_ids) expect(kb.usable(id)).toBe(true);
  expect(r.r.decide.excluded_documents.map((d) => d.id)).toContain('DOC-12');
  expect(r.docsNow).not.toContain('DOC-12');
});

test('근사 모델: 가중치는 음수가 없고(단조성), 근거 설명(note)이 있다', () => {
  for (const w of Object.values(approx.model.weights)) expect(w).toBeGreaterThanOrEqual(0);
  expect(approx.status).toBe('APPROXIMATION');
  expect(approx._meta.note.join(' ')).toMatch(/공식 산정식 아님|가정/);
  expect(approx.range.band_points).toBeGreaterThan(0);
  expect(approx.fit.r2).toBeGreaterThan(0.8);
});
