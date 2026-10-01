// B. 상담 및 추가 질문 엔진
// 이미 확보된 사실과 판단 결과를 보고, 판단을 바꿀 수 있는 '부족한 정보'만 골라 묻는다.
// 한 번에 최대 2개, 우선순위 순. "모르겠어요" 답은 기록하고 다시 묻지 않는다.
import type { Fact, FactMap, Question } from '../types.ts';

type Opt = { label: string; value: string };
interface QDef {
  id: string; slot: string; text: string; why: string; priority: number;
  options: Opt[]; input?: 'date' | 'number' | 'multi';
  relevant: (f: FactMap) => boolean;
  apply: (f: FactMap, value: string) => FactMap;
}

const now = () => new Date().toISOString();
const has = (f: FactMap, k: string) => f[k] !== undefined;
const val = (f: FactMap, k: string) => f[k]?.value as any;
function set<T>(f: FactMap, k: string, value: T, evidence: string, status: Fact['status'] = 'stated_by_guardian'): FactMap {
  return { ...f, [k]: { value, status, evidence, source: 'answer', updatedAt: now() } };
}
const graded = (f: FactMap) => val(f, 'grade_status') === 'graded';
const mid = (f: FactMap) => [3, 4, 5].includes(val(f, 'grade'));
const applying = (f: FactMap) => ['none', 'pending', 'out_of_grade'].includes(val(f, 'grade_status'));
const wantsFacility = (f: FactMap) => val(f, 'goal') === 'facility';
const facilityContext = (f: FactMap) => graded(f) && mid(f) && wantsFacility(f) && val(f, 'facility_in_cert') !== true;
const UNKNOWN = '__unknown__';
const U: Opt = { label: '잘 모르겠어요', value: UNKNOWN };

