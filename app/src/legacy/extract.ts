// A. 자연어 정보 추출 엔진 (규칙 기반 — Mock 모드의 기본 추출기이자, LLM 결과의 안전망)
// 원칙: 입력 문장에 근거가 있는 것만 추출한다. 근거(evidence)는 항상 원문의 부분 문자열이다.
import type { Fact, FactMap } from '../types.ts';

export interface ExtractOptions { today: string }

const now = () => new Date().toISOString();

function clauseAround(text: string, idx: number, len: number): string {
  const seps = /[.!?。\n]|는데|고 |지만|서 /g;
  let start = 0; let end = text.length; let m: RegExpExecArray | null;
  while ((m = seps.exec(text))) {
    if (m.index + m[0].length <= idx) start = m.index + m[0].length;
    else if (m.index >= idx + len) { end = m.index; break; }
  }
  return text.slice(start, end).trim();
}

function fact<T>(value: T, evidence: string, status: Fact['status'] = 'stated_by_guardian'): Fact<T> {
  return { value, status, evidence: evidence.trim(), source: 'extractor', updatedAt: now() };
}

function ymd(d: Date): string { return d.toISOString().slice(0, 10); }

/** 월/일만 있을 때 연도 추정: future=true 이면 오늘 이후 가장 가까운 날, false 면 오늘 이전 가장 가까운 날 */
function inferDate(today: string, month: number, day: number, future: boolean, yearHint?: number): string {
  const t = new Date(today + 'T00:00:00Z');
  if (yearHint) return ymd(new Date(Date.UTC(yearHint, month - 1, day)));
  let y = t.getUTCFullYear();
  let d = new Date(Date.UTC(y, month - 1, day));
  if (future && d < t) d = new Date(Date.UTC(y + 1, month - 1, day));
  if (!future && d > t) d = new Date(Date.UTC(y - 1, month - 1, day));
  return ymd(d);
}

const RELATIONS: [RegExp, string][] = [
  [/어머니|엄마|어머님|모친/, '어머니'], [/아버지|아빠|아버님|부친/, '아버지'],
  [/할머니/, '할머니'], [/할아버지/, '할아버지'], [/남편/, '남편'], [/아내|와이프|집사람/, '아내'],
  [/시어머니/, '시어머니'], [/시아버지/, '시아버지'], [/장모/, '장모'], [/장인/, '장인'],
];

// 노인성 질병 키워드 → 시행령 별표1 코드 (data/geriatric_diseases.json 과 일치해야 함, 테스트로 확인)
export const DISEASE_KEYWORDS: [RegExp, string][] = [
  [/알츠하이머/, 'G30'], [/혈관성\s*치매/, 'F01'], [/지주막하\s*출혈/, 'I60'], [/뇌출혈|뇌내출혈/, 'I61'],
  [/뇌경색/, 'I63'], [/뇌졸중/, 'I64'], [/뇌혈관/, 'I67'], [/중풍/, 'U23.4'], [/이차성\s*파킨슨/, 'G21'],
  [/파킨슨/, 'G20'], [/다발\s*경화/, 'G35'], [/척수성\s*근위축/, 'G12'], [/진전|손떨림/, 'R25.1'],
];

const HEDGE = /같대|같아|같은데|같다|의심|인지\s*모르|아닐까|기가\s*있/;

