// 객관식 답변 → 조사 항목 값·사실(FactMap)·시설급여 사유 가능성. 자유 문장은 받지 않는다.
//
// 화면에서 저장하는 것은 '질문(step) ID → 고른 값' 뿐이다. expandAnswers() 가 이것을
// 조사 항목 값(PHY-01 등)·돌봄 정보(living 등)로 펼친다. 이미 펼친 키(테스트 픽스처 등)는 그대로 둔다.
import type { Kb, Step } from './kb.ts';
import type { Answers, Fact, FactMap, ItemValues } from './types.ts';
import type { AdlAnswer, DementiaAnswer } from './scoring.ts';

export const UNKNOWN = 'unknown';
const ITEM = /^(PHY|COG|BEH|NUR|REH)-\d\d$/;

export function isVisible(s: Step, a: Answers, all?: Step[]): boolean {
  if (s.gate) return a[s.gate] === 'yes';
  if (!s.when) return true;
  // 조건이 가리키는 질문이 지금 숨겨져 있으면 그 답은 없는 것으로 본다
  // (예: 65세 미만 때 고른 질병 답이 나이를 65세 이상으로 바꾼 뒤에도 남아 치매 질문을 가리던 문제)
  const dep = all?.find((x) => x.id === s.when!.q);
  const v = dep && !isVisible(dep, a, all) ? undefined : a[s.when.q];
  const val = typeof v === 'string' ? v : undefined;
  if (s.when.in) return val !== undefined && s.when.in.includes(val);
  if (s.when.notIn) return val === undefined || !s.when.notIn.includes(val);
  return true;
}

/** 지금 답변 기준으로 보여줄 질문 목록 (앞 질문의 답에 따라 달라짐) */
export function visibleSteps(kb: Kb, raw: Answers): Step[] {
  const a = expandAnswers(kb, raw);
  return kb.questionnaire.steps.filter((s) => isVisible(s, a, kb.questionnaire.steps));
}

export function isAnswered(s: Step, raw: Answers): boolean {
  const v = raw[s.id];
  if (s.type === 'chips') return Array.isArray(v) || v === UNKNOWN || !!otherText(raw, s.id);
  return typeof v === 'string' && v !== '';
}

/** 직접 적은 내용 (목록에 없는 것). 저장 키: `<질문 id>_other` */
export const otherKey = (stepId: string) => `${stepId}_other`;
export function otherText(raw: Answers, stepId: string): string {
  const v = raw[otherKey(stepId)];
  return typeof v === 'string' ? v.trim().slice(0, 300) : '';
}

/** 먼저 묻기(gate)가 있는 여러 개 고르기의 실제 값: 없어요 → [] / 잘 모르겠어요 → 모름 / 있어요 → 고른 목록 */
function gatedChips(s: Step, raw: Answers): string[] | typeof UNKNOWN | undefined {
  const v = raw[s.id];
  const g = s.gate ? raw[s.gate] : undefined;
  if (g === 'no') return [];
  if (g === UNKNOWN) return UNKNOWN;
  if (g === 'yes') return Array.isArray(v) ? v : v === UNKNOWN ? UNKNOWN : otherText(raw, s.id) ? [] : undefined;
  return Array.isArray(v) ? v : v === UNKNOWN ? UNKNOWN : undefined; // 먼저 묻기에 답하지 않은 예전 저장값·테스트 입력
}

/** 직접 적은 내용 목록 (결과의 '방문조사 때 말씀할 내용', 신청서 사유 예시에 그대로 표시) */
export function otherNotes(kb: Kb, raw: Answers): { stepId: string; title: string; text: string }[] {
  const out: { stepId: string; title: string; text: string }[] = [];
  const title: Record<string, string> = { nursing: '집에서 하는 의료 처치', memory: '기억력·판단력', behavior: '행동 변화' };
  for (const s of kb.questionnaire.steps) {
    if (s.type !== 'chips' || !s.other) continue;
    if (s.gate && raw[s.gate] !== 'yes') continue;
    const t = otherText(raw, s.id);
    if (t) out.push({ stepId: s.id, title: title[s.id] ?? s.text, text: t });
  }
  return out;
}

