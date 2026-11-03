import { describe, expect, it } from 'vitest';
import { km, seatsLeft, filterPlaces, sortPlaces, nearestRegion, naverSearchUrl, telHref, type Place, type Index } from '../src/facilities.ts';

const P = (o: Partial<Place>): Place => ({
  id: 'x', name: '기관', kind: 'home_care', kinds: ['home_care'], lat: null, lng: null, addr: null, gu: null, grade: null, phone: null, ...o,
});
const home = P({ id: 'a', name: '노원 방문요양센터', addr: '서울특별시 노원구 노원로 1', gu: '노원구', lat: 37.65, lng: 127.06 });
const nh = P({ id: 'b', name: '상계 요양원', kind: 'nursing_home', kinds: ['nursing_home'], addr: '서울특별시 노원구 상계로 2', gu: '노원구', lat: 37.66, lng: 127.07, capacity: 30, current: 28, dementia: true });
const full = P({ id: 'c', name: '도봉 요양원', kind: 'nursing_home', kinds: ['nursing_home'], gu: '도봉구', lat: 37.67, lng: 127.04, capacity: 20, current: 20 });
const noGeo = P({ id: 'd', name: '가나다 주간보호', kind: 'day_care', kinds: ['day_care', 'home_care'] });

describe('기관 찾기 계산', () => {
  it('두 지점 거리(km)', () => {
    expect(km({ lat: 37.5665, lng: 126.978 }, { lat: 35.1796, lng: 129.0756 })).toBeCloseTo(325, -1); // 서울시청-부산시청 약 325km
    expect(km({ lat: 37, lng: 127 }, { lat: 37, lng: 127 })).toBe(0);
  });

  it('남은 자리는 입소·이용 시설만, 정원을 알 때만', () => {
    expect(seatsLeft(nh)).toBe(2);
    expect(seatsLeft(full)).toBe(0);
    expect(seatsLeft(home)).toBeNull();
    expect(seatsLeft(P({ kind: 'nursing_home', kinds: ['nursing_home'], capacity: 10, current: 12 }))).toBe(0);
  });

  it('종류·시군구·치매·남은 자리·검색어로 거른다', () => {
    const all = [home, nh, full, noGeo];
    expect(filterPlaces(all, { kind: 'home_care' }).map((p) => p.id)).toEqual(['a', 'd']); // 여러 서비스 하는 곳도 포함
    expect(filterPlaces(all, { gu: '노원구' }).map((p) => p.id)).toEqual(['a', 'b']);
    expect(filterPlaces(all, { dementia: true }).map((p) => p.id)).toEqual(['b']);
    expect(filterPlaces(all, { seats: true }).map((p) => p.id)).toEqual(['b']);
    expect(filterPlaces(all, { q: '상계 요양' }).map((p) => p.id)).toEqual(['b']);
    expect(filterPlaces(all, { q: '노원로' }).map((p) => p.id)).toEqual(['a']);
  });

  it('내 위치가 있으면 가까운 순, 위치 모르는 곳은 뒤로', () => {
    const s = sortPlaces([noGeo, full, home], { lat: 37.65, lng: 127.06 });
    expect(s.map((p) => p.id)).toEqual(['a', 'c', 'd']);
    expect(s[0].dist).toBe(0);
    expect(s[2].dist).toBeUndefined();
  });

  it('위치가 없으면 주소 있는 곳 먼저, 이름순', () => {
    expect(sortPlaces([noGeo, nh, home]).map((p) => p.id)).toEqual(['a', 'b', 'd']); // 노원 < 상계, 주소 없는 곳은 뒤
  });

  it('가장 가까운 시군구를 고르되 한두 곳짜리 지역은 건너뛴다', () => {
    const index: Index = { builtAt: '', sido: {
      11: { count: 10, center: [37.55, 126.99], gu: { 노원구: { count: 50, center: [37.65, 127.06] }, 고양시: { count: 1, center: [37.66, 127.06] } } },
      26: { count: 10, center: [35.17, 129.07], gu: { 해운대구: { count: 40, center: [35.16, 129.16] } } },
    } };
    expect(nearestRegion(index, { lat: 37.66, lng: 127.061 })).toEqual({ sido: '11', gu: '노원구' });
    expect(nearestRegion(index, { lat: 35.2, lng: 129.1 })).toEqual({ sido: '26', gu: '해운대구' });
  });

  it('네이버 지도 검색 주소·전화 링크', () => {
    expect(naverSearchUrl({ name: '상계 요양원', gu: '노원구' })).toBe(`https://map.naver.com/p/search/${encodeURIComponent('노원구 상계 요양원')}`);
    expect(telHref('02-931-4450')).toBe('tel:029314450');
  });
});
