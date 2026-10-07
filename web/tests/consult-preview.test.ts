import { expect, test } from 'vitest';
import { SITE, consultMode } from '../src/site.ts';
import { emptyForm, validate } from '../src/engine/consult.ts';

test('접수 미설정 시 로컬은 테스트 흐름, 배포본은 준비 안내로 구분한다', () => {
  const original = SITE.consultEndpoint;
  try { SITE.consultEndpoint = ''; expect(consultMode(true)).toBe('preview'); expect(consultMode(false)).toBe('closed'); }
  finally { SITE.consultEndpoint = original; }
});

test('실제 접수 설정이 완료되면 테스트 완료가 아닌 실제 접수 모드를 쓴다', () => {
  const original = [SITE.consultEndpoint, SITE.company.name, SITE.retention];
  try {
    SITE.consultEndpoint = 'https://example.org/exec'; SITE.company.name = '테스트 운영자'; SITE.retention = '30일';
    expect(consultMode(true)).toBe('live'); expect(consultMode(false)).toBe('live');
  } finally { [SITE.consultEndpoint, SITE.company.name, SITE.retention] = original; }
});

test.each(['부산 해운대구', '제주 서귀포시', '강원 원주시'])('거주 지역 %s를 제한 없이 입력할 수 있다', (region) => {
  expect(validate({ ...emptyForm(), region }).region).toBeUndefined();
});

test('공백만 있는 거주 지역은 다음 단계로 넘기지 않는다', () => {
  expect(validate({ ...emptyForm(), region: '   ' }).region).toBeTruthy();
});
