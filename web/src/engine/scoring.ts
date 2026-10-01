// 채점 엔진 (순수 함수). 입력: 조사 항목 값 → 출력: 영역 원점수·환산점수, 추정 점수 범위, 등급 범위, 근거.
//
// 공식인 부분 (data/grading_formula.json, 고시 제2조·시행령 제7조):
//   항목 점수표, 영역별 원점수 → 100점 환산표, 등급 구간, 5등급·인지지원 치매 요건, 치매 보정(별표2)
// 추정인 부분:
//   8개 서비스군 수형분석도 합산 → 원문 대조 전(RECONSTRUCTED_UNVERIFIED)이면 근사 모델(data/approx_model.json)로 대신한다.
//   '잘 모름' 답은 가장 가벼운 값(best)~가장 무거운 값(worst)으로 모두 계산해 범위를 넓힌다.
import type { Kb, Cond, TreeDef } from './kb.ts';
import { DOMAINS, DOMAIN_KO, GRADE_KO, GRADE_RANK, type Domain, type GradeCode, type ItemValues } from './types.ts';

export type Fill = 'best' | 'mid' | 'worst';
export type DementiaAnswer = 'diagnosed' | 'suspected' | 'none' | 'unknown';
export type AdlAnswer = 'independent' | 'incomplete' | 'partial' | 'full' | 'unknown';

const TABLE_KEY = { PHY: '신체기능', COG: '인지기능', BEH: '행동변화', NUR: '간호처치', REH: '재활' } as const;

export const isLevelItem = (id: string) => id.startsWith('PHY') || id.startsWith('REH');
export const bestValue = (id: string) => (isLevelItem(id) ? 1 : 0);
export const worstValue = (id: string) => (isLevelItem(id) ? 3 : 1);
export function fillValue(id: string, v: number | null | undefined, fill: Fill): number {
  if (v !== null && v !== undefined) return v;
  return fill === 'best' ? bestValue(id) : fill === 'worst' ? worstValue(id) : (bestValue(id) + worstValue(id)) / 2;
}

/** 영역별 100점 환산표 (정수 원점수는 표 값 그대로. 'mid' 시나리오의 소수 원점수만 이웃 값 사이 선형 보간) */
export function convert(kb: Kb, domain: Domain, raw: number): number {
  const t = kb.formula.conversion_tables[TABLE_KEY[domain]];
  const keys = Object.keys(t).map(Number);
  const lo = Math.min(...keys), hi = Math.max(...keys);
  if (raw < lo - 1e-9 || raw > hi + 1e-9) throw new Error(`[scoring] ${DOMAIN_KO[domain]} 원점수 ${raw} 이(가) 환산표 범위(${lo}~${hi}) 밖입니다`);
  const f = Math.floor(raw + 1e-9), c = Math.ceil(raw - 1e-9);
  if (f === c) return t[String(f)];
  return t[String(f)] + (t[String(c)] - t[String(f)]) * (raw - f);
}

export interface DomainScore { raw: number; conv: number; unknown: number; items: number }
export type DomainScores = Record<Domain, DomainScore>;

/** 고시 52개 항목을 채워(fill) 모두 숫자로 만든 값 */
export function filledValues(kb: Kb, values: ItemValues, fill: Fill): Record<string, number> {
  const out: Record<string, number> = {};
  for (const d of DOMAINS) for (const it of kb.v52(d)) out[it.id] = fillValue(it.id, values[it.id], fill);
  return out;
}

export function domainScores(kb: Kb, values: ItemValues, fill: Fill): DomainScores {
  const out = {} as DomainScores;
  for (const d of DOMAINS) {
    const items = kb.v52(d);
    let raw = 0, unknown = 0;
    for (const it of items) {
      const v = values[it.id];
      if (v === null || v === undefined) unknown++;
      raw += fillValue(it.id, v, fill);
    }
    out[d] = { raw, conv: convert(kb, d, raw), unknown, items: items.length };
  }
  return out;
}

// ---------------------------------------------------------------- 수형분석도
export function holds(c: Cond, x: number): boolean {
  const e = 1e-9;
  if (c.eq !== undefined && Math.abs(x - c.eq) > e) return false;
  if (c.in !== undefined && !c.in.includes(x)) return false;
  if (c.le !== undefined && !(x <= c.le + e)) return false;
  if (c.lt !== undefined && !(x < c.lt - e)) return false;
  if (c.ge !== undefined && !(x >= c.ge - e)) return false;
  if (c.gt !== undefined && !(x > c.gt + e)) return false;
  return true;
}

