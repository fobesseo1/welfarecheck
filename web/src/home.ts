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

const c = SITE.company;
const company = [c.name, c.ceo && `대표 ${c.ceo}`, c.bizNo && `사업자등록번호 ${c.bizNo}`, c.address, SITE.phone].filter(Boolean).join(' · ');
const el = document.getElementById('h-company');
if (el && company) el.textContent = ` · ${company}`;
const hours = document.getElementById('h-hours');
if (hours) hours.textContent = `${SITE.hours} · ${SITE.promise}`;
