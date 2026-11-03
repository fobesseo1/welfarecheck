// 기관 상세 화면 (facility.html?s=시도코드&id=기관ID): 공공데이터로 알 수 있는 것을 한 장에 모아 보여 준다
import { esc, attr } from './ui/html.ts';
import { SIDO, kindInfo, seatsLeft, naverSearchUrl, telHref, won, loadPlaces, loadDetails, type Place, type Detail } from './facilities.ts';
import { loadNaverMaps, markerHtml, whenAuthFails } from './naver-map.ts';

const root = document.getElementById('fd')!;
const q = new URLSearchParams(location.search);
const sido = q.get('s') ?? '';
const id = q.get('id') ?? '';

const sec = (title: string, body: string) => (body ? `<section class="fd-sec"><h2>${title}</h2>${body}</section>` : '');
const row = (k: string, v: string) => `<div class="fd-kv"><span>${k}</span><b>${v}</b></div>`;
const href = (u: string) => (/^https?:\/\//i.test(u) ? u : `http://${u}`);

function seats(p: Place, d: Detail): string {
  if (!d.accept?.length) return '';
  return d.accept.map((a) => {
    const left = a.capacity != null ? Math.max(0, a.capacity - a.current) : null;
    return `<div class="fd-seat">
      <p class="t">${esc(a.service)}</p>
      <div class="fd-nums">
        <div><span>정원</span><b>${a.capacity ?? '-'}</b></div>
        <div><span>현원</span><b>${a.current}</b></div>
        <div class="${left ? 'ok' : ''}"><span>남은 자리</span><b>${left ?? '-'}</b></div>
        <div><span>대기</span><b>${a.waiting}</b></div>
      </div></div>`;
  }).join('') + '<p class="fd-note">공단에 신고된 숫자예요. 지금 이용할 수 있는지는 전화로 직접 확인해 주세요.</p>';
}

function rooms(d: Detail): string {
  const r = d.rooms;
  if (!r || !(r[1] + r[2] + r[3] + r[4])) return '';
  return `<div class="fd-nums">${(['1', '2', '3', '4'] as const).map((n) => `<div><span>${n}인실</span><b>${r[n]}개</b></div>`).join('')}</div>`;
}

function nonpay(d: Detail): string {
  const list = (d.nonpay ?? []).filter((x) => x.amount || x.basis);
  if (!list.length) return '';
  return `<table class="fd-tbl"><thead><tr><th>항목</th><th>금액</th><th>계산 근거</th></tr></thead><tbody>${list.map((x) =>
    `<tr><td>${esc(x.item)}</td><td>${x.amount != null ? won(x.amount) : '-'}</td><td>${esc(x.basis ?? '')}</td></tr>`).join('')}</tbody></table>
    <p class="fd-note">장기요양 급여(본인부담금)와 별도로 내는 비용이에요. 기관이 공단에 신고한 금액 기준이에요.</p>`;
}

function render(p: Place, d: Detail) {
  document.title = `${p.name} · 모심듀오`;
  const k = kindInfo(p.kind);
  root.innerHTML = `
    <a class="fd-back" href="find.html#sido=${attr(sido)}${p.gu ? `&gu=${encodeURIComponent(p.gu)}` : ''}">← ${esc(SIDO[sido] ?? '')} 기관 목록</a>
    <header class="fd-top">
      <div class="fx-kinds">${p.kinds.map((x) => { const i = kindInfo(x); return `<span style="--c:${i.color}">${i.label}</span>`; }).join('')}${p.dementia ? '<span class="dem">치매 전담</span>' : ''}</div>
      <h1>${esc(p.name)}</h1>
      <p class="addr">${p.addr ? esc(p.addr) : '주소 정보 준비 중'}${d.zip ? ` <span class="muted">(${esc(d.zip)})</span>` : ''}</p>
      <div class="fx-acts">
        ${p.phone ? `<a class="fx-btn dark" href="${attr(telHref(p.phone))}">전화 ${esc(p.phone)}</a>` : ''}
        <a class="fx-btn" href="${attr(naverSearchUrl(p))}" target="_blank" rel="noopener">네이버 지도에서 보기</a>
        ${d.homepage ? `<a class="fx-btn" href="${attr(href(d.homepage))}" target="_blank" rel="noopener nofollow">홈페이지</a>` : ''}
      </div>
    </header>
    ${p.lat != null ? '<div id="fd-map" class="fd-map"></div>' : ''}
    ${p.kind === 'care_hospital' ? sec('요양병원 정보', [
      p.grade ? row('적정성평가', `${esc(p.grade)} <span class="muted">(1등급이 가장 좋음)</span>`) : d.gradeNote ? row('적정성평가', esc(d.gradeNote)) : '',
      d.doctors != null ? row('의사 수', `${d.doctors}명`) : '', d.since ? row('개설일', esc(d.since)) : '',
    ].join('')) : ''}
    ${sec('자리 현황', seats(p, d))}
    ${sec('방 구성', rooms(d))}
    ${sec('비급여 비용', nonpay(d))}
    ${sec('일하는 사람', d.staff?.length ? `<div class="fd-staff">${d.staff.map(([n, c]) => `<span>${esc(n)} <b>${c}</b></span>`).join('')}</div>` : '')}
    ${sec('찾아가는 길', [d.transit ? `<p>${esc(d.transit)}</p>` : '', d.parking ? row('주차', esc(d.parking)) : ''].join(''))}
    ${p.kind !== 'care_hospital' && d.since ? sec('기관 정보', row('장기요양기관 지정일', esc(d.since))) : ''}
    ${!d.accept && !d.staff && p.kind !== 'care_hospital' ? '<p class="fd-note">이 기관의 자세한 정보는 아직 모으는 중이에요. 며칠 안에 채워져요.</p>' : ''}
    <p class="fd-src">출처: ${p.kind === 'care_hospital' ? '건강보험심사평가원 병원정보·병원평가정보' : '국민건강보험공단 장기요양기관 정보'} (공공데이터${d.fetched ? `, ${esc(d.fetched.replaceAll('-', '.'))} 수집` : ''}). 실제와 다를 수 있으니 방문 전 기관에 확인해 주세요.</p>
    <a class="fx-btn mint big" href="consult.html">어디가 맞을지 모르겠다면 무료 상담</a>`;
  if (p.lat != null) {
    whenAuthFails(() => document.getElementById('fd-map')?.remove());
    loadNaverMaps().then((naver) => {
      const pos = new naver.maps.LatLng(p.lat, p.lng);
      const map = new naver.maps.Map(document.getElementById('fd-map'), { center: pos, zoom: 16, scaleControl: false, mapDataControl: false });
      new naver.maps.Marker({ position: pos, map, icon: { content: markerHtml(k.mark, k.color, true), anchor: new naver.maps.Point(14, 14) } });
    }).catch(() => document.getElementById('fd-map')?.remove());
  }
}

async function start() {
  if (!SIDO[sido] || !id) { root.innerHTML = '<p class="fd-note">기관을 찾을 수 없어요. <a href="find.html">기관 찾기</a>에서 다시 골라 주세요.</p>'; return; }
  try {
    const [places, details] = await Promise.all([loadPlaces(sido), loadDetails(sido)]);
    const p = places.find((x) => x.id === id);
    if (!p) throw new Error('없음');
    render(p, details[id] ?? {});
  } catch {
    root.innerHTML = '<p class="fd-note">기관 정보를 불러오지 못했어요. <a href="find.html">기관 찾기</a>로 돌아가 주세요.</p>';
  }
}
void start();
