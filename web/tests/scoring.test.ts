// 채점: 환산표(모든 구간), 등급 경계값, 치매 요건, 치매 보정식, '잘 모름' 증가 시 범위 확대
import { describe, test, expect } from 'vitest';
import { kb, items, est } from './helpers.ts';
import { convert, domainScores, gradeFor, dementiaProbability, applyDementiaCorrection, filledValues, formatGradeRange } from '../src/engine/scoring.ts';
import { itemValues } from '../src/engine/answers.ts';
import { DOMAINS, type Domain, type Answers, GRADE_RANK } from '../src/engine/types.ts';
import formula from '../../data/grading_formula.json' with { type: 'json' };

const TABLE = { PHY: '신체기능', COG: '인지기능', BEH: '행동변화', NUR: '간호처치', REH: '재활' } as const;
const RANGE: Record<Domain, [number, number]> = { PHY: [12, 36], COG: [0, 7], BEH: [0, 14], NUR: [0, 9], REH: [10, 30] };

describe('영역별 100점 환산표', () => {
  for (const d of DOMAINS) {
    test(`${TABLE[d]}: 원점수 ${RANGE[d][0]}~${RANGE[d][1]} 전 구간이 표 값과 일치하고 단조 증가`, () => {
      const t = (formula.conversion_tables as any)[TABLE[d]] as Record<string, number>;
      const [lo, hi] = RANGE[d];
      expect(Object.keys(t).map(Number).sort((a, b) => a - b)).toEqual(Array.from({ length: hi - lo + 1 }, (_, i) => lo + i));
      let prev = -1;
      for (let raw = lo; raw <= hi; raw++) {
        const v = convert(kb, d, raw);
        expect(v).toBe(t[String(raw)]);
        expect(v).toBeGreaterThan(prev);
        prev = v;
      }
      expect(convert(kb, d, lo)).toBe(0);
      expect(convert(kb, d, hi)).toBe(100);
      expect(() => convert(kb, d, lo - 1)).toThrow();
      expect(() => convert(kb, d, hi + 1)).toThrow();
    });
  }
  test('항목 수: 고시 52개 = 신체 12 + 인지 7 + 행동 14 + 간호 9 + 재활 10', () => {
    expect(DOMAINS.map((d) => kb.v52(d).length)).toEqual([12, 7, 14, 9, 10]);
  });
  test('항목 점수표: 완전자립 1·부분도움 2·완전도움 3, 증상 예 1·아니오 0 → 원점수 합', () => {
    const light = domainScores(kb, itemValues(kb, items('1')), 'best');
    expect([light.PHY.raw, light.COG.raw, light.BEH.raw, light.NUR.raw, light.REH.raw]).toEqual([12, 0, 0, 0, 10]);
    const heavy = domainScores(kb, itemValues(kb, items('3', kb.items.map((i) => i.id))), 'best');
    expect([heavy.PHY.raw, heavy.COG.raw, heavy.BEH.raw, heavy.NUR.raw, heavy.REH.raw]).toEqual([36, 7, 14, 9, 30]);
    expect(DOMAINS.map((d) => heavy[d].conv)).toEqual([100, 100, 100, 100, 100]);
    // 65개 중 고시 52개 밖의 항목(PHY-13, COG-08 등)은 점수에 들어가지 않는다
    const extra = domainScores(kb, itemValues(kb, { ...items('1'), 'PHY-13': '3', 'COG-10': 'yes', 'NUR-10': 'yes' }), 'best');
    expect([extra.PHY.raw, extra.COG.raw, extra.NUR.raw]).toEqual([12, 0, 0]);
  });
});

describe('등급 구간 경계값 (시행령 제7조, R-GRADE-01·02)', () => {
  const cases: [number, string, string][] = [
    // 점수, 치매 있음, 치매 없음
    [44.9, 'cognitive', 'none'], [45, '5', 'none'], [50.9, '5', 'none'], [51, '4', '4'], [59.9, '4', '4'],
    [60, '3', '3'], [74.9, '3', '3'], [75, '2', '2'], [94.9, '2', '2'], [95, '1', '1'], [0, 'cognitive', 'none'], [130, '1', '1'],
  ];
  for (const [s, withD, withoutD] of cases) {
    test(`${s}점 → 치매 ${withD} / 치매 없음 ${withoutD}`, () => {
      expect(gradeFor(kb, s, true)).toBe(withD);
      expect(gradeFor(kb, s, false)).toBe(withoutD);
    });
  }
  test('치매가 없으면 어떤 점수에서도 5등급·인지지원등급이 나오지 않는다', () => {
    for (let s = 0; s <= 120; s += 0.1) expect(['5', 'cognitive']).not.toContain(gradeFor(kb, s, false));
  });
});

