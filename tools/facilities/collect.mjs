#!/usr/bin/env node
// 전국 돌봄기관 수집 — 공공데이터포털 API (키: 저장소 루트 .env.local 의 DATA_GO_KR_SERVICE_KEY)
//
//   node tools/facilities/collect.mjs probe            API별로 1건씩 불러 키·활용신청 상태 확인
//   node tools/facilities/collect.mjs list             장기요양기관 전국 목록 (검색 API)
//   node tools/facilities/collect.mjs detail [--max 9000] [--days 7]
//                                                      기관별 상세 (하루 트래픽 안에서 끊어 받고, 다음 실행에 이어 받음)
//   node tools/facilities/collect.mjs hosp             요양병원 목록 + 적정성평가 (심평원)
//   node tools/facilities/collect.mjs geo [--max 20000] 장기요양기관 좌표 (도로명주소 좌표제공 API, 바뀐 주소만)
//   node tools/facilities/collect.mjs geo-file          장기요양기관 좌표 (주소정보 다운로드 '도로명주소 출입구 정보' TXT, 키 없이)
//   node tools/facilities/collect.mjs geo-addr [--max 30000] 장기요양기관 좌표 (우체국 주소 DB → 글자 주소 → 브이월드, 승인 불필요)
//   node tools/facilities/collect.mjs build            합쳐서 web/public/facilities/ 에 시도별 JSON 생성
//
// 받은 원본은 data/facilities/raw/ 에 쌓인다 (커밋하지 않음). 명세: docs/api-specs/, 계획: docs/FACILITY_DATA_PLAN.md
import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv, parseXml, serviceOf, primaryKind, isDementiaUnit, phoneOf, num, sleep, utmkToWgs84, coordQuery } from './lib.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const RAW = join(ROOT, 'data', 'facilities', 'raw');
const OUT = join(ROOT, 'web', 'public', 'facilities');
loadEnv(join(ROOT, '.env.local'));
const KEY = process.env.DATA_GO_KR_SERVICE_KEY;

const LTC_SEARCH = 'https://apis.data.go.kr/B550928/searchLtcInsttService02';
const LTC_DETAIL = 'https://apis.data.go.kr/B550928/getLtcInsttDetailInfoService02';
const HIRA_HOSP = 'https://apis.data.go.kr/B551182/hospInfoServicev2';
const HIRA_EVAL = 'https://apis.data.go.kr/B551182/hospAsmInfoService1';

// 시도코드: 강원(42→51)·전북(45→52)·광주+전남(29·46→12, 2026 통합) 은 신·구 코드를 모두 물어보고 기관기호로 중복 제거
const SIDO = ['11', '12', '26', '27', '28', '29', '30', '31', '36', '41', '42', '51', '43', '44', '45', '52', '46', '47', '48', '50'];

// 심평원 시도코드(앞 2자리) → 공단과 같은 법정동 시도코드
const HIRA_SIDO = { 11: '11', 21: '26', 22: '28', 23: '27', 24: '12', 25: '30', 26: '31', 31: '41', 32: '51', 33: '43', 34: '44', 35: '52', 36: '12', 37: '47', 38: '48', 39: '50', 41: '36' };

// 상세 기능: once = 기관당 1번, perType = 입소·주야간·단기보호 유형마다
const DETAIL_OPS = {
  general: { op: 'getGeneralSttusDetailInfoItem02', once: true },
  etc: { op: 'getInsttEtcDetailInfoItem02', once: true },
  staff: { op: 'getStaffSttusDetailInfoItem02', once: true },
  accept: { op: 'getAceptncNmprDetailInfoItem02' },
  room: { op: 'getInsttSttusDetailInfoItem02' },
  nonpay: { op: 'getNonBenefitSttusDetailInfoList02', list: true },
};
const RESIDENTIAL = new Set(['nursing_home', 'day_care', 'short_stay']);

const args = process.argv.slice(2);
const cmd = args[0];
const opt = (name, def) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : def; };
const readJson = (p, def) => (existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : def);
const writeJson = (p, v, pretty = false) => { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, JSON.stringify(v, null, pretty ? 1 : 0)); };

