// 기관 찾기·기관 상세 화면이 함께 쓰는 자료형과 계산 (화면 그리기 없음 → 테스트 가능)
// 자료: public/facilities/ (tools/facilities/collect.mjs build 가 만든다)

export type Kind = 'home_care' | 'home_bath' | 'home_nursing' | 'day_care' | 'short_stay' | 'nursing_home' | 'care_hospital';

export interface Place {
  id: string; name: string; kind: Kind; kinds: Kind[];
  lat: number | null; lng: number | null; addr: string | null; gu: string | null;
  grade: string | null; phone: string | null; dementia?: boolean;
  capacity?: number | null; current?: number | null; waiting?: number | null;
}
export interface Detail {
  zip?: string | null; since?: string | null; homepage?: string | null; transit?: string | null; parking?: string | null;
  accept?: { service: string; capacity: number | null; current: number; waiting: number }[];
  rooms?: Record<'1' | '2' | '3' | '4', number> | null;
  staff?: [string, number][] | null;
  nonpay?: { item: string; amount: number | null; basis: string | null; updated: string | null }[];
  fetched?: string | null; doctors?: number | null; gradeNote?: string | null;
}
export interface Region { count: number; center: [number, number] | null }
export interface Index { builtAt: string; sido: Record<string, Region & { gu: Record<string, Region> }> }

export const SIDO: Record<string, string> = {
  11: '서울', 41: '경기', 28: '인천', 51: '강원', 43: '충북', 44: '충남', 30: '대전', 36: '세종',
  52: '전북', 12: '광주·전남', 47: '경북', 27: '대구', 48: '경남', 26: '부산', 31: '울산', 50: '제주',
};

export const KINDS: { id: Kind; label: string; mark: string; color: string; desc: string }[] = [
  { id: 'home_care', label: '방문요양', mark: '재', color: '#2E9E6F', desc: '요양보호사가 집으로 와요' },
  { id: 'day_care', label: '주야간보호', mark: '주', color: '#C98A32', desc: '낮 동안 센터에서 돌봐요' },
  { id: 'nursing_home', label: '요양원', mark: '원', color: '#3E6FC4', desc: '입소해서 생활해요' },
  { id: 'care_hospital', label: '요양병원', mark: '병', color: '#8A5BC2', desc: '치료가 필요할 때 입원해요' },
  { id: 'short_stay', label: '단기보호', mark: '단', color: '#B5564E', desc: '며칠~몇 달 잠시 맡겨요' },
  { id: 'home_bath', label: '방문목욕', mark: '욕', color: '#2A8C9E', desc: '목욕 차량·인력이 와요' },
  { id: 'home_nursing', label: '방문간호', mark: '간', color: '#C2548A', desc: '간호사가 집으로 와요' },
];
export const kindInfo = (k: Kind) => KINDS.find((x) => x.id === k)!;
/** 정원·현원을 보여 줄 수 있는 입소·이용 시설 */
export const HAS_SEATS: Kind[] = ['nursing_home', 'day_care', 'short_stay'];

export function km(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const r = (d: number) => (d * Math.PI) / 180;
  const h = Math.sin(r(b.lat - a.lat) / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lng - a.lng) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

/** 남은 자리 (정원 − 현원). 정원을 모르면 null */
export function seatsLeft(p: Place): number | null {
  if (p.capacity == null || p.current == null || !p.kinds.some((k) => HAS_SEATS.includes(k))) return null;
  return Math.max(0, p.capacity - p.current);
}

export interface Filter { kind?: Kind | ''; gu?: string; dementia?: boolean; seats?: boolean; q?: string }
export function filterPlaces(list: Place[], f: Filter): Place[] {
  const q = f.q?.trim().replace(/\s+/g, '');
  return list.filter((p) =>
    (!f.kind || p.kinds.includes(f.kind)) &&
    (!f.gu || p.gu === f.gu) &&
    (!f.dementia || p.dementia) &&
    (!f.seats || (seatsLeft(p) ?? 0) > 0) &&
    (!q || p.name.replace(/\s+/g, '').includes(q) || (p.addr ?? '').replace(/\s+/g, '').includes(q)));
}

/** 내 위치가 있으면 가까운 순(위치 모르는 기관은 맨 뒤), 없으면 상세 정보가 있는 곳 먼저·이름순 */
export function sortPlaces(list: Place[], origin?: { lat: number; lng: number } | null): (Place & { dist?: number })[] {
  if (origin) {
    return list.map((p) => ({ ...p, dist: p.lat != null && p.lng != null ? km(origin, { lat: p.lat, lng: p.lng }) : undefined }))
      .sort((a, b) => (a.dist ?? Infinity) - (b.dist ?? Infinity));
  }
  return [...list].sort((a, b) => Number(!a.addr) - Number(!b.addr) || a.name.localeCompare(b.name, 'ko'));
}

/** 내 위치에서 가장 가까운 시도·시군구 (목차의 지역 중심 좌표 기준) */
export function nearestRegion(index: Index, at: { lat: number; lng: number }): { sido: string; gu: string } | null {
  let best: { sido: string; gu: string; d: number } | null = null;
  for (const [sido, s] of Object.entries(index.sido)) {
    for (const [gu, g] of Object.entries(s.gu)) {
      if (!g.center || g.count < 3) continue; // 주소가 잘못 들어간 한두 곳짜리 지역은 건너뜀
      const d = km(at, { lat: g.center[0], lng: g.center[1] });
      if (!best || d < best.d) best = { sido, gu, d };
    }
  }
  return best && { sido: best.sido, gu: best.gu };
}

export const naverSearchUrl = (p: Pick<Place, 'name' | 'gu'>) => `https://map.naver.com/p/search/${encodeURIComponent([p.gu, p.name].filter(Boolean).join(' '))}`;
export const telHref = (phone: string) => `tel:${phone.replace(/[^\d+]/g, '')}`;
export const won = (n: number) => `${n.toLocaleString('ko-KR')}원`;

const cache = new Map<string, Promise<unknown>>();
const getJson = <T>(path: string): Promise<T> => {
  if (!cache.has(path)) cache.set(path, fetch(path).then((r) => { if (!r.ok) throw new Error(`${path} ${r.status}`); return r.json(); }));
  return cache.get(path) as Promise<T>;
};
export const loadIndex = () => getJson<Index>('facilities/index.json');
export const loadPlaces = (sido: string) => getJson<Place[]>(`facilities/places/${sido}.json`);
export const loadDetails = (sido: string) => getJson<Record<string, Detail>>(`facilities/details/${sido}.json`);