describe('치매 보정 (고시 제2조제5호, 별표2)', () => {
  test('계산용 계수가 고시 산식 문자열과 같다', () => {
    const nums = formula.dementia_regression_bylaw2.formula.match(/-?\d+\.\d+|-?\d+(?=×)/g)!.map(Number);
    const r = formula.dementia_regression_bylaw2.structured;
    expect(nums).toEqual([r.intercept, ...Object.values(r.item_coefficients), r.adl_score.coefficient, r.behavior_score.coefficient]);
  });
  test('로지스틱 값 계산 = A/(1+A)', () => {
    const vals = filledValues(kb, itemValues(kb, { ...items('1'), 'COG-02': 'yes', 'BEH-04': 'yes', 'BEH-07': 'yes', 'BEH-09': 'yes', 'REH-03': '2' }), 'best');
    const z = -27 + 1.37 + 1.2 + 0.89 + 3.29 + 0.5 * 2 + 0.89 * 24 + 0.18 * 5;
    const p = dementiaProbability(kb, vals, { PHY: 24, BEH: 5 });
    expect(p).toBeCloseTo(Math.exp(z) / (1 + Math.exp(z)), 10);
    expect(p).toBeGreaterThan(0.5);
    const low = dementiaProbability(kb, filledValues(kb, itemValues(kb, items('1')), 'best'), { PHY: 12, BEH: 0 });
    expect(low).toBeLessThan(0.5);
  });
  test('51 이상 75 미만 + 요건 충족 + 값 ≥ 0.5 → 한 단계 위 등급 최저점수', () => {
    expect(applyDementiaCorrection(kb, 50.9, true, 0.9)).toEqual({ score: 50.9, applied: false });
    expect(applyDementiaCorrection(kb, 51, true, 0.9)).toEqual({ score: 60, applied: true });
    expect(applyDementiaCorrection(kb, 59.9, true, 0.9)).toEqual({ score: 60, applied: true });
    expect(applyDementiaCorrection(kb, 60, true, 0.9)).toEqual({ score: 75, applied: true });
    expect(applyDementiaCorrection(kb, 74.9, true, 0.5)).toEqual({ score: 75, applied: true });
    expect(applyDementiaCorrection(kb, 75, true, 0.9)).toEqual({ score: 75, applied: false });
    expect(applyDementiaCorrection(kb, 65, true, 0.49)).toEqual({ score: 65, applied: false });
    expect(applyDementiaCorrection(kb, 65, false, 0.99)).toEqual({ score: 65, applied: false });
  });
  test('치매 진단·인지증 자립도 요건이 없으면 추정에서도 보정하지 않는다', () => {
    const base = { ...items('2', ['COG-01', 'COG-02', 'BEH-04', 'BEH-07', 'BEH-09']) };
    const yes = est({ ...base, dementia: 'diagnosed', dem_adl: 'partial' });
    const noDx = est({ ...base, dementia: 'none', dem_adl: 'partial' });
    const indep = est({ ...base, dementia: 'diagnosed', dem_adl: 'independent' });
    expect(yes.correction.eligible).toBe('yes');
    expect(noDx.correction.eligible).toBe('no');
    expect(indep.correction.eligible).toBe('no');
    expect(noDx.correction.low || noDx.correction.high).toBe(false);
    expect(yes.score.low).toBeGreaterThanOrEqual(noDx.score.low);
  });
});

