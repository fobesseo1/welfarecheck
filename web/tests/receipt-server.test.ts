import { expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const id = '12345678-1234-1234-1234-123456789abc';
function server(existingHeader?: string[]) {
  const sheets = new Map<string, ReturnType<typeof sheet>>();
  function sheet(header?: string[]) {
    const rows: unknown[][] = header ? [header] : [];
    return {
      rows, appendRow(row: unknown[]) { rows.push(row); }, setFrozenRows() {},
      getLastRow: () => rows.length, getLastColumn: () => rows[0]?.length ?? 0,
      getRange(row: number, col: number, count = 1, width = 1) {
        return {
          getValues: () => rows.slice(row - 1, row - 1 + count).map((r) => r.slice(col - 1, col - 1 + width)),
          setValue(value: unknown) { rows[row - 1][col - 1] = value; },
          createTextFinder(value: string) { return { matchEntireCell() { return this; }, findNext: () => rows.slice(row - 1, row - 1 + count).some((r) => r[col - 1] === value) ? {} : null }; },
        };
      },
    };
  }
  if (existingHeader) sheets.set('상담신청', sheet(existingHeader));
  const env: any = {
    SpreadsheetApp: { getActiveSpreadsheet: () => ({ getSheetByName: (name: string) => sheets.get(name), insertSheet: (name: string) => { const s = sheet(); sheets.set(name, s); return s; } }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    ContentService: { MimeType: { JSON: 'json', JAVASCRIPT: 'javascript' }, createTextOutput: (text: string) => ({ text, setMimeType(type: string) { return { text, type }; } }) },
  };
  runInNewContext(readFileSync(new URL('../../tools/consult-sheet/Code.gs', import.meta.url), 'utf8'), env);
  return { sheets, post: (d: object) => JSON.parse(env.doPost({ postData: { contents: JSON.stringify(d) } }).text), get: (callback = `mosimReceipt_${id.replace(/-/g, '')}`) => env.doGet({ parameter: { request_id: id, callback } }) };
}
const payload = { request_id: id, phone: '010-1234-5678', privacy_consent: 'Y', sensitive_consent: 'N', result_summary: '건강정보', status: '신규' };

test('저장 전에는 미확인, 저장 후에는 확인되며 재전송은 한 행만 남긴다', () => {
  const s = server();
  expect(s.get().text).toContain('"ok":false');
  expect(s.post(payload).ok).toBe(true);
  expect(s.post(payload).ok).toBe(true);
  expect(s.sheets.get('상담신청')!.rows).toHaveLength(2);
  const receipt = s.get();
  expect(receipt.type).toBe('javascript');
  expect(receipt.text).toContain('"ok":true');
  expect(receipt.text).not.toContain(payload.phone);
  expect(receipt.text).not.toContain('건강정보');
  expect(s.sheets.get('상담신청')!.rows[1][8]).toBe('');
});

test('동의·전화번호가 잘못된 신청은 저장되지 않고 완료 확인도 나오지 않는다', () => {
  const s = server();
  expect(s.post({ ...payload, privacy_consent: 'N' }).ok).toBe(false);
  expect(s.post({ ...payload, phone: '123' }).ok).toBe(false);
  expect(s.sheets.size).toBe(0);
  expect(s.get().text).toContain('"ok":false');
  expect(s.get('alert(1)').type).toBe('json');
});

test('간병인 신청도 동일 접수 ID를 중복 저장하지 않는다', () => {
  const s = server();
  s.post({ ...payload, kind: 'caregiver', name: '테스트' });
  s.post({ ...payload, kind: 'caregiver', name: '테스트' });
  expect(s.sheets.get('간병인등록')!.rows).toHaveLength(2);
  expect(s.get().text).toContain('"ok":true');
});

test('기존 시트에는 접수 ID 열을 추가해 재시도 확인이 가능하다', () => {
  const first = server(); first.post(payload);
  const oldHeader = first.sheets.get('상담신청')!.rows[0].slice(0, -1) as string[];
  const s = server(oldHeader); s.post(payload);
  expect(s.sheets.get('상담신청')!.rows[0].at(-1)).toBe('접수 ID');
  expect(s.get().text).toContain('"ok":true');
});
