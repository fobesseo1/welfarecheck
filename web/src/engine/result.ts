// 답변 → 결과 화면 모델. (채점 + 시설급여 판단 + 절차·서류 + 할 일 3가지 + 답 보완 안내) — UI 와 분리된 순수 함수
import type { Kb } from './kb.ts';
import { GRADE_KO, GRADE_RANK, DOMAINS, DOMAIN_KO, type Answers, type GradeCode, type ActionItem, type DocItem, type Domain } from './types.ts';
import { estimate, formatGradeRange, type Estimate } from './scoring.ts';
import { adlAnswer, answersToFacts, dementiaAnswer, expandAnswers, facilityReasons, itemValues, visibleSteps, isAnswered, otherNotes, otherText, UNKNOWN, type FacilityReason } from './answers.ts';
import { decide, type DecideOutput } from './decide.ts';
import { buildGuide, type Guide } from './guide.ts';

export const DISCLAIMER = '참고용 추정이에요. 장기요양등급과 급여는 국민건강보험공단(등급판정위원회)이 결정해요.';

export type Tone = 'good' | 'maybe' | 'wait' | 'no';
/** body: 한 줄 사실, detail: 펼쳐야 보이는 설명 */
export interface Verdict { tone: Tone; title: string; body: string; detail: string }
export type FacilityStatus = 'possible' | 'conditional' | 'not_possible';
export interface FacilityScenario { grades: GradeCode[]; label: string; status: FacilityStatus; text: string; detail?: string; rule_ids: string[] }
export interface FacilityView {
  basis: 'current_grade' | 'expected_grade';
  scenarios: FacilityScenario[];
  reasons: FacilityReason[];
  showReasons: boolean;
  rule_ids: string[];
}
/** 결과를 더 정확하게: 다시 볼 질문으로 바로 가는 안내 */
export interface Tip { kind: 'unknown' | 'boundary' | 'dementia' | 'check' | 'reason'; text: string; detail?: string; jump?: string }

export interface GuideResult {
  today: string;
  disclaimer: string;
  is_official_decision: false;
  verdict: Verdict;
  estimate: Estimate;
  domainTable: { domain: Domain; name: string; rawLow: number; rawHigh: number; convLow: number; convHigh: number; unknown: number; items: number }[];
  facility: FacilityView;
  gradeNote?: string;
  decide: DecideOutput;
  docsNow: DocItem[];
  docsLater: DocItem[];
  docsCheck: DocItem[];
  actions: ActionItem[];
  tips: Tip[];
  /** 보호자가 직접 적은 내용 (해석·점수 없음, 그대로 보여주기만) */
  notes: { stepId: string; title: string; text: string }[];
  /** 자세히 보기 칸들(접수 경로·서류·병원·방문조사·입소·상황별) */
  guide: Guide;
}

const hitReasons = (rs: FacilityReason[]) => rs.filter((r) => r.likelihood === 'high' || r.likelihood === 'possible');
const reasonSentence = (rs: FacilityReason[]) => {
  const hit = hitReasons(rs);
  if (hit.length) return `지금 답변으로는 ${hit.map((r) => `'${r.short}'`).join(', ')} 사유에 해당할 수 있어요.`;
  if (rs.every((r) => r.likelihood === 'unknown')) return '돌봄 환경을 알려주시면 해당 여부를 볼 수 있어요.';
  return '지금 답변으로는 해당하는 사유가 뚜렷하지 않아요.';
};

function scenariosFor(grades: GradeCode[], reasons: FacilityReason[]): FacilityScenario[] {
  const out: FacilityScenario[] = [];
  const top = grades.filter((x) => x === '1' || x === '2');
  const mid = grades.filter((x) => x === '3' || x === '4' || x === '5');
  if (top.length) out.push({ grades: top, label: formatGradeRange(top), status: 'possible', text: '바로 입소 가능', rule_ids: ['R-FAC-01'] });
  if (mid.length) out.push({ grades: mid, label: formatGradeRange(mid), status: 'conditional', text: '공단 인정이 있어야 가능', detail: `원칙은 집에서 받는 서비스(재가급여)만 돼요. 가족이 돌보기 어렵거나, 집 환경이 열악하거나, 행동 문제로 집 돌봄이 어렵다고 인정받으면 요양원도 돼요. ${reasonSentence(reasons)}`, rule_ids: ['R-FAC-02', 'R-CHANGE-01'] });
  if (grades.includes('cognitive')) out.push({ grades: ['cognitive'], label: GRADE_KO.cognitive, status: 'not_possible', text: '요양원 불가 · 주간보호 등 이용', rule_ids: ['R-FAC-03'] });
  if (grades.includes('none')) out.push({ grades: ['none'], label: GRADE_KO.none, status: 'not_possible', text: '장기요양 서비스 불가', detail: '결과가 이상하면 90일 안에 이의신청을 할 수 있어요.', rule_ids: ['R-FAC-04', 'R-APPEAL-01'] });
  return out;
}

