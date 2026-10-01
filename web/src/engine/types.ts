// 공통 타입. 엔진은 UI 와 분리된 순수 함수이고, 모든 기준 데이터는 Kb(근거 DB)로 주입받는다.

export type Domain = 'PHY' | 'COG' | 'BEH' | 'NUR' | 'REH';
export const DOMAINS: Domain[] = ['PHY', 'COG', 'BEH', 'NUR', 'REH'];
export const DOMAIN_KO: Record<Domain, string> = { PHY: '신체기능', COG: '인지기능', BEH: '행동변화', NUR: '간호처치', REH: '재활' };

/** 조사 항목 값: 신체·재활 1~3, 인지·행동·간호 0/1, null = 잘 모름 */
export type ItemValues = Record<string, number | null>;

/** 보호자 답변 (localStorage 에 그대로 저장되는 객관식 답) */
export interface Answers {
  [questionId: string]: string | string[] | undefined;
}

export type GradeCode = '1' | '2' | '3' | '4' | '5' | 'cognitive' | 'none';
export const GRADE_KO: Record<GradeCode, string> = { '1': '1등급', '2': '2등급', '3': '3등급', '4': '4등급', '5': '5등급', cognitive: '인지지원등급', none: '등급외' };
/** 중증도 순위 (클수록 중증) */
export const GRADE_RANK: Record<GradeCode, number> = { none: 0, cognitive: 1, '5': 2, '4': 3, '3': 4, '2': 5, '1': 6 };

// ---------- 판단 엔진(app/ 에서 이식) ----------
export type FactStatus = 'confirmed_by_document' | 'stated_by_guardian' | 'unknown';
export interface Fact<T = unknown> { value: T; status: FactStatus; evidence: string; source: 'answer' | 'estimate' }
export type GradeStatus = 'none' | 'pending' | 'out_of_grade' | 'graded';
export type Grade = 1 | 2 | 3 | 4 | 5 | 'cognitive';
export type Living = 'alone' | 'elderly_only' | 'minor_or_elderly_only' | 'with_family';
export type Insurance = 'health' | 'medical_aid_basic' | 'medical_aid_other';
export type Dementia = 'diagnosed' | 'suspected' | 'none';

export interface FactMap {
  relation?: Fact<string>;
  age_over65?: Fact<boolean>;
  insurance?: Fact<Insurance>;
  low_income?: Fact<boolean>;
  grade_status?: Fact<GradeStatus>;
  grade?: Fact<Grade>;
  validity_end?: Fact<string>;
  facility_in_cert?: Fact<boolean>;
  current_home_services?: Fact<boolean>;
  dementia?: Fact<Dementia>;
  diseases?: Fact<string[]>;
  disease_label?: Fact<string>;
  living?: Fact<Living>;
  caregiver_difficulty?: Fact<boolean>;
  housing_poor?: Fact<boolean>;
  behavior_problem?: Fact<boolean>;
  goal?: Fact<'facility' | 'home' | 'info'>;
  in_nursing_hospital?: Fact<boolean>;
  applied_date?: Fact<string>;
  notice_date?: Fact<string>;
  dissatisfied_result?: Fact<boolean>;
  condition_worsened?: Fact<boolean>;
  items?: Fact<Record<string, string>>;
  [key: string]: Fact<any> | undefined;
}

export type ResultCode = 'MET' | 'PROCEDURE_REQUIRED' | 'NEEDS_CHECK' | 'NOT_ELIGIBLE' | 'NEEDS_EXPERT' | 'NOT_APPLICABLE';
export interface SourceRef { rule: string; source: string; article: string; title?: string; status?: string }
export interface Decision {
  id: string; title: string; result: ResultCode; summary: string; rule_ids: string[]; sources: SourceRef[];
  inputs_used: Record<string, unknown>; missing: string[]; next_actions: string[]; data?: Record<string, unknown>;
}
export interface TraceEntry { step: string; rule?: string; detail: string; level: 'info' | 'warn' | 'error' }
export interface DocItem {
  id: string; name: string; form?: string; when: 'now' | 'later'; required: string;
  submit_to?: string; timing?: string; procedure: string; sources: SourceRef[]; status: string; display_rule?: string;
  /** 누가 준비하나: self=보호자가 직접 쓰거나 챙김 / issued=병원·기관에서 발급받음 / nhis=공단이 보내줌 */
  prep?: DocPrep; prep_where?: string;
}
export type DocPrep = 'self' | 'issued' | 'nhis';
export interface ActionItem { id: string; priority: number; text: string; detail?: string; rule_ids: string[] }