/** 질문 답 → 엔진 입력 (조사 항목 값·돌봄 정보 등) */
export function expandAnswers(kb: Kb, raw: Answers): Answers {
  const steps = kb.questionnaire.steps;
  const a: Answers = { ...kb.questionnaire.defaults, ...raw };
  delete (a as any)._note;
  // 원칙: 지금 보이지 않는 질문의 답은 계산에 쓰지 않는다 (답을 고친 이력과 무관하게 같은 결과가 나오도록)
  // 보호자가 직접 답한 값은 다른 질문의 sets 로 덮지 않는다 — 단, 그 질문이 지금 보일 때만
  const explicit = (k: string) => {
    if (raw[k] === undefined) return false;
    const st = steps.find((x) => x.id === k);
    return !st || isVisible(st, a, steps);
  };
  const filled = new Set<string>(); // 다른 질문의 sets 로 채운 키
  for (const s of steps) {
    if (!s.gate && s.when && !filled.has(s.id) && !isVisible(s, a, steps)) delete a[s.id]; // 숨겨진 질문의 옛 답 제거 (sets 로 채운 값은 유지)
    if (s.type === 'chips') {
      const itemChips = (s.options ?? []).every((o) => ITEM.test(o.value));
      if (!itemChips) continue; // 주거 문제처럼 항목이 아닌 체크는 값 목록 그대로 사용
      const v = gatedChips(s, raw);
      if (v === undefined) continue;
      for (const o of s.options ?? []) a[o.value] = v === UNKNOWN ? UNKNOWN : v.includes(o.value) ? 'yes' : 'no';
      continue;
    }
    const v = raw[s.id];
    if (v === undefined || !isVisible(s, a, steps)) continue;
    if (s.gate_for) continue; // 먼저 묻기 질문은 위 chips 처리에서 반영
    if (s.type === 'single') {
      if (v === UNKNOWN) {
        for (const o of s.options ?? []) for (const k of Object.keys(o.sets ?? {})) if (ITEM.test(k)) a[k] = UNKNOWN; else if (!explicit(k)) delete a[k];
        continue;
      }
      const opt = (s.options ?? []).find((o) => o.value === v);
      for (const [k, val] of Object.entries(opt?.sets ?? {})) if (!explicit(k) || ITEM.test(k)) { a[k] = val; filled.add(k); }
    }
  }
  return a;
}

/** 조사 항목 값 (65개). 신체·재활: '1'|'2'|'3', 체크: 'yes'|'no', 그 외/미응답 = null(잘 모름) */
export function itemValues(kb: Kb, a: Answers): ItemValues {
  const out: ItemValues = {};
  for (const it of kb.items) {
    const v = a[it.id];
    if (v === '1' || v === '2' || v === '3') out[it.id] = Number(v);
    else if (v === 'yes') out[it.id] = 1;
    else if (v === 'no') out[it.id] = 0;
    else out[it.id] = null;
  }
  return out;
}

export function dementiaAnswer(a: Answers): DementiaAnswer {
  const v = a.dementia;
  return v === 'diagnosed' || v === 'suspected' || v === 'none' ? v : 'unknown';
}
export function adlAnswer(a: Answers): AdlAnswer {
  const v = a.dem_adl;
  if (v === 'independent' || v === 'incomplete' || v === 'partial' || v === 'full') return v;
  // 치매 진단·의심이 없다고 답했으면 인지증 자립도 질문은 나오지 않는다 → '자립'으로 본다
  return a.dementia === 'none' ? 'independent' : 'unknown';
}

// ---------------------------------------------------------------- 시설급여 예외 사유 ①②③ 해당 가능성 (R-FAC-02)
export type Likelihood = 'high' | 'possible' | 'low' | 'unknown';
export const LIKELIHOOD_KO: Record<Likelihood, string> = { high: '해당 가능성 높음', possible: '해당 가능성 있음', low: '해당 가능성 낮음', unknown: '정보 부족' };
export interface FacilityReason { code: '①' | '②' | '③'; label: string; short: string; likelihood: Likelihood; why: string }