async function call(base, op, params, { retries = 2 } = {}) {
  if (!KEY) throw new Error('.env.local 에 DATA_GO_KR_SERVICE_KEY 가 없습니다');
  const qs = new URLSearchParams({ serviceKey: KEY, ...params });
  for (let attempt = 0, slow = 0; ; attempt++) {
    try {
      await throttle();
      const res = await fetch(`${base}/${op}?${qs}`, { signal: AbortSignal.timeout(30000) });
      const text = await res.text();
      if (!res.ok && attempt < retries) { await sleep(1000 * (attempt + 1)); continue; }
      const r = parseXml(text);
      // 23 = 초당 요청 제한 초과 → 잠깐 쉬고 다시 (재시도 횟수와 별도로 최대 6번)
      if (r.code === '23' && slow < 6) { slow++; attempt--; await sleep(1500 * slow); continue; }
      if (!res.ok) r.code ??= `HTTP${res.status}`;
      if (r.code === null && !r.items.length) r.code = text.slice(0, 120).replace(/\s+/g, ' ');
      return r;
    } catch (e) {
      if (attempt >= retries) return { code: 'NETWORK', msg: String(e), total: null, items: [] };
      await sleep(1000 * (attempt + 1));
    }
  }
}
const ok = (r) => r.code === '00' || r.code === '0' || r.code === '000';

// 모든 요청 사이 최소 간격 (기본 150ms ≈ 초당 6~7건). 개발계정은 안내된 30tps보다 낮게 막힌다
const GAP = Number(opt('gap', 150));
let nextAt = 0;
async function throttle() {
  const now = Date.now();
  const at = Math.max(now, nextAt);
  nextAt = at + GAP;
  if (at > now) await sleep(at - now);
}

/** 동시에 n개씩 처리 (공단 30tps 한도 아래로) */
async function pool(items, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) await fn(items[i++]); }));
}

async function probe() {
  const tries = [
    ['장기요양 검색 15059029', LTC_SEARCH, 'getLtcInsttSeachList02', { siDoCd: '11', siGunGuCd: '305', pageNo: 1, numOfRows: 1 }],
    ['장기요양 상세 15058856', LTC_DETAIL, 'getGeneralSttusDetailInfoItem02', { longTermAdminSym: '21130500195', adminPttnCd: 'B03' }],
    ['심평원 병원정보 15001698', HIRA_HOSP, 'getHospBasisList', { clCd: '28', pageNo: 1, numOfRows: 1 }],
    ['심평원 병원평가 15094093', HIRA_EVAL, 'getHospAsmInfo1', { pageNo: 1, numOfRows: 1 }],
  ];
  for (const [name, base, op, params] of tries) {
    const r = await call(base, op, params, { retries: 0 });
    const fields = r.items[0] ? Object.keys(r.items[0]).join(', ') : '';
    console.log(`${ok(r) ? 'OK ' : 'ERR'} ${name}  code=${r.code} ${ok(r) ? `total=${r.total}` : r.msg ?? ''}`);
    if (fields) console.log(`    필드: ${fields}`);
  }
}

async function list() {
  const all = new Map(); // key = 기관기호, value = { sym, name, siDoCd, siGunGuCd, types: [...] }
  for (const sido of SIDO) {
    let page = 1, got = 0, total = null;
    do {
      const r = await call(LTC_SEARCH, 'getLtcInsttSeachList02', { siDoCd: sido, pageNo: page, numOfRows: 1000 });
      if (!ok(r)) { console.log(`시도 ${sido} p${page}: ${r.code} ${r.msg ?? ''}`); break; }
      total = r.total ?? 0;
      for (const it of r.items) {
        const sym = it.longTermAdminSym;
        const cur = all.get(sym) ?? { sym, name: it.adminNm, siDoCd: it.siDoCd, siGunGuCd: it.siGunGuCd, types: [] };
        if (it.adminPttnCd && !cur.types.includes(it.adminPttnCd)) cur.types.push(it.adminPttnCd);
        cur.designated = it.longTermPeribRgtDt ?? cur.designated;
        all.set(sym, cur);
      }
      got += r.items.length; page++;
      if (!r.items.length) break;
    } while (got < total);
    if (total) console.log(`시도 ${sido}: ${got}/${total}`);
  }
  const out = [...all.values()];
  writeJson(join(RAW, 'ltc_list.json'), { fetchedAt: new Date().toISOString(), count: out.length, items: out });
  console.log(`장기요양기관 ${out.length}곳 (기관기호 기준) → data/facilities/raw/ltc_list.json`);
}

