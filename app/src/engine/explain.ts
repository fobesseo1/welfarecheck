// E. 결과 설명 엔진 + 등급 사전검토(V1: 공식 조사 항목 기반 상태 정리)
// 판단 엔진이 만든 구조화 결과만 문장으로 바꾼다. 새로운 법적 결론을 만들지 않는다.
// (LLM 문장 다듬기는 선택 기능이며, 켜더라도 이 템플릿 결과를 입력으로만 쓴다.)
import type { AssessmentSummary, FactMap } from '../types.ts';
import type { DecideOutput } from './decide.ts';
import { evidence } from '../evidence.ts';

const LABEL: Record<string, string> = {
  none: '아직 등급 없음', pending: '신청 후 판정 대기', out_of_grade: '등급외 판정', graded: '등급 있음',
  health: '건강보험', medical_aid_basic: '의료급여(기초생활수급)', medical_aid_other: '의료급여',
  alone: '혼자 사심', elderly_only: '노인끼리만 사심', minor_or_elderly_only: '미성년 손자녀와 사심', with_family: '가족과 함께 사심',
  diagnosed: '치매 진단 받음', suspected: '치매 의심(진단 전)', facility: '요양원 입소 희망', home: '집에서 돌봄 희망', info: '방법 알아보는 중',
  needs_help: '도움 필요', independent: '혼자 가능', yes: '있음', observe: '조사원이 직접 확인',
};
const STATUS: Record<string, string> = { stated_by_guardian: '보호자 말씀', confirmed_by_document: '서류 확인', unknown: '미확인' };

export function assessmentSummary(facts: FactMap): AssessmentSummary {
  const ev = evidence();
  const items = (facts.items?.value ?? {}) as Record<string, string>;
  const domains = ['신체기능', '인지기능', '행동변화', '간호처치', '재활'];
  const known = (pred: (i: typeof ev.items[number]) => boolean) => ev.items.filter((i) => pred(i) && items[i.id]).length;
  return {
    v52: { known: known((i) => i.in_v52), total: ev.items.filter((i) => i.in_v52).length },
    v65: { known: known((i) => i.in_v65), total: ev.items.length },
    domains: domains.map((d) => {
      const list = ev.items.filter((i) => i.domain === d);
      return {
        domain: d,
        known: list.filter((i) => items[i.id]).map((i) => ({ id: i.id, name: i.official_item_name, value: LABEL[items[i.id]] ?? items[i.id] })),
        unknown_count: list.filter((i) => !items[i.id]).length,
      };
    }),
    note: '보호자 말씀을 공식 조사 항목에 맞춰 정리한 참고 정보예요. 점수와 등급은 공단 방문조사와 등급판정위원회가 정해요. 재활 항목은 조사원이 직접 동작을 시켜 확인해요.',
  };
}

export function explain(facts: FactMap, out: DecideOutput, assess: AssessmentSummary, today: string): Record<'situation' | 'grade_review' | 'facility' | 'documents' | 'actions', string> {
  const f = (k: string) => facts[k];
  const lines: string[] = [];
  const who = (f('relation')?.value as string) ?? '가족분';
  const age = f('age') ? `${f('age')!.value}세 ` : f('age_over65') ? (f('age_over65')!.value ? '65세 이상 ' : '65세 미만 ') : '';
  lines.push(`${age}${who}`);
  const g = f('grade_status')?.value as string | undefined;
  if (g === 'graded') { const gr = f('grade')!.value; lines.push(`장기요양 ${gr === 'cognitive' ? '인지지원' : gr}등급` + (f('validity_end') ? ` (유효기간 ${f('validity_end')!.value}까지)` : '')); }
  else if (g) lines.push(LABEL[g]);
  if (f('dementia')) lines.push(LABEL[f('dementia')!.value as string]);
  const ev = evidence();
  const dz = ((f('diseases')?.value as string[]) ?? []).filter((c) => !c.startsWith('F0')).map((c) => ev.diseases.find((d) => d.code.replace('*', '') === c)?.name ?? c);
  if (dz.length) lines.push(`진단: ${dz.join(', ')}`);
  if (f('other_condition')) lines.push(`${f('other_condition')!.value}`);
  if (f('living')) lines.push(LABEL[f('living')!.value as string]);
  if (f('main_caregiver')) lines.push(`${f('main_caregiver')!.value}께서 주로 돌보심`);
  if (f('caregiver_difficulty')?.value === true) lines.push('집에서 계속 돌보기 어려운 상황');
  if (f('in_nursing_hospital')?.value) lines.push('요양병원 입원 중');
  if (f('insurance')) lines.push(LABEL[f('insurance')!.value as string]);
  if (f('goal')) lines.push(LABEL[f('goal')!.value as string]);
  const helps = assess.domains.flatMap((d) => d.known.filter((k) => k.value === '도움 필요' || k.value === '있음').map((k) => k.name));
  if (helps.length) lines.push(`어려운 일: ${helps.join(', ')}`);
  const situation = lines.map((l) => '• ' + l).join('\n') + '\n\n(• 는 보호자 말씀 기준이에요. 서류로 확인된 것은 결과 화면에 따로 표시돼요.)';

  const byId = Object.fromEntries(out.decisions.map((d) => [d.id, d]));
  const gradeReview = [
    `공식 조사 항목 기준으로 지금까지 확인된 항목: 고시 기준 ${assess.v52.known}/${assess.v52.total}개, 공단 안내 기준 ${assess.v65.known}/${assess.v65.total}개.`,
    ...assess.domains.map((d) => `- ${d.domain}: ${d.known.length ? d.known.map((k) => `${k.name}(${k.value})`).join(', ') : '확인된 항목 없음'}`),
    byId.B ? `\n${byId.B.summary}` : '',
    '예상 등급은 표시하지 않아요. 등급은 공단 방문조사와 등급판정위원회가 정해요.',
  ].join('\n');

  const facility = [byId.C?.summary, byId.D && byId.D.result !== 'NOT_APPLICABLE' ? byId.D.summary : '', byId.EARLY?.summary ?? '', byId.COST?.summary ?? '', byId.A && byId.A.result !== 'MET' ? `신청 자격: ${byId.A.summary}` : '']
    .filter(Boolean).join('\n\n');

  const nowDocs = out.documents.filter((d) => d.when === 'now');
  const laterDocs = out.documents.filter((d) => d.when === 'later');
  const documents = [
    out.procedures.length ? '진행할 절차:\n' + out.procedures.map((p) => `■ ${p.title}\n` + p.steps.map((s) => `  - ${s.text}`).join('\n')).join('\n') : '지금 진행할 행정절차가 없어요.',
    nowDocs.length ? '\n지금 준비할 서류:\n' + nowDocs.map((d) => `☐ ${d.name}${d.form ? ` (${d.form})` : ''}`).join('\n') : '',
    laterDocs.length ? '\n나중에 필요한 서류:\n' + laterDocs.map((d) => `· ${d.name}`).join('\n') : '',
    out.excluded_documents.length ? '\n확인 중인 항목(근거 원문 대조 전이라 자동 안내에서 제외):\n' + out.excluded_documents.map((d) => `· ${d.name}`).join('\n') : '',
  ].filter(Boolean).join('\n');

  const actions = out.actions.map((a, i) => `${i + 1}. ${a.text}`).join('\n') || '지금 급하게 할 일은 없어요.';
  return { situation, grade_review: gradeReview, facility, documents, actions };
}

export { STATUS as STATUS_LABEL, LABEL };
