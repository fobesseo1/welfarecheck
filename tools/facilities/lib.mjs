// 기관 수집 공통 함수 — 의존성 없음 (Node 20+ 의 fetch 사용)
import { readFileSync, existsSync } from 'node:fs';

/** 저장소 루트 .env.local 을 읽어 process.env 에 없는 값만 채운다 */
export function loadEnv(path) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$/);
    if (!m || process.env[m[1]]) continue;
    process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
}

const unescape = (s) => s
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')
  .trim();

/** 공공데이터포털 XML 응답(평평한 <item> 목록)을 { code, msg, total, items } 로 바꾼다 */
export function parseXml(xml) {
  const tag = (name, src = xml) => { const m = src.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`)); return m ? unescape(m[1]) : null; };
  // 게이트웨이 오류는 <OpenAPI_ServiceResponse> 안의 returnReasonCode 로 온다
  const code = tag('resultCode') ?? tag('returnReasonCode');
  const msg = tag('resultMsg') ?? tag('returnAuthMsg') ?? tag('errMsg');
  const total = Number(tag('totalCount') ?? NaN);
  const items = [];
  for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const rec = {};
    for (const f of m[1].matchAll(/<([A-Za-z0-9_]+)>([\s\S]*?)<\/\1>/g)) rec[f[1]] = unescape(f[2]);
    items.push(rec);
  }
  return { code, msg, total: Number.isNaN(total) ? null : total, items };
}

// 공단 기관유형코드 → 서비스 종류 (docs/api-specs/guide_nhis_ltc_detail.txt '기관유형코드 정의')
export function serviceOf(pttn) {
  if (/^A0[1-5]$/.test(pttn) || pttn === 'S41') return 'nursing_home';
  const m = pttn.match(/^[BC]0([1-6])$/);
  if (!m) return null; // 치매전담실 코드(G/M/H/I)는 따로 표시
  return { 1: 'home_care', 2: 'home_bath', 3: 'day_care', 4: 'short_stay', 5: 'home_nursing', 6: 'welfare_tool' }[m[1]];
}

/** 지도에 쓰는 대표 종류: 한 기관이 여러 서비스를 하면 이 순서로 하나를 고른다 */
export const KIND_PRIORITY = ['care_hospital', 'nursing_home', 'day_care', 'short_stay', 'home_care', 'home_nursing', 'home_bath', 'welfare_tool'];
export const primaryKind = (kinds) => KIND_PRIORITY.find((k) => kinds.includes(k)) ?? null;

export const isDementiaUnit = (pttn) => /^[GMHI]\d\d$/.test(pttn) || pttn === 'S41';

export const phoneOf = (r) => [r.locTelNo_1, r.locTelNo_2, r.locTelNo_3].filter(Boolean).join('-') || null;

export const num = (v) => (v === undefined || v === null || v === '' ? null : Number(v));

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * UTM-K(EPSG:5179, GRS80) → WGS84 위경도. 도로명주소 좌표제공 API 의 entX·entY 를 바꿀 때 쓴다.
 * 횡메르카토르 역변환 (원점 38N 127.5E, 축척 0.9996, 가산 X 1,000,000 · Y 2,000,000)
 */
export function utmkToWgs84(x, y) {
  const a = 6378137, f = 1 / 298.257222101, k0 = 0.9996;
  const lat0 = 38 * Math.PI / 180, lon0 = 127.5 * Math.PI / 180, x0 = 1000000, y0 = 2000000;
  const e2 = f * (2 - f), ep2 = e2 / (1 - e2);
  const M = (phi) => a * ((1 - e2 / 4 - 3 * e2 ** 2 / 64 - 5 * e2 ** 3 / 256) * phi
    - (3 * e2 / 8 + 3 * e2 ** 2 / 32 + 45 * e2 ** 3 / 1024) * Math.sin(2 * phi)
    + (15 * e2 ** 2 / 256 + 45 * e2 ** 3 / 1024) * Math.sin(4 * phi)
    - (35 * e2 ** 3 / 3072) * Math.sin(6 * phi));
  const mu = (M(lat0) + (y - y0) / k0) / (a * (1 - e2 / 4 - 3 * e2 ** 2 / 64 - 5 * e2 ** 3 / 256));
  const e1 = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2));
  const phi1 = mu + (3 * e1 / 2 - 27 * e1 ** 3 / 32) * Math.sin(2 * mu) + (21 * e1 ** 2 / 16 - 55 * e1 ** 4 / 32) * Math.sin(4 * mu)
    + (151 * e1 ** 3 / 96) * Math.sin(6 * mu) + (1097 * e1 ** 4 / 512) * Math.sin(8 * mu);
  const s = Math.sin(phi1), c = Math.cos(phi1), t = Math.tan(phi1);
  const N1 = a / Math.sqrt(1 - e2 * s * s), R1 = a * (1 - e2) / (1 - e2 * s * s) ** 1.5;
  const C1 = ep2 * c * c, T1 = t * t, D = (x - x0) / (N1 * k0);
  const lat = phi1 - (N1 * t / R1) * (D ** 2 / 2 - (5 + 3 * T1 + 10 * C1 - 4 * C1 ** 2 - 9 * ep2) * D ** 4 / 24
    + (61 + 90 * T1 + 298 * C1 + 45 * T1 ** 2 - 252 * ep2 - 3 * C1 ** 2) * D ** 6 / 720);
  const lon = lon0 + (D - (1 + 2 * T1 + C1) * D ** 3 / 6 + (5 - 2 * C1 + 28 * T1 - 3 * C1 ** 2 + 8 * ep2 + 24 * T1 ** 2) * D ** 5 / 120) / c;
  return { lat: lat * 180 / Math.PI, lng: lon * 180 / Math.PI };
}

/** 공단 일반현황 → 도로명주소 좌표제공 API 요청값 (법정동코드 10자리 + 도로명코드 12자리 + 건물번호) */
export function coordQuery(g) {
  if (!g?.roadNmCd || !g.gunmulMlno || !g.siDoCd || !g.siGunGuCd || !g.BDongCd) return null;
  const admCd = `${g.siDoCd}${g.siGunGuCd}${g.BDongCd}${(g.riCd ?? '00').padStart(2, '0')}`;
  return { admCd, rnMgtSn: g.roadNmCd, udrtYn: '0', buldMnnm: String(Number(g.gunmulMlno)), buldSlno: String(Number(g.gunmulSlno ?? 0)) };
}
