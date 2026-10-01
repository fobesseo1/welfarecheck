// 공식 판단 규칙 엔진 + 개인별 서류·절차 생성 (app/src/engine/decide.ts 이식)
// 모든 판단은 legal_rules.json 의 규칙 ID 에 연결되고, OFFICIAL_VERIFIED 가 아닌 규칙은 자동 판단에서 제외하고 추적(trace)에 남긴다.
// 이식하며 바뀐 점: 입력이 객관식 답변에서 만든 사실(FactMap)이고, 자유문장용 응급 신호 분기는 없다.
import type { Kb } from './kb.ts';
import type { ActionItem, Decision, DocItem, FactMap, ResultCode, TraceEntry } from './types.ts';

export interface DecideOutput {
  decisions: Decision[];
  situations: string[];
  procedures: { id: string; title: string; steps: { id: string; text: string; rules: string[] }[] }[];
  documents: DocItem[];
  excluded_documents: { id: string; name: string; reason: string }[];
  actions: ActionItem[];
  all_actions: ActionItem[];
  trace: TraceEntry[];
}

const DAY = 86400000;
export const FIELD_KO: Record<string, string> = { age: '나이', insurance: '건강보험/의료급여 여부', diseases: '진단받은 병명', grade_status: '등급 보유 여부', grade: '등급', validity_end: '인정서 유효기간', facility_in_cert: '인정서의 시설급여 포함 여부', caregiver_difficulty: '가족이 돌보기 어려운 사정', housing_poor: '주거환경', behavior_problem: '문제행동 여부', applied_date: '신청일', notice_date: '결과 통지일' };
const toDate = (s: string) => new Date(s + 'T00:00:00Z');
export const addDays = (s: string, n: number) => new Date(toDate(s).getTime() + n * DAY).toISOString().slice(0, 10);
export const diffDays = (a: string, b: string) => Math.round((toDate(a).getTime() - toDate(b).getTime()) / DAY);
const v = <T,>(f: FactMap, k: string): T | undefined => (f[k] ? (f[k]!.value as T) : undefined);

class Ctx {
  trace: TraceEntry[] = [];
  kb: Kb;
  constructor(kb: Kb) { this.kb = kb; }
  log(step: string, detail: string, rule?: string, level: TraceEntry['level'] = 'info') { this.trace.push({ step, rule, detail, level }); }
  use(step: string, ids: string[]): string[] {
    const ok: string[] = [];
    for (const id of ids) {
      try {
        if (this.kb.usable(id)) ok.push(id);
        else this.log(step, `규칙 ${id} 는 검증 상태가 ${this.kb.rule(id).verification_status} 라서 자동 판단에서 제외`, id, 'warn');
      } catch (e) { this.log(step, (e as Error).message, id, 'error'); }
    }
    return ok;
  }
  decision(d: Omit<Decision, 'sources'>): Decision {
    const rule_ids = this.use(d.id, d.rule_ids);
    let result: ResultCode = d.result;
    if (rule_ids.length < d.rule_ids.length && (result === 'MET' || result === 'NOT_ELIGIBLE')) result = 'NEEDS_EXPERT';
    const dec = { ...d, result, rule_ids, sources: this.kb.refs(rule_ids) };
    this.log(d.id, `${d.title} → ${result} (${d.summary})`, rule_ids.join(','));
    return dec;
  }
}