function verdictFor(a: Answers, est: Estimate, reasons: FacilityReason[]): Verdict {
  const g = a.grade as string | undefined;
  const G = (x: string) => GRADE_KO[x as GradeCode];
  if (g === '1' || g === '2') return { tone: 'good', title: '요양원에 모실 수 있어요', body: `${G(g)}은 바로 입소할 수 있어요.`, detail: '자리가 있는 요양원을 찾아 상담하면 돼요.' };
  if ((g === '3' || g === '4' || g === '5') && a.facility_in_cert === 'yes') return { tone: 'good', title: '요양원에 모실 수 있어요', body: '인정서에 시설급여가 있어요.', detail: `${G(g)}이어도 인정서에 시설급여가 있으면 요양원을 이용할 수 있어요.` };
  if (g === '3' || g === '4' || g === '5') return { tone: 'maybe', title: '조건이 맞으면 모실 수 있어요', body: `${G(g)}은 공단 인정이 필요해요.`, detail: `공단에 '급여종류 변경'을 신청해 인정받으면 요양원을 이용할 수 있어요. ${reasonSentence(reasons)}` };
  if (g === 'cognitive') return { tone: 'no', title: '요양원은 이용할 수 없어요', body: '대신 주간보호·단기보호를 이용할 수 있어요.', detail: '인지지원등급은 요양원(시설급여)이 안 되고, 주간보호·단기보호·종일 방문요양·복지용구를 이용할 수 있어요. 상태가 나빠졌다면 등급 변경 신청을 할 수 있어요.' };

  // 등급 없음·판정 대기·등급외 → 예상 등급으로 전망
  const first = g === 'pending' ? '판정 결과가 나와야 요양원을 이용할 수 있어요.' : g === 'out_of_grade' ? '등급외 판정이라 지금은 요양원을 이용할 수 없어요.' : '요양원은 장기요양등급이 있어야 들어갈 수 있어요.';
  const gs = est.grades;
  const allTop = gs.every((x) => x === '1' || x === '2');
  const anyTop = gs.some((x) => x === '1' || x === '2');
  const anyMid = gs.some((x) => ['3', '4', '5'].includes(x));
  const allLow = gs.every((x) => x === 'none' || x === 'cognitive');
  const outlook = allTop ? '나오면 바로 입소 가능' : anyTop && anyMid ? '1·2등급이면 바로, 3~5등급이면 조건부' : anyMid ? '나오면 공단 인정이 있어야 가능' : allLow ? '요양원은 어려울 수 있어요' : '';
  const title = g === 'out_of_grade' ? '지금은 요양원을 이용할 수 없어요' : g === 'pending' ? '판정 결과를 기다려야 해요' : '먼저 등급을 받아야 해요';
  return { tone: allLow ? 'no' : 'wait', title, body: `예상 ${est.label}${outlook ? ` · ${outlook}` : ''}`, detail: `${first}${anyMid ? ' ' + reasonSentence(reasons) : ''}` };
}

