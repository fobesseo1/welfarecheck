// 근사 모델 적합: 복원한 수형분석도(data/grading_trees.json)로 가상 인구의 요양인정점수(치매 보정 전)를 계산하고,
// 5개 영역 100점 환산점수로 선형 근사식(절편 + 영역별 가중치, 가중치 ≥ 0)을 최소제곱으로 맞춘다.
// 사용: npm run fit-model   → data/approx_model.json 의 model·fit·range 를 갱신
import { writeFileSync, readFileSync } from 'node:fs';
import { kb } from '../src/data.ts';
import { DOMAINS, type Domain, type ItemValues } from '../src/engine/types.ts';
import { domainScores, filledValues, treeTotal } from '../src/engine/scoring.ts';

const SEED = 20260929, N = 20000;
function mulberry32(a: number) {
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const rnd = mulberry32(SEED);
const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());
const sig = (x: number) => 1 / (1 + Math.exp(-x));
const clamp = (x: number) => Math.max(0, Math.min(1, x));

// 항목별 '어려워지는 순서' 가정 (목욕·옷 입기가 먼저, 식사·체위변경은 나중). 가상 인구 생성용 가정일 뿐 공식 자료 아님
const PHY_D: Record<string, number> = { 'PHY-04': 0.15, 'PHY-01': 0.3, 'PHY-02': 0.35, 'PHY-03': 0.35, 'PHY-10': 0.4, 'PHY-09': 0.45, 'PHY-12': 0.5, 'PHY-11': 0.55, 'PHY-08': 0.55, 'PHY-07': 0.6, 'PHY-05': 0.65, 'PHY-06': 0.7 };

export function syntheticProfile(): ItemValues {
  const s = clamp(Math.pow(rnd(), 0.9));                       // 신체 중증도
  const c = rnd() < 0.5 ? rnd() : clamp(s + 0.25 * gauss());   // 인지 중증도 (절반은 신체와 상관)
  const v: ItemValues = {};
  for (const it of kb.v52('PHY')) { const z = s - PHY_D[it.id] + 0.15 * gauss(); v[it.id] = z < 0 ? 1 : z < 0.3 ? 2 : 3; }
  kb.v52('COG').forEach((it, i) => { v[it.id] = rnd() < sig((c - 0.25 - i * 0.06) * 8) ? 1 : 0; });
  kb.v52('BEH').forEach((it, i) => { v[it.id] = rnd() < sig((c * 0.9 - 0.45 - (i % 7) * 0.05) * 6) ? 1 : 0; });
  kb.v52('NUR').forEach((it) => { v[it.id] = rnd() < (s > 0.6 ? (s - 0.6) * 0.5 : 0.01) ? 1 : 0; });
  kb.v52('REH').forEach((it, i) => { const z = s - 0.35 - (i % 4) * 0.08 + 0.2 * gauss(); v[it.id] = z < 0 ? 1 : z < 0.35 ? 2 : 3; });
  return v;
}

// 비음수 최소제곱 (작은 차원: 음수 계수를 빼고 다시 푸는 방식)
function solve(A: number[][], b: number[]): number[] {
  const n = A.length; const M = A.map((r, i) => [...r, b[i]]);
  for (let i = 0; i < n; i++) {
    let p = i; for (let k = i + 1; k < n; k++) if (Math.abs(M[k][i]) > Math.abs(M[p][i])) p = k;
    [M[i], M[p]] = [M[p], M[i]];
    for (let k = 0; k < n; k++) if (k !== i) { const f = M[k][i] / M[i][i]; for (let j = i; j <= n; j++) M[k][j] -= f * M[i][j]; }
  }
  return M.map((r, i) => r[n] / r[i]);
}
function fit(X: number[][], y: number[], active: number[]): number[] {
  const cols = [0, ...active.map((a) => a + 1)];
  const Z = X.map((r) => [1, ...r]);
  const A = cols.map((i) => cols.map((j) => Z.reduce((s, r) => s + r[i] * r[j], 0)));
  const b = cols.map((i) => Z.reduce((s, r, k) => s + r[i] * y[k], 0));
  const sol = solve(A, b); const full = new Array(X[0].length + 1).fill(0);
  cols.forEach((c, i) => (full[c] = sol[i]));
  return full;
}

