import { expect, test, vi } from 'vitest';
import { kb, items, TODAY } from './helpers.ts';
import { careData, formDef } from '../src/data.ts';
import { buildResult } from '../src/engine/result.ts';
import { careView } from '../src/engine/care.ts';
import { buildForm } from '../src/engine/form.ts';
import { renderForm } from '../src/ui/form.ts';
import { renderResult, careSection } from '../src/ui/result.ts';
import { sendWithReceipt } from '../src/submission.ts';
import { SITE, consultReady } from '../src/site.ts';

const fresh = { age: 'over65', dementia: 'none', insurance: 'health', grade: 'none', ...items('2') };
const id = '12345678-1234-1234-1234-123456789abc';

test.each(['1', '3', 'cognitive'])('만료된 %s등급은 확장 표에서도 급여·한도액을 약속하지 않는다', (grade) => {
  const r = buildResult(kb, { ...fresh, grade, validity_end: '2026-09-01' }, TODAY);
  expect(r.careContext.expired).toBe(true);
  const care = careView(careData, r.careGrades, undefined, r.careContext);
  expect(care.rows.every((row) => row.status === 'no')).toBe(true);
  expect(care.limit).toBeUndefined();
  const html = careSection(care, careData, kb);
  expect(html).toContain('유효기간 확인');
  expect(html).not.toContain('이용 가능');
});

test('유효한 현재 등급은 서비스를 안내하고 예상 등급과 구별한다', () => {
  const r = buildResult(kb, { ...fresh, grade: '1', validity_end: '2028-01-01' }, TODAY);
  const care = careView(careData, r.careGrades, undefined, r.careContext);
  expect(care.rows.find((row) => row.id === 'facility')?.status).toBe('yes');
  expect(care.limit).toBeDefined();
  const html = renderResult(r, kb);
  expect(html).toContain('현재 공단 등급');
  expect(html).toContain('이번 답변의 예상 등급');
  expect(html).not.toContain('신뢰도 높음');
});

test('현재 4등급 인정서에 시설급여가 있으면 표도 이용 가능으로 표시한다', () => {
  const r = buildResult(kb, { ...fresh, grade: '4', facility_in_cert: 'yes', validity_end: '2028-01-01' }, TODAY);
  expect(careView(careData, r.careGrades, undefined, r.careContext).rows.find((row) => row.id === 'facility')?.status).toBe('yes');
});

test('신청 대상이 아니면 예상 등급의 급여 한도를 표시하지 않는다', () => {
  const r = buildResult(kb, { ...fresh, age: 'under65', disease: 'none' }, TODAY);
  expect(r.careContext.notEligible).toBe(true);
  const care = careView(careData, r.careGrades, undefined, r.careContext);
  expect(care.limit).toBeUndefined();
  expect(care.notice).toContain('신청 대상이 아니에요');
});

test('65세 미만 최초 신청은 작성 도우미에서도 온라인 신청 대신 지사를 안내한다', () => {
  const a = { ...fresh, age: 'under65', disease: 'cerebrovascular' };
  const f = buildForm(kb, formDef, a, buildResult(kb, a, TODAY))!;
  expect(f.online.url).toBe(kb.guide.links.branch.url);
  expect(renderForm(f)).toContain('접수할 지사 찾기');
  expect(renderForm(f)).not.toContain(formDef.online.url);
});

test.each([['interested', '이해관계인'], ['official', '사회복지전담공무원'], ['center', '치매안심센터의 장'], ['designated', '시장·군수·구청장이 지정한 사람']])('대리인 %s 선택을 신청서 유형에 반영한다', (other, label) => {
  const a = { ...fresh, applicant: 'other', applicant_other: other };
  const f = buildForm(kb, formDef, a, buildResult(kb, a, TODAY))!;
  const field = f.sections.flatMap((s) => s.fields).find((x) => x.no === '⑩')!;
  expect(field.checks?.filter((x) => x.on).map((x) => x.label)).toEqual([label]);
  expect(renderForm(f)).toContain(`class="kind on">${label}`);
  expect(field.hint).not.toContain("가족이면");
});

test('접수 주소·운영 주체·보관 기간이 모두 있어야 개인정보 수집을 연다', () => {
  const saved = { endpoint: SITE.consultEndpoint, name: SITE.company.name, retention: SITE.retention };
  try {
    SITE.consultEndpoint = ''; SITE.company.name = ''; SITE.retention = '';
    expect(consultReady()).toBe(false);
    SITE.consultEndpoint = 'https://example.org/exec';
    expect(consultReady()).toBe(false);
    SITE.company.name = '테스트 운영자'; SITE.retention = '상담 종료 후 30일';
    expect(consultReady()).toBe(true);
  } finally { SITE.consultEndpoint = saved.endpoint; SITE.company.name = saved.name; SITE.retention = saved.retention; }
});

test('불투명 POST 성공만으로 완료 처리하지 않는다', async () => {
  const fetcher = vi.fn().mockResolvedValue({ type: 'opaque' });
  const receipt = vi.fn().mockResolvedValue({ ok: false, request_id: id, pending: false });
  await expect(sendWithReceipt('https://example.org/exec', {}, id, receipt, fetcher)).rejects.toThrow('receipt-rejected');
  expect(fetcher).toHaveBeenCalledTimes(1);
});

test('본인 접수 ID의 저장 확인을 받아야 완료한다', async () => {
  const fetcher = vi.fn().mockResolvedValue({ type: 'opaque' });
  const receipt = vi.fn().mockResolvedValueOnce({ ok: false, request_id: id, pending: true }).mockResolvedValueOnce({ ok: true, request_id: id });
  await expect(sendWithReceipt('https://example.org/exec', { phone: '010-1234-5678' }, id, receipt, fetcher)).resolves.toBeUndefined();
  expect(JSON.parse(fetcher.mock.calls[0][1].body).request_id).toBe(id);
});

test('접수 ID가 다른 확인은 완료로 처리하지 않는다', async () => {
  const receipt = vi.fn().mockResolvedValueOnce({ ok: false, request_id: id }).mockResolvedValueOnce({ ok: true, request_id: 'other' });
  await expect(sendWithReceipt('https://example.org/exec', {}, id, receipt, vi.fn().mockResolvedValue({}))).rejects.toThrow('receipt-mismatch');
});

test('이미 저장된 신청은 재시도해도 전송하지 않는다', async () => {
  const fetcher = vi.fn();
  await sendWithReceipt('https://example.org/exec', {}, id, vi.fn().mockResolvedValue({ ok: true, request_id: id }), fetcher);
  expect(fetcher).not.toHaveBeenCalled();
});