const ITEM_PATTERNS: { id: string; re: RegExp; kind: 'adl' | 'symptom' | 'observe' }[] = [
  { id: 'PHY-10', re: /화장실/, kind: 'adl' },
  { id: 'PHY-01', re: /옷(을)?\s*(갈아|입|벗)/, kind: 'adl' },
  { id: 'PHY-04', re: /목욕|샤워|씻/, kind: 'adl' },
  { id: 'PHY-05', re: /식사|밥(을)?\s*(드|먹)/, kind: 'adl' },
  { id: 'PHY-07', re: /일어나\s*앉|일어나(시)?지/, kind: 'adl' },
  { id: 'PHY-08', re: /옮겨\s*앉|휠체어/, kind: 'adl' },
  { id: 'PHY-09', re: /거동|걷(기|지|는)|누워만|방\s*밖/, kind: 'adl' },
  { id: 'PHY-11', re: /대변\s*(실수|조절)/, kind: 'adl' },
  { id: 'PHY-12', re: /소변\s*(실수|조절)|기저귀/, kind: 'adl' },
  { id: 'BEH-09', re: /밖으로\s*나가(려|시려)/, kind: 'symptom' },
  { id: 'BEH-07', re: /길을\s*잃|헤매/, kind: 'symptom' },
  { id: 'BEH-04', re: /밤낮|주야|밤에\s*(잠|안\s*주무|못\s*주무|깨)/, kind: 'symptom' },
  { id: 'BEH-08', re: /폭언|욕(을|하)|때리/, kind: 'symptom' },
  { id: 'BEH-01', re: /훔쳐|도둑/, kind: 'symptom' },
  { id: 'BEH-02', re: /헛것|환청|환각/, kind: 'symptom' },
  { id: 'BEH-05', re: /(도움|씻기|돌봄)[^.]*(거부|저항)/, kind: 'symptom' },
  { id: 'BEH-15', re: /(가스불|불을\s*켜)/, kind: 'symptom' },
  { id: 'COG-01', re: /깜빡|같은\s*말(을)?\s*반복|방금/, kind: 'symptom' },
  { id: 'COG-02', re: /날짜(를|가)?\s*(헷갈|모르)/, kind: 'symptom' },
  { id: 'NUR-04', re: /욕창/, kind: 'symptom' },
  { id: 'NUR-05', re: /콧줄|경관/, kind: 'symptom' },
  { id: 'NUR-07', re: /소변줄|도뇨/, kind: 'symptom' },
  { id: 'NUR-09', re: /투석/, kind: 'symptom' },
  { id: 'REH-01', re: /오른(쪽)?\s*(팔|편)[^.]*(못|마비|불편)|오른쪽을\s*잘\s*못/, kind: 'observe' },
  { id: 'REH-03', re: /왼(쪽)?\s*(팔|편)[^.]*(못|마비|불편)|왼쪽을\s*잘\s*못/, kind: 'observe' },
];

const NEG = /힘들|힘드|힘겨|어렵|어려|못\s|못하|못\s*가|못\s*하|도움|도와|안\s*되|불편|혼자서는/;
const INDEP = /혼자\s*(잘\s*)?(하|가|드|입|씻)/;


