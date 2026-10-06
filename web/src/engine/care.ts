// '이용할 수 있는 돌봄' 표: 예상(또는 현재) 등급 → 서비스별 가능 여부·월 한도액. 화면과 분리된 순수 함수
// 가능 여부는 data/care_services.json 에만 있고, 각 서비스는 legal_rules.json 규칙에 연결된다
import { GRADE_KO, GRADE_RANK, type GradeCode } from './types.ts';
import { formatGradeRange } from './scoring.ts';

export type CareStatus = 'yes' | 'limited' | 'conditional' | 'no';
export type NeedId = 'care' | 'home' | 'day' | 'facility';
export interface CareServiceDef { id: string; name: string; needs: NeedId[]; short: string; by_grade: Record<GradeCode, CareStatus>; notes: Partial<Record<GradeCode, string>>; rules: string[] }
export interface CareOutsideDef { id: string; name: string; show: 'always' | 'no_grade'; needs?: NeedId[]; short: string; rules: string[] }
export interface CareData {
  year: number;
  monthly_limit: { values: Partial<Record<GradeCode, number>>; copay_home: number; rules: string[]; note: string };
  needs: { id: NeedId; label: string; hint: string }[];
  services: CareServiceDef[];
  outside: CareOutsideDef[];
}

export interface CareRow { id: string; name: string; short: string; status: CareStatus | 'mixed'; label: string; detail: string[]; rules: string[]; match: boolean }
export interface CareView {
  grades: GradeCode[];
  gradeLabel: string;
  need?: NeedId;
  rows: CareRow[];
  outside: { id: string; name: string; short: string; rules: string[]; match: boolean }[];
  limit?: { year: number; low: number; high: number; copayLow: number; copayHigh: number; note: string; rules: string[] };
}

const STATUS_KO: Record<CareStatus, string> = { yes: '이용 가능', limited: '일부만 가능', conditional: '공단 인정 시 가능', no: '이용 불가' };
export const NEED_IDS: NeedId[] = ['care', 'home', 'day', 'facility'];
export const isNeed = (v: unknown): v is NeedId => typeof v === 'string' && (NEED_IDS as string[]).includes(v);

/** 등급 여러 개(예상 범위)에 걸치면 '등급별로 달라요'로 묶고 등급별 문장을 보여준다 */
export function careView(data: CareData, grades: GradeCode[], need?: NeedId): CareView {
  const gs = [...new Set(grades)].sort((a, b) => GRADE_RANK[b] - GRADE_RANK[a]);
  const rows: CareRow[] = data.services.map((s) => {
    const st = gs.map((g) => s.by_grade[g] ?? 'no');
    const same = st.every((x) => x === st[0]);
    const detail: string[] = [];
    if (!same) {
      // 같은 상태끼리 등급을 묶어 '1~2등급: 이용 가능' 처럼
      const groups = new Map<CareStatus, GradeCode[]>();
      gs.forEach((g, i) => groups.set(st[i], [...(groups.get(st[i]) ?? []), g]));
      for (const [k, v] of groups) detail.push(`${formatGradeRange(v)}: ${STATUS_KO[k]}`);
    }
    for (const g of gs) { const n = s.notes[g]; if (n && !detail.includes(n)) detail.push(n); }
    const status = same ? st[0] : 'mixed';
    return { id: s.id, name: s.name, short: s.short, status, label: status === 'mixed' ? '등급에 따라 달라요' : STATUS_KO[status], detail, rules: s.rules, match: !!need && s.needs.includes(need) };
  });
  // 고른 도움에 맞는 것을 위로 (같으면 원래 순서)
  if (need) rows.sort((a, b) => Number(b.match) - Number(a.match));

  const graded = gs.filter((g) => g !== 'none');
  const outside = data.outside
    .filter((o) => o.show === 'always' || (o.show === 'no_grade' && gs.includes('none')))
    .map((o) => ({ id: o.id, name: o.name, short: o.short, rules: o.rules, match: !!need && !!o.needs?.includes(need) }));
  if (need) outside.sort((a, b) => Number(b.match) - Number(a.match));

  const vals = graded.map((g) => data.monthly_limit.values[g]).filter((v): v is number => typeof v === 'number');
  const limit = vals.length ? (() => {
    const low = Math.min(...vals), high = Math.max(...vals), c = data.monthly_limit.copay_home;
    return { year: data.year, low, high, copayLow: Math.round(low * c), copayHigh: Math.round(high * c), note: data.monthly_limit.note, rules: data.monthly_limit.rules };
  })() : undefined;

  return { grades: gs, gradeLabel: gs.length ? formatGradeRange(gs) : GRADE_KO.none, need, rows, outside, limit };
}

/** 금액을 '251만 원' 처럼 */
export const won = (n: number) => (n >= 10000 ? `${Math.round(n / 10000).toLocaleString('ko-KR')}만 원` : `${n.toLocaleString('ko-KR')}원`);
