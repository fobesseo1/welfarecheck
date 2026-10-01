// 결과 화면 '자세히 보기' 칸들(접수 경로·서류·병원·방문조사·입소·상황별 안내)의 화면 모델.
// 문구·링크는 data/guide_content.json, 서류는 decide() 결과(documents.json)에서만 가져온다.
import type { Kb } from './kb.ts';
import type { Answers, DocItem, DocPrep } from './types.ts';
import type { DecideOutput } from './decide.ts';
import type { Tone } from './result.ts';
import { otherNotes } from './answers.ts';

export interface LinkDef { label: string; url: string; source: string }
export interface GuideDef {
  links: Record<string, LinkDef>;
  channels: { online: string; under65_blocked: string; cards: { t: string; d: string }[]; branch_note: string; call_hours: string; call_script: string; acute: string };
  roles: { options: { value: string; label: string }[]; other_options: { value: string; label: string }[]; id_docs: Record<string, { name: string; where: string }>; rules: string[] };
  forms_note: string;
  doctor: { flow: string[]; over65: string; under65: string; change_grade: string; validity: string; search_note: string; script: string; checklist: string[]; cost: { who: string; pay: string }[]; cost_note: string; exempt: string; rules: string[] };
  visit: { intro: string; base: string[]; body: string; mind: string; care: string; hospital: string; example: string; rules: string[] };
  admission: { intro: string; common: { id: string; t: string; d: string }[]; medaid: { id: string; t: string; d: string }; facility_intro: string; facility: { id: string; t: string }[]; rules: string[] };
  situations: Record<'out_of_grade' | 'pending' | 'expired', { title: string; text?: string; reapply?: string; appeal?: string; rules: string[] }>;
}

export interface GuideDoc { key: string; id: string; name: string; where: string; prep: DocPrep; when: 'now' | 'later' }
export interface Guide {
  cta: { kind: 'apply' | 'branch' | 'tel' | 'result'; label: string; url: string; note: string } | null;
  channels: { show: boolean; under65Blocked: boolean; acute: boolean };
  role: { value: string; other: string };
  docs: GuideDoc[];
  doctor: { show: boolean; lines: string[]; script: string };
  visit: { show: boolean; notes: string[]; typed: { title: string; text: string }[] };
  admission: { show: boolean; common: { id: string; t: string; d: string }[]; facility: { id: string; t: string }[] };
  situation: 'out_of_grade' | 'pending' | 'expired' | null;
}

const PROC_APPLY = ['PROC-INITIAL', 'PROC-RENEWAL', 'PROC-CHANGE-GRADE', 'PROC-CHANGE-TYPE'];

