import { expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
const id='12345678-1234-1234-1234-123456789abc';
function server(options:{quota?:number;failMail?:boolean;failAppend?:string}={}) {
 const sheets=new Map<string,any>(), sent:any[]=[];
 function sheet(name:string) {
  const rows:any[][]=[];
  return { rows,appendRow(row:any[]){if(options.failAppend===name&&rows.length)throw Error('append');rows.push(row);},setFrozenRows(){},getLastRow:()=>rows.length,getLastColumn:()=>rows[0]?.length||0,
   deleteRows(row:number,count:number){rows.splice(row-1,count);},deleteRow(row:number){rows.splice(row-1,1);},
   getRange(row:number,col:number,count=1,width=1){return{getValues:()=>rows.slice(row-1,row-1+count).map(r=>r.slice(col-1,col-1+width)),setValue(v:any){rows[row-1][col-1]=v;},createTextFinder(v:string){return{matchEntireCell(){return this;},findNext:()=>rows.slice(row-1,row-1+count).some(r=>r[col-1]===v)?{}:null};}};}
  };
 }
 const ss={getSheetByName:(n:string)=>sheets.get(n),insertSheet:(n:string)=>{const sh=sheet(n);sheets.set(n,sh);return sh;}};
 const env:any={SpreadsheetApp:{openById:()=>ss,getActiveSpreadsheet:()=>ss,flush(){}},LockService:{getScriptLock:()=>({waitLock(){},tryLock:()=>true,releaseLock(){}})},
  ContentService:{MimeType:{JSON:'json',JAVASCRIPT:'js'},createTextOutput:(text:string)=>({text,setMimeType(){return{text};}})},
  Utilities:{getUuid:()=>crypto.randomUUID(),formatDate:(d:Date)=>d.toISOString().slice(0,10)},
  DriveApp:{getFileById:()=>({getMimeType:()=> 'application/pdf',getBlob:()=>({setName:(name:string)=>({name})})})},
  MailApp:{getRemainingDailyQuota:()=>options.quota??100,sendEmail:(mail:any)=>{if(options.failMail)throw Error('mail');sent.push(mail);}},console};
 // 실제 비공개 시트·PDF 설정 없이 동일 서버 코드를 검증한다.
 const questions=JSON.parse(readFileSync(new URL('../../data/questionnaire.json',import.meta.url),'utf8')).steps;
 const guides=Object.fromEntries(['01','02','03','04','05','06','07','08'].map(id=>[id,{title:`안내서 ${id}`,fileId:`test-pdf-${id}`} ]));
 const config=`const DELIVERY_SS_ID='test-sheet'; const DELIVERY_REPLY_TO='operator@example.com'; const DELIVERY_VERSION='test'; const DELIVERY_GUIDES=${JSON.stringify(guides)}; const DELIVERY_QUESTIONS=${JSON.stringify(questions)};`;
 const source=config+'\n'+['Code.gs','Delivery.gs'].map(f=>readFileSync(new URL('../../tools/consult-sheet/'+f,import.meta.url),'utf8')).join('\n');
 runInNewContext(source,env);
 return{env,sheets,sent,post:(d:any)=>JSON.parse(env.doPost({postData:{contents:JSON.stringify(d)}}).text)};
}
const request={kind:'guide_request',request_id:id,email:'guardian@example.com',phone:'010-1234-5678',privacy_consent:'Y',sensitive_consent:'N',marketing_consent:'N',guide_ids:['01','02'],answers:{age:'over65',dementia:'diagnosed'},result_summary:'건강 결과'};
test('시트가 자료 번호를 숫자로 바꿔도 PDF를 찾고 숫자 입력 전화의 앞 0을 보존한다',()=>{
 const s=server();s.post({...request,phone:'01012345678'});
 expect(s.sheets.get('접수현황').rows[1][4]).toBe('010-1234-5678');
 s.sheets.get('자료발송').rows[1][2]=1;s.sheets.get('자료발송').rows[2][2]=2;
 s.env.processMailQueue();expect(s.sent).toHaveLength(1);expect(s.sent[0].attachments).toHaveLength(2);
});
test('중복 요청은 한 건 저장하고 PDF 두 개를 한 통으로 발송한다',()=>{
 const s=server();expect(s.post(request).ok).toBe(true);expect(s.post(request).ok).toBe(true);
 expect(s.sheets.get('접수현황').rows).toHaveLength(2);
 expect(s.sheets.get('답변기록').rows).toHaveLength(1);
 s.env.processMailQueue();s.env.processMailQueue();expect(s.sent).toHaveLength(1);
 expect(s.sent[0].attachments).toHaveLength(2);expect(s.sent[0].body).not.toContain('건강 결과');
 const row=s.sheets.get('접수현황').rows[1];
 expect(row[18].getTime()).toBe(s.env.monthLater_(row[17]).getTime());
});
test('별도 건강정보 동의가 있을 때만 현재 답과 결과를 저장한다',()=>{
 const s=server();expect(s.post({...request,sensitive_consent:'Y',answers:{age:'over65',disease:'dementia',dementia:'none',grade:'none'}}).ok).toBe(true);
 const rows=s.sheets.get('답변기록').rows.slice(1);expect(rows.map((r:any[])=>r[2])).toEqual(['age','dementia','grade']);
 s.env.processMailQueue();expect(s.sent[0].body).toContain('건강 결과');
});
test('전화 누락·동의 거부·수신자 여러 명·잘못된 자료는 접수 거부한다',()=>{
 for(const extra of [{phone:''},{privacy_consent:'N'},{email:'a@example.com,b@example.com'},{guide_ids:['09']}]){
  const s=server();expect(s.post({...request,...extra}).ok).toBe(false);expect(s.sent).toHaveLength(0);
 }
});
test('발송 한도 부족은 대기, 메일 호출 오류는 확인 대상으로 남겨 자동 재발송하지 않는다',()=>{
 const noQuota=server({quota:0});noQuota.post(request);noQuota.env.processMailQueue();expect(noQuota.sheets.get('자료발송').rows[1][6]).toBe('대기');
 const broken=server({failMail:true});broken.post(request);broken.env.processMailQueue();expect(broken.sheets.get('자료발송').rows[1][6]).toBe('수동 확인 필요');broken.env.processMailQueue();expect(broken.sent).toHaveLength(0);
});
test('저장 중 실패한 부속 행을 되돌린 뒤 같은 요청을 재시도할 수 있다',()=>{
 const options={failAppend:'자료발송'};const s=server(options);expect(s.post({...request,sensitive_consent:'Y'}).ok).toBe(false);
 expect(s.sheets.get('답변기록').rows).toHaveLength(1);expect(s.sheets.get('접수현황').rows).toHaveLength(1);
 options.failAppend='';expect(s.post(request).ok).toBe(true);
});
test('메일 접수 한도는 동일 이메일 하루 세 건이며 상담 요청은 발송 후에도 열린다',()=>{
 const s=server();for(let i=0;i<3;i++)expect(s.post({...request,request_id:crypto.randomUUID(),consult_requested:true}).ok).toBe(true);
 expect(s.post({...request,request_id:crypto.randomUUID()}).error).toBe('daily-limit');s.env.processMailQueue();
 expect(s.sheets.get('접수현황').rows[1][17]).toBe('');
});
test('6개월이 지난 접수의 답변·발송 기록을 함께 삭제한다',()=>{
 const s=server();s.post({...request,sensitive_consent:'Y'});s.sheets.get('접수현황').rows[1][17]=new Date('2020-01-31');
 s.env.purgeExpiredRequests();expect(s.sheets.get('접수현황').rows).toHaveLength(1);expect(s.sheets.get('답변기록').rows).toHaveLength(1);expect(s.sheets.get('자료발송').rows).toHaveLength(1);
 expect(s.env.monthLater_(new Date('2025-08-31')).getDate()).toBe(28);
});
