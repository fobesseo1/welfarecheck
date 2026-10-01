// 공통 타입 정의
// 원칙: 모든 사실(Fact)은 값 + 확인 상태 + 원문 근거를 함께 가진다.

export type FactStatus = 'confirmed_by_document' | 'stated_by_guardian' | 'unknown';
export type FactSource = 'extractor' | 'llm' | 'answer' | 'edit';

export interface Fact<T = unknown> {
  value: T;
  status: FactStatus;
  evidence: string; // 원문 인용 또는 답변 내용
  source: FactSource;
  updatedAt: string;
}

// 판단에 쓰는 사실 키
export type GradeStatus = 'none' | 'pending' | 'out_of_grade' | 'graded';
export type Grade = 1 | 2 | 3 | 4 | 5 | 'cognitive';
export type Living = 'alone' | 'elderly_only' | 'minor_or_elderly_only' | 'with_family';
export type Insurance = 'health' | 'medical_aid_basic' | 'medical_aid_other';
export type Dementia = 'diagnosed' | 'suspected' | 'none';

export interface FactMap {
  relation?: Fact<string>;
  age?: Fact<number>;
  age_over65?: Fact<boolean>;
  main_caregiver?: Fact<string>;
  insurance?: Fact<Insurance>;
  low_income?: Fact<boolean>;
  grade_status?: Fact<GradeStatus>;
  grade?: Fact<Grade>;
  validity_end?: Fact<string>; // YYYY-MM-DD
  facility_in_cert?: Fact<boolean>; // 인정서 급여종류에 시설급여 포함 여부
  current_home_services?: Fact<boolean>;
  dementia?: Fact<Dementia>;
  diseases?: Fact<string[]>; // 노인성 질병 코드 목록 (geriatric_diseases.json)
  other_condition?: Fact<string>;
  living?: Fact<Living>;
  caregiver_difficulty?: Fact<boolean>;
  housing_poor?: Fact<boolean>;
  behavior_problem?: Fact<boolean>;
  home_service_unusable?: Fact<boolean>;
  goal?: Fact<'facility' | 'home' | 'info'>;
  in_nursing_hospital?: Fact<boolean>;
  applied_date?: Fact<string>;
  notice_date?: Fact<string>;
  dissatisfied_result?: Fact<boolean>;
  condition_worsened?: Fact<boolean>;
  items?: Fact<Record<string, string>>; // 조사 항목 ID → 값 후보 (예: PHY-10 → 'needs_help')
  [key: string]: Fact<any> | undefined;
}

export type ResultCode = 'MET' | 'PROCEDURE_REQUIRED' | 'NEEDS_CHECK' | 'NOT_ELIGIBLE' | 'NEEDS_EXPERT' | 'NOT_APPLICABLE';

export interface SourceRef { rule: string; source: string; article: string; title?: string; status?: string }

export interface Decision {
  id: string; // A~F, 기타
  title: string;
  result: ResultCode;
  summary: string; // 보호자용 한 줄
  rule_ids: string[];
  sources: SourceRef[];
  inputs_used: Record<string, unknown>;
  missing: string[];
  next_actions: string[];
  data?: Record<string, unknown>;
}

export interface TraceEntry { step: string; rule?: string; detail: string; level: 'info' | 'warn' | 'error' }

export interface Question {
  id: string;
  text: string;
  slot: string;
  options: { label: string; value: string }[];
  why: string;
  input?: 'date' | 'number' | 'multi';
}

export interface DocItem {
  id: string; name: string; form?: string; when: 'now' | 'later'; required: string;
  submit_to?: string; timing?: string; procedure: string; sources: SourceRef[]; status: string;
}

export interface ActionItem { id: string; priority: number; text: string; rule_ids: string[] }

export interface Result {
  decisions: Decision[];
  procedures: { id: string; title: string; steps: { id: string; text: string; rules: string[] }[] }[];
  documents: DocItem[];
  excluded_documents: { id: string; name: string; reason: string }[];
  actions: ActionItem[];
  assessment: AssessmentSummary;
  explanation: Record<'situation' | 'grade_review' | 'facility' | 'documents' | 'actions', string>;
  trace: TraceEntry[];
  engine_version: string;
  is_official_decision: false;
}

export interface AssessmentSummary {
  v52: { known: number; total: number };
  v65: { known: number; total: number };
  domains: { domain: string; known: { id: string; name: string; value: string }[]; unknown_count: number }[];
  note: string;
}