export function buildGuide(kb: Kb, def: GuideDef, raw: Answers, a: Answers, dec: DecideOutput, tone: Tone): Guide {
  const procs = new Set(dec.situations);
  const under65 = a.age === 'under65';
  const grade = a.grade as string | undefined;
  const B = dec.decisions.find((d) => d.id === 'B');
  const expired = typeof (B?.data as any)?.days_left === 'number' && (B!.data as any).days_left < 0;
  const L = def.links;

  // ---------- 상황별 큰 버튼 ----------
  let cta: Guide['cta'] = null;
  if (grade === 'pending') cta = { kind: 'result', label: '등급판정 결과 조회하기', url: L.result.url, note: '누리집 로그인이 필요해요.' };
  else if (expired || grade === 'out_of_grade' || grade === 'unknown' || grade === undefined) cta = { kind: 'tel', label: '공단에 전화하기 · 1577-1000', url: L.tel.url, note: def.channels.call_hours };
  else if (procs.has('PROC-INITIAL') && under65) cta = { kind: 'branch', label: '접수할 지사 찾기', url: L.branch.url, note: '65세 미만 처음 신청은 방문·우편·팩스로 내요.' };
  else if (PROC_APPLY.some((p) => procs.has(p))) cta = { kind: 'apply', label: procs.has('PROC-INITIAL') ? '공식 사이트에서 신청하기' : '공식 사이트에서 갱신·변경 신청하기', url: L.apply.url, note: '인증서 로그인이 필요해요. 새 창으로 열려요.' };

  // ---------- 누가 신청하나요 → 신분증 서류 ----------
  const roleValue = a.applicant === 'self' || a.applicant === 'other' ? (a.applicant as string) : 'family';
  const otherValue = typeof a.applicant_other === 'string' ? a.applicant_other : 'interested';
  const idKey = roleValue === 'other' ? otherValue : roleValue;
  const idDoc = def.roles.id_docs[idKey] ?? def.roles.id_docs.family;
  const docs: GuideDoc[] = [];
  const push = (d: DocItem) => docs.push({ key: `doc:${d.id}`, id: d.id, name: d.name, where: d.prep_where ?? d.submit_to ?? '', prep: d.prep ?? 'self', when: d.when });
  for (const d of dec.documents) {
    if (d.display_rule) continue;
    if (d.id === 'DOC-05') { docs.push({ key: `doc:DOC-05:${idKey}`, id: 'DOC-05', name: idDoc.name, where: idDoc.where, prep: 'self', when: d.when }); continue; }
    push(d);
  }
  const hasIdDoc = docs.some((d) => d.id === 'DOC-05');
  if (hasIdDoc && roleValue === 'other' && otherValue === 'designated') {
    const d6 = kb.docs.get('DOC-06');
    if (d6 && d6.verification_status === 'OFFICIAL_VERIFIED') docs.push({ key: 'doc:DOC-06', id: 'DOC-06', name: `${d6.official_name} (${d6.form ?? ''})`.replace(' ()', ''), where: d6.prep_where ?? '', prep: d6.prep ?? 'issued', when: 'now' });
  }
  for (const d of dec.documents) if (d.display_rule) push(d);

  // ---------- 병원·의사소견서 ----------
  const needDoctor = docs.some((d) => d.id === 'DOC-02' || d.id === 'DOC-04');
  const lines: string[] = [];
  if (needDoctor) {
    lines.push(under65 && procs.has('PROC-INITIAL') ? def.doctor.under65 : def.doctor.over65);
    if (procs.has('PROC-CHANGE-GRADE')) lines.push(def.doctor.change_grade);
  }
  const script = def.doctor.script.replace('{who}', under65 ? '65세 미만 어르신의' : '어르신의');

  // ---------- 방문조사 준비 메모 (답변에 따라) ----------
  const showVisit = ['PROC-INITIAL', 'PROC-PENDING', 'PROC-RENEWAL', 'PROC-CHANGE-GRADE'].some((p) => procs.has(p));
  const notes = [...def.visit.base];
  const bodyHelp = ['b_move', 'b_toilet'].some((k) => typeof raw[k] === 'string' && raw[k] !== '1' && raw[k] !== 'unknown');
  if (bodyHelp) notes.push(def.visit.body);
  if (raw.memory_gate === 'yes' || raw.behavior_gate === 'yes' || (Array.isArray(raw.memory) && raw.memory.length) || (Array.isArray(raw.behavior) && raw.behavior.length)) notes.push(def.visit.mind);
  if (['alone', 'far', 'spouse', 'family_hard'].includes(String(raw.carer)) || (Array.isArray(a.housing) && (a.housing as string[]).length)) notes.push(def.visit.care);
  if (a.hospital === 'yes') notes.push(def.visit.hospital);
  const typed = otherNotes(kb, raw).map((n) => ({ title: n.title, text: n.text }));

  // ---------- 입소 준비 ----------
  const medaid = typeof a.insurance === 'string' && a.insurance.startsWith('medical_aid');
  const admission = { show: tone !== 'no', common: [...def.admission.common, ...(medaid ? [def.admission.medaid] : [])], facility: def.admission.facility };

  const situation: Guide['situation'] = grade === 'out_of_grade' ? 'out_of_grade' : grade === 'pending' ? 'pending' : expired ? 'expired' : null;

  return {
    cta,
    channels: { show: PROC_APPLY.some((p) => procs.has(p)), under65Blocked: under65 && procs.has('PROC-INITIAL'), acute: procs.has('PROC-INITIAL') },
    role: { value: roleValue, other: otherValue },
    docs,
    doctor: { show: needDoctor, lines, script },
    visit: { show: showVisit, notes, typed },
    admission,
    situation,
  };
}

/** 복사용 글 (가족 대화방·메모에 붙여넣기) */
export function copyText(kind: string, g: Guide, def: GuideDef, checks: Record<string, boolean>): string {
  if (kind === 'hospital') return g.doctor.script;
  if (kind === 'visit') return ['방문조사 준비', ...g.visit.notes.map((n) => `- ${n}`), ...g.visit.typed.map((t) => `- ${t.title}: ${t.text}`), def.visit.example].join('\n');
  if (kind === 'admission') return ['요양원 입소 준비', ...[...g.admission.common, ...g.admission.facility].map((x) => `${checks[x.id] ? '[준비됨]' : '[ ]'} ${x.t}`)].join('\n');
  const who = def.roles.options.find((o) => o.value === g.role.value)?.label ?? '';
  return [`준비할 서류 (신청: ${who})`, ...g.docs.map((d) => `${checks[d.key] ? '[준비됨]' : '[ ]'} ${d.name}${d.where ? ` — ${d.where}` : ''}`), `공식 신청: ${def.links.apply.url}`, `지사 찾기: ${def.links.branch.url}`].join('\n');
}
