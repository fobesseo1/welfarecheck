// 근거 DB (data/*.json) 를 엔진이 쓰는 형태로 묶는다. 파일 읽기는 하지 않는다(브라우저·Node 공용).
// 기준이 바뀌면 JSON 만 고치면 되고, 코드는 규칙·서류·절차 ID 로만 참조한다.
import type { SourceRef } from './types.ts';
import type { GuideDef } from './guide.ts';

export interface Rule { id: string; category: string; rule: string; sources: { src: string; article: string }[]; verification_status: string; quote?: string }
export interface SourceDoc { id: string; title: string; verification_status: string }
export interface DocDef { id: string; official_name: string; form?: string; required?: string; submit_to?: string; timing?: string; verification_status: string; sources?: string[]; display_rule?: string; prep?: 'self' | 'issued' | 'nhis'; prep_where?: string }
export interface ProcStep { id: string; text: string; rules: string[] }
export interface ProcDef { id: string; title: string; steps: ProcStep[]; docs_now: string[]; docs_later: string[]; rules: string[] }
export interface ItemDef { id: string; domain: string; official_item_name: string; guardian_question: string; in_v52: boolean; in_v65: boolean }
export interface Disease { mark: string; name: string; code: string }

export type Cond = { le?: number; lt?: number; ge?: number; gt?: number; eq?: number; in?: number[] };
export type SplitVar = { type: 'domain'; domain: 'PHY' | 'COG' | 'BEH' | 'NUR' | 'REH' } | { type: 'item'; item: string };
export interface TreeNode { score: number; split?: { label: string; var: SplitVar }; children?: { node: number; label: string; cond: Cond }[] }
export interface TreeDef { status: string; nodes: Record<string, TreeNode>; all_checks_passed: boolean; corrections?: string[] }
export interface GradingTrees { _meta: { status: string; all_automatic_checks_passed: boolean }; trees: Record<string, TreeDef> }

export interface DementiaRegression {
  intercept: number;
  item_coefficients: Record<string, number>;
  adl_score: { coefficient: number; basis: 'PHY_raw' };
  behavior_score: { coefficient: number; basis: 'BEH_raw' };
  applies_from: number; applies_below: number; threshold: number;
}
export interface GradingFormula {
  item_scores: Record<string, Record<string, number>>;
  conversion_tables: Record<'신체기능' | '인지기능' | '행동변화' | '간호처치' | '재활', Record<string, number>>;
  dementia_regression_bylaw2: { structured: DementiaRegression };
  grade_cutoffs: { grade1: number; grade2: number; grade3: number; grade4: number; grade5: number };
}

export interface ApproxModel {
  _meta: { note: string[] | string };
  status: string;
  model: { intercept: number; weights: Record<'PHY' | 'COG' | 'BEH' | 'NUR' | 'REH', number> };
  fit: { rmse: number; r2: number; n: number; seed: number };
  range: { band_points: number; tree_mode_band_points: number };
  confidence: { high: { max_unknown_ratio: number; max_grade_span: number }; medium: { max_unknown_ratio: number; max_grade_span: number } };
}

export interface QOption { value: string; label: string; hint?: string; codes?: string[]; key?: boolean; wide?: boolean; sets?: Record<string, string>; form_text?: string; group?: string }
/** 한 화면 = 질문 하나. single: 하나 고르면 바로 다음 / chips: 여러 개 고르기 / date: 날짜(선택)
 *  gate_for: 먼저 '있어요/없어요'를 묻는 질문(대상 chips 의 id) / gate: 이 chips 는 그 질문이 '있어요'일 때만 나온다
 *  other: 목록에 없는 것을 직접 적는 칸(해석·점수 없음, 그대로 보여주기만) */
export interface Step {
  id: string; stage: string; type: 'single' | 'chips' | 'date'; text: string; hint?: string; note?: string; optional?: boolean;
  when?: { q: string; in?: string[]; notIn?: string[] }; options?: QOption[]; none_label?: string; layout?: 'grid';
  gate_for?: string; gate?: string; other?: boolean;
}
export interface Questionnaire {
  stages: { id: string; title: string }[];
  steps: Step[];
  defaults: Record<string, string>;
  reason_writing: Record<'①' | '②' | '③', string>;
  facility_reason_heuristics: {
    caregiver: { high: { caregiver: string[]; living: string[] }; possible: { caregiver: string[]; living: string[] }; low: { caregiver: string[] } };
    housing: { possible_if_key_issue: boolean; possible_if_count_at_least: number };
    behavior: { high: string[]; possible: string[]; low: string[]; item_signal: { items: string[]; possible_if_count_at_least: number } };
  };
}

