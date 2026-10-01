// RESULT_SAMPLES.md 17개 사례: 객관식 답변 → 시설급여 판단·절차·서류·행동이 기존 기대값(app/fixtures/samples.json)과 맞는지
import { test, expect } from 'vitest';
import { run, kb } from './helpers.ts';
import legacy from '../../app/fixtures/samples.json' with { type: 'json' };
import objective from './fixtures/samples_objective.json' with { type: 'json' };

const byId = Object.fromEntries((legacy as any).cases.map((c: any) => [c.id, c]));

test('17개 사례가 모두 옮겨져 있다', () => {
  expect(objective.cases.map((c) => c.id)).toEqual((legacy as any).cases.map((c: any) => c.id));
});

for (const oc of objective.cases as any[]) {
  const lc = byId[oc.id];
  test(`${oc.id} ${lc.title}`, () => {
    const e = { ...lc.expect };
    for (const k of oc.expect_drop ?? []) delete e[k];
    Object.assign(e, oc.expect_add ?? {});
    const x = run(oc.answers, lc.today);
    const ctx = `\n procs=${x.procs}\n now=${x.docsNow}\n later=${x.docsLater}\n actions=${x.actions}\n decisions=${JSON.stringify(Object.fromEntries(Object.entries(x.dec).map(([k, d]: any) => [k, d.result])))}`;

    for (const [id, code] of Object.entries(e.decisions ?? {})) expect(x.dec[id]?.result, `판단 ${id}` + ctx).toBe(code);
    for (const p of e.procedures_include ?? []) expect(x.procs, `절차 ${p} 포함` + ctx).toContain(p);
    for (const p of e.procedures_exclude ?? []) expect(x.procs, `절차 ${p} 제외` + ctx).not.toContain(p);
    for (const d of e.docs_now ?? []) expect(x.docsNow, `지금 서류 ${d}` + ctx).toContain(d);
    for (const d of e.docs_later ?? []) expect(x.docsLater, `나중 서류 ${d}` + ctx).toContain(d);
    for (const d of e.excluded_docs ?? []) expect(x.r.decide.excluded_documents.map((z) => z.id), `제외 서류 ${d}`).toContain(d);
    for (const a of e.actions_include ?? []) expect(x.actions, `행동 ${a}` + ctx).toContain(a);
    if (e.d_reasons) expect((x.dec.D.data as any).reasons.map((z: any) => z.code)).toEqual(e.d_reasons);
    if (e.b_data) for (const [k, v] of Object.entries(e.b_data)) expect((x.dec.B.data as any)[k], `B.${k}`).toEqual(v);
    if (e.c_rules) for (const rid of e.c_rules) expect(x.dec.C.rule_ids).toContain(rid);
    if (e.facts) {
      if ('dementia' in e.facts) expect(oc.answers.dementia).toBe(e.facts.dementia);
      if ('age' in e.facts) expect(oc.answers.age).toBe(e.facts.age >= 65 ? 'over65' : 'under65');
    }
    if (e.e_missing_include) for (const m of e.e_missing_include) expect(x.dec.E.missing).toContain(m);
    if (e.estimate_grades_within) for (const g of x.r.estimate.grades) expect(e.estimate_grades_within, `예상 등급 ${x.r.estimate.label}`).toContain(g);
    if (e.verdict_tone) expect(x.r.verdict.tone).toBe(e.verdict_tone);

    // 공통 불변식: 판단 근거는 모두 OFFICIAL_VERIFIED, 할 일은 최대 3개, 공식 판정 아님, 서류는 documents.json 에서만
    for (const d of x.r.decide.decisions) for (const s of d.sources) expect(s.status, `${d.id} 근거 ${s.rule}`).toBe('OFFICIAL_VERIFIED');
    expect(x.r.actions.length).toBeLessThanOrEqual(3);
    expect(x.r.is_official_decision).toBe(false);
    for (const d of x.r.decide.documents) { expect(kb.docs.has(d.id)).toBe(true); expect(d.status).toBe('OFFICIAL_VERIFIED'); }
    for (const p of x.r.decide.procedures) expect(kb.procs.has(p.id)).toBe(true);
  });
}
