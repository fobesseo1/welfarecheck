// 확장 기능: '이용할 수 있는 돌봄' 표와 기능 스위치
import { describe, expect, test } from 'vitest';
import { kb, careData } from '../src/data.ts';
import { careView, won } from '../src/engine/care.ts';
import { mergeFlags, allOff, FEATURES } from '../src/features.ts';
import { buildResult } from '../src/engine/result.ts';
import { readFileSync } from 'node:fs';
import { emptyForm, validate, buildPayload, helpOptions, HELP_OPTIONS } from '../src/engine/consult.ts';
import { emptyCaregiver, validateCaregiver, buildCaregiverPayload } from '../src/engine/caregiver.ts';
import companiesJson from '../../data/care_companies.json' with { type: 'json' };
import caregiversJson from '../../data/caregivers.json' with { type: 'json' };
import siteFlags from '../public/features.json' with { type: 'json' };

describe('care_services.json 근거', () => {
  const all = [...careData.services.flatMap((s) => s.rules), ...careData.monthly_limit.rules, ...careData.outside.flatMap((o) => o.rules)];
  test('인용 규칙이 모두 legal_rules.json 에 있다', () => {
    for (const id of all) expect(kb.rules.has(id), id).toBe(true);
  });
  test('가능 여부(서비스 표)의 규칙은 모두 OFFICIAL_VERIFIED', () => {
    for (const s of careData.services) for (const id of s.rules) expect(kb.rule(id).verification_status, `${s.id} ${id}`).toBe('OFFICIAL_VERIFIED');
  });
  test('안내 카드 규칙은 VERIFIED 또는 공식 지침(OFFICIAL_GUIDE)', () => {
    for (const o of careData.outside) for (const id of o.rules) expect(['OFFICIAL_VERIFIED', 'OFFICIAL_GUIDE']).toContain(kb.rule(id).verification_status);
  });
  test('모든 서비스가 7개 등급 값을 다 갖는다', () => {
    for (const s of careData.services) expect(Object.keys(s.by_grade).sort()).toEqual(['1', '2', '3', '4', '5', 'cognitive', 'none'].sort());
  });
  test('월 한도액이 고시(R-HOME-04) 금액과 같다', () => {
    const rule = kb.rule('R-HOME-04').rule;
    for (const v of Object.values(careData.monthly_limit.values)) expect(rule).toContain(v!.toLocaleString('en-US'));
  });
});

describe('careView', () => {
  const row = (v: ReturnType<typeof careView>, id: string) => v.rows.find((r) => r.id === id)!;
  test('1등급: 요양원·방문요양 가능, 한도 251만 원', () => {
    const v = careView(careData, ['1']);
    expect(row(v, 'facility').status).toBe('yes');
    expect(row(v, 'home_visit').status).toBe('yes');
    expect(won(v.limit!.low)).toBe('251만 원');
  });
  test('인지지원등급: 요양원·방문목욕 불가, 주간보호 가능, 방문요양은 일부', () => {
    const v = careView(careData, ['cognitive']);
    expect(row(v, 'facility').status).toBe('no');
    expect(row(v, 'bath').status).toBe('no');
    expect(row(v, 'day').status).toBe('yes');
    expect(row(v, 'home_visit').status).toBe('limited');
  });
  test('5등급 방문요양은 일부만 (고시 제17조제7항)', () => {
    expect(row(careView(careData, ['5']), 'home_visit').status).toBe('limited');
  });
  test('2~3등급처럼 걸치면 요양원은 등급별로 달라요', () => {
    const r = row(careView(careData, ['2', '3']), 'facility');
    expect(r.status).toBe('mixed');
    expect(r.detail.join(' ')).toContain('2등급: 이용 가능');
  });
  test('등급외: 장기요양 모두 불가, 맞춤돌봄·통합지원 안내, 한도 없음', () => {
    const v = careView(careData, ['none']);
    expect(v.rows.every((r) => r.status === 'no')).toBe(true);
    expect(v.outside.map((o) => o.id)).toEqual(expect.arrayContaining(['mcare', 'integrated', 'carer_private']));
    expect(v.limit).toBeUndefined();
  });
  test('고른 도움(주간보호)이 맨 위로', () => {
    const v = careView(careData, ['3'], 'day');
    expect(v.rows[0].id).toBe('day');
    expect(v.rows[0].match).toBe(true);
  });
  test('결과 모델의 careGrades: 현재 등급이 있으면 그 등급', () => {
    const r = buildResult(kb, { age: 'over65', grade: '2' }, '2026-10-06');
    expect(r.careGrades).toEqual(['2']);
  });
});

