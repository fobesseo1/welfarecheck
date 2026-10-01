import { kb } from '../src/data.ts';
import { buildResult } from '../src/engine/result.ts';
import { itemValues, dementiaAnswer, adlAnswer } from '../src/engine/answers.ts';
import { estimate } from '../src/engine/scoring.ts';
import type { Answers } from '../src/engine/types.ts';

export { kb };
export const TODAY = '2026-09-29';

/** 조사 항목을 한꺼번에 채운 답변 (신체·재활 = level, 체크리스트 = yes 목록만 '있음') */
export function items(level: '1' | '2' | '3', yes: string[] = [], levels: Record<string, '1' | '2' | '3'> = {}): Answers {
  const a: Answers = {};
  for (const it of kb.items) a[it.id] = it.id.startsWith('PHY') || it.id.startsWith('REH') ? (levels[it.id] ?? level) : yes.includes(it.id) ? 'yes' : 'no';
  return a;
}

export function run(a: Answers, today = TODAY) {
  const r = buildResult(kb, a, today);
  const dec = Object.fromEntries(r.decide.decisions.map((d) => [d.id, d]));
  return {
    r, dec,
    procs: r.decide.procedures.map((p) => p.id),
    docsNow: r.decide.documents.filter((d) => d.when === 'now').map((d) => d.id),
    docsLater: r.decide.documents.filter((d) => d.when === 'later').map((d) => d.id),
    actions: r.actions.map((x) => x.id),
  };
}

export function est(a: Answers) {
  return estimate(kb, { values: itemValues(kb, a), dementia: dementiaAnswer(a), adl: adlAnswer(a) });
}
