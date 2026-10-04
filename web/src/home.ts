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
  const v = box?.querySelector('video') as HTMLVideoElement | null; // 타일 안 영상
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


// 스크롤하면 부드럽게 나타남. '동작 줄이기'이거나 관찰 기능이 없으면 바로 보이게
(() => {
  const els = [...document.querySelectorAll<HTMLElement>('.rv')];
  if (matchMedia('(prefers-reduced-motion: reduce)').matches || typeof IntersectionObserver === 'undefined') { els.forEach((e) => e.classList.add('in')); return; }
  const io = new IntersectionObserver((list) => {
    for (const e of list) if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
  }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
  els.forEach((e) => io.observe(e));
})();

const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
/** 화면에 보일 때만 콜백을 켜고 끈다 */
function whileVisible(el: Element, on: () => void, off: () => void) {
  if (typeof IntersectionObserver === 'undefined') { on(); return; }
  new IntersectionObserver(([e]) => (e.isIntersecting ? on() : off()), { threshold: 0.05 }).observe(el);
}

// 낯선 말 목록: 한 칸씩 위로 흐르고, 가운데 말이 크게 (끝까지 가면 처음으로 이어짐)
(() => {
  const ul = document.getElementById('h-roll');
  if (!ul) return;
  const base = [...ul.children] as HTMLElement[];
  const n = base.length, CENTER = 2;
  base.forEach((li) => ul.appendChild(li.cloneNode(true)));
  const items = [...ul.children] as HTMLElement[];
  let idx = 0;
  const paint = (animate: boolean) => {
    const row = items[0].offsetHeight || 64;
    ul.style.transition = animate ? '' : 'none';
    items.forEach((li) => (li.style.transition = animate ? '' : 'none'));
    ul.style.transform = `translateY(${-idx * row}px)`;
    items.forEach((li, i) => li.classList.toggle('on', i === idx + CENTER));
    if (!animate) { void ul.offsetHeight; ul.style.transition = ''; items.forEach((li) => (li.style.transition = '')); }
  };
  paint(false);
  if (reduceMotion) return;
  let timer: number | undefined;
  const step = () => {
    idx += 1; paint(true);
    if (idx >= n) window.setTimeout(() => { idx -= n; paint(false); }, 950);
  };
  whileVisible(ul, () => { if (!timer) timer = window.setInterval(step, 2000); }, () => { window.clearInterval(timer); timer = undefined; });
})();

// 동심원 → 가로선 묶음(오른쪽에서 한 줄로 모임) → 짧은 가로선 → 다시 동심원 (참고: easehealth.com)
// 원 하나를 위쪽 반원·아래쪽 반원 두 선으로 나눠, 위 반원은 위쪽 선으로·아래 반원은 아래쪽 선으로만 바뀌게 해서 선이 엇갈리지 않는다
(() => {
  const svg = document.getElementById('h-rings');
  if (!svg) return;
  const paths = [...svg.querySelectorAll('path')];
  const M = 120, cx = 150, cy = 200;
  type Pt = [number, number];
  // 선 j: 원 d = floor(j/2), 짝수는 위쪽, 홀수는 아래쪽
  const ring = (j: number) => Math.floor(j / 2);
  const up = (j: number) => j % 2 === 0;
  const offset = (j: number) => (up(j) ? -1 : 1) * (15 + 30 * ring(j)); // 가로선일 때의 높이
  const circle = (j: number, s: number): Pt => {
    const r = 40 + 40 * ring(j), a = Math.PI * s; // 왼쪽 → (위 또는 아래) → 오른쪽
    return [cx - r * Math.cos(a), cy + (up(j) ? -1 : 1) * r * Math.sin(a)];
  };
  const smooth = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
  // 가로선 묶음: 왼쪽 끝부터 나란히 가다가 오른쪽에서 한 점으로 모여 한 줄로 이어짐
  const bundle = (j: number, s: number): Pt => {
    const x = -20 + 1330 * s;
    return [x, cy + offset(j) * (1 - smooth((x - 560) / 260))];
  };
  // 짧은 가로선: 오른쪽 끝이 왼쪽으로 물러남
  const short = (j: number, s: number): Pt => [-20 + 400 * s, cy + offset(j)];
  // [모양, 머무는 시간, 다음 모양으로 바뀌는 시간]
  const seq: [(j: number, s: number) => Pt, number, number][] = [[circle, 1.2, 2.6], [bundle, 1.2, 1.8], [short, 0.8, 2.6]];
  const total = seq.reduce((n, [, h, m]) => n + h + m, 0);
  const ease = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
  const draw = (time: number) => {
    let f = (time / 1000) % total, k = 0;
    while (f > seq[k][1] + seq[k][2]) { f -= seq[k][1] + seq[k][2]; k++; }
    const [from, hold, morph] = seq[k], to = seq[(k + 1) % seq.length][0];
    const m = f < hold ? 0 : ease((f - hold) / morph);
    paths.forEach((p, j) => {
      let d = '';
      for (let i = 0; i <= M; i++) {
        const s = i / M;
        const [x1, y1] = from(j, s), [x2, y2] = to(j, s);
        d += `${i ? 'L' : 'M'}${(x1 + (x2 - x1) * m).toFixed(1)} ${(y1 + (y2 - y1) * m).toFixed(1)}`;
      }
      p.setAttribute('d', d);
    });
  };
  // 스크롤과 상관없이 화면에 보이는 동안 계속 자동으로 움직인다 (화면 밖에서는 쉬어서 전력 절약)
  draw(0);
  let raf = 0, t0 = 0, acc = 0;
  const loop = (now: number) => { if (!t0) t0 = now; draw(acc + now - t0); raf = requestAnimationFrame(loop); };
  whileVisible(svg, () => { if (!raf) { t0 = 0; raf = requestAnimationFrame(loop); } }, () => { if (raf) { cancelAnimationFrame(raf); raf = 0; acc += performance.now() - t0; } });
})();