async function detail() {
  const max = Number(opt('max', 9000)); // 기능별 하루 호출 상한 (개발계정 10,000)
  const fresh = Number(opt('days', 7)) * 864e5;
  const { items } = readJson(join(RAW, 'ltc_list.json'), { items: [] });
  if (!items.length) throw new Error('먼저 list 를 실행하세요');
  const used = Object.fromEntries(Object.keys(DETAIL_OPS).map((k) => [k, 0]));
  const cachePath = (f) => join(RAW, 'detail', `${f.sym}.json`);
  const jobsFor = (f, cache) => {
    const services = f.types.filter((t) => serviceOf(t) && serviceOf(t) !== 'welfare_tool'); // 복지용구 사업소는 받지 않음
    const jobs = [];
    for (const [name, d] of Object.entries(DETAIL_OPS)) {
      const types = !services.length ? [] : d.once ? [services[0]] : services.filter((t) => RESIDENTIAL.has(serviceOf(t)));
      for (const t of types) {
        const key = d.once ? name : `${name}:${t}`;
        const prev = cache.ops[key];
        if (prev && Date.now() - Date.parse(prev.at) < fresh) continue;
        jobs.push({ name, d, t, key });
      }
    }
    return jobs;
  };
  let done = 0, skipped = 0, stopped = false;
  await pool(items, 5, async (f) => {
    if (stopped) return;
    const cache = readJson(cachePath(f), { ops: {} });
    const jobs = jobsFor(f, cache);
    if (!jobs.length) { skipped++; return; }
    for (const j of jobs) {
      if (stopped || used[j.name] >= max) { stopped = true; break; }
      used[j.name]++;
      const r = await call(LTC_DETAIL, j.d.op, { longTermAdminSym: f.sym, adminPttnCd: j.t, pageNo: 1, numOfRows: 100 });
      if (r.code === '22') { stopped = true; console.log('하루 호출 한도 초과 — 내일 이어서 실행하세요'); break; }
      if (!ok(r) && r.code !== '03') continue; // 03 = 자료 없음
      cache.ops[j.key] = { at: new Date().toISOString(), data: j.d.list ? r.items : (r.items[0] ?? null) };
    }
    writeJson(cachePath(f), cache); // 중간에 멈춰도 받은 것은 저장
    if (++done % 200 === 0) console.log(`  ${done}곳 받음`, used);
  });
  // 남은 기관 수 → 매일 자동 실행(run-daily.cmd)이 0이면 예약 작업을 지운다
  const remaining = items.filter((f) => jobsFor(f, readJson(cachePath(f), { ops: {} })).length).length;
  writeJson(join(RAW, 'detail-status.json'), { at: new Date().toISOString(), total: items.length, remaining, used }, true);
  console.log(`상세 ${done}곳 받음, ${skipped}곳은 최근 자료 있음, 남은 기관 ${remaining}곳${stopped ? ' — 한도에서 멈춤, 다시 실행하면 이어 받음' : ''}`, used);
}

async function hosp() {
  const items = [];
  let page = 1, total = null;
  do {
    const r = await call(HIRA_HOSP, 'getHospBasisList', { clCd: '28', pageNo: page, numOfRows: 1000 });
    if (!ok(r)) { console.log(`요양병원 p${page}: ${r.code} ${r.msg ?? ''}`); break; }
    total = r.total; items.push(...r.items); page++;
    if (!r.items.length) break;
  } while (items.length < total);
  console.log(`요양병원 ${items.length}/${total}`);
  const evals = readJson(join(RAW, 'hira_eval.json'), {});
  await pool(items, 5, async (h) => {
    if (evals[h.ykiho]) return;
    const r = await call(HIRA_EVAL, 'getHospAsmInfo1', { ykiho: h.ykiho, pageNo: 1, numOfRows: 100 });
    if (ok(r) || r.code === '03') evals[h.ykiho] = { at: new Date().toISOString(), items: r.items };
  });
  writeJson(join(RAW, 'hira_hosp.json'), { fetchedAt: new Date().toISOString(), count: items.length, items });
  writeJson(join(RAW, 'hira_eval.json'), evals);
}

