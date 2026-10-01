// 상담 세션: 입력 → 추출 → 사실 병합 → 판단 → 서류·절차 → 설명 → 다음 질문
// 세션은 파일(.state/sessions)에 저장되어 중단 후 재개할 수 있고, 답변은 언제든 수정할 수 있다.
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Fact, FactMap, Result, Question } from './types.ts';
import { extractFacts } from './legacy/llm/adapter.ts';
import { decide } from './engine/decide.ts';
import { assessmentSummary, explain } from './engine/explain.ts';
import { nextQuestions, applyAnswer, QUESTIONS } from './engine/questions.ts';

export const ENGINE_VERSION = '0.1.0';

export interface Session {
  id: string; createdAt: string; updatedAt: string;
  messages: { at: string; text: string; provider: string; dropped: unknown[] }[];
  answered: Record<string, string>;
  facts: FactMap;
  history: { at: string; key: string; from: unknown; to: unknown; source: string }[];
}

export interface State { session: Session; questions: Question[]; result: Result }

const stateDir = () => process.env.LTC_STATE_DIR ?? path.resolve('.state');
const today = () => process.env.LTC_TODAY ?? new Date().toISOString().slice(0, 10);

function merge(s: Session, incoming: FactMap, source: string) {
  for (const [k, f] of Object.entries(incoming)) {
    if (!f) continue;
    const prev = s.facts[k];
    let next: Fact = f;
    if (k === 'items' && prev) next = { ...f, value: { ...(prev.value as object), ...(f.value as object) }, evidence: `${prev.evidence} / ${f.evidence}` };
    if (k === 'diseases' && prev) next = { ...f, value: [...new Set([...(prev.value as string[]), ...(f.value as string[])])] };
    if (JSON.stringify(prev?.value) !== JSON.stringify(next.value)) s.history.push({ at: new Date().toISOString(), key: k, from: prev?.value, to: next.value, source });
    s.facts[k] = next;
  }
}

/** 순수 분석 함수 (테스트에서 직접 사용) */
export function analyze(facts: FactMap, answered: Record<string, string>, day = today()): { result: Result; questions: Question[] } {
  const out = decide(facts, day);
  const assessment = assessmentSummary(facts);
  const explanation = explain(facts, out, assessment, day);
  const result: Result = {
    decisions: out.decisions, procedures: out.procedures, documents: out.documents,
    excluded_documents: out.excluded_documents, actions: out.actions, assessment, explanation, trace: out.trace,
    engine_version: ENGINE_VERSION, is_official_decision: false,
  };
  return { result, questions: nextQuestions(facts, answered) };
}

export class SessionStore {
  dir = path.join(stateDir(), 'sessions');
  constructor() { mkdirSync(this.dir, { recursive: true }); }
  file(id: string) { if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error('잘못된 세션 ID'); return path.join(this.dir, id + '.json'); }
  load(id: string): Session { const p = this.file(id); if (!existsSync(p)) throw new Error('세션을 찾을 수 없습니다'); return JSON.parse(readFileSync(p, 'utf8')); }
  save(s: Session) { s.updatedAt = new Date().toISOString(); writeFileSync(this.file(s.id), JSON.stringify(s, null, 1)); }

  create(): Session {
    const s: Session = { id: randomUUID(), createdAt: new Date().toISOString(), updatedAt: '', messages: [], answered: {}, facts: {}, history: [] };
    this.save(s); return s;
  }
  state(s: Session): State { const { result, questions } = analyze(s.facts, s.answered); return { session: s, questions, result }; }

  async message(id: string, text: string): Promise<State> {
    const s = this.load(id);
    const ex = await extractFacts(text, today());
    s.messages.push({ at: new Date().toISOString(), text, provider: ex.provider, dropped: ex.dropped });
    merge(s, ex.facts, ex.provider);
    this.save(s); return this.state(s);
  }
  answer(id: string, questionId: string, value: string): State {
    const s = this.load(id);
    const before = s.facts;
    s.facts = applyAnswer(s.facts, questionId, value);
    for (const k of Object.keys(s.facts)) if (before[k] !== s.facts[k]) s.history.push({ at: new Date().toISOString(), key: k, from: before[k]?.value, to: s.facts[k]!.value, source: `answer:${questionId}` });
    s.answered[questionId] = value;
    this.save(s); return this.state(s);
  }
  /** 사실 직접 수정 (value=null 이면 삭제 → 관련 질문을 다시 물음) */
  edit(id: string, key: string, value: unknown): State {
    const s = this.load(id);
    const prev = s.facts[key];
    if (value === null) { delete s.facts[key]; for (const q of QUESTIONS) if (q.slot === key) delete s.answered[q.id]; }
    else s.facts[key] = { value, status: 'stated_by_guardian', evidence: `보호자 수정: ${JSON.stringify(value)}`, source: 'edit', updatedAt: new Date().toISOString() };
    s.history.push({ at: new Date().toISOString(), key, from: prev?.value, to: value, source: 'edit' });
    this.save(s); return this.state(s);
  }
}
