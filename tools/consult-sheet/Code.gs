/**
 * 요양원 길잡이 — 상담 신청을 구글 시트에 한 줄씩 쌓는 Apps Script 웹 앱
 * 설치 방법: docs/CONSULT_SHEET_SETUP.md
 *
 * 받는 값은 web/src/engine/consult.ts 의 buildPayload() 와 같은 이름이어야 한다.
 * 건강 정보(result_summary)는 보호자가 따로 동의(sensitive_consent = Y)한 경우에만 들어온다.
 */
const SHEET_NAME = '상담신청';
const COLUMNS = [
  ['submitted_at', '접수 시각'],
  ['region', '지역'],
  ['dong', '동네'],
  ['help', '필요한 도움'],
  ['help_text', '직접 적은 내용'],
  ['contact', '연락 방법'],
  ['phone', '휴대폰'],
  ['name', '호칭'],
  ['result_summary', '3분 체크 결과 요약'],
  ['sensitive_consent', '건강정보 동의'],
  ['privacy_consent', '개인정보 동의'],
  ['status', '상태'],
];
const EXTRA = ['담당자', '연락한 날', '연결한 기관', '메모'];

function sheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(SHEET_NAME);
    sh.appendRow(COLUMNS.map((c) => c[1]).concat(EXTRA));
    sh.setFrozenRows(1);
  }
  return sh;
}

function clean_(v, max) {
  // 시트 수식으로 해석되지 않게 =,+,-,@ 로 시작하면 작은따옴표를 붙인다
  let s = String(v == null ? '' : v).slice(0, max);
  if (/^[=+\-@]/.test(s)) s = "'" + s;
  return s;
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const d = JSON.parse(e.postData.contents || '{}');
    if (d.privacy_consent !== 'Y') return out_({ ok: false, error: 'no-consent' });
    if (!/^01[016789]-?\d{3,4}-?\d{4}$/.test(String(d.phone || ''))) return out_({ ok: false, error: 'bad-phone' });
    if (d.sensitive_consent !== 'Y') d.result_summary = '';
    const row = COLUMNS.map(([k]) => clean_(d[k], k === 'result_summary' || k === 'help_text' ? 400 : 60));
    row[0] = new Date(); // 접수 시각은 서버 시각으로
    sheet_().appendRow(row.concat(EXTRA.map(() => '')));
    return out_({ ok: true });
  } catch (err) {
    return out_({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

function out_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
