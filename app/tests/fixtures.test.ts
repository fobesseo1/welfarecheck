// 기존 17개 안내문 사례를 자동 테스트로 재사용
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { run } from './helpers.ts';

const { cases } = JSON.parse(readFileSync(new URL('../fixtures/samples.json', import.meta.url), 'utf8'));

for (const c of cases) {
  test(`${c.id} ${c.title}`, () => {
    const r = run(c.text, c.answers, c.today);
    const e = c.expect;
    const ctx = `\n procs=${r.procs}\n now=${r.docsNow}\n later=${r.docsLater}\n actions=${r.actions}\n decisions=${JSON.stringify(Object.fromEntries(Object.entries(r.dec).map(([k, d]: any) => [k, d.result])))}`;
    for (const [id, code] of Object.entries(e.decisions ?? {})) assert.equal(r.dec[id]?.result, code, `판단 ${id}` + ctx);
    for (const p of e.procedures_include ?? []) assert.ok(r.procs.includes(p), `절차 ${p} 포함` + ctx);
    for (const p of e.procedures_exclude ?? []) assert.ok(!r.procs.includes(p), `절차 ${p} 제외` + ctx);
    for (const d of e.docs_now ?? []) assert.ok(r.docsNow.includes(d), `지금 서류 ${d}` + ctx);
    for (const d of e.docs_later ?? []) assert.ok(r.docsLater.includes(d), `나중 서류 ${d}` + ctx);
    for (const d of e.excluded_docs ?? []) assert.ok(r.result.excluded_documents.some((x) => x.id === d), `제외 서류 ${d}` + ctx);
    for (const a of e.actions_include ?? []) assert.ok(r.actions.includes(a), `행동 ${a}` + ctx);
    if (e.d_reasons) assert.deepEqual((r.dec.D.data as any).reasons.map((x: any) => x.code), e.d_reasons);
    if (e.b_data) for (const [k, v] of Object.entries(e.b_data)) assert.deepEqual((r.dec.B.data as any)[k], v, `B.${k}`);
    if (e.c_rules) for (const rid of e.c_rules) assert.ok(r.dec.C.rule_ids.includes(rid), `C 근거 ${rid}`);
    if (e.facts) for (const [k, v] of Object.entries(e.facts)) assert.deepEqual((r.facts as any)[k]?.value, v, `사실 ${k}`);
    if (e.first_question) assert.equal(r.questions[0]?.id, e.first_question);
    // 공통 불변식: 모든 판단의 규칙은 검증 완료, 행동은 최대 3개, 공식 판정 아님
    for (const d of r.result.decisions) for (const s of d.sources) assert.equal(s.status, 'OFFICIAL_VERIFIED', `${d.id} 근거 ${s.rule}`);
    assert.ok(r.result.actions.length <= 3);
    assert.equal(r.result.is_official_decision, false);
  });
}
