// 지시서 4절: 입력이 바뀌면 판단·서류·행동이 실제로 바뀌는지 검증 (하드코딩 금지 확인)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { run } from './helpers.ts';

const A = '어머니가 82세인데 등급은 없어요. 치매 진단을 받으셨고 혼자 화장실 가기가 힘드세요.';
const B = '아버지가 4등급이고 현재 재가급여를 받고 계세요. 어머니가 혼자 돌보시는데 너무 힘들어하세요.';
const C = '아버지가 2등급이고 시설급여를 이용할 수 있는 인정서가 있어요. 이제 요양원에 모시려고 합니다.';

test('사례 A·B·C 는 서로 다른 절차와 서류를 낸다', () => {
  const a = run(A, [['Q-INSURANCE', 'health']]); const b = run(B, [['Q-GOAL', 'facility']]); const c = run(C);
  assert.deepEqual(a.procs.slice(0, 1), ['PROC-INITIAL']);
  assert.ok(b.procs.includes('PROC-CHANGE-TYPE') && !b.procs.includes('PROC-INITIAL'));
  assert.ok(c.procs.includes('PROC-ADMISSION') && !c.procs.includes('PROC-CHANGE-TYPE'));
  const sets = [a, b, c].map((x) => JSON.stringify([x.procs, x.docsNow]));
  assert.equal(new Set(sets).size, 3, sets.join('\n'));
  assert.equal(a.dec.C.result, 'NOT_ELIGIBLE'); assert.equal(b.dec.C.result, 'NEEDS_CHECK'); assert.equal(c.dec.C.result, 'MET');
});

test('B 의 등급만 4 → 2 로 바꾸면 요양원 가능으로 바뀐다', () => {
  const r = run(B.replace('4등급', '2등급'), [['Q-GOAL', 'facility']]);
  assert.equal(r.dec.C.result, 'MET'); assert.ok(r.procs.includes('PROC-ADMISSION')); assert.ok(!r.procs.includes('PROC-CHANGE-TYPE'));
});

test('B 의 등급을 인지지원으로 바꾸면 요양원 불가 + 재가급여 안내', () => {
  const r = run(B.replace('4등급', '인지지원등급'));
  assert.equal(r.dec.C.result, 'NOT_ELIGIBLE'); assert.ok(r.procs.includes('PROC-HOME-SERVICES'));
});

test('B 에서 인정서에 시설급여가 있다고 답하면 변경 신청 없이 입소 준비', () => {
  const r = run(B, [['Q-GOAL', 'facility'], ['Q-FAC-CERT', 'yes']]);
  assert.equal(r.dec.C.result, 'MET'); assert.ok(r.procs.includes('PROC-ADMISSION')); assert.ok(!r.procs.includes('PROC-CHANGE-TYPE'));
});

test('B 에서 가족이 충분히 돌볼 수 있고 다른 사유가 없으면 변경 사유 없음', () => {
  const r = run('아버지가 4등급이에요. 요양원에 모시고 싶어요.', [['Q-FAC-CERT', 'no'], ['Q-CAREGIVER', 'ok'], ['Q-BEHAVIOR', 'no'], ['Q-HOUSING', 'no']]);
  assert.equal(r.dec.D.result, 'NOT_ELIGIBLE'); assert.ok(!r.procs.includes('PROC-CHANGE-TYPE')); assert.ok(r.procs.includes('PROC-HOME-SERVICES'));
});

test('C 에 유효기간이 50일 남으면 갱신 절차가 추가된다', () => {
  const r = run(C + ' 유효기간은 11월 18일까지예요.');
  assert.ok(r.procs.includes('PROC-RENEWAL')); assert.ok(r.docsNow.includes('DOC-02'));
  assert.deepEqual((r.dec.B.data as any).renewal_window, ['2026-08-20', '2026-10-19']);
});

test('C 유효기간이 20일 남으면 기한 촉박 → 전문가·기관 확인 + 긴급 행동', () => {
  const r = run(C + ' 유효기간은 10월 19일까지예요.');
  assert.equal(r.dec.B.result, 'NEEDS_EXPERT'); assert.ok(r.actions.includes('ACT-RENEW-URGENT'));
});

