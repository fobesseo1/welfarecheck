import { extract } from '../src/legacy/extract.ts';
import { applyAnswer } from '../src/engine/questions.ts';
import { analyze } from '../src/session.ts';
import type { FactMap } from '../src/types.ts';

export function run(text: string, answers: [string, string][] = [], today = '2026-09-29') {
  let facts: FactMap = extract(text, { today });
  const answered: Record<string, string> = {};
  for (const [q, v] of answers) { facts = applyAnswer(facts, q, v); answered[q] = v; }
  const { result, questions } = analyze(facts, answered, today);
  const dec = Object.fromEntries(result.decisions.map((d) => [d.id, d]));
  return { facts, result, questions, dec, procs: result.procedures.map((p) => p.id), docsNow: result.documents.filter((d) => d.when === 'now').map((d) => d.id), docsLater: result.documents.filter((d) => d.when === 'later').map((d) => d.id), actions: result.actions.map((a) => a.id) };
}
