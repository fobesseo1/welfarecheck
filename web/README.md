# web — 보호자용 객관식 장기요양 자가진단 · 요양원 입소 준비 안내

보호자가 부모님 상태를 **객관식**으로 답하면 다음을 보여주는 웹 도구입니다. **AI API 를 쓰지 않고**, 모든 계산은 브라우저에서 규칙·점수표로 합니다(서버·DB 없음).

1. 대략의 **예상 등급 범위** (예: "3~4등급 예상") + 신뢰도 + 점수에 가장 큰 영향을 준 답 3개
2. **요양원(시설급여) 입소 가능 여부와 조건** — 받은 등급이 있으면 그 등급으로, 없으면 예상 등급으로 시나리오 안내. 3~5등급은 사유 ①②③ 해당 가능성 표시
3. **지금 준비할 절차와 서류** (지금/나중 구분, `data/procedures.json`·`data/documents.json` 에서만)
4. **지금 가장 먼저 할 일 3가지**

> 결과는 참고용 추정이며, 등급과 급여는 국민건강보험공단이 결정합니다.

## 실행

Node.js 20 이상 (개발·테스트는 Node 24 에서 확인).

```bash
cd web
npm install
npm run dev
```

브라우저에서 http://localhost:5173 을 엽니다.

| 명령 | 내용 |
|---|---|
| `npm run dev` | 개발 서버 |
| `npm test` | 테스트 (Vitest) |
| `npm run build` | 정적 파일 생성 → `dist/` (아무 웹 서버에 올리거나 `npm run preview` 로 확인) |
| `npm run typecheck` | 타입 검사 |
| `npm run fit-model` | 근사 모델 가중치 재계산 → `data/approx_model.json` |
| `npm run trees` | 고시 HWP 에서 수형분석도 다시 복원 → `data/grading_trees.json`, `docs/trees_review.md` (Python 3 필요) |

## 화면

| 주소 | 화면 |
|---|---|
| `index.html` | 홈페이지 (서비스 소개·무료 상담 안내, 컴퓨터·휴대폰 반응형) |
| `check.html` | 3분 등급 체크 (질문 → 결과). `#age=over65` 처럼 미리 채운 링크 지원 |
| `consult.html` | 1분 상담 신청 → 구글 시트 (`src/site.ts` 의 `consultEndpoint`, 설치 `docs/CONSULT_SHEET_SETUP.md`) |

연락처·회사 정보·상담 받는 주소는 `src/site.ts` 한 곳에서 바꾼다(빈 값은 화면에서 숨김).

## 구조

```
web/
  index.html, src/main.ts        화면 제어 (시작 → 한 화면에 질문 하나 → 결과), localStorage 이어하기
  src/ui/questions.ts            질문 화면 (둥근 선택 버튼·여러 개 고르기·날짜, 자유 입력 없음)
  src/ui/result.ts               결과 화면 (인쇄·PDF 저장용 스타일 포함)
  src/data.ts                    근거 DB(../data/*.json) 불러오기
  src/engine/                    UI 와 분리된 순수 함수
    scoring.ts                   채점: 항목 점수 → 영역 원점수 → 100점 환산 → (트리 또는 근사식) → 치매 보정 → 등급 범위
    answers.ts                   질문 답 펼치기(묶음 질문 → 조사 항목 값) → 사실(FactMap)·시설급여 사유 ①②③ 가능성
    decide.ts                    판단 엔진 (app/src/engine/decide.ts 이식: 신청 자격, 등급·유효기간, 시설급여, 추가 인정, 신청일부터 급여, 비용 감면, 절차·서류, 미검증 규칙 제외, 추적 로그)
    result.ts                    결과 화면 모델 조립
    guide.ts                     결과 '자세히 보기' 칸 (접수 경로·서류 체크·병원·방문조사·입소 준비·상황별 안내, 문구·링크는 data/guide_content.json)
  scripts/fit-approx-model.ts    근사 모델 적합
  tests/                         154개 테스트
```

## 점수 계산 — 공식인 부분과 추정인 부분

| 단계 | 근거 | 상태 |
|---|---|---|
| 항목 점수표, 영역별 원점수 → 100점 환산표 | 등급판정기준 고시 제2조 (`data/grading_formula.json`) | 공식 |
| 등급 구간, 5등급·인지지원 치매 요건 | 시행령 제7조 (R-GRADE-01·02) | 공식 |
| 치매 보정 (51~75점, 별표2 로지스틱식 ≥ 0.5 → 한 단계 위 최저점수) | 고시 제2조제5호·별표2 | 공식 (단, '일상생활점수·행동점수' 정의는 원문에 없어 원점수로 해석) |
| 8개 서비스군 수형분석도 합산 | 고시 별표1 (그림) → `tools/hwp_trees.py` 로 복원 | **복원, 원문 대조 전** |
| 대신 쓰는 근사식 (5개 영역 환산점수의 선형식) | `data/approx_model.json` | **추정** |

- 수형분석도가 `RECONSTRUCTED_UNVERIFIED` 인 동안 화면의 예상 등급은 근사식으로 계산하고 "공식 산정식이 아닌 추정" 이라고 표시합니다. 복원 트리 계산값은 '자세히 보기'에 참고로만 보여줍니다.
- `docs/trees_review.md` 를 원문 그림과 대조한 뒤 `data/grading_trees.json` 의 `_meta.status` 와 각 트리 `status` 를 `OFFICIAL_VERIFIED` 로 바꾸면 트리 점수가 주 추정치가 됩니다(코드 수정 불필요).
- '잘 모름' 답은 가장 가벼운 값~가장 무거운 값으로 모두 계산해 범위를 넓힙니다.

## 디자인

- 시안: Claude Design 캔버스 https://claude.ai/artifact/EJQVpQWaEH4FL3zKkufDQe (소유자만 열람 가능, 공유는 캔버스의 Share 메뉴)
- 글꼴: Pretendard(jsDelivr CDN) → 없으면 Noto Sans KR(Google Fonts) → 기기 기본 글꼴, 자간 -0.5% (`src/styles.css`, `index.html`)
- 인터넷이 막힌 곳에서는 두 글꼴 모두 못 불러오므로 기기 기본 한글 글꼴(맑은 고딕·Apple SD 고딕)로 보입니다.

## 기준을 바꿀 때

코드가 아니라 `data/*.json` 을 고칩니다: 질문 문구·선택지·순서·묶음 질문의 항목 값(sets)·사유 ①②③ 표시 기준은 `data/questionnaire.json`, 규칙은 `legal_rules.json`, 서류·절차는 `documents.json`·`procedures.json`, 결과 안내 문구·공식 링크는 `guide_content.json`(링크마다 `sources.json` 출처 ID).