describe('기능 스위치', () => {
  test('기본은 모두 꺼짐 (보호자에게 새 기능이 보이지 않음)', () => {
    expect(Object.values(allOff()).every((v) => v === false)).toBe(true);
    expect(mergeFlags(null, null)).toEqual(allOff());
  });
  test('사이트 값 위에 관리자 미리보기 값이 덮인다, 모르는 키·잘못된 값은 버린다', () => {
    const f = mergeFlags({ homeHub: true, careGuide: 'yes', nope: true }, { careGuide: true, homeHub: false });
    expect(f.homeHub).toBe(false);
    expect(f.careGuide).toBe(true);
    expect('nope' in f).toBe(false);
  });
  test('public/features.json 은 모든 기능을 true/false 로 갖는다 (관리자가 켜도 테스트는 통과)', async () => {
    const site = (await import('../public/features.json', { with: { type: 'json' } })).default as Record<string, boolean>;
    expect(Object.keys(site).sort()).toEqual(FEATURES.map((f) => f.id).sort());
    expect(Object.values(site).every((v) => typeof v === 'boolean')).toBe(true);
  });
});


describe('상담 신청 확장 (consultMore)', () => {
  const base = () => ({ ...emptyForm(), region: '경기', contact: 'phone' as const, phone: '010-1234-5678', agreePrivacy: true });
  test('꺼져 있으면 예전 선택지 그대로', () => { expect(helpOptions(false)).toBe(HELP_OPTIONS); });
  test('켜지면 간병·방문요양·주간보호가 더해진다', () => {
    expect(helpOptions(true).map((o) => o.value)).toEqual(['grade', 'care', 'home', 'day', 'match', 'unknown', 'other']);
  });
  test('간병을 고르면 언제부터를 꼭 물어본다', () => {
    const f = { ...base(), help: ['care' as const] };
    expect(validate(f).careWhen).toBeDefined();
    expect(validate({ ...f, careWhen: 'now' as const })).toEqual({});
  });
  test('간병 값은 간병을 골랐을 때만 보낸다', () => {
    const p = buildPayload({ ...base(), help: ['care'], careWhen: 'week', carePlace: 'hospital', caregiverId: 'cg1' }, null, 't');
    expect(p.help).toBe('간병');
    expect(p.care_when).toBe('이번 주 안에');
    expect(p.care_place).toBe('병원 (입원 중)');
    expect(p.caregiver_id).toBe('cg1');
    const q = buildPayload({ ...base(), help: ['grade'], careWhen: 'week' }, null, 't');
    expect(q.care_when).toBe('');
  });
});

describe('간병인 등록 (caregiverMatch)', () => {
  test('빈 신청서는 필수 칸을 모두 알려준다', () => {
    expect(Object.keys(validateCaregiver(emptyCaregiver())).sort()).toEqual(['agreePrivacy', 'experience', 'name', 'phone', 'places', 'regions'].sort());
  });
  test('보낼 내용: kind=caregiver, 번호 형식 정리', () => {
    const p = buildCaregiverPayload({ ...emptyCaregiver(), name: '김간병', phone: '01012345678', regions: ['경기'], experience: '3~5년', places: ['병원'], agreePrivacy: true }, 't');
    expect(p.kind).toBe('caregiver');
    expect(p.phone).toBe('010-1234-5678');
  });
});

describe('Apps Script 열과 보내는 값이 맞다', () => {
  const gs = readFileSync(new URL('../../tools/consult-sheet/Code.gs', import.meta.url), 'utf-8');
  const keys = (block: string) => [...block.matchAll(/\['([a-z_]+)', '/g)].map((m) => m[1]);
  const consultCols = keys(gs.slice(gs.indexOf('const COLUMNS'), gs.indexOf('const EXTRA')));
  const cgCols = keys(gs.slice(gs.indexOf('const CG_COLUMNS'), gs.indexOf('const CG_EXTRA')));
  test('상담 신청', () => { expect(consultCols.sort()).toEqual(Object.keys(buildPayload(emptyForm(), null, 't')).sort()); });
  test('간병인 등록', () => { expect([...cgCols, 'kind'].sort()).toEqual(Object.keys(buildCaregiverPayload(emptyCaregiver(), 't')).sort()); });
});

describe('예시 항목이 실제로 공개되지 않게', () => {
  const flags = siteFlags as Record<string, boolean>;
  test('간병 업체 목록을 모두에게 켰으면 (예시) 업체가 없어야 한다', () => {
    if (flags.careCompanies) expect((companiesJson as { companies: { example?: boolean }[] }).companies.filter((c) => c.example)).toEqual([]);
  });
  test('간병인 찾기를 모두에게 켰으면 (예시) 간병인이 없어야 한다', () => {
    if (flags.caregiverMatch) expect((caregiversJson as { caregivers: { example?: boolean }[] }).caregivers.filter((c) => c.example)).toEqual([]);
  });
});