// 도로명주소 좌표제공 API (business.juso.go.kr, 키: JUSO_COORD_API_KEY). 공단 자료엔 글자 주소가 없고
// 도로명코드·건물번호만 있어, 이 값을 그대로 받는 이 API로 좌표를 만든다. 결과는 UTM-K → 위경도로 바꿔 저장
async function geo() {
  const key = process.env.JUSO_COORD_API_KEY;
  if (!key) throw new Error('.env.local 에 JUSO_COORD_API_KEY 가 없습니다');
  const max = Number(opt('max', 20000));
  const cachePath = join(ROOT, 'data', 'facilities', 'geocode-cache.json');
  const cache = readJson(cachePath, {});
  const { items } = readJson(join(RAW, 'ltc_list.json'), { items: [] });
  const todo = [];
  for (const f of items) {
    const q = coordQuery(readJson(join(RAW, 'detail', `${f.sym}.json`), { ops: {} }).ops.general?.data);
    if (!q) continue;
    const id = `LTC-${f.sym}`, sig = Object.values(q).join('-');
    if (cache[id]?.sig === sig) continue; // 주소가 그대로면 다시 묻지 않음
    todo.push({ id, q, sig });
  }
  console.log(`좌표 필요 ${todo.length}곳 (이번 실행 최대 ${max})`);
  let okN = 0, fail = 0, n = 0;
  await pool(todo.slice(0, max), 4, async ({ id, q, sig }) => {
    await throttle();
    const qs = new URLSearchParams({ confmKey: key, resultType: 'json', ...q });
    try {
      const res = await fetch(`https://business.juso.go.kr/addrlink/addrCoordApi.do?${qs}`, { signal: AbortSignal.timeout(20000) });
      const j = (await res.json()).results;
      const code = j?.common?.errorCode;
      if (code !== '0') {
        if (/E0001|E0014|-999/.test(code)) throw new Error(`좌표 API 오류 ${code} ${j?.common?.errorMessage}`); // 키 문제는 바로 멈춤
        cache[id] = { sig, precision: 'failed', reason: code }; fail++; return;
      }
      const hit = j.juso?.[0];
      if (!hit?.entX) { cache[id] = { sig, precision: 'failed', reason: 'empty' }; fail++; return; }
      const { lat, lng } = utmkToWgs84(Number(hit.entX), Number(hit.entY));
      cache[id] = { sig, lat: Math.round(lat * 1e5) / 1e5, lng: Math.round(lng * 1e5) / 1e5, precision: 'road' };
      okN++;
    } catch (e) {
      if (/좌표 API 오류/.test(String(e))) throw e;
      fail++; // 네트워크 오류는 저장하지 않아 다음 실행에 다시 시도
    }
    if (++n % 500 === 0) { writeJson(cachePath, cache); console.log(`  ${n}곳 처리 (성공 ${okN}, 실패 ${fail})`); }
  });
  writeJson(cachePath, cache);
  console.log(`좌표 성공 ${okN}, 실패 ${fail} → data/facilities/geocode-cache.json`);
}

// 주소정보누리집 > 주소정보 다운로드 > 제공하는 주소 > '도로명주소 출입구 정보'(TXT) 를 data/facilities/raw/juso/ 에 풀어 두면
// 도로명코드+지하여부+건물본번·부번으로 출입구 좌표(UTM-K)를 찾는다. 좌표 API 와 같은 값이라 결과를 같은 캐시에 쓴다
const GEO_CACHE = join(ROOT, 'data', 'facilities', 'geocode-cache.json');

// 폴더 아래 .txt 전부 (하위 폴더 포함). UTF-8 이 아니면 EUC-KR 로 읽는다
function readTxtFiles(dir, what) {
  const files = [];
  const walk = (d) => { for (const e of readdirSync(d, { withFileTypes: true })) e.isDirectory() ? walk(join(d, e.name)) : /\.txt$/i.test(e.name) && files.push(join(d, e.name)); };
  if (existsSync(dir)) walk(dir);
  if (!files.length) throw new Error(`${dir.slice(ROOT.length + 1)} 에 ${what} TXT 가 없습니다`);
  return files.map((file) => {
    const buf = readFileSync(file);
    const text = new TextDecoder('utf-8').decode(buf);
    return { file, text: text.includes('�') ? new TextDecoder('euc-kr').decode(buf) : text };
  });
}