test('A 의 나이만 82 → 58 로 바꾸면 치매 진단이 노인성 질병이라 65세 미만 절차가 붙는다', () => {
  const r = run(A.replace('82세', '58세'), [['Q-INSURANCE', 'health']]);
  assert.equal(r.dec.A.result, 'MET'); assert.ok(r.procs.includes('PROC-INITIAL-UNDER65')); assert.ok(r.docsNow.includes('DOC-04'));
});

test('A 에서 치매 문장을 빼고 58세로 하면 질병 확인 질문이 나오고 신청 대상 확정 안 함', () => {
  const r = run('어머니가 58세인데 등급은 없어요. 혼자 화장실 가기가 힘드세요.', [['Q-INSURANCE', 'health']]);
  assert.equal(r.dec.A.result, 'NEEDS_CHECK'); assert.ok(r.questions.some((q) => q.id === 'Q-DISEASE'));
  const r2 = run('어머니가 58세인데 등급은 없어요.', [['Q-INSURANCE', 'health'], ['Q-DISEASE', 'none']]);
  assert.equal(r2.dec.A.result, 'NOT_ELIGIBLE'); assert.ok(!r2.procs.includes('PROC-INITIAL'));
});

test('A 에 혼자 사신다는 정보가 추가되면 신청일부터 급여 절차가 추가된다', () => {
  const base = run(A, [['Q-INSURANCE', 'health']]);
  const alone = run(A + ' 혼자 사세요.', [['Q-INSURANCE', 'health']]);
  assert.ok(!base.procs.includes('PROC-EARLY')); assert.ok(alone.procs.includes('PROC-EARLY')); assert.ok(alone.docsNow.includes('DOC-10'));
});

test('신규 조합: 5등급 + 기초수급 + 독거 + 만료 47일 전 + 요양원 희망', () => {
  const r = run('어머니 5등급이고 기초생활수급자세요. 혼자 사세요. 유효기간이 11월 15일까지예요. 요양원에 모시고 싶어요.', [['Q-FAC-CERT', 'no']]);
  assert.ok(r.procs.includes('PROC-CHANGE-TYPE')); assert.ok(r.procs.includes('PROC-RENEWAL')); assert.ok(r.procs.includes('PROC-COST-RELIEF'));
  assert.deepEqual((r.dec.D.data as any).reasons.map((x: any) => x.code), ['①']);
  assert.equal(r.dec.COST.result, 'PROCEDURE_REQUIRED');
});

test('신규 조합: 인지지원등급 + 요양병원 입원', () => {
  const r = run('할머니가 인지지원등급인데 지금 요양병원에 입원해 계세요. 퇴원하면 요양원 보내고 싶어요.');
  assert.equal(r.dec.C.result, 'NOT_ELIGIBLE'); assert.ok(r.dec.C.rule_ids.includes('R-FAC-07')); assert.ok(r.dec.C.rule_ids.includes('R-FAC-03'));
});

test('신규 조합: 1등급 유효기간 지남', () => {
  const r = run('아버지 1등급인데 유효기간이 2026년 8월 31일까지였어요.');
  assert.equal(r.dec.B.result, 'NEEDS_EXPERT');
});

test('신규 조합: 등급외, 통지일 모름 → 통지일 질문, 답하면 기한 계산', () => {
  const r = run('엄마가 등급외 판정 받았어요.');
  assert.ok(r.questions.some((q) => q.id === 'Q-NOTICE'));
  const r2 = run('엄마가 등급외 판정 받았어요.', [['Q-NOTICE', '2026-09-15']]);
  assert.equal((r2.dec.B.data as any).appeal_deadline, '2026-12-14');
});

test('신규 조합: 3등급 의료급여(기타) + 주거환경 열악 → 사유② + 감경', () => {
  const r = run('아버지 3등급이고 의료급여 받으세요. 집이 반지하라 너무 추워요. 요양원 알아보고 있어요.', [['Q-FAC-CERT', 'no']]);
  assert.ok((r.dec.D.data as any).reasons.some((x: any) => x.code === '②'));
  assert.match(r.dec.COST.summary, /감경/);
});
