/**
 * 모심듀오 — 상담 신청을 구글 시트에 한 줄씩 쌓는 Apps Script 웹 앱
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
  ['care_when', '간병 시작'],
  ['care_place', '간병 장소'],
  ['caregiver_id', '고른 간병인'],
  ['status', '상태'],
];
const EXTRA = ['담당자', '연락한 날', '연결한 기관', '메모', '접수 ID'];

// 간병인 등록 신청 (care.html, kind = 'caregiver'). 등록 신청만으로 공개하지 않는다
const CG_SHEET_NAME = '간병인등록';
const CG_COLUMNS = [
  ['submitted_at', '접수 시각'],
  ['name', '성함'],
  ['phone', '휴대폰'],
  ['regions', '활동 지역'],
  ['experience', '경력'],
  ['certs', '자격'],
  ['places', '가능한 곳'],
  ['shifts', '근무 형태'],
  ['intro', '소개'],
  ['privacy_consent', '개인정보 동의'],
  ['status', '상태'],
];
const CG_EXTRA = ['확인한 사람', '공개 동의일', '공개 ID', '메모', '접수 ID'];

function ss_() {
  return typeof DELIVERY_SS_ID === 'undefined' ? SpreadsheetApp.getActiveSpreadsheet() : SpreadsheetApp.openById(DELIVERY_SS_ID);
}
function sheet_(name, columns, extra) {
  const ss = ss_();
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.appendRow(columns.map((c) => c[1]).concat(extra));
    sh.setFrozenRows(1);
  }
  const width = sh.getLastColumn();
  if (!sh.getRange(1, 1, 1, width).getValues()[0].includes('접수 ID')) sh.getRange(1, width + 1).setValue('접수 ID');
  return sh;
}

function receipt_(id) {
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id)) return false;
  const ss = ss_();
  return [SHEET_NAME, CG_SHEET_NAME, '접수현황'].some((name) => {
    const sh = ss.getSheetByName(name);
    if (!sh || sh.getLastRow() < 2) return false;
    const column = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].indexOf('접수 ID') + 1;
    return column > 0 && Boolean(sh.getRange(2, column, sh.getLastRow() - 1, 1).createTextFinder(id).matchEntireCell(true).findNext());
  });
}

// JSONP에는 성공 여부와 임의 접수 ID만 반환한다. 연락처·건강정보는 반환하지 않는다.
function doGet(e) {
  const id = String(e.parameter.request_id || '');
  const callback = String(e.parameter.callback || '');
  if (!/^mosimReceipt_[a-f0-9]{32}$/.test(callback) || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id)) return out_({ ok: false });
  const body = { ok: receipt_(id), request_id: id, pending: true };
  return ContentService.createTextOutput(callback + '(' + JSON.stringify(body) + ');').setMimeType(ContentService.MimeType.JAVASCRIPT);
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
    if (String(e.postData.contents || '').length > 50000) return out_({ok:false,error:'too-large'});
    const d = JSON.parse(e.postData.contents || '{}');
    const id = String(d.request_id || '');
    if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id)) return out_({ ok: false, error: 'bad-request-id' });
    if (receipt_(id)) return out_({ ok: true, request_id: id });
    if (d.privacy_consent !== 'Y') return out_({ ok: false, error: 'no-consent' });
    if (d.kind === 'guide_request') return out_(saveGuideRequest_(d, id));
    if (!/^01[016789]-?\d{3,4}-?\d{4}$/.test(String(d.phone || ''))) return out_({ ok: false, error: 'bad-phone' });
    if (d.kind === 'caregiver') {
      const r = CG_COLUMNS.map(([k]) => clean_(d[k], k === 'intro' ? 400 : 60));
      r[0] = new Date();
      sheet_(CG_SHEET_NAME, CG_COLUMNS, CG_EXTRA).appendRow(r.concat(CG_EXTRA.map((name) => name === '접수 ID' ? id : '')));
      return out_({ ok: true, request_id: id });
    }
    if (d.sensitive_consent !== 'Y') d.result_summary = '';
    if (typeof saveCurrentConsult_ === 'function' && ss_().getSheetByName('접수현황')) return out_(saveCurrentConsult_(d, id));
    const row = COLUMNS.map(([k]) => clean_(d[k], k === 'result_summary' || k === 'help_text' ? 400 : 60));
    row[0] = new Date(); // 접수 시각은 서버 시각으로
    sheet_(SHEET_NAME, COLUMNS, EXTRA).appendRow(row.concat(EXTRA.map((name) => name === '접수 ID' ? id : '')));
    return out_({ ok: true, request_id: id });
  } catch (err) {
    return out_({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

function out_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