export function evalTree(tree: TreeDef, vals: Record<string, number>, conv: Record<Domain, number>): { score: number; leaf: number; path: number[] } {
  let n = 0; const path = [0];
  for (;;) {
    const node = tree.nodes[String(n)];
    if (!node) throw new Error(`[scoring] 트리에 마디 ${n} 이(가) 없습니다`);
    if (!node.children?.length || !node.split) return { score: node.score, leaf: n, path };
    const v = node.split.var;
    const x = v.type === 'domain' ? conv[v.domain] : vals[v.item];
    if (x === undefined) throw new Error(`[scoring] 분할 변수 값 없음: ${JSON.stringify(v)}`);
    const next = node.children.find((c) => holds(c.cond, x));
    if (!next) throw new Error(`[scoring] 마디 ${n} 에서 값 ${x} 에 맞는 가지가 없습니다`);
    n = next.node; path.push(n);
  }
}

export function treeTotal(kb: Kb, vals: Record<string, number>, conv: Record<Domain, number>) {
  const parts = Object.entries(kb.trees.trees).map(([name, t]) => ({ name, ...evalTree(t, vals, conv) }));
  return { total: Math.round(parts.reduce((s, p) => s + p.score, 0) * 10) / 10, parts };
}

export function treesUsable(kb: Kb): boolean {
  return kb.trees._meta.all_automatic_checks_passed && Object.values(kb.trees.trees).every((t) => t.all_checks_passed);
}

// ---------------------------------------------------------------- 근사 모델
export function approxScore(kb: Kb, conv: Record<Domain, number>): number {
  const m = kb.approx.model;
  return DOMAINS.reduce((s, d) => s + m.weights[d] * conv[d], m.intercept);
}

// ---------------------------------------------------------------- 등급·치매 보정 (공식 규칙)
export function gradeFor(kb: Kb, score: number, dementia: boolean): GradeCode {
  const c = kb.formula.grade_cutoffs;
  if (score >= c.grade1) return '1';
  if (score >= c.grade2) return '2';
  if (score >= c.grade3) return '3';
  if (score >= c.grade4) return '4';
  if (score >= c.grade5) return dementia ? '5' : 'none';
  return dementia ? 'cognitive' : 'none';
}

/** 별표2 로지스틱 값 (vals 는 채워진 52개 항목 값, raws 는 영역 원점수) */
export function dementiaProbability(kb: Kb, vals: Record<string, number>, raws: { PHY: number; BEH: number }): number {
  const r = kb.formula.dementia_regression_bylaw2.structured;
  let z = r.intercept;
  for (const [id, coef] of Object.entries(r.item_coefficients)) z += coef * (vals[id] ?? 0);
  z += r.adl_score.coefficient * raws.PHY + r.behavior_score.coefficient * raws.BEH;
  const A = Math.exp(z);
  return A / (1 + A);
}

/** 고시 제2조제5호 + 별표2: 51 이상 75 미만 + 치매 + 인지증 자립도 불완전자립 이상 + 값 ≥ 0.5 → 한 단계 위 등급 최저점수 */
export function applyDementiaCorrection(kb: Kb, score: number, eligible: boolean, p: number): { score: number; applied: boolean } {
  const r = kb.formula.dementia_regression_bylaw2.structured; const c = kb.formula.grade_cutoffs;
  if (!eligible || score < r.applies_from || score >= r.applies_below || p < r.threshold) return { score, applied: false };
  return { score: score < c.grade3 ? c.grade3 : c.grade2, applied: true };
}

export function formatGradeRange(grades: GradeCode[]): string {
  const sorted = [...grades].sort((a, b) => GRADE_RANK[b] - GRADE_RANK[a]);
  const a = sorted[0], b = sorted[sorted.length - 1];
  if (a === b) return GRADE_KO[a];
  const num = (g: GradeCode) => /^\d$/.test(g);
  return num(a) && num(b) ? `${a}~${b}등급` : `${GRADE_KO[a]}~${GRADE_KO[b]}`;
}

// ---------------------------------------------------------------- 종합 추정
export interface EstimateInput { values: ItemValues; dementia: DementiaAnswer; adl: AdlAnswer }
export interface ScenarioResult { fill: Fill; domains: DomainScores; approx: number; tree: number | null; base: number; p: number }
export interface Influence { itemId: string; name: string; domain: Domain; value: number; delta: number }
export interface Estimate {
  mode: 'tree' | 'approx';
  is_official: false;
  scenarios: Record<Fill, ScenarioResult>;
  band: number;
  score: { low: number; mid: number; high: number };
  correction: { low: boolean; mid: boolean; high: boolean; p: { low: number; high: number }; eligible: 'yes' | 'maybe' | 'no' };
  grades: GradeCode[];
  label: string;
  gradesIfDiagnosed?: { grades: GradeCode[]; label: string };
  treeReference: { low: number; high: number; grades: GradeCode[]; label: string } | null;
  unknown: { count: number; total: number; ratio: number; byDomain: Record<Domain, number>; context: string[] };
  confidence: '높음' | '보통' | '낮음';
  confidenceReason: string;
  influences: Influence[];
  rule_ids: string[];
  notes: string[];
}