const LIVING_KO: Record<string, string> = { alone: '혼자 사심', elderly_only: '노인끼리 사심', minor_or_elderly_only: '미성년 손자녀와 사심', with_family: '가족과 함께 사심' };
const CAREGIVER_KO: Record<string, string> = { nobody: '돌봐 드릴 사람이 없음', elderly_spouse: '나이 드신 배우자가 돌봄', family_hard: '가족이 돌보기 어려움', ok: '가족이 충분히 돌봄' };

function optionLabel(kb: Kb, stepId: string, v: unknown): string | undefined {
  return kb.questionnaire.steps.find((s) => s.id === stepId)?.options?.find((o) => o.value === v)?.label;
}

export function facilityReasons(kb: Kb, a: Answers, values: ItemValues): FacilityReason[] {
  const H = kb.questionnaire.facility_reason_heuristics;
  const out: FacilityReason[] = [];

  // ① 주로 돌보는 가족이 돌보기 어려움
  {
    const cg = a.caregiver as string | undefined, lv = a.living as string | undefined;
    let lk: Likelihood = 'unknown';
    if ((cg && H.caregiver.high.caregiver.includes(cg)) || (lv && H.caregiver.high.living.includes(lv))) lk = 'high';
    else if ((cg && H.caregiver.possible.caregiver.includes(cg)) || (lv && H.caregiver.possible.living.includes(lv))) lk = 'possible';
    else if (cg && H.caregiver.low.caregiver.includes(cg)) lk = 'low';
    const why = optionLabel(kb, 'carer', a.carer) ?? [lv && LIVING_KO[lv], cg && CAREGIVER_KO[cg]].filter(Boolean).join(' · ');
    out.push({ code: '①', label: '주로 돌보는 가족이 돌보기 어려운 경우', short: '가족이 돌보기 어려움', likelihood: lk, why });
  }
  // ② 주거환경이 열악해 시설 입소가 불가피
  {
    const h = a.housing;
    let lk: Likelihood = 'unknown'; let why = '';
    if (Array.isArray(h)) {
      const opts = kb.questionnaire.steps.find((s) => s.id === 'housing')?.options ?? [];
      const picked = opts.filter((o) => h.includes(o.value));
      const key = picked.some((o) => o.key);
      lk = picked.length && ((H.housing.possible_if_key_issue && key) || picked.length >= H.housing.possible_if_count_at_least) ? 'possible' : 'low';
      why = picked.length ? picked.map((o) => o.label).join(', ') : '집에 큰 문제 없음';
    }
    out.push({ code: '②', label: '주거환경이 열악해 시설 입소가 불가피한 경우', short: '집 환경이 열악함', likelihood: lk, why });
  }
  // ③ 치매 등 문제행동으로 재가급여 이용 불가
  {
    const b = a.behavior_service as string | undefined;
    const sig = H.behavior.item_signal.items.filter((id) => values[id] === 1);
    const anyBehaviorAnswer = H.behavior.item_signal.items.some((id) => values[id] !== null);
    let lk: Likelihood = 'unknown'; const why: string[] = [];
    if (b && H.behavior.high.includes(b)) lk = 'high';
    else if (b && H.behavior.possible.includes(b)) lk = 'possible';
    else if (sig.length >= H.behavior.item_signal.possible_if_count_at_least) lk = 'possible';
    else if ((b && H.behavior.low.includes(b)) || anyBehaviorAnswer) lk = 'low';
    const bl = optionLabel(kb, 'behavior_service', b); if (bl) why.push(bl);
    if (sig.length) why.push(sig.map((id) => optionLabel(kb, 'behavior', id) ?? kb.itemById.get(id)!.official_item_name).join(', '));
    out.push({ code: '③', label: '치매 등에 따른 문제행동으로 재가급여를 이용할 수 없는 경우', short: '행동 문제로 집 돌봄이 어려움', likelihood: lk, why: why.join(' · ') });
  }
  return out;
}