export function extract(text: string, opts: ExtractOptions): FactMap {
  const f: FactMap = {};
  const t = text.replace(/\s+/g, ' ');

  // 관계
  for (const [re, rel] of RELATIONS) { const m = t.match(re); if (m) { f.relation = fact(rel, m[0]); break; } }
  // 첫 등장 관계어 기준으로 다시 정렬 (예: "아버지가 … 어머니가 돌보시는데" → 아버지)
  let firstIdx = Infinity; let firstRel: string | null = null; let firstEv = '';
  for (const [re, rel] of RELATIONS) { const m = re.exec(t); if (m && m.index < firstIdx) { firstIdx = m.index; firstRel = rel; firstEv = m[0]; } }
  if (firstRel) f.relation = fact(firstRel, firstEv);

  // 나이: 문장에서 처음 나오는 40~110 사이 나이
  for (const m of t.matchAll(/(\d{2,3})\s*(세|살)|\((\d{2,3})\)/g)) {
    if (m[3]) { const n3 = Number(m[3]); if (n3 >= 40 && n3 <= 110) { f.age = fact(n3, m[0]); break; } continue; }
    const n = Number(m[1]);
    if (n >= 40 && n <= 110) { f.age = fact(n, m[0]); break; }
  }

  // 등급
  let m: RegExpMatchArray | null;
  if ((m = t.match(/인지\s*지원\s*등급/))) { f.grade_status = fact('graded', m[0]); f.grade = fact('cognitive', m[0]); }
  else if ((m = t.match(/등급\s*외/))) { f.grade_status = fact('out_of_grade', m[0]); }
  else if ((m = t.match(/([1-5])\s*등급/))) { f.grade_status = fact('graded', m[0]); f.grade = fact(Number(m[1]) as 1, m[0]); }
  else if ((m = t.match(/등급(은|이|도)?\s*(아직\s*)?(없|안\s*받)/))) { f.grade_status = fact('none', m[0]); }
  if (!f.grade_status && (m = t.match(/신청(했|해\s*놨|하고\s*기다|한\s*상태)/))) { f.grade_status = fact('pending', m[0]); }

  // 인정서 급여 종류
  if ((m = t.match(/시설급여(를|도)?\s*(이용할\s*수\s*있|받을\s*수\s*있|가능)|인정서에\s*시설급여/))) f.facility_in_cert = fact(true, m[0]);
  else if ((m = t.match(/재가급여만/))) f.facility_in_cert = fact(false, m[0]);
  if ((m = t.match(/방문요양|재가급여|주간보호|주야간보호|주·야간보호/))) f.current_home_services = fact(true, m[0]);

  // 유효기간
  if ((m = t.match(/유효기간[^0-9]{0,15}(?:(\d{4})\s*[년.\-/]\s*)?(\d{1,2})\s*[월.\-/]\s*(\d{1,2})\s*일?/))) {
    f.validity_end = fact(inferDate(opts.today, Number(m[2]), Number(m[3]), true, m[1] ? Number(m[1]) : undefined), m[0]);
  } else if ((m = t.match(/유효기간[^0-9]{0,15}(내년|올해)\s*(\d{1,2})\s*월/))) {
    const y = new Date(opts.today).getUTCFullYear() + (m[1] === '내년' ? 1 : 0);
    const last = new Date(Date.UTC(y, Number(m[2]), 0));
    f.validity_end = fact(ymd(last), m[0]);
  }

  // 날짜: 신청일, 통지일
  if ((m = t.match(/(\d{1,2})\s*월\s*(\d{1,2})\s*일(에|날)?\s*신청/))) f.applied_date = fact(inferDate(opts.today, +m[1], +m[2], false), m[0]);
  if ((m = t.match(/(\d{1,2})\s*월\s*(\d{1,2})\s*일(에|날)?\s*(통지(서)?|결과)(를|을)?\s*받/))) f.notice_date = fact(inferDate(opts.today, +m[1], +m[2], false), m[0]);

  // 치매
  if ((m = t.match(/치매[^.]{0,12}(같|의심|기가|인지\s*모르)/)) || (m = t.match(/(같은데|같아요)[^.]{0,6}치매/))) f.dementia = fact('suspected', m[0]);
  else if ((m = t.match(/치매[^.]{0,15}진단|진단[^.]{0,10}치매|알츠하이머/))) f.dementia = fact('diagnosed', m[0]);
  else if ((m = t.match(/치매(가|를)?\s*(있|앓)/))) f.dementia = fact('diagnosed', m[0]);
  if (f.dementia?.value === 'diagnosed' && /진단[^.]{0,10}(안|없|못)|병원[^.]{0,8}안\s*가/.test(t)) f.dementia = fact('suspected', f.dementia.evidence);

  // 노인성 질병
  const codes: string[] = []; const evs: string[] = [];
  for (const [re, code] of DISEASE_KEYWORDS) {
    const mm = re.exec(t);
    if (mm) {
      const clause = clauseAround(t, mm.index, mm[0].length);
      if (HEDGE.test(clause)) { f.other_condition = fact(`${mm[0]} 의심(진단 미확인)`, clause); continue; }
      if (!codes.includes(code)) { codes.push(code); evs.push(mm[0]); }
    }
  }
  if (f.dementia?.value === 'diagnosed' && !codes.some((c) => c.startsWith('F0') || c === 'G30')) { codes.push('F03'); evs.push(f.dementia.evidence); }
  if (codes.length) f.diseases = fact(codes, evs.join(', '));
  if (!codes.length && (m = t.match(/([가-힣]+)\s*(수술|골절|디스크|당뇨|암)/))) f.other_condition = f.other_condition ?? fact(m[0], m[0]);

  // 주거·돌봄 환경
  if ((m = t.match(/혼자\s*사(세|시|십|는|셔|신다)|독거|혼자\s*지내/))) f.living = fact('alone', m[0]);
  else if ((m = t.match(/두\s*분(이서|만)|노부부|부부(만|끼리)\s*사/))) f.living = fact('elderly_only', m[0]);
  else if ((m = t.match(/(같이|함께)\s*(살|사세|지내)|모시고\s*(살|있)|저희\s*(부부)?(랑|와|하고)\s*(같이|함께)?/))) f.living = fact('with_family', m[0]);

  if ((m = t.match(/(돌보|모시|수발|케어)[^.]{0,20}(힘들|어렵|벅차|못\s*하)|힘들어\s*하|일을\s*하니까|직장(에|을)?\s*다(니|녀)|맞벌이|멀리\s*살/))) f.caregiver_difficulty = fact(true, clauseAround(t, t.indexOf(m[0]), m[0].length));
  if ((m = t.match(/(어머니|아버지|엄마|아빠|할머니|할아버지|배우자)(가|께서)\s*혼자\s*(돌보|모시|수발)/))) f.main_caregiver = fact(m[1], m[0]);
  if ((m = t.match(/(집|주거|방)[^.]{0,10}(열악|좁|계단|난방이\s*안|추워|곰팡이|반지하)/))) f.housing_poor = fact(true, m[0]);
  if ((m = t.match(/(방문요양|주간보호|요양보호사)[^.]{0,15}(거부|못\s*받|안\s*받|그만두|쫓겨)/))) f.home_service_unusable = fact(true, m[0]);

  // 목표
  if ((m = t.match(/요양원|시설(에|로)?\s*(모시|입소|보내)|입소/))) f.goal = fact('facility', m[0]);
  else if ((m = t.match(/집에서\s*(계속\s*)?(모시|돌보)[^.]{0,6}(싶|려)/))) f.goal = fact('home', m[0]);

  // 보험·소득
  if ((m = t.match(/기초\s*(생활)?\s*수급|생계\s*급여|의료\s*급여\s*1\s*종/))) f.insurance = fact('medical_aid_basic', m[0]);
  else if ((m = t.match(/의료\s*급여/))) f.insurance = fact('medical_aid_other', m[0]);
  else if ((m = t.match(/건강\s*보험|피부양자|직장\s*보험/))) f.insurance = fact('health', m[0]);
  if ((m = t.match(/차상위|저소득/))) f.low_income = fact(true, m[0]);

  // 요양병원
  if ((m = t.match(/요양\s*병원(에|에서)?\s*(계|입원|있)/))) f.in_nursing_hospital = fact(true, m[0]);

  // 결과 불만·상태 변화·낙상
  if ((m = t.match(/말이\s*안\s*돼|억울|될\s*줄\s*알았|이의|너무\s*낮/))) f.dissatisfied_result = fact(true, m[0]);
  if ((m = t.match(/(요즘|최근|점점)[^.]{0,20}(나빠|심해|더\s*못|자꾸)/))) f.condition_worsened = fact(true, m[0]);


  // 조사 항목 (보호자 진술 기반 값 후보)
  const items: Record<string, string> = {}; const iev: string[] = [];
  for (const p of ITEM_PATTERNS) {
    const mm = p.re.exec(t);
    if (!mm) continue;
    const clause = clauseAround(t, mm.index, mm[0].length);
    if (p.kind === 'adl') {
      if (NEG.test(clause) || NEG.test(t.slice(mm.index, mm.index + 25))) items[p.id] = 'needs_help';
      else if (INDEP.test(clause)) items[p.id] = 'independent';
      else continue;
    } else if (p.kind === 'symptom') items[p.id] = 'yes';
    else items[p.id] = 'observe';
    iev.push(clause);
  }
  if (Object.keys(items).length) f.items = fact(items, iev.join(' / '));
  if (Object.keys(items).some((k) => k.startsWith('BEH-'))) f.behavior_problem = fact(true, iev.find((e) => /나가|길|밤|폭언|욕|때리|훔|헛|거부|불/.test(e)) ?? iev[0]);

  return f;
}

/** 원문 근거 검증: evidence 가 입력 문장에 실제로 있는지 (LLM 결과 검증에도 사용) */
export function evidenceInText(evidence: string, text: string): boolean {
  const norm = (s: string) => s.replace(/\s+/g, '');
  if (!evidence) return false;
  return evidence.split(/\s*[,/]\s*/).every((part) => !part || norm(text).includes(norm(part)));
}