/** 답을 보완하면 결과가 더 정확해지는 부분 (사실대로 빠짐없이 답하도록 돕는 안내 — 부풀리기 안내 아님) */
function tipsFor(kb: Kb, raw: Answers, a: Answers, est: Estimate, reasons: FacilityReason[], conditional: boolean): Tip[] {
  const tips: Tip[] = [];
  const steps = visibleSteps(kb, raw);

  // 1) 잘 모르겠어요 / 아직 안 한 질문
  const unknown = steps.filter((s) => s.type !== 'date' && (raw[s.id] === UNKNOWN || !isAnswered(s, raw)));
  for (const s of unknown.slice(0, 4)) tips.push({ kind: 'unknown', text: `'${s.text}' 를 확인해 주세요`, detail: '모르는 답은 가장 가벼운 경우부터 가장 무거운 경우까지 모두 계산해서 범위가 넓어져요.', jump: s.id });
  if (unknown.length > 4) tips.push({ kind: 'unknown', text: `그 밖에 모르는 질문 ${unknown.length - 4}개`, jump: unknown[4].id });

  // 2) 등급 경계
  if (est.grades.length >= 2 && !unknown.length) tips.push({ kind: 'boundary', text: `${est.label} 사이에 걸쳐 있어요`, detail: '몸 상태 답 하나로도 결과가 달라질 수 있어요. 잘하실 때가 아니라 평소 모습 기준으로 답했는지 다시 봐 주세요.', jump: 'b_wash' });

  // 3) 치매 진단
  const dem = a.dementia;
  if (est.gradesIfDiagnosed && est.gradesIfDiagnosed.label !== est.label) tips.push({ kind: 'dementia', text: `치매 진단이 있으면 ${est.gradesIfDiagnosed.label}까지 나올 수 있어요`, detail: '5등급·인지지원등급은 치매 진단이 있어야 나와요.', jump: 'dementia' });

  // 4) 빠뜨리기 쉬운 답
  // '없어요'(먼저 묻기) 또는 목록에서 하나도 안 고름 → 다시 볼 곳은 먼저 묻기 질문
  const empty = (id: string) => raw[id + '_gate'] === 'no' || (Array.isArray(raw[id]) && (raw[id] as string[]).length === 0 && !otherText(raw, id));
  const jumpTo = (id: string) => (raw[id + '_gate'] !== undefined ? id + '_gate' : id);
  if ((dem === 'diagnosed' || dem === 'suspected') && empty('memory')) tips.push({ kind: 'check', text: '치매가 있는데 기억력 변화를 없다고 하셨어요', detail: '가끔이라도 최근 한 달 안에 있었던 일은 골라 주세요.', jump: jumpTo('memory') });
  if ((dem === 'diagnosed' || dem === 'suspected') && empty('behavior')) tips.push({ kind: 'check', text: '밤에만 생기는 일도 넣었나요?', detail: '밤낮이 바뀜, 밤에 밖으로 나가려 함 같은 일도 행동 변화에 들어가요.', jump: jumpTo('behavior') });
  if ((raw.b_move === '4' || raw.b_move === '3') && empty('nursing')) tips.push({ kind: 'check', text: '누워 지내시면 욕창·소변줄 같은 처치가 있는지 다시 봐 주세요', jump: jumpTo('nursing') });

  // 5) 요양원 인정 사유 (3~5등급)
  if (conditional) {
    for (const r of reasons) {
      if (r.likelihood === 'high' || r.likelihood === 'possible') tips.push({ kind: 'reason', text: `'${r.short}' 은 변경신청서에 구체적으로 적으세요`, detail: kb.questionnaire.reason_writing[r.code] });
      else if (r.likelihood === 'unknown') tips.push({ kind: 'reason', text: `'${r.short}' 에 해당하는지 아직 몰라요`, jump: r.code === '②' ? 'housing' : r.code === '③' ? jumpTo('behavior') : 'carer' });
      else if (r.code === '②' && Array.isArray(a.housing) && (a.housing as string[]).length) tips.push({ kind: 'reason', text: '집 문제를 빠뜨리지 않았는지 다시 봐 주세요', detail: '난방·화장실·온수처럼 생활에 꼭 필요한 부분의 문제는 모두 골라 주세요.', jump: 'housing' });
    }
  }
  return tips;
}

export function buildResult(kb: Kb, raw: Answers, today: string): GuideResult {
  const a = expandAnswers(kb, raw);
  const values = itemValues(kb, a);
  const est = estimate(kb, { values, dementia: dementiaAnswer(a), adl: adlAnswer(a) });
  const reasons = facilityReasons(kb, a, values);
  const facts = answersToFacts(kb, a, reasons);
  const dec = decide(kb, facts, today);

  const g = a.grade as string | undefined;
  const graded = !!g && ['1', '2', '3', '4', '5', 'cognitive'].includes(g);
  const scenarios = graded ? [] : scenariosFor(est.grades, reasons);
  const conditional = graded ? ['3', '4', '5'].includes(g!) && a.facility_in_cert !== 'yes' : scenarios.some((s) => s.status === 'conditional');
  const C = dec.decisions.find((d) => d.id === 'C')!;
  const facility: FacilityView = {
    basis: graded ? 'current_grade' : 'expected_grade', scenarios, reasons, showReasons: conditional,
    rule_ids: [...new Set([...C.rule_ids, ...scenarios.flatMap((s) => s.rule_ids)])],
  };

  let gradeNote: string | undefined;
  if (graded) {
    const cur = GRADE_RANK[g as GradeCode];
    if (est.grades.every((x) => GRADE_RANK[x] > cur)) gradeNote = `지금 등급보다 무거운 ${est.label}이 예상돼요. 상태가 나빠졌다면 등급 변경 신청을 해 보세요.`;
  } else if (g === 'out_of_grade' && est.grades.some((x) => x !== 'none')) {
    gradeNote = `답변으로는 ${est.label}이 예상돼요. 결과가 실제와 다르면 이의신청(90일 이내)이나 재신청을 할 수 있어요.`;
  }

  const ds = est.scenarios;
  const domainTable = DOMAINS.map((d) => ({ domain: d, name: DOMAIN_KO[d], rawLow: ds.best.domains[d].raw, rawHigh: ds.worst.domains[d].raw, convLow: ds.best.domains[d].conv, convHigh: ds.worst.domains[d].conv, unknown: ds.best.domains[d].unknown, items: ds.best.domains[d].items }));

  const verdict = verdictFor(a, est, reasons);
  return {
    today, disclaimer: DISCLAIMER, is_official_decision: false,
    verdict,
    estimate: est, domainTable, facility, gradeNote, decide: dec,
    docsNow: dec.documents.filter((d) => d.when === 'now' && !d.display_rule),
    docsLater: dec.documents.filter((d) => d.when === 'later' && !d.display_rule),
    docsCheck: dec.documents.filter((d) => d.display_rule),
    actions: dec.actions,
    tips: tipsFor(kb, raw, a, est, reasons, conditional),
    notes: otherNotes(kb, raw),
    guide: buildGuide(kb, kb.guide, raw, a, dec, verdict.tone),
  };
}
