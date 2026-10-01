// 가상 프로필 12개 (가벼움 → 중증): 추정 등급 범위가 상식적으로 단조 증가하는지
import { test, expect } from 'vitest';
import { items, est } from './helpers.ts';
import { GRADE_RANK } from '../src/engine/types.ts';
import type { Answers } from '../src/engine/types.ts';

const P = (name: string, a: Answers): [string, Answers] => [name, { dementia: 'none', dem_adl: 'independent', ...a }];
const PROFILES: [string, Answers][] = [
  P('P01 혼자 다 하심', items('1')),
  P('P02 목욕만 일부 도움', items('1', [], { 'PHY-04': '2' })),
  P('P03 목욕·옷 입기 일부 도움', items('1', [], { 'PHY-04': '2', 'PHY-01': '2' })),
  P('P04 목욕 전부, 옷·세수 일부, 깜빡하심', items('1', ['COG-01'], { 'PHY-04': '3', 'PHY-01': '2', 'PHY-02': '2' })),
  P('P05 + 화장실·소변 일부, 날짜 모름', items('1', ['COG-01', 'COG-02'], { 'PHY-04': '3', 'PHY-01': '2', 'PHY-02': '2', 'PHY-10': '2', 'PHY-12': '2' })),
  P('P06 신체 대부분 일부 도움, 무릎 한쪽 굳음', items('2', ['COG-01', 'COG-02'], { 'PHY-05': '1', 'PHY-06': '1', 'PHY-07': '1', 'REH-01': '1', 'REH-02': '1', 'REH-03': '1', 'REH-04': '1', 'REH-05': '1', 'REH-06': '1', 'REH-07': '1', 'REH-08': '1', 'REH-10': '1' })),
  P('P07 신체 전부 일부 도움, 인지 3개, 밤낮 바뀜', items('2', ['COG-01', 'COG-02', 'COG-03', 'BEH-04'])),
  P('P08 + 목욕·화장실 전부, 배회', items('2', ['COG-01', 'COG-02', 'COG-03', 'BEH-04', 'BEH-07', 'BEH-09'], { 'PHY-04': '3', 'PHY-10': '3', 'PHY-01': '3' })),
  P('P09 절반 전부 도움, 인지 5개, 행동 5개', items('2', ['COG-01', 'COG-02', 'COG-03', 'COG-04', 'COG-06', 'BEH-04', 'BEH-05', 'BEH-06', 'BEH-07', 'BEH-09'], { 'PHY-01': '3', 'PHY-02': '3', 'PHY-03': '3', 'PHY-04': '3', 'PHY-10': '3', 'PHY-11': '3', 'PHY-12': '3' })),
  P('P10 거의 누워 지내심', items('3', ['COG-01', 'COG-02', 'COG-03', 'COG-04', 'COG-06', 'BEH-04'], { 'PHY-05': '2', 'PHY-06': '2' })),
  P('P11 누워 지내심 + 욕창·소변줄', items('3', ['COG-01', 'COG-02', 'COG-03', 'COG-04', 'COG-05', 'COG-06', 'COG-07', 'BEH-04', 'NUR-04', 'NUR-07'])),
  P('P12 최중증 + 경관영양·흡인·산소', items('3', ['COG-01', 'COG-02', 'COG-03', 'COG-04', 'COG-05', 'COG-06', 'COG-07', 'BEH-04', 'BEH-05', 'NUR-02', 'NUR-03', 'NUR-04', 'NUR-05', 'NUR-07'])),
];

test('가상 프로필 12개: 더 중증일수록 추정 점수와 예상 등급이 내려가지 않는다', () => {
  const rows = PROFILES.map(([name, a]) => { const e = est(a); return { name, mid: e.score.mid, lo: e.score.low, hi: e.score.high, label: e.label, least: Math.min(...e.grades.map((g) => GRADE_RANK[g])), most: Math.max(...e.grades.map((g) => GRADE_RANK[g])) }; });
  const table = '\n' + rows.map((r) => `${r.name}: ${r.label} (${r.lo}~${r.hi})`).join('\n');
  for (let i = 1; i < rows.length; i++) {
    expect(rows[i].mid, table).toBeGreaterThanOrEqual(rows[i - 1].mid);
    expect(rows[i].least, table).toBeGreaterThanOrEqual(rows[i - 1].least);
    expect(rows[i].most, table).toBeGreaterThanOrEqual(rows[i - 1].most);
  }
  // 양 끝 상식 점검: 혼자 다 하시면 등급외, 최중증은 1등급
  expect(rows[0].label, table).toBe('등급외');
  expect(rows[rows.length - 1].label, table).toBe('1등급');
  // 중간 프로필은 '3~4등급' 같은 범위로 나온다
  expect(rows.some((r) => /^\d~\d등급$/.test(r.label)), table).toBe(true);
});

test('치매 보정: 같은 상태에서 치매 진단 + 인지증 자립도 요건을 갖추면 점수가 내려가지 않는다', () => {
  for (const [, a] of PROFILES) {
    const no = est(a), yes = est({ ...a, dementia: 'diagnosed', dem_adl: 'partial' });
    expect(yes.score.mid).toBeGreaterThanOrEqual(no.score.mid);
  }
});
