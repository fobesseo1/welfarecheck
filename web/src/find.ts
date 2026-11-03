// 기관 찾기 화면 (find.html): 지역·종류로 고르면 목록과 네이버 지도에 함께 보여 준다
// 주소: find.html#sido=11&gu=노원구&kind=nursing_home  (3분 체크 결과 등에서 이 형태로 연결)
import { esc, attr } from './ui/html.ts';
import {
  SIDO, KINDS, kindInfo, seatsLeft, filterPlaces, sortPlaces, nearestRegion, telHref,
  loadIndex, loadPlaces, type Index, type Place, type Kind,
} from './facilities.ts';
import { loadNaverMaps, markerHtml, whenAuthFails, authFailMessage, type Naver } from './naver-map.ts';

const PAGE = 30;
const MAX_PINS = 400;

const st = {
  sido: '', gu: '', kind: '' as Kind | '', dementia: false, seats: false, q: '',
  origin: null as { lat: number; lng: number } | null,
  shown: PAGE, selected: '',
};
let index: Index | null = null;
let places: Place[] = [];
let view: (Place & { dist?: number })[] = [];

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;
const controls = $('#fx-controls');
const listEl = $('#fx-list');
const mapEl = $('#fx-map');
const mapNote = $('#fx-mapnote');

// ---------- 주소(#...) 와 상태 ----------
function readHash() {
  const h = new URLSearchParams(location.hash.slice(1));
  st.sido = SIDO[h.get('sido') ?? ''] ? h.get('sido')! : '';
  st.gu = h.get('gu') ?? '';
  const k = h.get('kind') ?? '';
  st.kind = KINDS.some((x) => x.id === k) ? (k as Kind) : '';
}
function writeHash() {
  const h = new URLSearchParams();
  if (st.sido) h.set('sido', st.sido);
  if (st.gu) h.set('gu', st.gu);
  if (st.kind) h.set('kind', st.kind);
  const s = h.toString();
  history.replaceState(null, '', `${location.pathname}${location.search}${s ? `#${s}` : ''}`);
}

// ---------- 고르는 칸 ----------
function renderControls() {
  const gus = st.sido && index ? Object.entries(index.sido[st.sido]?.gu ?? {}).filter(([, g]) => g.count >= 3) : [];
  controls.innerHTML = `
    <div class="fx-row">
      <label class="fx-sel"><span class="sr">시·도</span>
        <select id="fx-sido"><option value="">시·도 고르기</option>${Object.entries(SIDO).map(([c, n]) => `<option value="${c}"${c === st.sido ? ' selected' : ''}>${esc(n)}</option>`).join('')}</select>
      </label>
      <label class="fx-sel"><span class="sr">시·군·구</span>
        <select id="fx-gu"${st.sido && gus.length ? '' : ' disabled'}><option value="">${st.sido === '36' ? '세종 전체' : '시·군·구 전체'}</option>${gus.map(([g, v]) => `<option value="${attr(g)}"${g === st.gu ? ' selected' : ''}>${esc(g)} (${v.count})</option>`).join('')}</select>
      </label>
      <button type="button" class="fx-btn" id="fx-locate">내 위치</button>
    </div>
    <div class="fx-chips" role="group" aria-label="기관 종류">
      <button type="button" class="fx-chip" data-kind="" aria-pressed="${!st.kind}">전체</button>
      ${KINDS.map((k) => `<button type="button" class="fx-chip" data-kind="${k.id}" aria-pressed="${st.kind === k.id}"><i style="--c:${k.color}">${k.mark}</i>${k.label}</button>`).join('')}
    </div>
    <div class="fx-row fx-row2">
      <label class="fx-tog"><input type="checkbox" id="fx-dementia"${st.dementia ? ' checked' : ''}/> 치매 전담</label>
      <label class="fx-tog"><input type="checkbox" id="fx-seats"${st.seats ? ' checked' : ''}/> 남은 자리 있음</label>
      <input class="fx-q" id="fx-q" type="search" placeholder="이름·주소 검색" value="${attr(st.q)}" />
    </div>`;
}

controls.addEventListener('change', (e) => {
  const t = e.target as HTMLInputElement;
  if (t.id === 'fx-sido') { st.sido = t.value; st.gu = ''; st.origin = null; void loadSido(); return; }
  if (t.id === 'fx-gu') { st.gu = t.value; st.origin = null; update(true); return; }
  if (t.id === 'fx-dementia') st.dementia = t.checked;
  if (t.id === 'fx-seats') st.seats = t.checked;
  update(false);
});
controls.addEventListener('input', (e) => {
  const t = e.target as HTMLInputElement;
  if (t.id === 'fx-q') { st.q = t.value; update(false); }
});
controls.addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest('button');
  if (!b) return;
  if (b.id === 'fx-locate') { locate(b); return; }
  if (b.dataset.kind !== undefined) {
    st.kind = b.dataset.kind as Kind | '';
    controls.querySelectorAll<HTMLButtonElement>('.fx-chip').forEach((c) => c.setAttribute('aria-pressed', String(c.dataset.kind === st.kind)));
    update(false);
  }
});

