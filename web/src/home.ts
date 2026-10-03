// 홈페이지: 소개 영상 팝업, 휴대폰 메뉴, 회사 정보(site.ts 에서 정해진 것만)
import { SITE } from './site.ts';
import { openIntro } from './ui/intro.ts';

document.addEventListener('click', (ev) => {
  const t = ev.target as HTMLElement;
  if (t.closest('[data-act="intro"]')) { openIntro(); return; }
  const menu = t.closest('.h-menu') as HTMLButtonElement | null;
  const nav = document.getElementById('h-nav')!;
  if (menu) {
    const open = !nav.classList.contains('open');
    nav.classList.toggle('open', open);
    menu.setAttribute('aria-expanded', String(open));
    menu.setAttribute('aria-label', open ? '메뉴 닫기' : '메뉴 열기');
    return;
  }
  // 메뉴 안 링크를 누르면 닫기
  if (t.closest('#h-nav a')) { nav.classList.remove('open'); document.querySelector('.h-menu')?.setAttribute('aria-expanded', 'false'); }
});

// 첫 화면 소개 영상: 소리 없이 반복 재생. 휴대폰 폭이면 세로 20초판, 아니면 가로 45초판.
// 화면에 보일 때만 재생하고, '동작 줄이기' 설정이면 자동 재생하지 않고 재생 버튼을 보여준다.
(() => {
  const box = document.getElementById('h-vid');
  const v = box?.querySelector('video') as HTMLVideoElement | null;
  if (!box || !v) return;
  const tall = matchMedia('(max-width: 720px)').matches;
  const f = tall ? 'intro-20s-vertical' : 'intro-45s';
  box.classList.toggle('tall', tall);
  v.poster = `video/${tall ? "hero-20s" : "hero-45s"}.jpg`; // 첫 장면이 비어 있어 3초 지점 화면을 미리 보여줌
  v.src = `video/${f}.mp4`;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduce || typeof IntersectionObserver === 'undefined') { v.controls = true; return; }
  let inView = false;
  // 자동 재생이 정말 막힌 경우(NotAllowedError)에만 재생 버튼을 보여준다. 탭이 숨겨져 잠깐 멈춘 경우는 다시 보일 때 이어서 재생
  const tryPlay = () => { if (inView && document.visibilityState === 'visible') v.play().catch((e: DOMException) => { if (e?.name === 'NotAllowedError') v.controls = true; }); };
  const io = new IntersectionObserver(([e]) => {
    inView = e.isIntersecting;
    if (inView) tryPlay(); else v.pause();
  }, { threshold: 0.35 });
  io.observe(v);
  document.addEventListener('visibilitychange', tryPlay);
  // 소리 켜고 보기(팝업)를 여는 동안 작은 영상은 멈춘다
  document.addEventListener('click', (ev) => { if ((ev.target as HTMLElement).closest('[data-act="intro"]')) v.pause(); });
  new MutationObserver(() => { if (!document.querySelector("dialog.intro-dlg")) tryPlay(); })
    .observe(document.body, { childList: true });
})();

const c = SITE.company;
const company = [c.name, c.ceo && `대표 ${c.ceo}`, c.bizNo && `사업자등록번호 ${c.bizNo}`, c.address, SITE.phone].filter(Boolean).join(' · ');
const el = document.getElementById('h-company');
if (el && company) el.textContent = ` · ${company}`;
const hours = document.getElementById('h-hours');
if (hours) hours.textContent = `${SITE.hours} · ${SITE.promise}`;
