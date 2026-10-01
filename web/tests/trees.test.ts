// 수형분석도 복원 결과 검증: 마디 수·최종마디 수·본문 예시 점수·점수 합·모든 입력에서 최종마디 도달
import { describe, test, expect } from 'vitest';
import { kb } from './helpers.ts';
import { evalTree, treeTotal, holds, treesUsable } from '../src/engine/scoring.ts';
import { DOMAINS, type Domain } from '../src/engine/types.ts';
import trees from '../../data/grading_trees.json' with { type: 'json' };

// 고시 [별표1] 본문에 적힌 값 (사람이 옮김): [마디 수(번호 최대), 최종마디 수, 예시 마디, 예시 점수]
const TEXT: Record<string, [number, number, number, number]> = {
  청결: [24, 13, 15, 1.2], 배설: [33, 17, 30, 0.3], 식사: [20, 11, 11, 7.1], 기능보조: [22, 12, 7, 1.2],
  행동변화대응: [14, 8, 7, 0.6], 간접지원: [16, 9, 3, 12.5], 간호처치: [17, 10, 14, 6.7], 재활훈련: [19, 11, 4, 2.5],
};

describe('복원한 8개 수형분석도', () => {
  test('8개 서비스군이 모두 있고, 원문 대조 전 상태로 표시되어 있다', () => {
    expect(Object.keys(trees.trees)).toEqual(Object.keys(TEXT));
    expect(trees._meta.status).toBe('RECONSTRUCTED_UNVERIFIED');
    expect(trees._meta.all_automatic_checks_passed).toBe(true);
    expect(treesUsable(kb)).toBe(true);
    expect(kb.treesVerified()).toBe(false);
  });

  for (const [name, [total, leaves, exNode, exScore]] of Object.entries(TEXT)) {
    test(`${name}: 마디 ${total}·최종마디 ${leaves}·마디 ${exNode}=${exScore}점`, () => {
      const t = kb.trees.trees[name];
      const nums = Object.keys(t.nodes).map(Number).sort((a, b) => a - b);
      expect(nums).toEqual(Array.from({ length: nums.length }, (_, i) => i));
      expect(Math.max(...nums)).toBe(total);
      const leafNums = nums.filter((n) => !t.nodes[n].children);
      // 배설: 원문 그림에 '마디 8' 이 두 번 표기(마디 9 없음) → 본문 수는 서로 다른 번호 기준. 보정한 마디를 빼면 일치
      const corrected = (t.corrections ?? []).map((c) => Number(/마디 (\d+) 로 보정/.exec(c)![1]));
      expect(leafNums.filter((n) => !corrected.includes(n)).length).toBe(leaves);
      expect(t.nodes[exNode].children).toBeUndefined();
      expect(t.nodes[exNode].score).toBe(exScore);
      // 모든 마디는 부모가 정확히 하나 (뿌리 제외)
      const parents = new Map<number, number>();
      for (const n of nums) for (const c of t.nodes[n].children ?? []) { expect(parents.has(c.node)).toBe(false); parents.set(c.node, n); }
      expect(nums.filter((n) => n !== 0).every((n) => parents.has(n))).toBe(true);
      // 부모 점수는 자식 점수 사이 (평균이므로)
      for (const n of nums) {
        const ch = t.nodes[n].children; if (!ch) continue;
        const cs = ch.map((c) => t.nodes[c.node].score);
        expect(t.nodes[n].score).toBeGreaterThanOrEqual(Math.min(...cs) - 0.05);
        expect(t.nodes[n].score).toBeLessThanOrEqual(Math.max(...cs) + 0.05);
      }
    });
  }

  test('배설 트리의 원문 번호 중복 보정이 기록되어 있다 (사람 확인 필요)', () => {
    expect(kb.trees.trees['배설'].corrections?.[0]).toMatch(/마디 8.*두 번.*마디 9/);
  });

  test('무작위 입력 3,000개: 모든 트리에서 최종마디에 도달하고, 합계 = 8개 최종마디 점수의 합', () => {
    let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const tables = { PHY: '신체기능', COG: '인지기능', BEH: '행동변화', NUR: '간호처치', REH: '재활' } as const;
    for (let k = 0; k < 3000; k++) {
      const vals: Record<string, number> = {}; const raw: Record<Domain, number> = { PHY: 0, COG: 0, BEH: 0, NUR: 0, REH: 0 };
      for (const d of DOMAINS) for (const it of kb.v52(d)) { const lvl = d === 'PHY' || d === 'REH'; const v = lvl ? 1 + Math.floor(rnd() * 3) : rnd() < 0.4 ? 1 : 0; vals[it.id] = v; raw[d] += v; }
      const conv = Object.fromEntries(DOMAINS.map((d) => [d, (kb.formula.conversion_tables as any)[tables[d]][String(raw[d])]])) as Record<Domain, number>;
      const tt = treeTotal(kb, vals, conv);
      expect(tt.parts).toHaveLength(8);
      let sum = 0;
      for (const p of tt.parts) { const t = kb.trees.trees[p.name]; expect(t.nodes[p.leaf].children).toBeUndefined(); sum += p.score; }
      expect(tt.total).toBeCloseTo(Math.round(sum * 10) / 10, 6);
    }
  });

  test('가장 가벼운 상태와 가장 무거운 상태의 합계 (상식 점검: 가벼우면 등급외, 무거우면 1등급 구간)', () => {
    const mk = (lvl: number, yes: number) => {
      const vals: Record<string, number> = {};
      for (const d of DOMAINS) for (const it of kb.v52(d)) vals[it.id] = d === 'PHY' || d === 'REH' ? lvl : yes;
      return vals;
    };
    const light = treeTotal(kb, mk(1, 0), { PHY: 0, COG: 0, BEH: 0, NUR: 0, REH: 0 }).total;
    const heavy = treeTotal(kb, mk(3, 1), { PHY: 100, COG: 100, BEH: 100, NUR: 100, REH: 100 }).total;
    expect(light).toBeLessThan(45);
    expect(heavy).toBeGreaterThanOrEqual(95);
  });

  test('분할 조건 해석기', () => {
    expect(holds({ le: 34.15 }, 34.15)).toBe(true);
    expect(holds({ gt: 34.15 }, 34.15)).toBe(false);
    expect(holds({ gt: 0, le: 39.46 }, 39.46)).toBe(true);
    expect(holds({ eq: 0 }, 0)).toBe(true);
    expect(holds({ in: [1, 2] }, 3)).toBe(false);
    expect(() => evalTree({ status: 'x', all_checks_passed: true, nodes: { '0': { score: 1, split: { label: 'x', var: { type: 'item', item: 'PHY-01' } }, children: [{ node: 1, label: '', cond: { eq: 9 } }] }, '1': { score: 1 } } }, { 'PHY-01': 1 }, { PHY: 0, COG: 0, BEH: 0, NUR: 0, REH: 0 })).toThrow();
  });
});