// 상세를 받은 기관의 주소 열쇠 'rnMgtSn|지하|본번|부번' → [{id, sig}]
function wantedAddresses() {
  const want = new Map();
  for (const f of readJson(join(RAW, 'ltc_list.json'), { items: [] }).items) {
    const q = coordQuery(readJson(join(RAW, 'detail', `${f.sym}.json`), { ops: {} }).ops.general?.data);
    if (!q) continue;
    const k = [q.rnMgtSn, q.udrtYn, Number(q.buldMnnm), Number(q.buldSlno)].join('|');
    if (!want.has(k)) want.set(k, []);
    want.get(k).push({ id: `LTC-${f.sym}`, sig: Object.values(q).join('-') });
  }
  return want;
}

function geoFile() {
  const cache = readJson(GEO_CACHE, {});
  const want = wantedAddresses();
  const found = new Map(); // 주출입구(RM)·공용(01)을 먼저 쓴다
  const rank = (se, ty) => (se === 'RM' ? 0 : 2) + (ty === '01' ? 0 : 1);
  for (const { file, text } of readTxtFiles(join(RAW, 'juso'), '출입구 정보')) {
    for (const line of text.split(/\r?\n/)) {
      const c = line.split('|');
      if (c.length < 19) continue;
      const k = [c[6], c[8], Number(c[9]), Number(c[10])].join('|');
      if (!want.has(k) || c[13] === '63') continue; // 63 = 폐지
      const r = rank(c[15], c[16]);
      if (found.has(k) && found.get(k).r <= r) continue;
      found.set(k, { r, x: Number(c[17]), y: Number(c[18]) });
    }
    console.log(`  ${file.slice(ROOT.length + 1)} 읽음 (지금까지 ${found.size}/${want.size})`);
  }
  let okN = 0;
  for (const [k, list] of want) {
    const hit = found.get(k);
    if (!hit || !hit.x) continue;
    const { lat, lng } = utmkToWgs84(hit.x, hit.y);
    for (const { id, sig } of list) { cache[id] = { sig, lat: Math.round(lat * 1e5) / 1e5, lng: Math.round(lng * 1e5) / 1e5, precision: 'road' }; okN++; }
  }
  writeJson(GEO_CACHE, cache);
  console.log(`좌표 ${okN}곳 (주소 ${found.size}/${want.size} 찾음) → data/facilities/geocode-cache.json`);
}