export function decide(kb: Kb, facts: FactMap, today: string): DecideOutput {
  const c = new Ctx(kb);
  const decisions: Decision[] = [];
  const situations = new Set<string>();

  const over65 = v<boolean>(facts, 'age_over65');
  const insurance = v<string>(facts, 'insurance');
  const gradeStatus = v<string>(facts, 'grade_status');
  const grade = v<number | 'cognitive'>(facts, 'grade');
  const diseases = v<string[]>(facts, 'diseases');
  const goal = v<string>(facts, 'goal');
  const living = v<string>(facts, 'living');
  const dementia = v<string>(facts, 'dementia');

  // ---------- A. 신청 자격 ----------
  {
    const missing: string[] = []; const next: string[] = [];
    let result: ResultCode; let summary: string;
    const rules = ['R-ELIG-01'];
    if (gradeStatus === 'graded' || gradeStatus === 'pending') {
      result = 'MET'; summary = gradeStatus === 'graded' ? '이미 장기요양등급을 받은 수급자예요.' : '이미 신청해서 판정을 기다리는 중이에요.';
    } else if (over65 === undefined) {
      result = 'NEEDS_CHECK'; summary = '나이를 알아야 신청 대상인지 확인할 수 있어요.'; missing.push('age');
    } else if (over65) {
      if (!insurance) { result = 'NEEDS_CHECK'; summary = '65세 이상이라 나이 조건은 충족해요. 건강보험 또는 의료급여 가입 여부만 확인하면 돼요.'; missing.push('insurance'); }
      else { result = 'MET'; summary = '65세 이상이고 건강보험(또는 의료급여) 가입자라 신청할 수 있어요.'; }
    } else {
      rules.push('R-ELIG-02');
      const norm = (x: string) => x.replace('*', '');
      const known = (diseases ?? []).filter((code) => c.kb.diseases.some((d) => norm(d.code) === norm(code)));
      if (known.length) {
        result = insurance ? 'MET' : 'NEEDS_CHECK';
        if (!insurance) missing.push('insurance');
        summary = `65세 미만이지만 법에 정한 노인성 질병(${v<string>(facts, 'disease_label') ?? '목록 질병'})이 있어 신청할 수 있어요. 진단서나 의사소견서로 공단이 확인해요.`;
      } else if (diseases && diseases.length === 0) {
        result = 'NOT_ELIGIBLE'; summary = '65세 미만은 치매·뇌혈관질환·파킨슨병 등 노인성 질병이 있어야 신청할 수 있어요. 지금 답변으로는 해당하지 않아요.';
        next.push('담당 의사에게 진단명 전체를 확인하세요.');
      } else {
        result = 'NEEDS_CHECK'; summary = '65세 미만은 노인성 질병 진단이 있어야 신청할 수 있어요. 진단받은 병명을 확인해 주세요.'; missing.push('diseases');
      }
    }
    decisions.push(c.decision({ id: 'A', title: '장기요양인정 신청 대상', result, summary, rule_ids: rules, inputs_used: { age_over65: over65, insurance, diseases, grade_status: gradeStatus }, missing, next_actions: next }));
  }
  const A = decisions[0];

  // ---------- B. 현재 등급·유효기간 ----------
  let renewal: { start: string; end: string; days: number } | null = null;
  let appealDeadline: string | null = null;
  {
    const missing: string[] = []; let result: ResultCode; let summary: string; const rules = ['R-FAC-04']; const data: Record<string, unknown> = {};
    if (!gradeStatus) { result = 'NEEDS_CHECK'; summary = '장기요양등급을 이미 받으셨는지 확인이 필요해요.'; missing.push('grade_status'); }
    else if (gradeStatus === 'none') {
      rules.push('R-APPLY-01');
      if (A.result === 'NOT_ELIGIBLE') { result = 'NOT_ELIGIBLE'; summary = '등급이 없고, 지금 답변으로는 신청 대상이 아닐 수 있어요.'; }
      else { result = 'PROCEDURE_REQUIRED'; summary = '아직 등급이 없어요. 먼저 장기요양인정 신청을 해야 해요.'; situations.add('PROC-INITIAL'); }
    } else if (gradeStatus === 'pending') {
      rules.push('R-PROC-01'); result = 'PROCEDURE_REQUIRED';
      const applied = v<string>(facts, 'applied_date');
      if (applied) { data.decision_due = addDays(applied, 30); data.decision_due_extended = addDays(applied, 60); summary = `신청 후 판정을 기다리는 중이에요. 신청일부터 30일(${data.decision_due})까지 판정해야 하고, 늦어지면 최대 30일 연장될 수 있어요.`; }
      else { summary = '신청 후 판정을 기다리는 중이에요. 신청일부터 30일 안에 판정해야 해요.'; missing.push('applied_date'); }
      situations.add('PROC-PENDING');
    } else if (gradeStatus === 'out_of_grade') {
      rules.push('R-APPEAL-01'); result = 'NOT_ELIGIBLE';
      const notice = v<string>(facts, 'notice_date');
      if (notice) { appealDeadline = addDays(notice, 90); data.appeal_deadline = appealDeadline; summary = `등급외 판정을 받으셨어요. 이의신청(심사청구)은 처분을 안 날부터 90일, 즉 ${appealDeadline}까지 할 수 있어요(처분일부터 180일이 지나면 불가).`; }
      else { summary = '등급외 판정을 받으셨어요. 이의신청(심사청구)은 처분을 안 날부터 90일 안에 해야 해요.'; missing.push('notice_date'); }
      situations.add('PROC-APPEAL');
      if (v<boolean>(facts, 'condition_worsened')) situations.add('PROC-INITIAL');
    } else {
      rules.push('R-VALID-01', 'R-VALID-02');
      const end = v<string>(facts, 'validity_end');
      if (!end) { result = 'MET'; summary = `${grade === 'cognitive' ? '인지지원' : grade}등급을 받으셨어요. 인정서의 유효기간을 확인해 주세요.`; missing.push('validity_end'); }
      else {
        const days = diffDays(end, today);
        const start = addDays(end, -90); const last = addDays(end, -30);
        renewal = { start, end: last, days }; data.validity_end = end; data.renewal_window = [start, last]; data.days_left = days;
        if (days < 0) { result = 'NEEDS_EXPERT'; summary = `유효기간(${end})이 이미 지났어요. 다시 급여를 받으려면 공단에 신청 방법을 바로 문의하세요.`; }
        else if (days <= 30) { result = 'NEEDS_EXPERT'; summary = `유효기간(${end})이 ${days}일 남았어요. 갱신 신청은 만료 30일 전까지 마쳐야 해서 기한이 지났거나 촉박해요. 바로 공단에 문의하세요.`; situations.add('PROC-RENEWAL'); }
        else if (days <= 90) { result = 'PROCEDURE_REQUIRED'; summary = `유효기간이 ${end}까지예요. 지금이 갱신 신청 기간(${start} ~ ${last})이에요.`; situations.add('PROC-RENEWAL'); }
        else { result = 'MET'; summary = `유효기간이 ${end}까지 남아 있어요. 갱신 신청은 ${start}부터 ${last}까지 하면 돼요.`; }
      }
      if (v<boolean>(facts, 'dissatisfied_result')) {
        rules.push('R-APPEAL-01'); situations.add('PROC-APPEAL');
        const notice = v<string>(facts, 'notice_date');
        if (notice) { appealDeadline = addDays(notice, 90); data.appeal_deadline = appealDeadline; }
        else missing.push('notice_date');
      }
      if (v<boolean>(facts, 'condition_worsened') && grade !== 1) { rules.push('R-CHANGE-01'); situations.add('PROC-CHANGE-GRADE'); }
    }
    decisions.push(c.decision({ id: 'B', title: '현재 등급과 유효기간', result: result!, summary: summary!, rule_ids: rules, inputs_used: { grade_status: gradeStatus, grade, validity_end: v(facts, 'validity_end') }, missing, next_actions: [], data }));
  }

  // ---------- C. 시설급여(요양원) 이용 가능 여부 ----------
  let C: Decision;
  {
    const missing: string[] = []; let result: ResultCode; let summary: string; const rules: string[] = [];
    const inHospital = v<boolean>(facts, 'in_nursing_hospital');
    if (gradeStatus !== 'graded') {
      rules.push('R-FAC-04', 'R-FAC-01', 'R-FAC-02', 'R-FAC-03');
      result = gradeStatus ? 'NOT_ELIGIBLE' : 'NEEDS_CHECK';
      summary = '요양원은 장기요양등급이 있어야 이용할 수 있어요. 등급을 받으면 1·2등급은 바로, 3~5등급은 위원회 인정을 받으면 이용할 수 있고, 인지지원등급은 이용할 수 없어요.';
      if (!gradeStatus) missing.push('grade_status');
    } else if (grade === 1 || grade === 2) {
      rules.push('R-FAC-01'); result = 'MET'; summary = `${grade}등급이라 요양원(시설급여)을 이용할 수 있어요. 어느 요양원에 자리가 있는지는 각 요양원에 확인해야 해요.`;
    } else if (grade === 'cognitive') {
      rules.push('R-FAC-03'); result = 'NOT_ELIGIBLE'; summary = '인지지원등급은 요양원(시설급여)을 이용할 수 없어요. 주·야간보호, 단기보호, 종일 방문요양, 복지용구를 이용할 수 있어요.';
      situations.add('PROC-HOME-SERVICES');
    } else if (grade === 3 || grade === 4 || grade === 5) {
      rules.push('R-FAC-02');
      const inCert = v<boolean>(facts, 'facility_in_cert');
      if (inCert === true) { result = 'MET'; summary = `${grade}등급이지만 인정서에 시설급여가 포함되어 있어 요양원을 이용할 수 있어요.`; }
      else if (inCert === false) { result = 'PROCEDURE_REQUIRED'; summary = `${grade}등급은 원칙적으로 재가급여만 받을 수 있어요. 요양원을 이용하려면 급여종류 변경 신청을 하고 등급판정위원회의 인정을 받아야 해요.`; }
      else { result = goal === 'facility' ? 'NEEDS_CHECK' : 'PROCEDURE_REQUIRED'; summary = `${grade}등급은 원칙적으로 재가급여만 받을 수 있어요. 인정서의 '급여 종류'에 시설급여가 있는지 확인해 주세요. 없으면 급여종류 변경 신청이 필요해요.`; missing.push('facility_in_cert'); }
    } else { result = 'NEEDS_CHECK'; summary = '등급을 확인해야 해요.'; missing.push('grade'); rules.push('R-FAC-04'); }
    if (inHospital) { rules.push('R-FAC-07'); summary += ' 참고로 요양병원 입원은 의료기관 이용이라 요양원(시설급여)과 다른 제도예요.'; }
    C = c.decision({ id: 'C', title: '요양원(시설급여) 이용 가능 여부', result, summary, rule_ids: rules, inputs_used: { grade_status: gradeStatus, grade, facility_in_cert: v(facts, 'facility_in_cert'), in_nursing_hospital: inHospital }, missing, next_actions: [] });
    decisions.push(C);
  }

  // ---------- D. 추가 인정(급여종류 변경) 필요 여부 ----------
  {
    const isMid = grade === 3 || grade === 4 || grade === 5;
    if (gradeStatus === 'graded' && isMid && C.result !== 'MET' && goal !== 'home') {
      const reasons: { code: string; label: string; evidence: string }[] = [];
      const unknown: string[] = [];
      const cg = facts.caregiver_difficulty; const lv = living;
      if (cg?.value === true || lv === 'alone' || lv === 'elderly_only') reasons.push({ code: '①', label: '주로 돌보는 가족이 돌보기 어려운 경우', evidence: cg?.evidence ?? facts.living!.evidence });
      else if (cg === undefined && lv === undefined) unknown.push('caregiver_difficulty');
      if (facts.housing_poor?.value === true) reasons.push({ code: '②', label: '주거환경이 열악해 시설 입소가 불가피한 경우', evidence: facts.housing_poor.evidence });
      else if (facts.housing_poor === undefined) unknown.push('housing_poor');
      if (facts.behavior_problem?.value === true) reasons.push({ code: '③', label: '치매 등에 따른 문제행동으로 재가급여를 이용할 수 없는 경우', evidence: facts.behavior_problem.evidence });
      else if (facts.behavior_problem === undefined) unknown.push('behavior_problem');
      let result: ResultCode; let summary: string;
      const rules = ['R-FAC-02', 'R-CHANGE-01', 'R-CHANGE-02'];
      if (reasons.length) {
        result = 'PROCEDURE_REQUIRED'; summary = `급여종류 변경 신청이 필요해요. 답변하신 상황은 위원회가 인정하는 사유 중 ${reasons.map((r) => r.code + ' ' + r.label).join(', ')}에 해당할 수 있어요. 인정 여부는 위원회가 결정해요.`;
        situations.add('PROC-CHANGE-TYPE');
      } else if (unknown.length) { result = 'NEEDS_CHECK'; summary = '요양원 이용 인정 사유(가족 돌봄 곤란, 주거환경, 문제행동)에 해당하는지 확인이 필요해요.'; }
      else { result = 'NOT_ELIGIBLE'; summary = '지금 답변으로는 요양원 이용 인정 사유에 해당하지 않을 수 있어요. 재가급여를 이용하고, 상태가 나빠지면 등급 변경 신청을 고려하세요.'; situations.add('PROC-HOME-SERVICES'); }
      if (result === 'PROCEDURE_REQUIRED' && facts.facility_in_cert === undefined) summary = '인정서에 시설급여가 없다면 ' + summary;
      decisions.push(c.decision({ id: 'D', title: '요양원 이용을 위한 추가 인정', result, summary, rule_ids: rules, inputs_used: { grade, caregiver_difficulty: cg?.value, living: lv, housing_poor: facts.housing_poor?.value, behavior_problem: facts.behavior_problem?.value }, missing: unknown, next_actions: [], data: { reasons } }));
    } else {
      decisions.push(c.decision({ id: 'D', title: '요양원 이용을 위한 추가 인정', result: 'NOT_APPLICABLE', summary: gradeStatus === 'graded' && isMid && goal === 'home' ? '집에서 돌보시길 원하셔서 해당하지 않아요.' : '현재 상황에서는 해당하지 않아요.', rule_ids: [], inputs_used: { grade, goal }, missing: [], next_actions: [] }));
      if (gradeStatus === 'graded' && isMid && goal === 'home') situations.add('PROC-HOME-SERVICES');
    }
  }

  // ---------- 부가 판단: 신청일부터 급여, 65세 미만 서류, 대리신청, 비용, 입소 ----------
  const applying = situations.has('PROC-INITIAL') || situations.has('PROC-PENDING');
  if (applying && (living === 'alone' || living === 'elderly_only' || living === 'minor_or_elderly_only')) {
    situations.add('PROC-EARLY');
    decisions.push(c.decision({ id: 'EARLY', title: '신청일부터 급여 받기', result: 'PROCEDURE_REQUIRED', summary: '같이 사는 가족이 없거나 미성년자·65세 이상 노인만 있으면, 등급이 나오기 전 신청일부터 재가급여나 시설급여를 받을 수 있어요. 증명서류를 붙여 따로 신청해야 해요.', rule_ids: ['R-FAC-05'], inputs_used: { living }, missing: [], next_actions: [] }));
  }
  if (situations.has('PROC-INITIAL') && over65 === false) situations.add('PROC-INITIAL-UNDER65');
  if (situations.has('PROC-INITIAL') && facts.relation) situations.add('PROC-PROXY');

  const wantsFacility = goal === 'facility' || goal === 'info' || goal === undefined;
  if (C.result === 'MET' && wantsFacility) {
    situations.add('PROC-ADMISSION');
    if (insurance === 'medical_aid_basic' || insurance === 'medical_aid_other') situations.add('PROC-MEDAID-ADMISSION');
  }
  if (C.result === 'MET' && goal === 'home') situations.add('PROC-HOME-SERVICES');
  if ((situations.has('PROC-ADMISSION') || situations.has('PROC-CHANGE-TYPE')) && (insurance?.startsWith('medical_aid') || v<boolean>(facts, 'low_income'))) {
    situations.add('PROC-COST-RELIEF');
    const exempt = insurance === 'medical_aid_basic';
    decisions.push(c.decision({ id: 'COST', title: '본인부담 면제·감경', result: 'PROCEDURE_REQUIRED', summary: exempt ? '국민기초생활보장법상 의료급여 수급자는 장기요양 본인부담금이 없어요(비급여 항목은 별도). 수급자증명서와 의료급여증을 요양원에 내요.' : '의료급여 수급자나 소득·재산 기준 이하인 분은 본인부담이 감경돼요. 증빙을 요양원에 내요.', rule_ids: ['R-COST-01', 'R-COST-02'], inputs_used: { insurance, low_income: v(facts, 'low_income') }, missing: [], next_actions: [] }));
  }
  if (situations.has('PROC-CHANGE-TYPE') && insurance?.startsWith('medical_aid')) situations.add('PROC-MEDAID-ADMISSION');

  // ---------- E. 정보 충분성 / 모순 ----------
  const contradictions: string[] = [];
  const items = v<Record<string, string>>(facts, 'items') ?? {};
  if (items['PHY-09'] === 'independent' && (items['PHY-07'] === 'needs_help' || items['PHY-08'] === 'needs_help')) contradictions.push('방 밖으로 혼자 나오신다는 답과 일어나 앉기·옮겨 앉기에 도움이 필요하다는 답이 함께 있어요');
  const allMissing = [...new Set(decisions.flatMap((d) => d.missing))];
  decisions.push(c.decision({ id: 'E', title: '현재 정보로 판단 가능한가', result: contradictions.length ? 'NEEDS_EXPERT' : allMissing.length ? 'NEEDS_CHECK' : 'MET', summary: contradictions.length ? `서로 맞지 않을 수 있는 답이 있어요: ${contradictions.join('; ')}` : allMissing.length ? `더 확인하면 정확해지는 정보: ${allMissing.map((k) => FIELD_KO[k] ?? k).join(', ')}` : '판단에 필요한 정보가 모두 있어요.', rule_ids: [], inputs_used: {}, missing: allMissing, next_actions: [], data: { contradictions } }));

  // ---------- F. 절차·서류 생성 (procedures.json / documents.json 에서만) ----------
  const order = ['PROC-INITIAL', 'PROC-INITIAL-UNDER65', 'PROC-PROXY', 'PROC-EARLY', 'PROC-PENDING', 'PROC-APPEAL', 'PROC-RENEWAL', 'PROC-CHANGE-GRADE', 'PROC-CHANGE-TYPE', 'PROC-ADMISSION', 'PROC-MEDAID-ADMISSION', 'PROC-COST-RELIEF', 'PROC-HOME-SERVICES'];
  const chosen = order.filter((p) => situations.has(p));
  const procedures: DecideOutput['procedures'] = [];
  const documents: DocItem[] = []; const excluded: DecideOutput['excluded_documents'] = [];
  const seenDoc = new Set<string>();
  for (const pid of chosen) {
    const p = c.kb.procs.get(pid);
    if (!p) { c.log('F', `절차 ${pid} 가 procedures.json 에 없음`, undefined, 'error'); continue; }
    const steps = p.steps.filter((s) => {
      const ok = c.use(`F:${pid}`, s.rules).length === s.rules.length;
      if (!ok) c.log('F', `단계 ${s.id} 는 미검증 규칙 때문에 자동 안내에서 제외`, s.rules.join(','), 'warn');
      return ok;
    });
    procedures.push({ id: p.id, title: p.title, steps });
    for (const [when, list] of [['now', p.docs_now], ['later', p.docs_later]] as const) {
      for (const did of list) {
        const d = c.kb.docs.get(did)!;
        if (seenDoc.has(did)) continue;
        const docRules = d.sources ?? [];
        const usable = d.verification_status === 'OFFICIAL_VERIFIED' && c.use(`F:${did}`, docRules).length === docRules.length;
        if (!usable) {
          if (!excluded.some((x) => x.id === did)) excluded.push({ id: did, name: d.official_name, reason: `근거 검증 상태(${d.verification_status}${docRules.map((r) => '/' + r + ':' + c.kb.rule(r).verification_status).join('')}) — 원문 대조 후 자동 안내에 포함` });
          continue;
        }
        seenDoc.add(did);
        documents.push({ id: did, name: d.official_name, form: d.form, when, required: d.required ?? '', submit_to: d.submit_to, timing: d.timing, procedure: pid, sources: c.kb.refs(docRules), status: d.verification_status, display_rule: d.display_rule, prep: d.prep, prep_where: d.prep_where });
      }
    }
  }
  decisions.push(c.decision({ id: 'F', title: '남은 행정절차', result: chosen.length ? 'PROCEDURE_REQUIRED' : 'MET', summary: chosen.length ? procedures.map((p) => p.title).join(' → ') : '지금 진행할 행정절차가 없어요.', rule_ids: [...new Set(procedures.flatMap((p) => p.steps.flatMap((s) => s.rules)))], inputs_used: { situations: chosen }, missing: [], next_actions: [] }));

  // ---------- 지금 할 일 (우선순위) ----------
  const actions: ActionItem[] = [];
  // 제목은 한 줄 행동, 설명(detail)은 펼쳐야 보인다
  const add = (id: string, priority: number, text: string, detail: string, rule_ids: string[] = []) => actions.push({ id, priority, text, detail, rule_ids });
  if (appealDeadline) add('ACT-APPEAL', diffDays(appealDeadline, today) <= 30 ? 1 : 3, `${appealDeadline}까지 이의신청하기`, '판정이 실제와 다르다고 보면 공단에 심사청구서를 내세요.', ['R-APPEAL-01']);
  else if (situations.has('PROC-APPEAL')) add('ACT-APPEAL', 2, '통지서 받은 날부터 90일 안에 이의신청하기', '통지서 날짜를 확인하세요. 처분일부터 180일이 지나면 할 수 없어요.', ['R-APPEAL-01']);
  if (renewal && renewal.days <= 30 && renewal.days >= 0) add('ACT-RENEW-URGENT', 1, '오늘 공단에 갱신 문의하기', '갱신 신청은 만료 30일 전까지라 기한이 촉박해요.', ['R-VALID-02']);
  if (renewal && renewal.days < 0) add('ACT-EXPIRED', 1, '공단에 다시 신청하는 방법 문의하기', '유효기간이 이미 지났어요.', ['R-VALID-02']);
  if (situations.has('PROC-RENEWAL') && renewal && renewal.days > 30) add('ACT-RENEW', 2, `${renewal.end} 전에 갱신 신청하기`, '갱신신청서에 의사소견서를 함께 내요.', ['R-VALID-02']);
  if (situations.has('PROC-INITIAL-UNDER65')) add('ACT-U65-DOC', 2, '병원에서 진단서 받아 두기', '65세 미만은 신청할 때 진단서나 의사소견서를 함께 내야 해요.', ['R-APPLY-02']);
  if (situations.has('PROC-INITIAL')) add('ACT-APPLY', 3, '공단에 장기요양인정 신청하기', `${facts.relation ? '가족이 대신 신청할 수 있어요. ' : ''}온라인·방문·우편·팩스 모두 돼요.`, ['R-APPLY-01', 'R-APPLY-04', 'R-APPLY-05']);
  if (situations.has('PROC-EARLY')) add('ACT-EARLY', 3, "'신청일부터 급여신청'도 함께 하기", '등급이 나오기 전부터 서비스를 받을 수 있어요.', ['R-FAC-05']);
  if (situations.has('PROC-CHANGE-TYPE')) add('ACT-CHTYPE', 3, '공단에 급여종류 변경 신청하기', '돌보기 어려운 사정을 신청서에 구체적으로 적으세요.', ['R-CHANGE-01']);
  if (situations.has('PROC-CHANGE-GRADE')) add('ACT-CHGRADE', 4, '등급 변경 신청하기', '상태가 나빠졌다면 할 수 있어요. 의사소견서가 필요해요.', ['R-CHANGE-01']);
  if (situations.has('PROC-ADMISSION')) {
    add('ACT-ADM-CHOOSE', 3, '요양원 찾아 상담하기', '자리가 있는지, 입소 때 낼 서류가 무엇인지 물어보세요.');
    add('ACT-ADM-CONTRACT', 4, '계약서 1부 받고 추가 비용 확인하기', '식재료비·상급침실·이미용비는 따로 내요.', ['R-CONTRACT-01', 'R-COST-02']);
    if (v<boolean>(facts, 'current_home_services')) add('ACT-ADM-STOP-HOME', 4, '방문요양 센터에 종료 날짜 알리기', '입소하면 방문요양 등 재가급여를 함께 받을 수 없어요.', ['R-FAC-06']);
  }
  if (situations.has('PROC-MEDAID-ADMISSION')) add('ACT-MEDAID', 4, '시·군·구청에 입소·이용신청서 내기', '의료급여 수급권자는 시·군·구를 거쳐 입소해요.', ['R-CONTRACT-01']);
  if (situations.has('PROC-COST-RELIEF')) add('ACT-RELIEF', 5, '본인부담 감면 증빙 준비하기', '수급자증명서·의료급여증 등을 요양원에 내요.', ['R-COST-01']);
  if (situations.has('PROC-PENDING')) add('ACT-VISIT', 3, '방문조사 날 가족이 함께 있기', '평소 어려운 점을 직접 말할 수 있어요.', ['R-PROC-02']);
  if (situations.has('PROC-INITIAL') || situations.has('PROC-PENDING')) add('ACT-MEMO', 5, '방문조사 때 평소 모습 그대로 말하기', '잘하실 때가 아니라 평소 도와드리는 일을 빠짐없이 말씀하세요.');
  if (situations.has('PROC-HOME-SERVICES')) add('ACT-HOME', 4, grade === 'cognitive' ? '주간보호센터 알아보기' : '주간보호·단기보호 알아보기', grade === 'cognitive' ? '인지지원등급은 주간보호·단기보호·종일 방문요양을 쓸 수 있어요.' : '단기보호는 월 9일 이내예요.', ['R-FAC-03', 'R-SHORT-01']);
  if (A.result === 'NOT_ELIGIBLE' && gradeStatus !== 'graded') add('ACT-DIAG', 2, '진단받은 병명 확인하기', '치매·뇌졸중·파킨슨병 등 노인성 질병이 있으면 신청할 수 있어요.', ['R-ELIG-02']);
  if (dementia === 'suspected' && gradeStatus !== 'graded') add('ACT-DEMENTIA-DX', 2, '치매 진단 여부 확인하기', '5등급·인지지원등급은 치매 진단이 있어야 나와요.', ['R-GRADE-02']);
  if (v<boolean>(facts, 'in_nursing_hospital')) add('ACT-HOSP', 4, '요양원으로 옮기려면 등급부터', '요양병원과 요양원은 다른 제도예요.', ['R-FAC-07', 'R-FAC-04']);
  actions.sort((a, b) => a.priority - b.priority);
  const uniq = actions.filter((a, i, arr) => arr.findIndex((x) => x.id === a.id) === i);
  for (const a of uniq) a.rule_ids = c.use('ACTIONS', a.rule_ids);

  return { decisions, situations: chosen, procedures, documents, excluded_documents: excluded, actions: uniq.slice(0, 3), all_actions: uniq, trace: c.trace };
}
