// 3차 개편: 신청서 작성 도우미, 서류 준비 주체 구분, 답 보완 안내, 짧은 결과 문구
import { test, expect, describe } from 'vitest';
import { kb, items, TODAY } from './helpers.ts';
import { formDef } from '../src/data.ts';
import { buildResult } from '../src/engine/result.ts';
import { buildForm } from '../src/engine/form.ts';
import { visibleSteps, expandAnswers, itemValues, isAnswered } from '../src/engine/answers.ts';
import { renderForm } from '../src/ui/form.ts';
import { renderResult } from '../src/ui/result.ts';
import type { Answers } from '../src/engine/types.ts';
import sources from '../../data/sources.json' with { type: 'json' };

const four: Answers = { age: 'over65', dementia: 'diagnosed', insurance: 'health', grade: '4', facility_in_cert: 'no', grade_feel: 'ok', b_wash: 'bath', b_dress: '2', b_eat: '1', b_move: '2', b_toilet: '2', b_limbs: '1', b_joints: '1', nursing_gate: 'no', memory_gate: 'yes', memory: ['COG-01', 'COG-02'], behavior_gate: 'yes', behavior: ['BEH-09', 'BEH-07'], dem_adl: 'partial', carer: 'spouse', place: 'home_service', behavior_service: 'hard', housing: [] };
const fresh: Answers = { age: 'over65', dementia: 'none', insurance: 'health', grade: 'none', ...items('2'), carer: 'family_hard', place: 'home', housing: [] };

describe('신청서 작성 도우미 (별지 제1호의2서식)', () => {
  test('등급 없음 → 인정 신청서에 표시, 대리인 유형 가족, 개인정보 칸은 비워 둠', () => {
    const r = buildResult(kb, fresh, TODAY);
    const f = buildForm(kb, formDef, fresh, r)!;
    expect(f.kinds.filter((k) => k.on).map((k) => k.label)).toEqual(['장기요양인정 신청서']);
    const fields = f.sections.flatMap((s) => s.fields);
    for (const no of ['①', '②', '③', '⑤', '⑥', '⑦']) expect(fields.find((x) => x.no === no)!.kind).toBe('self');
    for (const x of fields) if (x.kind === 'self') expect(x.value).toBeUndefined();
    expect(fields.find((x) => x.no === '⑩')!.checks!.find((c) => c.on)!.label).toBe('가족');
    expect(f.sections.some((s) => s.title === '변경 사유')).toBe(false);
    expect(f.attachments.map((x) => x.label)).toEqual(['신분증 1부', '의사소견서 1부']);
  });
  test('4등급 요양원 희망 → 급여종류 변경신청서, ⑰ 사유 초안은 해당 가능성 있는 사유로, 의사소견서는 내지 않음', () => {
    const r = buildResult(kb, four, TODAY);
    const f = buildForm(kb, formDef, four, r)!;
    expect(f.kinds.filter((k) => k.on).map((k) => k.label)).toEqual(['장기요양 급여종류ㆍ내용 변경신청서']);
    const reason = f.sections.flatMap((s) => s.fields).find((x) => x.no === '⑰')!;
    expect(reason.kind).toBe('draft');
    expect(reason.value).toMatch(/1\. 주 돌봄 가족의 수발 곤란 — 고령 배우자 혼자 돌봄/);
    expect(reason.value).toMatch(/문제행동: 길을 잃음, 밖으로 나가려함/);
    expect(reason.value).not.toMatch(/주거환경/);
    expect(f.attachments.map((x) => x.label)).toEqual(['신분증 1부']);
  });
  test('65세 미만 최초 신청 → 노인성 질병 진단서가 함께 낼 서류에 들어감', () => {
    const a = { ...fresh, age: 'under65', disease: 'cerebrovascular' };
    const f = buildForm(kb, formDef, a, buildResult(kb, a, TODAY))!;
    expect(f.attachments.map((x) => x.label)).toContain('노인성 질병 진단서 등 1부');
  });
  test('신청서가 필요 없는 경우(2등급, 유효기간 넉넉) 도우미를 만들지 않음', () => {
    const a: Answers = { age: 'over65', grade: '2', validity_end: '2028-01-01' };
    expect(buildForm(kb, formDef, a, buildResult(kb, a, TODAY))).toBeNull();
  });
  test('온라인 신청 주소는 sources.json 에서 확인한 공단 주소와 같다', () => {
    const src = (sources as any).sources.find((s: any) => s.id === formDef.online.source);
    expect(src.url_primary).toBe(formDef.online.url);
    expect(formDef.online.url).toMatch(/^https:\/\/www\.longtermcare\.or\.kr\//);
    const html = renderForm(buildForm(kb, formDef, fresh, buildResult(kb, fresh, TODAY))!);
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).not.toMatch(/<input|<textarea/); // 개인정보 입력칸 없음
  });
});