// 승인 없이 되는 길: 우체국 우편번호 DB(epost.go.kr '지역별 주소 DB', 로그인 없이 내려받기)를 data/facilities/raw/epost/ 에 풀어 두면
// 도로명코드+건물번호로 글자 주소(도로명·지번)를 만들고, 브이월드 지오코더(VWORLD_API_KEY)로 위경도를 받는다
// 칼럼: 0 우편번호 1 시도 3 시군구 5 읍면 7 도로명코드 8 도로명 10 지하여부 11 건물본번 12 건물부번 17 법정동명 18 리명 20 산여부 21 지번본번 23 지번부번
async function geoAddr() {
  const key = process.env.VWORLD_API_KEY;
  if (!key) throw new Error('.env.local 에 VWORLD_API_KEY 가 없습니다');
  const max = Number(opt('max', 30000));
  const cache = readJson(GEO_CACHE, {});
  const want = wantedAddresses();
  const addr = new Map();
  const no = (a, b) => `${Number(a)}${Number(b) > 0 ? `-${Number(b)}` : ''}`;
  for (const { text } of readTxtFiles(join(RAW, 'epost'), '우체국 주소 DB')) {
    for (const line of text.split(/\r?\n/)) {
      const c = line.split('|');
      if (c.length < 24) continue;
      const k = [c[7], c[10], Number(c[11]), Number(c[12])].join('|');
      if (!want.has(k) || addr.has(k)) continue;
      addr.set(k, {
        road: [c[1], c[3], c[5], c[8], `${c[10] === '1' ? '지하 ' : ''}${no(c[11], c[12])}`].filter(Boolean).join(' '),
        parcel: [c[1], c[3], c[17] || c[5], c[18], `${c[20] === '1' ? '산' : ''}${no(c[21], c[23])}`].filter(Boolean).join(' '),
        zip: c[0],
      });
    }
  }
  const todo = [];
  for (const [k, list] of want) {
    const a = addr.get(k);
    if (!a) continue; // 우체국 DB 에 없는 주소는 DB 를 새로 받을 때 다시
    const left = list.filter(({ id, sig }) => cache[id]?.sig !== sig);
    if (left.length) todo.push({ a, list: left });
  }
  console.log(`글자 주소 ${addr.size}/${want.size}, 좌표 필요 ${todo.length}곳 (이번 실행 최대 ${max})`);
  const ask = async (type, address) => {
    await throttle();
    const qs = new URLSearchParams({ service: 'address', request: 'getcoord', version: '2.0', crs: 'epsg:4326', type, refine: 'true', simple: 'true', format: 'json', key, address });
    const r = (await (await fetch(`https://api.vworld.kr/req/address?${qs}`, { signal: AbortSignal.timeout(20000) })).json()).response;
    if (r?.status === 'OK') return { lat: Number(r.result.point.y), lng: Number(r.result.point.x) };
    if (r?.status === 'NOT_FOUND') return null;
    throw new Error(`브이월드 오류 ${r?.error?.code} ${r?.error?.text}`); // 키·한도 문제는 바로 멈춤
  };
  let okN = 0, fail = 0, n = 0;
  try {
    await pool(todo.slice(0, max), 4, async ({ a, list }) => {
      let hit = await ask('road', a.road), precision = 'road';
      if (!hit) { hit = await ask('parcel', a.parcel); precision = 'parcel'; }
      for (const { id, sig } of list) {
        cache[id] = hit
          ? { sig, lat: Math.round(hit.lat * 1e5) / 1e5, lng: Math.round(hit.lng * 1e5) / 1e5, precision, addr: a.road, zip: a.zip }
          : { sig, precision: 'failed', addr: a.road, zip: a.zip };
      }
      hit ? okN++ : fail++;
      if (++n % 500 === 0) { writeJson(GEO_CACHE, cache); console.log(`  ${n}곳 처리 (성공 ${okN}, 실패 ${fail})`); }
    });
  } finally {
    writeJson(GEO_CACHE, cache);
    console.log(`좌표 성공 ${okN}, 실패 ${fail} → data/facilities/geocode-cache.json`);
  }
}

// 공단 인력현황 칸 이름 (docs/api-specs/nhis_ltc_detail_15058856.txt)
const STAFF = [
  ['equipLong', '시설장'], ['hdOfce', '사무국장'], ['socWel', '사회복지사'], ['chrgDoc', '의사(전임)'], ['chargeDoc', '의사(촉탁)'],
  ['nur', '간호사'], ['nurArticle', '간호조무사'], ['dent', '치위생사'], ['physicalMTret', '물리치료사'], ['wrkMTret', '작업치료사'],
  ['recuProt_1', '요양보호사 1급'], ['recuProt_2', '요양보호사 2급'], ['nut', '영양사'], ['cook', '조리원'], ['hygiPrsn', '위생원'],
  ['ofceEmp', '사무원'], ['mgmtPrsn', '관리인'], ['suppPrsn', '보조원'], ['etcPer', '기타'],
];
const NONPAY = { 1: '식재료비', 2: '상급침실(1인실)', 3: '이·미용비', 4: '경관영양 유동식비', 5: '간식비', 6: '상급침실(2인실)', 7: '기타' };
const SERVICE_NAME = { nursing_home: '요양원(입소)', day_care: '주야간보호', short_stay: '단기보호', home_care: '방문요양', home_bath: '방문목욕', home_nursing: '방문간호' };
const day = (s) => (/^\d{8}$/.test(s ?? '') ? `${s.slice(0, 4)}.${s.slice(4, 6)}.${s.slice(6)}` : null);
const clean = (s) => (s ? String(s).replace(/\s+/g, ' ').trim() || null : null);
// 시군구 이름: 주소 둘째 낱말 (세종은 시군구가 없음)
const guOf = (addr, sido) => (sido === '36' || !addr ? null : addr.split(' ')[1] ?? null);