// ---------------------------------------------------------------- 답변 → 사실 (판단 엔진 입력)
const f = <T,>(value: T, evidence: string): Fact<T> => ({ value, status: 'stated_by_guardian', evidence, source: 'answer' });

export function answersToFacts(kb: Kb, a: Answers, reasons: FacilityReason[]): FactMap {
  const facts: FactMap = {};
  const s = (k: string) => (typeof a[k] === 'string' && a[k] !== UNKNOWN ? (a[k] as string) : undefined);
  const date = (k: string) => { const v = s(k); return v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined; };

  if (s('age')) facts.age_over65 = f(s('age') === 'over65', s('age') === 'over65' ? '65세 이상' : '65세 미만');
  if (s('age') === 'under65' && s('disease')) {
    const opt = kb.questionnaire.steps.find((q) => q.id === 'disease')!.options!.find((o) => o.value === s('disease'))!;
    facts.diseases = f(opt.codes ?? [], opt.label);
    if (opt.codes?.length) facts.disease_label = f(opt.label.replace(/\s*\(.*\)$/, ''), opt.label);
  }
  if (s('insurance')) facts.insurance = f(s('insurance') as any, s('insurance')!);
  if (s('dementia')) facts.dementia = f(s('dementia') as any, s('dementia')!);

  const g = s('grade');
  if (g === 'none' || g === 'pending' || g === 'out_of_grade') facts.grade_status = f(g, g);
  else if (g) { facts.grade_status = f('graded', g); facts.grade = f(g === 'cognitive' ? 'cognitive' : (Number(g) as any), g); }
  if (s('facility_in_cert')) facts.facility_in_cert = f(s('facility_in_cert') === 'yes', s('facility_in_cert')!);
  if (date('validity_end')) facts.validity_end = f(date('validity_end')!, date('validity_end')!);
  if (date('applied_date')) facts.applied_date = f(date('applied_date')!, date('applied_date')!);
  if (date('notice_date')) facts.notice_date = f(date('notice_date')!, date('notice_date')!);
  if (s('dissatisfied') === 'yes') facts.dissatisfied_result = f(true, '결과가 낮다고 느낌');
  if (s('worsened') === 'yes') facts.condition_worsened = f(true, '상태가 많이 나빠짐');
  // 대리 신청 (가족·친족 또는 그 밖의 대리인). 본인 신청이면 대리신청 절차가 빠진다
  if (s('applicant') && s('applicant') !== 'self') facts.relation = f(s('applicant') === 'family' ? '가족' : '대리인', '대리인이 신청');
  if (s('home_services')) facts.current_home_services = f(s('home_services') === 'yes', s('home_services')!);
  if (s('hospital')) facts.in_nursing_hospital = f(s('hospital') === 'yes', s('hospital')!);

  if (s('living')) facts.living = f(s('living') as any, s('living')!);
  if (s('goal')) facts.goal = f(s('goal') as any, s('goal')!);
  const [r1, r2, r3] = reasons;
  if (r1.likelihood !== 'unknown') facts.caregiver_difficulty = f(r1.likelihood === 'high' || r1.likelihood === 'possible', r1.why);
  if (r2.likelihood !== 'unknown') facts.housing_poor = f(r2.likelihood === 'high' || r2.likelihood === 'possible', r2.why);
  if (r3.likelihood !== 'unknown') facts.behavior_problem = f(r3.likelihood === 'high' || r3.likelihood === 'possible', r3.why);

  const items: Record<string, string> = {};
  for (const id of ['PHY-07', 'PHY-08', 'PHY-09']) { const v = a[id]; if (v === '1') items[id] = 'independent'; else if (v === '2' || v === '3') items[id] = 'needs_help'; }
  facts.items = f(items, '신체기능 답변');
  return facts;
}
