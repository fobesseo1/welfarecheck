// F. 근거 DB 무결성 + 추적성 + 미검증 규칙 차단
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evidence } from '../src/evidence.ts';
import { run } from './helpers.ts';

test('근거 DB 무결성: 규칙·출처·서류·절차 참조가 모두 연결됨', () => {
  assert.deepEqual(evidence().integrity(), []);
});

test('미검증 규칙(R-ADMIT-01)은 자동 안내에서 제외되고 추적 로그에 남는다', () => {
  assert.equal(evidence().usable('R-ADMIT-01'), false);
  const r = run('아버지가 2등급이고 요양원에 모시려고 해요.');
  assert.ok(!r.result.documents.some((d) => d.id === 'DOC-12'));
  assert.ok(r.result.excluded_documents.some((d) => d.id === 'DOC-12'));
  assert.ok(r.result.trace.some((t) => t.rule === 'R-ADMIT-01' && t.level === 'warn'));
  assert.ok(!r.result.procedures.flatMap((p) => p.steps).some((s) => s.rules.includes('R-ADMIT-01')));
});

test('모든 판단은 규칙 ID·출처·사용한 입력을 기록한다', () => {
  const r = run('어머니가 82세인데 등급은 없어요. 혼자 사세요.', [['Q-INSURANCE', 'health']]);
  for (const d of r.result.decisions) {
    assert.ok('inputs_used' in d);
    for (const id of d.rule_ids) assert.ok(d.sources.some((s) => s.rule === id), `${d.id}:${id}`);
  }
  assert.ok(r.result.trace.length > 5);
});

test('존재하지 않는 규칙을 참조하면 어느 규칙인지 오류 메시지에 나온다', () => {
  assert.throws(() => evidence().rule('R-NOPE-99'), /R-NOPE-99/);
});

test('서류마다 공식 근거가 연결되어 있다', () => {
  const r = run('아버지 3등급이고 의료급여 받으세요. 요양원 알아보고 있어요.', [['Q-FAC-CERT', 'yes']]);
  for (const d of r.result.documents) assert.ok(d.sources.length > 0, d.id);
});