// 시군구 코드(시도 2 + 시군구 3) → 이름. 목록 API 의 코드로 지역을 정해야 상세를 아직 못 받은 기관도 시군구에 들어간다
// 1) 우체국 주소 DB 의 도로명코드 앞 5자리와 시군구 이름 (data/facilities/sgg-names.json 에 저장해 두고 재사용)
// 2) 우체국 DB 에 없는 코드(2026 통합 광주·전남 12 등)는 상세 주소에서 가장 많이 나온 이름
const SGG_CACHE = join(ROOT, 'data', 'facilities', 'sgg-names.json');
function sggNames(items) {
  let names = readJson(SGG_CACHE, null);
  if (!names) {
    names = {};
    for (const { text } of readTxtFiles(join(RAW, 'epost'), '우체국 주소 DB')) {
      for (const line of text.split(/\r?\n/)) {
        const c = line.split('|');
        if (c.length < 24 || !/^\d{12}$/.test(c[7])) continue;
        names[c[7].slice(0, 5)] ??= c[3].split(' ')[0] || null;
      }
    }
    writeJson(SGG_CACHE, names, true);
  }
  const votes = {};
  for (const f of items) {
    const gu = guOf(clean(readJson(join(RAW, 'detail', `${f.sym}.json`), { ops: {} }).ops.general?.data?.adminAddr), f.siDoCd);
    if (!gu || !/[시군구]$/.test(gu)) continue;
    const v = (votes[f.siDoCd + f.siGunGuCd] ??= {});
    v[gu] = (v[gu] ?? 0) + 1;
  }
  return (sido, sgg) => {
    if (sido === '36') return null; // 세종은 시군구 없음
    const k = sido + sgg;
    const voted = Object.entries(votes[k] ?? {}).sort((a, b) => b[1] - a[1])[0]?.[0];
    return names[k] ?? voted ?? null;
  };
}

