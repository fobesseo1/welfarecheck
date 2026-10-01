// A. 추출 엔진: 입력에 없는 사실을 만들지 않는지, 근거가 원문에 있는지
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extract, evidenceInText, DISEASE_KEYWORDS } from '../src/legacy/extract.ts';
import { evidence } from '../src/evidence.ts';

const T = { today: '2026-09-29' };

test('나이가 없으면 나이를 만들지 않는다 (T16)', () => {
  const f = extract('엄마가 치매가 있으시고 화장실을 혼자 못 가세요.', T);
  assert.equal(f.age, undefined);
});

test('모든 추출 근거는 원문의 부분 문자열이다', () => {
  const texts = ['아버지가 79세고 4등급이에요. 요즘 밤에 자꾸 밖으로 나가시려고 해요. 인정서에는 재가급여만 적혀 있어요.',
    '어머니가 기초생활수급자세요. 혼자 사세요. 유효기간이 11월 15일까지예요.', '남편이 60세인데 작년에 뇌경색이 와서 오른쪽을 잘 못 써요.'];
  for (const t of texts) for (const [k, f] of Object.entries(extract(t, T))) assert.ok(evidenceInText(f!.evidence.split(' / ')[0], t), `${k}: "${f!.evidence}"`);
});

test('"파킨슨 같대요" 는 진단으로 저장하지 않는다 (T26)', () => {
  const f = extract('남편이 58세인데 파킨슨 같대요. 진단은 아직 없어요.', T);
  assert.equal(f.diseases, undefined); assert.match(String(f.other_condition?.value), /의심/);
});

test('"치매 같은데" 는 의심으로, "치매 진단" 은 진단으로 (T07)', () => {
  assert.equal(extract('치매 같은데 병원은 아직 안 가봤어요', T).dementia?.value, 'suspected');
  assert.equal(extract('치매 진단을 받으셨어요', T).dementia?.value, 'diagnosed');
});

test('요양병원 입원은 시설급여 이용으로 추출하지 않는다 (T17)', () => {
  const f = extract('엄마가 요양병원에 계세요', T);
  assert.equal(f.in_nursing_hospital?.value, true); assert.equal(f.facility_in_cert, undefined); assert.equal(f.grade, undefined);
});

test('재활 항목은 조사원 관찰 항목으로만 표시', () => {
  assert.equal((extract('오른쪽을 잘 못 써요', T).items?.value as any)['REH-01'], 'observe');
});

test('질병 키워드 코드는 모두 시행령 별표1 에 있다', () => {
  const codes = new Set(evidence().diseases.map((d) => d.code.replace('*', '')));
  for (const [, code] of DISEASE_KEYWORDS) assert.ok(codes.has(code), code);
});

test('날짜: 월/일만 있으면 유효기간은 미래, 통지일은 과거로 해석', () => {
  assert.equal(extract('유효기간이 3월 5일까지예요', T).validity_end?.value, '2027-03-05');
  assert.equal(extract('10월 1일에 통지서 받았어요', { today: '2026-10-05' }).notice_date?.value, '2026-10-01');
});
