// 네이버 지도 JS v3 를 지도가 필요한 화면에서만 불러온다. 키는 Client ID 하나(등록한 도메인에서만 동작)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Naver = any;

const CLIENT_ID = import.meta.env.NEXT_PUBLIC_NAVER_MAP_CLIENT_ID;
let loading: Promise<Naver> | null = null;

export function loadNaverMaps(): Promise<Naver> {
  const w = window as unknown as { naver?: Naver; navermap_authFailure?: () => void };
  if (w.naver?.maps) return Promise.resolve(w.naver);
  if (!CLIENT_ID) return Promise.reject(new Error('지도 키 없음'));
  return (loading ??= new Promise((resolve, reject) => {
    w.navermap_authFailure = () => reject(new Error('지도 인증 실패 (네이버 콘솔에 이 도메인이 등록됐는지 확인)'));
    const s = document.createElement('script');
    s.src = `https://oapi.map.naver.com/openapi/v3/maps.js?ncpKeyId=${encodeURIComponent(CLIENT_ID)}`;
    s.async = true;
    s.onload = () => (w.naver?.maps ? resolve(w.naver) : reject(new Error('지도를 불러오지 못했어요')));
    s.onerror = () => reject(new Error('지도를 불러오지 못했어요'));
    document.head.appendChild(s);
  }));
}

/** 종류 색 동그라미 + 한 글자 표시 */
export const markerHtml = (mark: string, color: string, active = false) =>
  `<div class="fx-pin${active ? ' on' : ''}" style="--c:${color}">${mark}</div>`;