function build() {
  const geo = readJson(GEO_CACHE, {});
  const ltcItems = readJson(join(RAW, 'ltc_list.json'), { items: [] }).items;
  const sggName = sggNames(ltcItems);
  const bySido = {};
  const details = {};
  const add = (sido, place, detail) => { (bySido[sido] ??= []).push(place); (details[sido] ??= {})[place.id] = detail; };
  const round = (v) => (v == null || Number.isNaN(v) ? null : Math.round(v * 1e5) / 1e5);

  for (const f of ltcItems) {
    const kinds = [...new Set(f.types.map(serviceOf).filter(Boolean))].filter((k) => k !== 'welfare_tool');
    if (!kinds.length) continue;
    const ops = readJson(join(RAW, 'detail', `${f.sym}.json`), { ops: {} }).ops;
    const g = ops.general?.data ?? {};
    const etc = ops.etc?.data ?? {};
    const st = ops.staff?.data ?? null;
    const accepts = Object.entries(ops).filter(([k]) => k.startsWith('accept:')).map(([k, v]) => [k.slice(7), v.data]).filter(([, d]) => d);
    const acc = accepts.map(([, d]) => d);
    const sum = (field) => (acc.length ? acc.reduce((s, a) => s + (num(a[field]) ?? 0), 0) : null);
    const id = `LTC-${f.sym}`;
    const pos = geo[id];
    const addr = clean(g.adminAddr) ?? pos?.addr ?? null;
    add(f.siDoCd, {
      id, name: f.name, kind: primaryKind(kinds), kinds,
      lat: round(pos?.lat), lng: round(pos?.lng), addr, gu: sggName(f.siDoCd, f.siGunGuCd) ?? guOf(addr, f.siDoCd),
      grade: null, // 공단 기관별 평가등급은 공개 API에 없음 (docs/FACILITY_DATA_PLAN.md 2절)
      phone: phoneOf(g),
      dementia: f.types.some(isDementiaUnit) || undefined,
      capacity: sum('totPer'), current: acc.length ? sum('maNowPer') + sum('fmNowPer') : null, waiting: acc.length ? sum('maRsvPer') + sum('fmRsvPer') : null,
    }, {
      zip: g.hmPostNo ?? pos?.zip ?? null, since: day(g.longTermPeribRgtDt),
      homepage: clean(etc.hmpgAddr), transit: clean(etc.tfMth), parking: clean(etc.pkngEquip),
      accept: accepts.map(([pttn, d]) => ({ service: SERVICE_NAME[serviceOf(pttn)] ?? pttn, capacity: num(d.totPer), current: (num(d.maNowPer) ?? 0) + (num(d.fmNowPer) ?? 0), waiting: (num(d.maRsvPer) ?? 0) + (num(d.fmRsvPer) ?? 0) })),
      rooms: (() => {
        const r = Object.entries(ops).filter(([k]) => k.startsWith('room:')).map(([, v]) => v.data).filter(Boolean);
        if (!r.length) return null;
        const n = (i) => r.reduce((s, x) => s + (num(x[`prsnRoomreal${i}`]) ?? 0), 0);
        return { 1: n(1), 2: n(2), 3: n(3), 4: n(4) };
      })(),
      staff: st ? STAFF.map(([k, label]) => [label, num(st[k]) ?? 0]).filter(([, n]) => n > 0) : null,
      nonpay: (() => {
        const seen = new Set();
        return Object.entries(ops).filter(([k]) => k.startsWith('nonpay:')).flatMap(([, v]) => (Array.isArray(v.data) ? v.data : v.data ? [v.data] : []))
          .map((x) => ({ item: NONPAY[x.nonpayKind] ?? '기타', amount: num(x.nonpayTgtAmt), basis: clean(x.prodBase), updated: day(x.uptDt) }))
          .filter((x) => { const k = `${x.item}|${x.amount}|${x.basis}`; return !seen.has(k) && seen.add(k); });
      })(),
      fetched: ops.general?.at?.slice(0, 10) ?? null,
    });
  }

  const evals = readJson(join(RAW, 'hira_eval.json'), {});
  for (const h of readJson(join(RAW, 'hira_hosp.json'), { items: [] }).items) {
    // asmGrd10 = 요양병원 적정성평가 등급 1~5 또는 '등급제외' (docs/api-specs/guide_hira_hosp_eval.txt)
    const g10 = (evals[h.ykiho]?.items ?? []).map((e) => e.asmGrd10).find(Boolean) ?? null;
    const id = `HIRA-${h.ykiho.slice(0, 24)}`;
    const sido = HIRA_SIDO[h.sidoCd?.slice(0, 2)] ?? '00';
    const addr = clean(h.addr);
    add(sido, {
      id, name: h.yadmNm, kind: 'care_hospital', kinds: ['care_hospital'],
      lat: round(num(h.YPos ?? h.yPos)), lng: round(num(h.XPos ?? h.xPos)), addr, gu: guOf(addr, sido),
      grade: /^[1-5]$/.test(g10 ?? '') ? `${g10}등급` : null,
      phone: h.telno ?? null,
    }, { zip: h.postNo ?? null, since: day(h.estbDd), doctors: num(h.drTotCnt), gradeNote: g10 === '등급제외' ? '등급제외' : null });
  }

  // 목차: 시도·시군구별 기관 수와 좌표 평균(내 위치에서 가까운 지역 고르기용)
  const center = (ps) => {
    const c = ps.filter((p) => p.lat != null);
    return c.length ? [round(c.reduce((s, p) => s + p.lat, 0) / c.length), round(c.reduce((s, p) => s + p.lng, 0) / c.length)] : null;
  };
  const index = {};
  for (const [sido, places] of Object.entries(bySido)) {
    writeJson(join(OUT, 'places', `${sido}.json`), places);
    writeJson(join(OUT, 'details', `${sido}.json`), details[sido]);
    const byGu = {};
    for (const p of places) if (p.gu) (byGu[p.gu] ??= []).push(p);
    index[sido] = { count: places.length, center: center(places), gu: Object.fromEntries(Object.entries(byGu).sort().map(([g, ps]) => [g, { count: ps.length, center: center(ps) }])) };
  }
  writeJson(join(OUT, 'index.json'), { builtAt: new Date().toISOString(), sido: index }, true);
  console.log('시도별 기관 수', Object.fromEntries(Object.entries(index).map(([s, v]) => [s, v.count])));
}

const commands = { probe, list, detail, hosp, geo, 'geo-file': geoFile, 'geo-addr': geoAddr, build };
if (!commands[cmd]) { console.log('사용법: node tools/facilities/collect.mjs <probe|list|detail|hosp|geo|geo-file|geo-addr|build>'); process.exit(1); }
await commands[cmd]();
