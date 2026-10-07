// 장기요양인정 신청서(별지 제1호의2서식) 작성 도우미. 답변으로 알 수 있는 칸만 채우고,
// 이름·주민번호·주소·전화번호 등 개인 식별정보 칸은 비워 둔다(수집하지 않음).
import type { Kb } from './kb.ts';
import type { Answers } from './types.ts';
import type { GuideResult } from './result.ts';
import { expandAnswers, otherNotes } from './answers.ts';

export interface FormDef {
  online: { url: string; label: string; note: string; rules: string[]; source: string };
  kinds: { id: string; label: string; proc: string; desc: string }[];
  sections: { id: string; title: string; fields: { no: string; label: string; fill: string; hint?: string; options?: string[] }[] }[];
  attachments: { id: string; label: string; when: string; detail?: string; detail_self?: string; detail_proxy?: string }[];
  cautions: string[];
}

export interface FilledField { no: string; label: string; kind: 'self' | 'filled' | 'draft'; value?: string; checks?: { label: string; on: boolean }[]; hint?: string }
export interface FilledForm {
  kinds: { label: string; desc: string; on: boolean }[];
  sections: { title: string; fields: FilledField[] }[];
  attachments: { label: string; detail: string }[];
  online: FormDef['online'];
  cautions: string[];
}

const BODY_LABEL: Record<string, string> = { b_wash: '씻기', b_dress: '옷 입기', b_eat: '식사', b_move: '집 안 움직임', b_toilet: '화장실' };

/** 신청서가 필요한 절차가 있을 때만 만든다 */
export function buildForm(kb: Kb, form: FormDef, raw: Answers, r: GuideResult): FilledForm | null {
  const procs = new Set(r.decide.situations);
  const kinds = form.kinds.map((k) => ({ label: k.label, desc: k.desc, on: procs.has(k.proc) }));
  if (!kinds.some((k) => k.on)) return null;
  const a = expandAnswers(kb, raw);
  const proxy = a.applicant !== 'self';
  const onlyChangeType = kinds.every((k) => !k.on || k.label.includes('급여종류'));
  const isInitial = procs.has('PROC-INITIAL');

  // ⑰ 변경 사유 초안 (신청서 말투: 선택지의 form_text)
  const opt = (step: string, v: unknown) => kb.questionnaire.steps.find((s) => s.id === step)?.options?.find((o) => o.value === v);
  const reasonLines: string[] = [];
  if (procs.has('PROC-CHANGE-TYPE')) {
    const hit = new Set(r.facility.reasons.filter((x) => x.likelihood === 'high' || x.likelihood === 'possible').map((x) => x.code));
    if (hit.has('①')) reasonLines.push(`주 돌봄 가족의 수발 곤란${opt('carer', raw.carer)?.form_text ? ` — ${opt('carer', raw.carer)!.form_text}` : ''}`);
    if (hit.has('②')) {
      const h = Array.isArray(a.housing) ? (a.housing as string[]).map((v) => opt('housing', v)?.form_text).filter(Boolean) : [];
      reasonLines.push(`주거환경 열악${h.length ? ` — ${h.join(', ')}` : ''}`);
    }
    if (hit.has('③')) {
      const beh = kb.questionnaire.facility_reason_heuristics.behavior.item_signal.items.filter((id) => a[id] === 'yes').map((id) => kb.itemById.get(id)!.official_item_name);
      const svc = opt('behavior_service', raw.behavior_service)?.form_text;
      reasonLines.push(`치매 등 문제행동으로 재가급여 이용 곤란${[svc, beh.length ? `문제행동: ${beh.join(', ')}` : ''].filter(Boolean).length ? ` — ${[svc, beh.length ? `문제행동: ${beh.join(', ')}` : ''].filter(Boolean).join('; ')}` : ''}`);
    }
  }
  if (procs.has('PROC-CHANGE-GRADE')) {
    const worse = Object.entries(BODY_LABEL).filter(([id]) => typeof raw[id] === 'string' && raw[id] !== '1' && raw[id] !== 'unknown').map(([, name]) => name);
    reasonLines.push(`심신상태 악화로 일상생활 도움 증가${worse.length ? ` — ${worse.join('·')}에 도움 필요` : ''}`);
  }

  // 보호자가 직접 적은 내용은 해석하지 않고 그대로 덧붙인다
  if (reasonLines.length) for (const n of otherNotes(kb, raw)) reasonLines.push(`기타(${n.title}) — ${n.text}`);

  const sections = form.sections
    .filter((s) => s.id !== 'proxy' || proxy)
    .filter((s) => s.id !== 'reason' || procs.has('PROC-CHANGE-TYPE') || procs.has('PROC-CHANGE-GRADE'))
    .map((s) => ({
      title: s.id === 'proxy' && r.guide.role.value === 'other' ? '대리인 (대신 신청할 때)' : s.title,
      fields: s.fields.map((f): FilledField => {
        if (f.fill === 'proxy_type') {
          const role = r.guide.role;
          const label = role.value === 'family' ? '가족' : role.other === 'interested' ? '이해관계인' : kb.guide.roles.other_options.find((o) => o.value === role.other)?.label ?? '';
          const choices = f.options ?? [];
          return { no: f.no, label: f.label, kind: 'filled', checks: choices.map((o) => ({ label: o, on: o === label })), hint: role.value === 'family' ? f.hint : `선택하신 대리인 유형은 '${label}'이에요. 대리인 신분증과 유형별 준비 서류를 확인해 주세요.` };
        }
        if (f.fill === 'change_reason') return { no: f.no, label: f.label, kind: 'draft', value: reasonLines.map((l, i) => `${i + 1}. ${l}`).join('\n') || undefined, hint: '답하신 내용으로 만든 예시예요. 실제 사정(누가·얼마나 자주·어떤 어려움)을 더해 고쳐 쓰세요.' };
        return { no: f.no, label: f.label, kind: 'self', hint: f.hint };
      }),
    }));

  const attachments = form.attachments
    .filter((x) => x.when === 'always' || (x.when === 'not_change_type' && !onlyChangeType) || (x.when === 'under65_initial' && isInitial && a.age === 'under65'))
    .map((x) => ({ label: x.label, detail: x.id === 'id_card' ? (proxy ? x.detail_proxy! : x.detail_self!) : x.detail ?? '' }));

  const online = r.guide.channels.under65Blocked ? { ...form.online, url: kb.guide.links.branch.url, label: '접수할 지사 찾기', note: kb.guide.channels.under65_blocked } : form.online;
  return { kinds, sections, attachments, online, cautions: form.cautions };
}
