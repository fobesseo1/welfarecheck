// 관리자 화면 (admin.html): 기능 스위치를 이 브라우저에서만 켜 보고(미리보기), 모두에게 켜는 방법을 안내한다
import { FEATURES, loadFeatures, getSiteFlags, readPreview, writePreview, type FeatureId, type Flags } from './features.ts';
import { esc } from './ui/html.ts';

const GITHUB_EDIT = 'https://github.com/fobesseo1/welfarecheck/edit/main/web/public/features.json';
const PAGES: [string, string][] = [['index.html', '홈'], ['check.html', '3분 체크'], ['care.html', '간병 안내'], ['consult.html', '상담 신청']];
const app = document.getElementById('app')!;
let site: Flags;

function render() {
  const preview = readPreview() ?? {};
  const effective = (id: FeatureId) => (typeof preview[id] === 'boolean' ? preview[id]! : site[id]);
  app.innerHTML = `
  <section class="card cs adm">
    <h1 class="cs-h">관리자 · 기능 켜고 끄기</h1>
    <p class="lead">여기서 켜면 <b>이 브라우저에서만</b> 보여요(미리보기). 보호자에게는 그대로 숨겨져 있어요.</p>
    <div class="adm-list">${FEATURES.map((f) => `
      <div class="adm-row">
        <div class="adm-txt"><b>${esc(f.name)}</b><small>${esc(f.desc)}</small>
          <span class="adm-site ${site[f.id] ? 'on' : ''}">모두에게: ${site[f.id] ? '켜짐' : '꺼짐'}</span></div>
        <button type="button" class="adm-sw" role="switch" aria-checked="${effective(f.id)}" data-act="toggle" data-id="${f.id}" aria-label="${esc(f.name)} 미리보기"><i></i></button>
      </div>`).join('')}
    </div>
    <div class="adm-btns">
      <button type="button" class="btn-line" data-act="all-on">모두 미리보기</button>
      <button type="button" class="btn-line" data-act="reset">미리보기 끄기</button>
    </div>
    <p class="sub-h">미리보기로 보기</p>
    <div class="links">${PAGES.map(([u, l]) => `<a class="link" href="${u}">${esc(l)}</a>`).join('')}</div>
    <p class="sub-h">모두에게 켜기</p>
    <ol class="plain adm-how">
      <li><a class="link" href="${GITHUB_EDIT}" target="_blank" rel="noopener noreferrer">GitHub에서 web/public/features.json 열기</a> (연필 아이콘으로 편집)</li>
      <li>켤 기능의 <code>false</code> 를 <code>true</code> 로 바꾸고 'Commit changes'</li>
      <li>2~3분 뒤 사이트에 반영돼요. 끌 때는 다시 <code>false</code></li>
    </ol>
    <p class="cs-note">⚠ '간병인 찾기·등록 (매칭)'은 유료직업소개사업 등록 뒤에 켜세요. 업체 목록·간병인 목록의 '(예시)' 항목은 실제 정보로 바꾼 뒤에 켜세요(예시가 남아 있으면 배포 검사가 막아요).</p>
  </section>`;
}

app.addEventListener('click', (ev) => {
  const t = (ev.target as HTMLElement).closest('[data-act]') as HTMLElement | null;
  if (!t) return;
  const p: Partial<Flags> = readPreview() ?? {};
  if (t.dataset.act === 'toggle') {
    const id = t.dataset.id as FeatureId;
    const cur = typeof p[id] === 'boolean' ? p[id]! : site[id];
    p[id] = !cur;
    if (p[id] === site[id]) delete p[id]; // 사이트 값과 같으면 미리보기 값은 지운다
    writePreview(p);
  } else if (t.dataset.act === 'all-on') writePreview(Object.fromEntries(FEATURES.map((f) => [f.id, true])) as Flags);
  else if (t.dataset.act === 'reset') writePreview(null);
  render();
});

void loadFeatures().then(() => { site = getSiteFlags(); render(); });
