// LLM 어댑터: 실제 API 호출 없이 응답을 흉내 내어(모의 fetch) 검증기를 시험한다.
// ※ 이 테스트 통과는 '실제 AI 모델 테스트 통과'가 아니다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractFacts, maskPII, validateLLMFacts } from '../src/legacy/llm/adapter.ts';

test('개인정보 마스킹', () => {
  assert.equal(maskPII('010-1234-5678 로 연락, 450101-2345678'), '[전화번호] 로 연락, [주민번호]');
});

test('검증기: 원문에 없는 근거·허용되지 않은 값은 버린다', () => {
  const text = '아버지가 4등급이에요.';
  const { facts, dropped } = validateLLMFacts({ grade: { value: 4, evidence: '4등급' }, age: { value: 80, evidence: '80세' }, grade_status: { value: 'expert', evidence: '4등급' }, foo: { value: 1, evidence: '' } }, text, 'test');
  assert.equal(facts.grade?.value, 4); assert.equal(facts.age, undefined);
  assert.deepEqual(dropped.map((d) => d.key).sort(), ['age', 'foo', 'grade_status']);
});

test('모의 anthropic 응답 → 검증 통과 항목만 반영, 조사 항목은 규칙 추출기 유지', async () => {
  process.env.LLM_PROVIDER = 'anthropic'; process.env.LLM_MODEL = 'test-model'; process.env.ANTHROPIC_API_KEY = 'x';
  process.env.LTC_STATE_DIR = '/tmp/ltc-adapter-test';
  const orig = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({ content: [{ text: JSON.stringify({ relation: { value: '어머니', evidence: '엄마' }, age: { value: 90, evidence: '90세' }, living: { value: 'alone', evidence: '혼자 사세요' } }) }], usage: { input_tokens: 10, output_tokens: 5 } }))) as typeof fetch;
  try {
    const r = await extractFacts('엄마가 혼자 사세요. 화장실을 혼자 못 가세요.', '2026-09-29');
    assert.equal(r.provider, 'anthropic');
    assert.equal(r.facts.living?.value, 'alone'); assert.equal(r.facts.living?.source, 'llm');
    assert.equal(r.facts.age, undefined, '원문에 없는 나이는 버려야 함');
    assert.equal((r.facts.items?.value as any)['PHY-10'], 'needs_help');
  } finally { globalThis.fetch = orig; process.env.LLM_PROVIDER = 'mock'; }
});

test('API 오류 시 규칙 추출기로 대체하고 표시', async () => {
  process.env.LLM_PROVIDER = 'openai'; process.env.LLM_MODEL = 'm';
  const orig = globalThis.fetch;
  globalThis.fetch = (async () => new Response('bad', { status: 500 })) as typeof fetch;
  try {
    const r = await extractFacts('아버지 2등급이에요', '2026-09-29');
    assert.match(r.provider, /openai→mock/); assert.equal(r.facts.grade?.value, 2);
  } finally { globalThis.fetch = orig; process.env.LLM_PROVIDER = 'mock'; }
});
