// 4차 보강: 결과 화면 '자세히 보기' 칸 (접수 경로·서류 체크·병원·방문조사·입소 준비·상황별 안내·공식 링크)
import { test, expect, describe } from 'vitest';
import { kb, items, TODAY } from './helpers.ts';
import { buildResult } from '../src/engine/result.ts';
import { copyText } from '../src/engine/guide.ts';
import { renderResult } from '../src/ui/result.ts';
import type { Answers } from '../src/engine/types.ts';
import sources from '../../data/sources.json' with { type: 'json' };

const fresh: Answers = { age: 'over65', dementia: 'none', insurance: 'health', grade: 'none', ...items('2'), carer: 'family_hard', place: 'home', housing: [] };
const young: Answers = { ...fresh, age: 'under65', disease: 'cerebrovascular' };
const four: Answers = { age: 'over65', dementia: 'diagnosed', insurance: 'medical_aid_1', grade: '4', facility_in_cert: 'no', grade_feel: 'ok', ...items('2'), nursing_gate: 'no', memory_gate: 'yes', memory: ['COG-01'], behavior_gate: 'no', dem_adl: 'partial', carer: 'spouse', place: 'home_service', behavior_service: 'hard', housing: [] };
const G = kb.guide;

describe('상황별 큰 버튼', () => {
  test('65세 이상 처음 신청 → 공식 신청 화면', () => {
    const g = buildResult(kb, fresh, TODAY).guide;
    expect(g.cta!.kind).toBe('apply');
    expect(g.cta!.url).toBe(G.links.apply.url);
    expect(g.channels.under65Blocked).toBe(false);
  });
  test('65세 미만 처음 신청 → 인터넷 불가, 지사 찾기', () => {
    const g = buildResult(kb, young, TODAY).guide;
    expect(g.cta!.kind).toBe('branch');
    expect(g.channels.under65Blocked).toBe(true);
    const html = renderResult(buildResult(kb, young, TODAY), kb);
    expect(html).toContain(G.channels.under65_blocked);
    expect(html).not.toContain('건강보험25시');
  });
  test('판정 대기 → 결과 조회, 등급외 → 전화 + 재신청/이의신청 안내', () => {
    const p = buildResult(kb, { ...fresh, grade: 'pending' }, TODAY);
    expect(p.guide.cta!.kind).toBe('result');
    expect(p.guide.situation).toBe('pending');
    const o = buildResult(kb, { ...fresh, grade: 'out_of_grade' }, TODAY);
    expect(o.guide.cta!.kind).toBe('tel');
    expect(o.guide.situation).toBe('out_of_grade');
    const html = renderResult(o, kb);
    expect(html).toContain('90일');
    expect(html).toContain(G.links.appeal.url);
  });
});

describe('서류: 누가 신청하나요 · 체크', () => {
  test('기본은 가족 → 가족 신분증, 본인 선택 시 본인 신분증', () => {
    const fam = buildResult(kb, fresh, TODAY).guide;
    expect(fam.role.value).toBe('family');
    expect(fam.docs.find((d) => d.id === 'DOC-05')!.name).toBe(G.roles.id_docs.family.name);
    const self = buildResult(kb, { ...fresh, applicant: 'self' }, TODAY).guide;
    expect(self.docs.find((d) => d.id === 'DOC-05')!.name).toBe(G.roles.id_docs.self.name);
  });
  test('지정 대리인 → 대리인 지정서 추가', () => {
    const g = buildResult(kb, { ...fresh, applicant: 'other', applicant_other: 'designated' }, TODAY).guide;
    expect(g.docs.some((d) => d.id === 'DOC-06')).toBe(true);
  });
  test('체크 상태가 화면과 복사 글에 반영', () => {
    const r = buildResult(kb, fresh, TODAY);
    const key = r.guide.docs[0].key;
    const html = renderResult(r, kb, null, { [key]: true });
    expect(html).toContain(`aria-checked="true" data-act="check" data-id="${key}"`);
    expect(html).toMatch(/<b>1<\/b>\/\d+개 준비/);
    expect(copyText('docs', r.guide, G, { [key]: true })).toContain(`[준비됨] ${r.guide.docs[0].name}`);
  });
});

describe('병원 · 방문조사 · 입소 준비', () => {
  test('65세 이상 처음 신청 → 소견서는 방문조사 뒤, 65세 미만 → 신청 때', () => {
    expect(buildResult(kb, fresh, TODAY).guide.doctor.lines[0]).toBe(G.doctor.over65);
    expect(buildResult(kb, young, TODAY).guide.doctor.lines[0]).toBe(G.doctor.under65);
    expect(buildResult(kb, young, TODAY).guide.doctor.script).toContain('65세 미만 어르신의');
  });
  test('방문조사 메모는 답에 따라: 이동 도움·돌봄 사정', () => {
    const g = buildResult(kb, { ...fresh, b_move: '2' }, TODAY).guide;
    expect(g.visit.show).toBe(true);
    expect(g.visit.notes).toContain(G.visit.body);
    expect(g.visit.notes).toContain(G.visit.care);
    expect(g.visit.notes).not.toContain(G.visit.mind);
  });
  test('의료급여 수급권자 → 입소 준비에 시·군·구 신청 추가', () => {
    const g = buildResult(kb, four, TODAY).guide;
    expect(g.admission.show).toBe(true);
    expect(g.admission.common.map((x) => x.id)).toContain('adm-medaid');
  });
});

describe('안내 문구·링크의 근거', () => {
  test('모든 링크의 출처가 sources.json 에 있음', () => {
    const ids = new Set(sources.sources.map((s: { id: string }) => s.id));
    for (const l of Object.values(G.links)) expect(ids.has(l.source), l.source).toBe(true);
  });
  test('인용하는 규칙이 모두 legal_rules.json 의 OFFICIAL_VERIFIED', () => {
    const all = [...G.roles.rules, ...G.doctor.rules, ...G.visit.rules, ...G.admission.rules, ...Object.values(G.situations).flatMap((s) => s.rules)];
    for (const id of all) expect(kb.usable(id), id).toBe(true);
  });
  test('응급·진료 권유 문구 없음, 공식 판정 아님 문구 표시', () => {
    for (const a of [fresh, young, four, { ...fresh, grade: 'out_of_grade' }]) {
      const html = renderResult(buildResult(kb, a, TODAY), kb);
      expect(html).not.toMatch(/119|응급실|진료부터/);
      expect(html).toContain('참고용 추정');
      expect(html).toContain('국민건강보험공단(등급판정위원회)이 결정');
    }
  });
});
