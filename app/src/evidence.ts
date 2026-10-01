// F. 공식 근거 데이터베이스 로더
// data/ 폴더의 JSON(법령 출처·판단 규칙·서류·절차·조사항목·노인성 질병)을 읽어 엔진에 제공한다.
// 기준이 바뀌면 JSON만 수정하면 되고, 코드는 규칙 ID로만 참조한다.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import type { SourceRef } from './types.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = process.env.LTC_DATA_DIR ?? path.resolve(here, '../../data');

function load(name: string): any {
  const p = path.join(DATA_DIR, name);
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch (e) {
    throw new Error(`[evidence] ${name} 을(를) 읽을 수 없습니다 (${p}): ${(e as Error).message}`);
  }
}

// 자동 판단에 사용할 수 있는 검증 상태 (지시서: 검증되지 않은 규칙은 자동 판단에 사용하지 않음)
export const USABLE_STATUSES = new Set(['OFFICIAL_VERIFIED']);

export interface Rule { id: string; category: string; rule: string; sources: { src: string; article: string }[]; verification_status: string; certainty?: string; quote?: string }
export interface SourceDoc { id: string; title: string; version?: string; effective_date?: string; verification_status: string; url_primary?: string; raw_file?: string }
export interface DocDef { id: string; official_name: string; form?: string; required?: string; submit_to?: string; timing?: string; verification_status: string; sources?: string[] }
export interface ProcStep { id: string; text: string; rules: string[] }
export interface ProcDef { id: string; title: string; steps: ProcStep[]; docs_now: string[]; docs_later: string[]; rules: string[] }
export interface ItemDef { id: string; domain: string; official_item_name: string; guardian_question: string; in_v52: boolean; in_v65: boolean; polarity: string }
export interface Disease { mark: string; name: string; code: string }

export class Evidence {
  rules = new Map<string, Rule>();
  sources = new Map<string, SourceDoc>();
  docs = new Map<string, DocDef>();
  procs = new Map<string, ProcDef>();
  items: ItemDef[] = [];
  diseases: Disease[] = [];
  loadedAt = new Date().toISOString();

  constructor() {
    for (const r of load('legal_rules.json').rules) this.rules.set(r.id, r);
    for (const s of load('sources.json').sources) this.sources.set(s.id, s);
    for (const d of load('documents.json').documents) this.docs.set(d.id, d);
    for (const p of load('procedures.json').procedures) this.procs.set(p.id, p);
    this.items = load('assessment_items.json').items;
    this.diseases = load('geriatric_diseases.json').diseases;
  }

  rule(id: string): Rule {
    const r = this.rules.get(id);
    if (!r) throw new Error(`[evidence] 규칙 ${id} 이(가) legal_rules.json 에 없습니다`);
    return r;
  }

  /** 자동 판단에 써도 되는 규칙인가 */
  usable(id: string): boolean {
    return USABLE_STATUSES.has(this.rule(id).verification_status);
  }

  refs(ruleIds: string[]): SourceRef[] {
    const out: SourceRef[] = [];
    for (const id of ruleIds) {
      const r = this.rule(id);
      for (const s of r.sources) {
        const src = this.sources.get(s.src);
        out.push({ rule: id, source: s.src, article: s.article, title: src?.title ?? s.src, status: r.verification_status });
      }
    }
    return out;
  }

  /** 자료 무결성 점검: 오류 목록 반환 (테스트·서버 시작 시 사용) */
  integrity(): string[] {
    const errs: string[] = [];
    for (const r of this.rules.values()) {
      if (!r.sources?.length) errs.push(`${r.id}: 출처 없음`);
      for (const s of r.sources ?? []) if (!this.sources.has(s.src)) errs.push(`${r.id}: 알 수 없는 출처 ${s.src}`);
    }
    for (const p of this.procs.values()) {
      for (const d of [...p.docs_now, ...p.docs_later]) if (!this.docs.has(d)) errs.push(`${p.id}: 알 수 없는 서류 ${d}`);
      for (const r of [...p.rules, ...p.steps.flatMap((s) => s.rules)]) if (!this.rules.has(r)) errs.push(`${p.id}: 알 수 없는 규칙 ${r}`);
    }
    for (const d of this.docs.values()) for (const r of d.sources ?? []) if (!this.rules.has(r)) errs.push(`${d.id}: 알 수 없는 규칙 ${r}`);
    return errs;
  }
}

let cached: Evidence | null = null;
export function evidence(): Evidence {
  if (!cached) cached = new Evidence();
  return cached;
}