describe("'잘 모름' 이 많을수록 범위가 넓어진다", () => {
  test('항목을 하나씩 모름으로 바꾸면 점수 범위·등급 수가 줄지 않고, 결국 넓어진다', () => {
    const a: Answers = { ...items('2', ['COG-01', 'BEH-04']), dementia: 'diagnosed', dem_adl: 'incomplete' };
    const ids = kb.items.filter((i) => i.in_v52).map((i) => i.id);
    let prevWidth = -1, prevGrades = 0; const first = est(a);
    for (let k = 0; k <= ids.length; k += 4) {
      const b = { ...a }; for (const id of ids.slice(0, k)) b[id] = 'unknown';
      const e = est(b);
      const width = e.score.high - e.score.low;
      expect(width).toBeGreaterThanOrEqual(prevWidth - 1e-9);
      expect(e.grades.length).toBeGreaterThanOrEqual(prevGrades);
      expect(e.unknown.count).toBe(Math.min(k, ids.length));
      prevWidth = width; prevGrades = e.grades.length;
    }
    const all = est(Object.fromEntries(Object.entries(a).map(([k, v]) => [k, /^(PHY|COG|BEH|NUR|REH)-/.test(k) ? 'unknown' : v])));
    expect(all.score.high - all.score.low).toBeGreaterThan(first.score.high - first.score.low + 50);
    expect(all.confidence).toBe('낮음');
  });
  test('모름이 없고 범위가 한 등급이면 신뢰도 높음, 치매 진단 여부를 모르면 한 단계 낮아진다', () => {
    const heavy = { ...items('3', ['NUR-04']), dementia: 'none', dem_adl: 'independent' };
    expect(est(heavy).confidence).toBe('높음');
    expect(est({ ...heavy, dementia: 'unknown' }).confidence).toBe('보통');
  });
});

describe('추정 결과 형식', () => {
  test('범위 표기', () => {
    expect(formatGradeRange(['3', '4'])).toBe('3~4등급');
    expect(formatGradeRange(['4', '3'])).toBe('3~4등급');
    expect(formatGradeRange(['2'])).toBe('2등급');
    expect(formatGradeRange(['5', 'none'])).toBe('5등급~등급외');
    expect(formatGradeRange(['cognitive', '4', '5'])).toBe('4등급~인지지원등급');
  });
  test('결과는 공식 판정이 아니며, 원문 대조 전에는 근사 모델을 쓰고 추정임을 밝힌다', () => {
    const e = est({ ...items('2'), dementia: 'none', dem_adl: 'independent' });
    expect(e.is_official).toBe(false);
    expect(kb.treesVerified()).toBe(false);
    expect(e.mode).toBe('approx');
    expect(e.notes.join(' ')).toMatch(/공식 산정식이 아닌 추정/);
    expect(e.score.low).toBeLessThanOrEqual(e.score.mid);
    expect(e.score.mid).toBeLessThanOrEqual(e.score.high);
  });
  test('점수에 가장 큰 영향을 준 답 3개: 도움이 필요하다고 답한 항목만, 영향이 큰 순서', () => {
    const e = est({ ...items('1', ['NUR-07'], { 'PHY-04': '3', 'PHY-10': '2' }), dementia: 'none', dem_adl: 'independent' });
    expect(e.influences.length).toBe(3);
    expect(e.influences.map((i) => i.itemId).sort()).toEqual(['NUR-07', 'PHY-04', 'PHY-10'].sort());
    expect(e.influences[0].delta).toBeGreaterThanOrEqual(e.influences[1].delta);
    const none = est({ ...items('1'), dementia: 'none', dem_adl: 'independent' });
    expect(none.influences).toEqual([]);
  });
  test('치매 의심(진단 전)이면 진단 후 시나리오를 따로 보여준다', () => {
    const a = { ...items('1', [], { 'PHY-01': '2', 'PHY-04': '2', 'PHY-10': '2' }), dementia: 'suspected', dem_adl: 'incomplete' };
    const e = est(a);
    expect(e.gradesIfDiagnosed).toBeDefined();
    expect(e.grades).not.toContain('5');
    expect(e.gradesIfDiagnosed!.grades.some((g) => g === '5' || g === 'cognitive')).toBe(true);
  });
  test('중증도 순위 상수', () => {
    expect(Object.entries(GRADE_RANK).sort((a, b) => a[1] - b[1]).map((x) => x[0])).toEqual(['none', 'cognitive', '5', '4', '3', '2', '1']);
  });
});