describe('서류 준비 주체 구분', () => {
  test('모든 서류에 직접 작성 / 발급받기 / 공단이 보내줌 구분이 있다', () => {
    for (const d of kb.docs.values()) expect(['self', 'issued', 'nhis']).toContain(d.prep);
    expect(kb.docs.get('DOC-01')!.prep).toBe('self');
    expect(kb.docs.get('DOC-02')!.prep).toBe('issued');
    expect(kb.docs.get('DOC-08')!.prep).toBe('nhis');
  });
  test('결과 화면 서류 목록에 구분 표시가 붙는다', () => {
    const html = renderResult(buildResult(kb, fresh, TODAY), kb);
    expect(html).toMatch(/who self">직접 작성/);
    expect(html).toMatch(/who issued">발급받기/);
    expect(html).toMatch(/who nhis">공단이 보내줌/);
  });
});

describe('답 보완 안내', () => {
  test('잘 모르겠어요로 넘긴 질문을 다시 답하도록 안내 (질문으로 바로 이동)', () => {
    const a = { ...four, b_toilet: 'unknown', memory_gate: 'unknown' };
    const tips = buildResult(kb, a, TODAY).tips;
    expect(tips.filter((t) => t.kind === 'unknown').map((t) => t.jump)).toEqual(expect.arrayContaining(['b_toilet', 'memory_gate']));
  });
  test('치매가 있는데 기억력·행동을 하나도 고르지 않으면 다시 보도록 안내', () => {
    const tips = buildResult(kb, { ...four, memory_gate: 'no', behavior_gate: 'no' }, TODAY).tips;
    expect(tips.map((t) => t.jump)).toEqual(expect.arrayContaining(['memory_gate', 'behavior_gate']));
  });
  test('3~5등급: 해당 가능성 있는 사유는 변경신청서에 구체적으로 적도록, 모르는 사유는 확인하도록', () => {
    const tips = buildResult(kb, four, TODAY).tips.filter((t) => t.kind === 'reason');
    expect(tips.some((t) => /가족이 돌보기 어려움/.test(t.text) && t.detail === kb.questionnaire.reason_writing['①'])).toBe(true);
    const unknownCarer = buildResult(kb, { ...four, carer: undefined }, TODAY).tips;
    expect(unknownCarer.some((t) => t.kind === 'reason' && t.jump === 'carer')).toBe(true);
  });
  test('부풀리기를 권하는 문구가 없다', () => {
    const text = JSON.stringify([buildResult(kb, four, TODAY).tips, kb.questionnaire.reason_writing]);
    expect(text).not.toMatch(/부풀|과장|더 나쁘게|높게 받/);
  });
});

describe('짧고 명확한 결과', () => {
  test('맨 위 한 줄은 짧고, 설명은 펼쳐야 보인다', () => {
    for (const a of [four, fresh, { age: 'over65', grade: '1' }, { age: 'over65', grade: 'cognitive' }] as Answers[]) {
      const v = buildResult(kb, a, TODAY).verdict;
      expect(v.body.length).toBeLessThanOrEqual(40);
      expect(v.detail.length).toBeGreaterThan(0);
    }
  });
  test('할 일 제목은 한 줄(30자 이하), 설명은 따로', () => {
    for (const a of [four, fresh, { ...fresh, age: 'under65', disease: 'dementia' }] as Answers[]) {
      for (const x of buildResult(kb, a, TODAY).decide.all_actions) { expect(x.text.length, x.text).toBeLessThanOrEqual(30); expect(x.detail).toBeTruthy(); }
    }
  });
  test('서류·진행 순서·자세히 보기는 모두 접는 칸(열고 닫는 화살표)', () => {
    const html = renderResult(buildResult(kb, four, TODAY), kb);
    for (const id of ['tips', 'facility', 'steps', 'docs', 'detail']) expect(html).toContain(`id="acc-${id}"`);
    expect(html).not.toMatch(/<details class="acc"[^>]*open/);
    expect(html).toMatch(/class="chev"/);
  });
});

describe('먼저 묻기 → 목록에서 고르기 → 직접 적기', () => {
  test('없어요를 누르면 목록 질문이 나오지 않고, 그 항목은 모두 없음으로 계산된다', () => {
    const a: Answers = { age: 'over65', behavior_gate: 'no' };
    expect(visibleSteps(kb, a).map((s) => s.id)).not.toContain('behavior');
    const v = itemValues(kb, expandAnswers(kb, a));
    for (let i = 1; i <= 14; i++) expect(v[`BEH-${String(i).padStart(2, '0')}`]).toBe(0);
  });
  test('있어요 → 목록이 나오고, 잘 모르겠어요 → 목록 항목이 모두 모름', () => {
    expect(visibleSteps(kb, { behavior_gate: 'yes' }).map((s) => s.id)).toContain('behavior');
    const v = itemValues(kb, expandAnswers(kb, { behavior_gate: 'unknown' }));
    expect(v['BEH-09']).toBeNull();
  });
  test('행동 목록은 3묶음(밖으로 나가는 일 / 돌봄·감정 / 생각·생활)으로 나뉜다', () => {
    const groups = [...new Set(kb.questionnaire.steps.find((s) => s.id === 'behavior')!.options!.map((o) => o.group))];
    expect(groups).toEqual(['밖으로 나가는 일', '돌봄 · 감정', '생각 · 생활']);
  });
  test('직접 적은 내용은 점수를 바꾸지 않고, 결과 메모와 신청서 사유에 그대로 나온다', () => {
    const text = '밤마다 가스레인지를 켜려고 하셔서 밸브를 잠가 두고 있어요';
    const withNote = { ...four, behavior_other: text };
    const r0 = buildResult(kb, four, TODAY), r1 = buildResult(kb, withNote, TODAY);
    expect(r1.estimate.score).toEqual(r0.estimate.score);
    expect(r1.estimate.label).toBe(r0.estimate.label);
    expect(r1.notes).toEqual([{ stepId: 'behavior', title: '행동 변화', text }]);
    const reason = buildForm(kb, formDef, withNote, r1)!.sections.flatMap((s) => s.fields).find((x) => x.no === '⑰')!;
    expect(reason.value).toContain(`기타(행동 변화) — ${text}`);
    expect(renderResult(r1, kb)).toContain('방문조사 때 말씀할 내용');
  });
  test('있어요 + 목록에서 고르지 않고 직접 적기만 해도 답한 것으로 본다', () => {
    const s = kb.questionnaire.steps.find((x) => x.id === 'behavior')!;
    expect(isAnswered(s, { behavior_gate: 'yes', behavior_other: '다른 행동' })).toBe(true);
    expect(isAnswered(s, { behavior_gate: 'yes' })).toBe(false);
  });
  test('먼저 묻기 질문에는 "예시 말고도 있으면 꼭 있어요" 안내가 있다', () => {
    for (const id of ['nursing_gate', 'memory_gate', 'behavior_gate']) expect(kb.questionnaire.steps.find((s) => s.id === id)!.note).toMatch(/꼭 '있어요'/);
  });
});