const X: number[][] = [], y: number[] = [];
for (let k = 0; k < N; k++) {
  const v = syntheticProfile();
  const ds = domainScores(kb, v, 'best');
  const conv = Object.fromEntries(DOMAINS.map((d) => [d, ds[d].conv])) as Record<Domain, number>;
  X.push(DOMAINS.map((d) => conv[d])); y.push(treeTotal(kb, filledValues(kb, v, 'best'), conv).total);
}
let active = [0, 1, 2, 3, 4], coef = fit(X, y, active);
while (active.some((a) => coef[a + 1] < 0)) { active = active.filter((a) => coef[a + 1] >= 0); coef = fit(X, y, active); }
const pred = X.map((r) => coef[0] + r.reduce((s, x, i) => s + coef[i + 1] * x, 0));
const mean = y.reduce((s, x) => s + x, 0) / N;
const sse = y.reduce((s, x, i) => s + (x - pred[i]) ** 2, 0), sst = y.reduce((s, x) => s + (x - mean) ** 2, 0);
const rmse = Math.sqrt(sse / N), r2 = 1 - sse / sst;
const absErr = y.map((x, i) => Math.abs(x - pred[i])).sort((a, b) => a - b);
const p90 = absErr[Math.floor(N * 0.9)];

const path = new URL('../../data/approx_model.json', import.meta.url);
const cur = JSON.parse(readFileSync(path, 'utf8'));
const round = (x: number, d = 4) => Math.round(x * 10 ** d) / 10 ** d;
cur._meta = {
  title: '요양인정점수 근사 모델 (공식 산정식 아님)',
  note: [
    '점수 = 절편 + Σ 영역별 가중치 × 영역별 100점 환산점수 (신체기능·인지기능·행동변화·간호처치·재활). 치매 보정은 이 점수에 공식 규칙(별표2)대로 따로 적용한다.',
    `가중치는 사람이 정한 값이 아니라, tools/hwp_trees.py 로 고시 HWP 도형에서 복원한 8개 수형분석도(RECONSTRUCTED_UNVERIFIED)로 가상 인구 ${N}명의 요양인정점수를 계산해 최소제곱(가중치 ≥ 0 제약)으로 맞춘 값이다 (web/scripts/fit-approx-model.ts, seed ${SEED}).`,
    '가정: 가상 인구의 항목 분포(신체 중증도·인지 중증도 두 잠재변수, 항목별 난이도)는 임의 가정이며 실제 신청자 분포가 아니다. 복원 트리가 원문과 다르면 가중치도 틀릴 수 있다.',
    `보수적 처리: 가중치는 음수를 허용하지 않아(더 중증일수록 점수가 줄지 않음) 단조성을 보장한다. 결과는 점수 하나가 아니라 '추정 점수 ± 범위 폭(band_points)' 에 걸치는 예상 등급 범위와 신뢰도로만 표시한다. 범위 폭은 근사 오차 RMSE(${round(rmse, 2)}점)를 올림한 값(약 68% 구간). 오차 90백분위는 ${round(p90, 2)}점이라 10명 중 1명꼴로 범위 밖일 수 있다.`,
    '제곱항·교호작용항을 넣어도 RMSE 가 거의 줄지 않아(8.3→8.1) 가장 단순한 선형식을 유지했다. 남은 오차는 트리가 개별 항목(양치질·화장실 등)으로 나누는 부분이라 영역 점수만으로는 설명되지 않는다.',
    '트리 원문 대조가 끝나 grading_trees.json 이 OFFICIAL_VERIFIED 가 되면 웹 도구는 트리 점수를 주 추정치로 쓰고 이 모델은 쓰지 않는다.',
  ],
  generated_at: new Date().toISOString().slice(0, 10),
};
cur.model = { intercept: round(coef[0]), weights: Object.fromEntries(DOMAINS.map((d, i) => [d, round(coef[i + 1])])) };
cur.fit = { rmse: round(rmse, 3), r2: round(r2, 4), abs_error_p90: round(p90, 3), n: N, seed: SEED, target: 'grading_trees.json 합산 점수(치매 보정 전)' };
cur.range = { band_points: Math.ceil(rmse), tree_mode_band_points: cur.range?.tree_mode_band_points ?? 2 };
writeFileSync(path, JSON.stringify(cur, null, 2) + '\n', 'utf8');
console.log('model', cur.model, 'fit', cur.fit, 'band', cur.range.band_points, 'mean', round(mean, 2));
