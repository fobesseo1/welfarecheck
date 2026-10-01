// 터미널 데모: node src/cli.ts "보호자 설명" [기준일]
// 인자가 없으면 지시서의 사례 A·B·C 를 실행한다.
import { extractFacts } from './legacy/llm/adapter.ts';
import { analyze } from './session.ts';

const CASES = process.argv[2] ? [process.argv[2]] : [
  '어머니가 82세인데 등급은 없어요. 치매 진단을 받으셨고 혼자 화장실 가기가 힘드세요.',
  '아버지가 4등급이고 현재 재가급여를 받고 계세요. 어머니가 혼자 돌보시는데 너무 힘들어하세요.',
  '아버지가 2등급이고 시설급여를 이용할 수 있는 인정서가 있어요. 이제 요양원에 모시려고 합니다.',
];
const today = process.argv[3] ?? new Date().toISOString().slice(0, 10);

for (const text of CASES) {
  const ex = await extractFacts(text, today);
  const { result, questions } = analyze(ex.facts, {}, today);
  console.log('\n' + '='.repeat(70) + `\n입력: ${text}\n추출기: ${ex.provider}`);
  console.log('추출: ' + Object.entries(ex.facts).map(([k, f]) => `${k}=${JSON.stringify(f!.value)}`).join(', '));
  console.log('\n판단:'); for (const d of result.decisions) console.log(`  ${d.id} ${d.result.padEnd(18)} ${d.summary} [${d.rule_ids.join(',')}]`);
  console.log('\n절차: ' + result.procedures.map((p) => p.title).join(' → '));
  console.log('지금 서류: ' + result.documents.filter((d) => d.when === 'now').map((d) => d.name).join(', '));
  console.log('나중 서류: ' + result.documents.filter((d) => d.when === 'later').map((d) => d.name).join(', '));
  if (result.excluded_documents.length) console.log('자동 안내 제외(근거 대조 전): ' + result.excluded_documents.map((d) => d.name).join(', '));
  console.log('\n지금 할 일:\n' + result.explanation.actions);
  console.log('\n다음 질문: ' + questions.map((q) => q.text).join(' | '));
}