function locate(btn: HTMLButtonElement) {
  if (!navigator.geolocation) { alert('이 브라우저에서는 위치를 알 수 없어요. 지역을 직접 골라 주세요.'); return; }
  btn.disabled = true; btn.textContent = '찾는 중…';
  navigator.geolocation.getCurrentPosition(async (pos) => {
    btn.disabled = false; btn.textContent = '내 위치';
    st.origin = { lat: pos.coords.latitude, lng: pos.coords.longitude };
    index ??= await loadIndex();
    const r = nearestRegion(index, st.origin);
    if (r) { const changed = r.sido !== st.sido; st.sido = r.sido; st.gu = r.gu; if (changed) { await loadSido(true); return; } }
    renderControls(); update(true);
  }, () => {
    btn.disabled = false; btn.textContent = '내 위치';
    alert('위치를 가져오지 못했어요. 브라우저에서 위치 권한을 허용하거나, 지역을 직접 골라 주세요.');
  }, { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 });
}

// ---------- 목록 ----------
function card(p: Place & { dist?: number }): string {
  const seats = seatsLeft(p);
  const facts = [
    p.capacity != null ? `정원 ${p.capacity}` : '',
    p.current != null && p.capacity != null ? `현원 ${p.current}` : '',
    seats != null ? `<b class="${seats > 0 ? 'ok' : ''}">남은 자리 ${seats}</b>` : '',
    p.waiting != null && p.capacity != null ? `대기 ${p.waiting}` : '',
  ].filter(Boolean).join(' · ');
  return `
    <li class="fx-card${p.id === st.selected ? ' on' : ''}" data-id="${attr(p.id)}">
      <div class="fx-kinds">${p.kinds.map((k) => { const i = kindInfo(k); return `<span style="--c:${i.color}">${i.label}</span>`; }).join('')}${p.dementia ? '<span class="dem">치매 전담</span>' : ''}${p.grade ? `<span class="grade">평가 ${esc(p.grade)}</span>` : ''}</div>
      <h3>${esc(p.name)}</h3>
      <p class="addr">${p.addr ? esc(p.addr) : '<span class="muted">주소 정보 준비 중</span>'}${p.dist != null ? ` <span class="dist">${p.dist < 1 ? `${Math.round(p.dist * 1000)}m` : `${p.dist.toFixed(1)}km`}</span>` : ''}</p>
      ${facts ? `<p class="facts">${facts}</p>` : ''}
      <div class="fx-acts">
        ${p.phone ? `<a class="fx-btn" href="${attr(telHref(p.phone))}">전화 ${esc(p.phone)}</a>` : ''}
        <a class="fx-btn dark" href="facility.html?s=${st.sido}&id=${encodeURIComponent(p.id)}">자세히</a>
      </div>
    </li>`;
}

function renderList() {
  if (!st.sido) {
    listEl.innerHTML = `<div class="fx-empty"><p><b>어느 지역에서 찾으세요?</b></p><p>시·도를 고르거나 <b>내 위치</b>를 눌러 주세요.</p></div>`;
    return;
  }
  const head = `<p class="fx-count"><b>${view.length.toLocaleString('ko-KR')}</b>곳${st.origin ? ' · 가까운 순' : ''}</p><p class="fx-hint">정원·현원·대기는 공단에 신고된 숫자예요. 지금 이용할 수 있는지는 전화로 직접 확인해 주세요.</p>`;
  if (!view.length) { listEl.innerHTML = `${head}<div class="fx-empty"><p>조건에 맞는 기관이 없어요. 조건을 줄여 보세요.</p></div>`; return; }
  listEl.innerHTML = `${head}<ul class="fx-cards">${view.slice(0, st.shown).map(card).join('')}</ul>
    ${view.length > st.shown ? `<button type="button" class="fx-more" id="fx-more">더 보기 (${(view.length - st.shown).toLocaleString('ko-KR')}곳 남음)</button>` : ''}`;
}

listEl.addEventListener('click', (e) => {
  const t = e.target as HTMLElement;
  if (t.id === 'fx-more') { st.shown += PAGE; renderList(); return; }
  if (t.closest('a')) return;
  const li = t.closest<HTMLElement>('.fx-card');
  if (li) select(li.dataset.id!, true);
});

// ---------- 지도 ----------
let naver: Naver = null;
let map: Naver = null;
let info: Naver = null;
const pins = new Map<string, Naver>();