export interface RawData {
  legalRules: { rules: Rule[] };
  sources: { sources: SourceDoc[] };
  documents: { documents: DocDef[] };
  procedures: { procedures: ProcDef[] };
  items: { items: ItemDef[] };
  diseases: { diseases: Disease[] };
  formula: GradingFormula;
  trees: GradingTrees;
  approx: ApproxModel;
  questionnaire: Questionnaire;
  guide: GuideDef;
}

/** 자동 판단에 사용할 수 있는 검증 상태 (지시서: OFFICIAL_VERIFIED 만) */
export const USABLE_STATUSES = new Set(['OFFICIAL_VERIFIED']);

export class Kb {
  rules = new Map<string, Rule>();
  sources = new Map<string, SourceDoc>();
  docs = new Map<string, DocDef>();
  procs = new Map<string, ProcDef>();
  items: ItemDef[];
  itemById = new Map<string, ItemDef>();
  diseases: Disease[];
  formula: GradingFormula;
  trees: GradingTrees;
  approx: ApproxModel;
  questionnaire: Questionnaire;
  guide: GuideDef;

  constructor(raw: RawData) {
    for (const r of raw.legalRules.rules) this.rules.set(r.id, r);
    for (const s of raw.sources.sources) this.sources.set(s.id, s);
    for (const d of raw.documents.documents) this.docs.set(d.id, d);
    for (const p of raw.procedures.procedures) this.procs.set(p.id, p);
    this.items = raw.items.items;
    for (const it of this.items) this.itemById.set(it.id, it);
    this.diseases = raw.diseases.diseases;
    this.formula = raw.formula;
    this.trees = raw.trees;
    this.approx = raw.approx;
    this.questionnaire = raw.questionnaire;
    this.guide = raw.guide;
  }

  rule(id: string): Rule {
    const r = this.rules.get(id);
    if (!r) throw new Error(`[kb] 규칙 ${id} 이(가) legal_rules.json 에 없습니다`);
    return r;
  }
  usable(id: string): boolean { return USABLE_STATUSES.has(this.rule(id).verification_status); }
  refs(ruleIds: string[]): SourceRef[] {
    const out: SourceRef[] = [];
    for (const id of ruleIds) {
      const r = this.rule(id);
      for (const s of r.sources) out.push({ rule: id, source: s.src, article: s.article, title: this.sources.get(s.src)?.title ?? s.src, status: r.verification_status });
    }
    return out;
  }
  /** 고시 기준 52개 항목 (영역별) */
  v52(domain: string): ItemDef[] {
    const ko: Record<string, string> = { PHY: '신체기능', COG: '인지기능', BEH: '행동변화', NUR: '간호처치', REH: '재활' };
    return this.items.filter((i) => i.in_v52 && i.domain === ko[domain]);
  }
  /** 트리 점수를 주 추정치로 써도 되는가: 사람이 원문 대조를 마치고 OFFICIAL_VERIFIED 로 바꾼 경우만 */
  treesVerified(): boolean {
    return this.trees._meta.status === 'OFFICIAL_VERIFIED' && Object.values(this.trees.trees).every((t) => t.status === 'OFFICIAL_VERIFIED' && t.all_checks_passed);
  }
  integrity(): string[] {
    const errs: string[] = [];
    for (const r of this.rules.values()) for (const s of r.sources ?? []) if (!this.sources.has(s.src)) errs.push(`${r.id}: 알 수 없는 출처 ${s.src}`);
    for (const p of this.procs.values()) {
      for (const d of [...p.docs_now, ...p.docs_later]) if (!this.docs.has(d)) errs.push(`${p.id}: 알 수 없는 서류 ${d}`);
      for (const r of [...p.rules, ...p.steps.flatMap((s) => s.rules)]) if (!this.rules.has(r)) errs.push(`${p.id}: 알 수 없는 규칙 ${r}`);
    }
    for (const d of this.docs.values()) for (const r of d.sources ?? []) if (!this.rules.has(r)) errs.push(`${d.id}: 알 수 없는 규칙 ${r}`);
    const stages = new Set(this.questionnaire.stages.map((s) => s.id));
    const itemLike = /^(PHY|COG|BEH|NUR|REH)-\d\d$/;
    for (const s of this.questionnaire.steps) {
      if (!stages.has(s.stage)) errs.push(`질문 ${s.id}: 알 수 없는 단계 ${s.stage}`);
      for (const o of s.options ?? []) {
        if (s.type === 'chips' && itemLike.test(o.value) && !this.itemById.has(o.value)) errs.push(`질문 ${s.id}: 알 수 없는 항목 ${o.value}`);
        for (const k of Object.keys(o.sets ?? {})) if (itemLike.test(k) && !this.itemById.has(k)) errs.push(`질문 ${s.id}: 알 수 없는 항목 ${k}`);
      }
    }
    return errs;
  }
}
