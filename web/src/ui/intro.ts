// 소개 영상 팝업 (홈페이지·3분 체크 공용). 휴대폰 폭이면 세로 20초판, 아니면 가로 45초판
/** 소개 영상 팝업. 휴대폰 폭이면 세로 20초판, 아니면 가로 45초판 (소리 있음, 자동 재생 안 함) */
function renderIntroDialog(tall: boolean): string {
  const f = tall ? 'intro-20s-vertical' : 'intro-45s';
  return `<dialog class="intro-dlg${tall ? ' tall' : ''}" aria-label="모심듀오 소개 영상">
    <button type="button" class="intro-x" data-act="intro-close" aria-label="닫기"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
    <video src="video/${f}.mp4" poster="video/${f}.jpg" controls playsinline preload="none" aria-label="부모님 돌봄으로 바쁜 하루, 요양원을 처음 알아보는 막막함, 질문에 답하면 예상 등급과 할 일을 알려주는 과정을 보여주는 ${tall ? '20' : '45'}초 영상"></video>
    <p>${tall ? '20' : '45'}초 · 소리 있음 · 화면 속 답과 결과는 예시예요</p>
  </dialog>`;
}

/** 팝업을 열고 재생. 닫으면 멈추고 지운다 (body 에 붙여 화면을 다시 그려도 영향 없음) */
export function openIntro(): void {
  document.querySelector('dialog.intro-dlg')?.remove();
  document.body.insertAdjacentHTML('beforeend', renderIntroDialog(matchMedia('(max-width: 600px)').matches));
  const dlg = document.querySelector('dialog.intro-dlg') as HTMLDialogElement;
  const v = dlg.querySelector('video')!;
  dlg.addEventListener('close', () => { v.pause(); dlg.remove(); });
  dlg.addEventListener('click', (e) => { const el = e.target as HTMLElement; if (e.target === dlg || el.closest('[data-act="intro-close"]')) dlg.close(); });
  dlg.showModal();
  v.play().catch(() => { /* 자동 재생이 막히면 재생 버튼을 누르면 됨 */ });
}