async function initMap() {
  whenAuthFails(() => { mapEl.classList.add('off'); mapNote.textContent = `지도를 띄우지 못했어요 (${authFailMessage}). 목록은 그대로 쓸 수 있어요.`; });
  try {
    naver = await loadNaverMaps();
    map = new naver.maps.Map(mapEl, { center: new naver.maps.LatLng(36.4, 127.8), zoom: 7, scaleControl: false, mapDataControl: false });
    info = new naver.maps.InfoWindow({ borderWidth: 0, backgroundColor: 'transparent', disableAnchor: true, pixelOffset: new naver.maps.Point(0, -8) });
    naver.maps.Event.addListener(map, 'idle', drawPins);
    // 처음 열 때는 idle 이 목록보다 먼저 올 수 있어, 지도 준비가 끝나면 한 번 더 그린다
    naver.maps.Event.once(map, 'init', () => { moveMap(); drawPins(); });
    moveMap();
    setTimeout(drawPins, 300);
  } catch (e) {
    mapEl.classList.add('off');
    mapNote.textContent = `지도를 띄우지 못했어요 (${(e as Error).message}). 목록은 그대로 쓸 수 있어요.`;
  }
}

function moveMap() {
  if (!map) return;
  const located = view.filter((p) => p.lat != null);
  if (st.origin) { map.setCenter(new naver.maps.LatLng(st.origin.lat, st.origin.lng)); map.setZoom(14); return; }
  if (st.gu && located.length) {
    const b = new naver.maps.LatLngBounds();
    for (const p of located) b.extend(new naver.maps.LatLng(p.lat, p.lng));
    map.fitBounds(b, { top: 30, right: 30, bottom: 30, left: 30 });
    return;
  }
  const c = st.sido ? index?.sido[st.sido]?.center : null;
  if (c) { map.setCenter(new naver.maps.LatLng(c[0], c[1])); map.setZoom(st.sido === '36' ? 12 : 11); }
}

function drawPins() {
  if (!map) return;
  const bounds = map.getBounds();
  const inView = view.filter((p) => p.lat != null && bounds.hasLatLng(new naver.maps.LatLng(p.lat, p.lng)));
  const keep = new Set(inView.slice(0, MAX_PINS).map((p) => p.id));
  for (const [id, m] of pins) if (!keep.has(id)) { m.setMap(null); pins.delete(id); }
  for (const p of inView.slice(0, MAX_PINS)) {
    if (pins.has(p.id)) continue;
    const k = kindInfo(st.kind && p.kinds.includes(st.kind) ? st.kind : p.kind);
    const m = new naver.maps.Marker({
      position: new naver.maps.LatLng(p.lat, p.lng), map, title: p.name,
      icon: { content: markerHtml(k.mark, k.color, p.id === st.selected), anchor: new naver.maps.Point(14, 14) },
    });
    naver.maps.Event.addListener(m, 'click', () => select(p.id, false));
    pins.set(p.id, m);
  }
  mapNote.textContent = inView.length > MAX_PINS ? `이 화면에 ${inView.length.toLocaleString('ko-KR')}곳이 있어 ${MAX_PINS}곳만 표시했어요. 지도를 확대해 보세요.` : '';
}

function resetPins() { for (const m of pins.values()) m.setMap(null); pins.clear(); drawPins(); }

function select(id: string, fromList: boolean) {
  st.selected = id;
  const p = view.find((x) => x.id === id);
  listEl.querySelectorAll('.fx-card').forEach((li) => li.classList.toggle('on', (li as HTMLElement).dataset.id === id));
  if (!fromList) {
    const i = view.findIndex((x) => x.id === id);
    if (i >= st.shown) { st.shown = i + 1; renderList(); }
    listEl.querySelector(`[data-id="${CSS.escape(id)}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
  if (!map || !p || p.lat == null) return;
  const pos = new naver.maps.LatLng(p.lat, p.lng);
  if (fromList) map.panTo(pos);
  info.setContent(`<div class="fx-info"><b>${esc(p.name)}</b><a href="facility.html?s=${st.sido}&id=${encodeURIComponent(p.id)}">자세히 →</a></div>`);
  info.open(map, pos);
}

// ---------- 흐름 ----------
function update(move: boolean) {
  view = sortPlaces(filterPlaces(places, { kind: st.kind, gu: st.gu, dementia: st.dementia, seats: st.seats, q: st.q }), st.origin);
  st.shown = PAGE;
  writeHash();
  renderList();
  if (move) moveMap();
  resetPins();
}

async function loadSido(keepGu = false) {
  if (!keepGu) st.gu = '';
  renderControls();
  if (!st.sido) { places = []; update(true); return; }
  listEl.innerHTML = '<p class="fx-count">불러오는 중…</p>';
  try { places = await loadPlaces(st.sido); } catch { places = []; listEl.innerHTML = '<div class="fx-empty"><p>기관 정보를 불러오지 못했어요. 잠시 뒤 다시 시도해 주세요.</p></div>'; return; }
  update(true);
}

async function start() {
  readHash();
  try { index = await loadIndex(); $('#fx-built').textContent = index.builtAt.slice(0, 10).replaceAll('-', '.'); } catch { /* 목차 없이도 목록은 동작 */ }
  void initMap();
  await loadSido(true);
}
void start();