export const QUESTIONS: QDef[] = [
  {
    id: 'Q-GRADE', slot: 'grade_status', priority: 1, why: '등급이 있는지에 따라 안내가 완전히 달라져요',
    text: '장기요양등급을 이미 받으셨나요? 우편으로 받은 "장기요양인정서"가 있으면 거기 적혀 있어요.',
    options: [
      { label: '아직 없어요', value: 'none' }, { label: '신청하고 결과 기다리는 중', value: 'pending' },
      { label: '1등급', value: '1' }, { label: '2등급', value: '2' }, { label: '3등급', value: '3' }, { label: '4등급', value: '4' }, { label: '5등급', value: '5' },
      { label: '인지지원등급', value: 'cognitive' }, { label: '등급외 판정', value: 'out_of_grade' }, U,
    ],
    relevant: (f) => !has(f, 'grade_status'),
    apply: (f, v) => {
      if (['none', 'pending', 'out_of_grade'].includes(v)) return set(f, 'grade_status', v, `보호자 답변: ${v}`);
      const g = v === 'cognitive' ? 'cognitive' : Number(v);
      return set(set(f, 'grade_status', 'graded', `보호자 답변: ${v}등급`), 'grade', g, `보호자 답변: ${v === 'cognitive' ? '인지지원' : v}등급`);
    },
  },
  {
    id: 'Q-AGE', slot: 'age', priority: 2, why: '65세 이상인지에 따라 신청 조건이 달라져요', input: 'number',
    text: '연세가 어떻게 되세요? 정확히 모르시면 65세 이상인지만 골라 주세요.',
    options: [{ label: '65세 이상', value: 'over' }, { label: '65세 미만', value: 'under' }, U],
    relevant: (f) => !has(f, 'age') && !has(f, 'age_over65') && !graded(f) && val(f, 'grade_status') !== 'pending',
    apply: (f, v) => {
      if (v === 'over') return set(f, 'age_over65', true, '보호자 답변: 65세 이상');
      if (v === 'under') return set(f, 'age_over65', false, '보호자 답변: 65세 미만');
      const n = Number(v); return Number.isFinite(n) && n > 0 ? set(f, 'age', n, `보호자 답변: ${n}세`) : f;
    },
  },
  {
    id: 'Q-DISEASE', slot: 'diseases', priority: 2, why: '65세 미만은 노인성 질병 진단이 있어야 신청할 수 있어요',
    text: '병원에서 진단받은 병이 있나요? 해당하는 것을 골라 주세요.',
    options: [
      { label: '치매·알츠하이머', value: 'F03' }, { label: '뇌경색·뇌출혈·중풍 등 뇌혈관질환', value: 'I67' },
      { label: '파킨슨병', value: 'G20' }, { label: '위에 해당하는 진단 없음', value: 'none' }, U,
    ],
    relevant: (f) => (val(f, 'age') !== undefined ? val(f, 'age') < 65 : val(f, 'age_over65') === false) && !has(f, 'diseases') && applying(f),
    apply: (f, v) => (v === 'none' ? set(f, 'diseases', [], '보호자 답변: 노인성 질병 진단 없음') : set(f, 'diseases', [v], `보호자 선택: ${v} 계열 진단(진단서로 확인 필요)`)),
  },
  {
    id: 'Q-INSURANCE', slot: 'insurance', priority: 3, why: '신청 자격과 본인부담(면제·감경) 확인에 필요해요',
    text: '건강보험을 이용하세요, 아니면 의료급여(기초생활수급 등)를 받으세요?',
    options: [
      { label: '건강보험 (본인 또는 자녀 피부양자)', value: 'health' }, { label: '의료급여 – 기초생활수급자', value: 'medical_aid_basic' },
      { label: '의료급여 – 그 밖의 경우', value: 'medical_aid_other' }, U,
    ],
    relevant: (f) => !has(f, 'insurance') && (applying(f) || !has(f, 'grade_status') || (wantsFacility(f) && graded(f))),
    apply: (f, v) => set(f, 'insurance', v, `보호자 답변: ${v}`),
  },
  {
    id: 'Q-DEMENTIA-DX', slot: 'dementia', priority: 3, why: '5등급·인지지원등급은 치매 진단이 있어야 받을 수 있어요',
    text: '병원에서 치매 진단을 받으셨나요?',
    options: [{ label: '네, 진단받았어요', value: 'diagnosed' }, { label: '의심되지만 아직 진단 전이에요', value: 'suspected' }, { label: '치매는 아니에요', value: 'none' }, U],
    relevant: (f) => !graded(f) && (val(f, 'dementia') === 'suspected' || (!has(f, 'dementia') && Object.keys(val(f, 'items') ?? {}).some((k) => k.startsWith('COG-')))),
    apply: (f, v) => {
      let g = set(f, 'dementia', v, `보호자 답변: ${v}`);
      if (v === 'diagnosed') g = set(g, 'diseases', [...new Set([...(val(g, 'diseases') ?? []), 'F03'])], '보호자 답변: 치매 진단');
      return g;
    },
  },
  {
    id: 'Q-GOAL', slot: 'goal', priority: 3, why: '요양원을 원하시는지에 따라 필요한 절차가 달라져요',
    text: '요양원 입소를 생각하세요, 아니면 집에서 도움받는 방법을 먼저 알고 싶으세요?',
    options: [{ label: '요양원 입소', value: 'facility' }, { label: '집에서 도움받기', value: 'home' }, { label: '아직 모르겠어요, 둘 다 알려주세요', value: 'info' }],
    relevant: (f) => !has(f, 'goal') && graded(f) && val(f, 'grade') !== 'cognitive',
    apply: (f, v) => set(f, 'goal', v, `보호자 답변: ${v}`),
  },
  {
    id: 'Q-FAC-CERT', slot: 'facility_in_cert', priority: 4, why: '3~5등급은 인정서에 시설급여가 있어야 요양원을 바로 이용할 수 있어요',
    text: '장기요양인정서의 "장기요양급여 종류"에 시설급여가 적혀 있나요?',
    options: [{ label: '시설급여가 적혀 있어요', value: 'yes' }, { label: '재가급여만 적혀 있어요', value: 'no' }, U],
    relevant: (f) => graded(f) && mid(f) && wantsFacility(f) && !has(f, 'facility_in_cert'),
    apply: (f, v) => set(f, 'facility_in_cert', v === 'yes', `보호자 답변(인정서 확인): ${v === 'yes' ? '시설급여 있음' : '재가급여만'}`, 'confirmed_by_document'),
  },
  {
    id: 'Q-CAREGIVER', slot: 'caregiver_difficulty', priority: 4, why: '가족이 돌보기 어려운 사정은 요양원 이용 인정 사유예요',
    text: '지금 주로 누가 돌보고 계세요? 계속 돌보기 어려운 사정이 있나요?',
    options: [
      { label: '혼자 사셔서 돌볼 가족이 없어요', value: 'alone' }, { label: '나이 드신 배우자 혼자 돌보세요', value: 'elderly' },
      { label: '가족이 돌보지만 일·건강 때문에 어려워요', value: 'hard' }, { label: '가족이 충분히 돌볼 수 있어요', value: 'ok' }, U,
    ],
    relevant: (f) => facilityContext(f) && !has(f, 'caregiver_difficulty') && !['alone', 'elderly_only'].includes(val(f, 'living')),
    apply: (f, v) => {
      if (v === 'alone') return set(set(f, 'living', 'alone', '보호자 답변: 혼자 사심'), 'caregiver_difficulty', true, '보호자 답변: 돌볼 가족 없음');
      if (v === 'elderly') return set(set(f, 'living', 'elderly_only', '보호자 답변: 고령 배우자만'), 'caregiver_difficulty', true, '보호자 답변: 고령 배우자 혼자 돌봄');
      if (v === 'hard') return set(f, 'caregiver_difficulty', true, '보호자 답변: 가족 돌봄 어려움');
      if (v === 'ok') return set(f, 'caregiver_difficulty', false, '보호자 답변: 가족 돌봄 가능');
      return f;
    },
  },
  {
    id: 'Q-BEHAVIOR', slot: 'behavior_problem', priority: 5, why: '치매 등 문제행동으로 재가급여를 쓰기 어려운 것도 요양원 이용 인정 사유예요',
    text: '밖으로 나가려 하시거나, 길을 잃거나, 화를 내며 거부하시는 행동 때문에 방문요양·주간보호를 이용하기 어려우신가요?',
    options: [{ label: '네, 그래요', value: 'yes' }, { label: '아니요', value: 'no' }, U],
    relevant: (f) => facilityContext(f) && !has(f, 'behavior_problem'),
    apply: (f, v) => (v === UNKNOWN ? f : set(f, 'behavior_problem', v === 'yes', `보호자 답변: 문제행동 ${v === 'yes' ? '있음' : '없음'}`)),
  },
  {
    id: 'Q-HOUSING', slot: 'housing_poor', priority: 6, why: '주거환경이 열악한 것도 요양원 이용 인정 사유예요',
    text: '집이 계단이 많거나 난방·화장실·온수 등이 불편해서 지내시기 어려운 환경인가요?',
    options: [{ label: '네, 어려워요', value: 'yes' }, { label: '아니요', value: 'no' }, U],
    relevant: (f) => facilityContext(f) && !has(f, 'housing_poor'),
    apply: (f, v) => (v === UNKNOWN ? f : set(f, 'housing_poor', v === 'yes', `보호자 답변: 주거환경 ${v === 'yes' ? '열악' : '양호'}`)),
  },
  {
    id: 'Q-LIVING', slot: 'living', priority: 4, why: '같이 사는 가족이 없으면 신청한 날부터 급여를 받을 수 있어요',
    text: '지금 누구와 함께 사세요?',
    options: [
      { label: '혼자 사세요', value: 'alone' }, { label: '65세 이상 배우자 등 노인끼리만 사세요', value: 'elderly_only' },
      { label: '미성년 손자녀와 사세요', value: 'minor_or_elderly_only' }, { label: '다른 가족과 함께 사세요', value: 'with_family' }, U,
    ],
    relevant: (f) => ['none', 'pending'].includes(val(f, 'grade_status')) && !has(f, 'living'),
    apply: (f, v) => (v === UNKNOWN ? f : set(f, 'living', v, `보호자 답변: ${v}`)),
  },
  {
    id: 'Q-VALIDITY', slot: 'validity_end', priority: 5, why: '갱신 신청 기간(만료 90일 전~30일 전)을 계산해 드려요', input: 'date',
    text: '인정서에 적힌 유효기간이 언제까지인가요? (예: 2027-08-31)',
    options: [U],
    relevant: (f) => graded(f) && !has(f, 'validity_end'),
    apply: (f, v) => (/^\d{4}-\d{2}-\d{2}$/.test(v) ? set(f, 'validity_end', v, `보호자 답변(인정서): ${v}`, 'confirmed_by_document') : f),
  },
  {
    id: 'Q-NOTICE', slot: 'notice_date', priority: 2, why: '이의신청 기한(안 날부터 90일)을 계산해 드려요', input: 'date',
    text: '판정 결과 통지서를 받은 날이 언제예요? (예: 2026-10-01)',
    options: [U],
    relevant: (f) => (val(f, 'grade_status') === 'out_of_grade' || (graded(f) && val(f, 'dissatisfied_result') === true)) && !has(f, 'notice_date'),
    apply: (f, v) => (/^\d{4}-\d{2}-\d{2}$/.test(v) ? set(f, 'notice_date', v, `보호자 답변: ${v}`) : f),
  },
  {
    id: 'Q-APPLIED', slot: 'applied_date', priority: 5, why: '판정 예정일(신청일부터 30일)을 계산해 드려요', input: 'date',
    text: '신청한 날이 언제예요? (예: 2026-09-10)',
    options: [U],
    relevant: (f) => val(f, 'grade_status') === 'pending' && !has(f, 'applied_date'),
    apply: (f, v) => (/^\d{4}-\d{2}-\d{2}$/.test(v) ? set(f, 'applied_date', v, `보호자 답변: ${v}`) : f),
  },
  {
    id: 'Q-ADL', slot: 'items', priority: 6, why: '방문조사에서 확인하는 항목을 미리 정리해 드려요', input: 'multi',
    text: '혼자 하기 어려워하시는 일을 모두 골라 주세요.',
    options: [
      { label: '화장실 가기', value: 'PHY-10' }, { label: '옷 갈아입기', value: 'PHY-01' }, { label: '목욕', value: 'PHY-04' },
      { label: '식사', value: 'PHY-05' }, { label: '일어나 앉기', value: 'PHY-07' }, { label: '방 밖으로 나오기·이동', value: 'PHY-09' },
      { label: '대소변 실수', value: 'PHY-12' }, { label: '없어요', value: 'none' }, U,
    ],
    relevant: (f) => applying(f) && Object.keys(val(f, 'items') ?? {}).filter((k) => k.startsWith('PHY-')).length < 2,
    apply: (f, v) => {
      if (v === UNKNOWN) return f;
      const items = { ...(val(f, 'items') ?? {}) };
      const picked = v.split(',').filter(Boolean);
      if (picked.includes('none')) for (const id of ['PHY-10', 'PHY-01', 'PHY-04', 'PHY-05', 'PHY-07', 'PHY-09']) items[id] ??= 'independent';
      else for (const id of picked) items[id] = 'needs_help';
      return set(f, 'items', items, `보호자 선택: ${v}`);
    },
  },
  {
    id: 'Q-WORSENED', slot: 'condition_worsened', priority: 7, why: '상태가 나빠졌다면 등급 변경 신청을 할 수 있어요',
    text: '지난 판정 이후 상태가 많이 나빠지셨나요?',
    options: [{ label: '네, 많이 나빠지셨어요', value: 'yes' }, { label: '아니요, 비슷해요', value: 'no' }, U],
    relevant: (f) => graded(f) && val(f, 'grade') !== 1 && !has(f, 'condition_worsened') && (val(f, 'dissatisfied_result') === true || (facilityContext(f) && val(f, 'caregiver_difficulty') === false)),
    apply: (f, v) => (v === UNKNOWN ? f : set(f, 'condition_worsened', v === 'yes', `보호자 답변: 상태 악화 ${v}`)),
  },
];

export function nextQuestions(facts: FactMap, answered: Record<string, string>, max = 2): Question[] {
  return QUESTIONS
    .filter((q) => !(q.id in answered) && q.relevant(facts))
    .sort((a, b) => a.priority - b.priority)
    .slice(0, max)
    .map((q) => ({ id: q.id, text: q.text, slot: q.slot, options: q.options, why: q.why, input: q.input } as Question));
}

export function applyAnswer(facts: FactMap, questionId: string, value: string): FactMap {
  const q = QUESTIONS.find((x) => x.id === questionId);
  if (!q) throw new Error(`[questions] 알 수 없는 질문 ${questionId}`);
  if (value === UNKNOWN) return facts;
  return q.apply(facts, value);
}

export { UNKNOWN };
