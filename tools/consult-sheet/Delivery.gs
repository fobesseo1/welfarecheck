/** Config.gs의 계정·자료 목록을 사용. 접수 저장과 이메일 발송을 분리한다. */
const INTAKE_HEADERS = ['접수 ID','접수 시각','요청 종류','호칭','휴대전화','이메일','수령 방법','필요한 도움','시작 희망일','연락 가능 시간','개인정보 동의','건강정보 저장 동의','추후 정보 수신','동의 시각·안내 버전','진행 상태','담당자','다음 연락일','상담 종료일','삭제 예정일'];
const ANSWER_HEADERS = ['접수 ID','테스트 ID','질문 ID','질문 문구','답변 코드','답변 표시 문구','기록 시각','질문·계산 버전','결과 요약'];
const MAIL_HEADERS = ['발송 ID','접수 ID','자료 번호','선정 이유','발송 방법','발송 요청일','발송 상태','발송 처리일','업체 메시지 ID','실패 사유','재시도 횟수'];
const LINK_HEADERS = ['기록 ID','접수 ID','기록 시각','부모님 거주지','필요한 도움·시간','예산 범위','기관 후보·추천 이유','확인한 비용·시작일','기관 전달 동의·시각','담당자·다음 할 일','확인 기한','연결 상태','이용 시작일','후속 확인·미해결'];
function table_(name, headers) {
  const ss = ss_(); let sh = ss.getSheetByName(name);
  if (!sh) { sh = ss.insertSheet(name); sh.appendRow(headers); sh.setFrozenRows(1); }
  if (JSON.stringify(sh.getRange(1,1,1,headers.length).getValues()[0]) !== JSON.stringify(headers)) throw new Error('header-mismatch');
  return sh;
}
function rows_(sh, width) { return sh.getLastRow() < 2 ? [] : sh.getRange(2,1,sh.getLastRow()-1,width).getValues(); }
function guideKey_(value) { return String(value).replace(/^'/,'').padStart(2,'0'); }
function phoneText_(value) { return String(value).replace(/\D/g,'').replace(/^(\d{3})(\d{3,4})(\d{4})$/,'$1-$2-$3'); }
function monthLater_(value) {
  const d = new Date(value); const day = d.getDate();
  d.setDate(1); d.setMonth(d.getMonth()+6);
  const last = new Date(d.getFullYear(), d.getMonth()+1, 0).getDate(); d.setDate(Math.min(day,last)); return d;
}
function checkedAnswers_(input) {
  const a = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const out = {};
  for (const q of DELIVERY_QUESTIONS) {
    const v = a[q.id] === undefined && q.other && typeof a[q.id+'_other'] === 'string' && a[q.id+'_other'].trim() ? [] : a[q.id]; if (v === undefined) continue;
    if (q.type === 'chips' && Array.isArray(v)) {
      if (v.length > (q.options || []).length || v.some(x => !(q.options || []).some(o => o.value === x))) throw new Error('bad-answer');
      out[q.id] = Array.from(new Set(v));
    } else if (typeof v === 'string' && (v === 'unknown' || (q.type === 'date' ? /^\d{4}-\d{2}-\d{2}$/.test(v) : (q.options || []).some(o => o.value === v)))) out[q.id] = v;
    else throw new Error('bad-answer');
  }
  function visible(q) {
    if (q.gate) return out[q.gate] === 'yes';
    if (!q.when) return true;
    const dep = DELIVERY_QUESTIONS.find(s => s.id === q.when.q);
    const v = dep && !visible(dep) ? undefined : out[q.when.q];
    return q.when.in ? q.when.in.includes(v) : !q.when.notIn.includes(v);
  }
  const result = [];
  for (const q of DELIVERY_QUESTIONS) {
    if (!visible(q) || out[q.id] === undefined) continue;
    const value = out[q.id]; const values = Array.isArray(value) ? value : [value];
    const label = values.length ? values.map(v => v === 'unknown' ? '잘 모르겠어요' : (q.options || []).find(o => o.value === v)?.label || v).join(' · ') : q.none_label || '선택 없음';
    result.push([q.id,q.text,JSON.stringify(value),label]);
    if (q.other && typeof a[q.id+'_other'] === 'string' && a[q.id+'_other'].trim()) result.push([q.id+'_other',q.text+' (직접 입력)',a[q.id+'_other'].slice(0,300),a[q.id+'_other'].slice(0,300)]);
  }
  return result;
}
function saveGuideRequest_(d, id) {
  const email = String(d.email || '').trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(email) || d.website) return {ok:false,error:'bad-request'};
  const ids = Array.isArray(d.guide_ids) ? Array.from(new Set(d.guide_ids)) : [];
  if (!ids.length || ids.length > 2 || ids.some(g => !DELIVERY_GUIDES[g])) return {ok:false,error:'bad-guides'};
  const consult = d.consult_requested === true;
  if (!/^01[016789]-?\d{3,4}-?\d{4}$/.test(String(d.phone || ''))) return {ok:false,error:'bad-phone'};
  const now = new Date(); const sh = table_('접수현황',INTAKE_HEADERS);
  const today = Utilities.formatDate(now,'Asia/Seoul','yyyy-MM-dd');
  const todays = rows_(sh,INTAKE_HEADERS.length).filter(r => r[5] && Utilities.formatDate(new Date(r[1]),'Asia/Seoul','yyyy-MM-dd') === today);
  if (todays.length >= 80 || todays.filter(r => r[5] === email).length >= 3) return {ok:false,error:'daily-limit'};
  const answers = d.sensitive_consent === 'Y' ? checkedAnswers_(d.answers) : [];
  const summary = d.sensitive_consent === 'Y' ? clean_(d.result_summary,1000) : '';
  const answerSheet = table_('답변기록',ANSWER_HEADERS); const mailSheet = table_('자료발송',MAIL_HEADERS);
  // 접수현황은 마지막에 기록. 중간 오류는 본 요청의 부속 행을 되돌려 재시도 가능하게 한다.
  const startAnswers = answerSheet.getLastRow(); const startMail = mailSheet.getLastRow();
  try {
    for (const a of answers) answerSheet.appendRow([id,id,...a.map(v => clean_(v,1000)),now,DELIVERY_VERSION,summary]);
    if (summary && !answers.length) answerSheet.appendRow([id,id,'result','체크 결과','','',now,DELIVERY_VERSION,summary]);
    for (const guide of ids) mailSheet.appendRow([Utilities.getUuid(),id,"'"+guide,'보호자가 확인한 선택','이메일',now,'대기','','','',0]);
    sh.appendRow([id,now,consult?'자료·상담 요청':'자료 요청','',phoneText_(d.phone),clean_(email,254),'이메일',ids.map(g=>DELIVERY_GUIDES[g].title).join(' · '),'','', 'Y',d.sensitive_consent==='Y'?'Y':'N',d.marketing_consent==='Y'?'Y':'N',now.toISOString()+' / '+DELIVERY_VERSION,consult?'신규':'자료 발송 대기','','','','']);
  } catch (e) {
    if (answerSheet.getLastRow()>startAnswers) answerSheet.deleteRows(startAnswers+1,answerSheet.getLastRow()-startAnswers);
    if (mailSheet.getLastRow()>startMail) mailSheet.deleteRows(startMail+1,mailSheet.getLastRow()-startMail);
    throw e;
  }
  return {ok:true,request_id:id};
}
function saveCurrentConsult_(d,id) {
  const now = new Date(); const sh = table_('접수현황',INTAKE_HEADERS);
  const a = table_('답변기록',ANSWER_HEADERS); const links = table_('상담연결',LINK_HEADERS);
  const ar = a.getLastRow(), lr = links.getLastRow();
  try {
    if (d.sensitive_consent === 'Y' && d.result_summary) a.appendRow([id,id,'result','체크 결과','','',now,DELIVERY_VERSION,clean_(d.result_summary,1000)]);
    links.appendRow([Utilities.getUuid(),id,now,clean_([d.region,d.dong].filter(Boolean).join(' '),100),clean_([d.help,d.help_text].filter(Boolean).join(' · '),500),'','','','','','', '확인 중','','']);
    sh.appendRow([id,now,'상담 요청',clean_(d.name,60),phoneText_(d.phone),'',clean_(d.contact,60),clean_([d.help,d.help_text].filter(Boolean).join(' · '),500),clean_(d.care_when,60),'','Y',d.sensitive_consent==='Y'?'Y':'N','N',now.toISOString()+' / '+DELIVERY_VERSION,'신규','','','','']);
  } catch(e) {
    if(a.getLastRow()>ar) a.deleteRows(ar+1,a.getLastRow()-ar);
    if(links.getLastRow()>lr) links.deleteRows(lr+1,links.getLastRow()-lr);
    throw e;
  }
  return {ok:true,request_id:id};
}
/** 5분 주기. 한 접수의 PDF를 한 통으로 묶어 발송한다. */
function processMailQueue() {
  const lock = LockService.getScriptLock(); if (!lock.tryLock(1000)) return;
  try {
    const intake = table_('접수현황',INTAKE_HEADERS), mail = table_('자료발송',MAIL_HEADERS), answer = table_('답변기록',ANSWER_HEADERS);
    const requests = rows_(intake,19), records = rows_(mail,11), answers = rows_(answer,9);
    const ids = Array.from(new Set(records.filter(r=>r[6]==='대기').map(r=>r[1]))).slice(0,10);
    for (const id of ids) {
      const bundle = records.map((row,i)=>({row,index:i+2})).filter(x=>x.row[1]===id);
      if (bundle.some(x=>x.row[6]!=='대기')) continue;
      const requestIndex = requests.findIndex(r=>r[0]===id); if(requestIndex<0) continue;
      const request = requests[requestIndex]; if (request[10]!=='Y' || !request[5]) continue;
      if(MailApp.getRemainingDailyQuota()<1) break;
      let attempted = false;
      try {
        const attachments = bundle.map(x=>{
          const guide=DELIVERY_GUIDES[guideKey_(x.row[2])]; if(!guide) throw new Error('unknown-guide');
          const file=DriveApp.getFileById(guide.fileId); if(file.getMimeType()!=='application/pdf') throw new Error('not-pdf');
          return file.getBlob().setName(guide.title+'.pdf');
        });
        const summary = request[11]==='Y' ? (answers.find(r=>r[0]===id && r[8]) || [])[8] || '' : '';
        const body = '안녕하세요. 모심듀오입니다.\n\n선택하신 준비 안내서를 첨부했어요.\n'+bundle.map(x=>'• '+DELIVERY_GUIDES[guideKey_(x.row[2])].title).join('\n')+(summary?'\n\n체크 결과\n'+summary:'')+'\n\n안내와 예상 등급은 참고용이며 실제 등급과 급여는 국민건강보험공단이 결정합니다.\n'+(request[2]==='자료·상담 요청'?'상담 요청도 접수했어요. 운영시간에 연락드릴게요.\n':'')+'\n문의: '+DELIVERY_REPLY_TO+' / 010-6428-8020\n접수 번호: '+id;
        for(const x of bundle) mail.getRange(x.index,7).setValue('처리 중');
        SpreadsheetApp.flush(); attempted=true;
        MailApp.sendEmail({to:request[5],subject:'[모심듀오] 요청하신 돌봄 준비 안내서',body,name:'모심듀오',replyTo:DELIVERY_REPLY_TO,attachments});
        const now=new Date();
        for(const x of bundle) { mail.getRange(x.index,7).setValue('발송 성공'); mail.getRange(x.index,8).setValue(now); }
        if(request[2]==='자료 요청') { intake.getRange(requestIndex+2,15).setValue('종료'); intake.getRange(requestIndex+2,18).setValue(now); intake.getRange(requestIndex+2,19).setValue(monthLater_(now)); }
      } catch(e) {
        // 메일 호출 이후 예외는 실제 발송 여부가 불명확할 수 있으므로 자동 재전송하지 않는다.
        for(const x of bundle) { mail.getRange(x.index,7).setValue(attempted?'수동 확인 필요':'발송 실패'); mail.getRange(x.index,10).setValue(attempted?'실제 수신 확인 후 처리하세요. 자동 재전송하지 않음':'PDF 또는 발송 설정 확인 필요'); }
      }
    }
  } finally { lock.releaseLock(); }
}
/** 종료일을 입력한 상담은 삭제 예정일 계산. 기간이 지난 요청과 부속 기록을 함께 삭제한다. */
function purgeExpiredRequests() {
  const lock=LockService.getScriptLock(); lock.waitLock(10000);
  try {
    const intake=table_('접수현황',INTAKE_HEADERS), rows=rows_(intake,19), now=new Date(); const expired=[];
    rows.forEach((r,i)=>{
      if(!r[17]) return;
      const deletion=monthLater_(r[17]); if(!r[18]) intake.getRange(i+2,19).setValue(deletion);
      if(deletion<=now) expired.push({id:r[0],index:i+2});
    });
    const ids=new Set(expired.map(x=>x.id));
    for(const [name,width,key] of [['답변기록',9,0],['자료발송',11,1],['상담연결',14,1]]) {
      const sh=ss_().getSheetByName(name); if(!sh) continue;
      rows_(sh,width).map((r,i)=>({r,index:i+2})).filter(x=>ids.has(x.r[key])).reverse().forEach(x=>sh.deleteRow(x.index));
    }
    expired.reverse().forEach(x=>intake.deleteRow(x.index));
  } finally {lock.releaseLock();}
}
/** 계정 소유자가 한 번 실행하여 승인. 테스트 이메일은 보내지 않는다. */
function setupDelivery() {
  table_('접수현황',INTAKE_HEADERS); table_('답변기록',ANSWER_HEADERS); table_('자료발송',MAIL_HEADERS); table_('상담연결',LINK_HEADERS);
  for(const guide of Object.values(DELIVERY_GUIDES)) if(DriveApp.getFileById(guide.fileId).getMimeType()!=='application/pdf') throw new Error('PDF 확인 필요');
  MailApp.getRemainingDailyQuota();
  const existing=ScriptApp.getProjectTriggers().map(t=>t.getHandlerFunction());
  if(!existing.includes('processMailQueue')) ScriptApp.newTrigger('processMailQueue').timeBased().everyMinutes(5).create();
  if(!existing.includes('purgeExpiredRequests')) ScriptApp.newTrigger('purgeExpiredRequests').timeBased().everyDays(1).atHour(3).create();
  console.log('PDF 접근·메일 권한·발송 및 삭제 트리거 준비 완료');
}
