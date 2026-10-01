// B. 질문 엔진 + 세션(수정·재개)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { extract } from '../src/legacy/extract.ts';
import { nextQuestions, applyAnswer, UNKNOWN } from '../src/engine/questions.ts';

const T = { today: '2026-09-29' };

test('이미 말한 정보는 다시 묻지 않는다', () => {
  const q = nextQuestions(extract('어머니가 82세인데 등급은 없어요.', T), {}).map((x) => x.id);
  assert.ok(!q.includes('Q-GRADE') && !q.includes('Q-AGE'));
});

test('답에 따라 다음 질문이 달라진다', () => {
  const f = extract('어머니가 좀 편찮으세요.', T);
  assert.equal(nextQuestions(f, {})[0].id, 'Q-GRADE');
  const none = applyAnswer(f, 'Q-GRADE', 'none');
  const four = applyAnswer(f, 'Q-GRADE', '4');
  const qn = nextQuestions(none, { 'Q-GRADE': 'none' }, 10).map((x) => x.id);
  const q4 = nextQuestions(four, { 'Q-GRADE': '4' }, 10).map((x) => x.id);
  assert.ok(qn.includes('Q-AGE') && !qn.includes('Q-GOAL'));
  assert.ok(q4.includes('Q-GOAL') && !q4.includes('Q-AGE'));
  const q4f = nextQuestions(applyAnswer(four, 'Q-GOAL', 'facility'), { 'Q-GRADE': '4', 'Q-GOAL': 'facility' }, 10).map((x) => x.id);
  assert.ok(q4f.includes('Q-FAC-CERT') && q4f.includes('Q-CAREGIVER'));
});

test('"모르겠어요" 답은 다시 묻지 않는다', () => {
  const f = extract('아버지 4등급이에요', T);
  assert.ok(nextQuestions(f, {}, 10).some((q) => q.id === 'Q-VALIDITY'));
  const f2 = applyAnswer(f, 'Q-VALIDITY', UNKNOWN);
  assert.ok(!nextQuestions(f2, { 'Q-VALIDITY': UNKNOWN }, 10).some((q) => q.id === 'Q-VALIDITY'));
});

test('한 번에 최대 2개 질문', () => {
  assert.ok(nextQuestions(extract('엄마가 편찮으세요', T), {}).length <= 2);
});

test('세션: 저장 후 재개, 사실 삭제 시 관련 질문 다시 등장', async () => {
  process.env.LTC_STATE_DIR = mkdtempSync(path.join(tmpdir(), 'ltc-'));
  process.env.LTC_TODAY = '2026-09-29';
  const { SessionStore } = await import('../src/session.ts');
  const store = new SessionStore();
  const s = store.create();
  let st = await store.message(s.id, '아버지가 4등급이에요. 요양원에 모시고 싶어요.');
  st = store.answer(s.id, 'Q-FAC-CERT', 'no');
  const resumed = new SessionStore().state(new SessionStore().load(s.id));
  assert.equal(resumed.session.facts.facility_in_cert?.value, false);
  assert.ok(!resumed.questions.some((q) => q.id === 'Q-FAC-CERT'));
  st = store.edit(s.id, 'facility_in_cert', null);
  assert.equal(st.session.facts.facility_in_cert, undefined);
  assert.ok(!('Q-FAC-CERT' in st.session.answered));
  assert.ok(nextQuestions(st.session.facts, st.session.answered, 10).some((q) => q.id === 'Q-FAC-CERT'));
  st = store.edit(s.id, 'grade', 2);
  assert.equal(st.result.decisions.find((d) => d.id === 'C')!.result, 'MET');
  assert.ok(st.session.history.length >= 3);
});