const r1 = (x: number) => Math.round(x * 10) / 10;

function scenario(kb: Kb, values: ItemValues, fill: Fill, useTree: boolean): ScenarioResult {
  const domains = domainScores(kb, values, fill);
  const conv = Object.fromEntries(DOMAINS.map((d) => [d, domains[d].conv])) as Record<Domain, number>;
  const vals = filledValues(kb, values, fill);
  const approx = approxScore(kb, conv);
  const tree = useTree && fill !== 'mid' ? treeTotal(kb, vals, conv).total : null;
  const p = dementiaProbability(kb, vals, { PHY: domains.PHY.raw, BEH: domains.BEH.raw });
  return { fill, domains, approx, tree, base: approx, p };
}

function gradesBetween(kb: Kb, low: number, high: number, dementiaOptions: boolean[]): GradeCode[] {
  const c = kb.formula.grade_cutoffs;
  const xs = [low, high, ...[c.grade1, c.grade2, c.grade3, c.grade4, c.grade5].filter((x) => x > low && x <= high)];
  const set = new Set<GradeCode>();
  for (const x of xs) for (const d of dementiaOptions) set.add(gradeFor(kb, x, d));
  return [...set].sort((a, b) => GRADE_RANK[b] - GRADE_RANK[a]);
}

export function estimate(kb: Kb, input: EstimateInput): Estimate {
  const treesOk = treesUsable(kb);
  const mode: Estimate['mode'] = kb.treesVerified() ? 'tree' : 'approx';
  const S = { best: scenario(kb, input.values, 'best', treesOk), mid: scenario(kb, input.values, 'mid', treesOk), worst: scenario(kb, input.values, 'worst', treesOk) };
  if (mode === 'tree') {
    S.best.base = S.best.tree!; S.worst.base = S.worst.tree!; S.mid.base = (S.best.tree! + S.worst.tree!) / 2;
  }
  const band = mode === 'approx' ? kb.approx.range.band_points : kb.approx.range.tree_mode_band_points;

  const demLow = input.dementia === 'diagnosed';
  const demHigh = input.dementia === 'diagnosed' || input.dementia === 'unknown';
  const adlOk = ['incomplete', 'partial', 'full'].includes(input.adl);
  const adlMaybe = adlOk || input.adl === 'unknown';
  const eligLow = demLow && adlOk, eligHigh = demHigh && adlMaybe;

  const lowRaw = Math.min(S.best.base, S.worst.base) - band;
  const highRaw = Math.max(S.best.base, S.worst.base) + band;
  const cl = applyDementiaCorrection(kb, lowRaw, eligLow, S.best.p);
  const cm = applyDementiaCorrection(kb, S.mid.base, eligLow, S.mid.p);
  const ch = applyDementiaCorrection(kb, highRaw, eligHigh, S.worst.p);
  let [low, mid, high] = [cl.score, cm.score, ch.score];
  if (mid < low) mid = low; if (high < mid) high = mid;

  const demOpts = demLow === demHigh ? [demLow] : [false, true];
  const grades = gradesBetween(kb, low, high, demOpts);

  // 치매 의심(진단 전)이면 '진단을 받으면' 시나리오를 따로 보여준다 (5등급·인지지원은 치매 진단이 요건: R-GRADE-02)
  let gradesIfDiagnosed: Estimate['gradesIfDiagnosed'];
  if (input.dementia === 'suspected') {
    const hi2 = applyDementiaCorrection(kb, highRaw, adlMaybe, S.worst.p).score;
    const lo2 = applyDementiaCorrection(kb, lowRaw, adlOk, S.best.p).score;
    const g = gradesBetween(kb, Math.min(lo2, hi2), Math.max(lo2, hi2), [true]);
    gradesIfDiagnosed = { grades: g, label: formatGradeRange(g) };
  }

  let treeReference: Estimate['treeReference'] = null;
  if (treesOk && S.best.tree !== null && S.worst.tree !== null) {
    const tb = kb.approx.range.tree_mode_band_points;
    const lo = applyDementiaCorrection(kb, Math.min(S.best.tree, S.worst.tree) - tb, eligLow, S.best.p).score;
    const hi = applyDementiaCorrection(kb, Math.max(S.best.tree, S.worst.tree) + tb, eligHigh, S.worst.p).score;
    const g = gradesBetween(kb, lo, Math.max(lo, hi), demOpts);
    treeReference = { low: r1(lo), high: r1(Math.max(lo, hi)), grades: g, label: formatGradeRange(g) };
  }

  // 모름 집계
  const byDomain = Object.fromEntries(DOMAINS.map((d) => [d, S.best.domains[d].unknown])) as Record<Domain, number>;
  const count = DOMAINS.reduce((s, d) => s + byDomain[d], 0);
  const total = DOMAINS.reduce((s, d) => s + S.best.domains[d].items, 0);
  const context: string[] = [];
  if (input.dementia === 'unknown') context.push('치매 진단 여부');
  if (input.adl === 'unknown') context.push('인지증 일상생활 자립도');
  const ratio = count / total;

  // 신뢰도
  const cf = kb.approx.confidence; const span = grades.length;
  let confidence: Estimate['confidence'] = ratio <= cf.high.max_unknown_ratio && span <= cf.high.max_grade_span ? '높음' : ratio <= cf.medium.max_unknown_ratio && span <= cf.medium.max_grade_span ? '보통' : '낮음';
  if (context.length && confidence === '높음') confidence = '보통';
  const confidenceReason = `잘 모름 ${count}/${total}개 항목${context.length ? ` + ${context.join('·')}` : ''}, 예상 등급 ${span}개에 걸침${mode === 'approx' ? ', 공식 산정식이 아닌 근사 모델' : ''}`;

  // 점수에 가장 큰 영향을 준 답 3개: 그 답을 '가장 가벼운 값'으로 바꿨을 때 줄어드는 점수 (모름은 제외)
  // 근사 모델에서는 같은 영역·같은 답의 항목끼리 영향이 같으므로, 복원 트리의 영향으로 순서를 가른다.
  const scoresOf = (vals: ItemValues) => {
    const s = scenario(kb, vals, 'best', treesOk);
    return { main: mode === 'tree' ? s.tree! : s.approx, tree: s.tree ?? 0 };
  };
  const base = scoresOf(input.values);
  const influences: (Influence & { tie: number })[] = [];
  for (const d of DOMAINS) for (const it of kb.v52(d)) {
    const v = input.values[it.id];
    if (v === null || v === undefined || v === bestValue(it.id)) continue;
    const alt = scoresOf({ ...input.values, [it.id]: bestValue(it.id) });
    const delta = base.main - alt.main;
    if (delta > 0.05) influences.push({ itemId: it.id, name: it.official_item_name, domain: d, value: v, delta: r1(delta), tie: base.tree - alt.tree });
  }
  influences.sort((a, b) => b.delta - a.delta || b.tie - a.tie || a.itemId.localeCompare(b.itemId));

  const notes: string[] = [];
  if (mode === 'approx') notes.push('이 점수는 공식 산정식이 아닌 추정입니다. 공식 점수는 8개 서비스군 수형분석도로 계산하는데, 원문 대조가 끝나기 전이라 근사식을 썼어요.');
  if (cl.applied || cm.applied || ch.applied) notes.push('치매 보정(고시 별표2)을 반영했어요: 51~75점 구간의 치매 어르신은 조건을 만족하면 한 단계 위 등급 최저점수로 올라가요.');
  if (input.dementia !== 'diagnosed' && grades.some((g) => g === 'none') && high >= kb.formula.grade_cutoffs.grade5 - band && low < kb.formula.grade_cutoffs.grade4)
    notes.push('5등급·인지지원등급은 치매 진단이 있어야 받을 수 있어요(시행령 제7조). 진단이 없으면 51점 미만은 등급외예요.');

  return {
    mode, is_official: false, scenarios: S, band,
    score: { low: r1(low), mid: r1(mid), high: r1(high) },
    correction: { low: cl.applied, mid: cm.applied, high: ch.applied, p: { low: S.best.p, high: S.worst.p }, eligible: eligLow ? 'yes' : eligHigh ? 'maybe' : 'no' },
    grades, label: formatGradeRange(grades), gradesIfDiagnosed, treeReference,
    unknown: { count, total, ratio, byDomain, context },
    confidence, confidenceReason, influences: influences.slice(0, 3).map(({ tie: _t, ...x }) => x),
    rule_ids: ['R-GRADE-01', 'R-GRADE-02', 'R-GRADE-03'], notes,
  };
}
