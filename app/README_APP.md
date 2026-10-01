# 장기요양 사전검토·입소 준비 안내 — 실행 가이드

보호자가 상황을 자유롭게 적으면 → 정보 추출 → 부족한 정보만 추가 질문 → 공식 규칙으로 판단 → 개인별 절차·서류 생성 → 쉬운 안내문 + 근거 표시.

## 1. 필요 환경
- **Node.js 22.18 이상** (TypeScript 를 별도 빌드 없이 바로 실행). 확인: `node --version`
- 설치할 패키지 없음 (외부 의존성 0개). GPU 불필요.
- Windows: https://nodejs.org 에서 LTS(22 또는 24) 설치

## 2. 실행
```bash
cd welfare_source/app
npm start            # 또는 node src/server.ts
# 브라우저에서 http://localhost:3000
```
- 터미널 데모(사례 A·B·C): `npm run demo`  또는 `node src/cli.ts "어머니가 85세인데 …"`
- 자동 테스트: `npm test`

## 3. 환경변수
| 변수 | 기본값 | 설명 |
|---|---|---|
| `PORT` | 3000 | 웹 서버 포트 |
| `LLM_PROVIDER` | `mock` | `mock` / `anthropic` / `openai` / `gemini` |
| `LLM_MODEL` | (없음) | 실제 API 사용 시 필수. 각 업체 콘솔의 모델 ID |
| `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `GEMINI_API_KEY` | | 선택한 업체의 키 |
| `LLM_TIMEOUT_MS` | 30000 | API 응답 대기 시간 |
| `LTC_DATA_DIR` | `../data` | 근거 DB(JSON) 위치 |
| `LTC_STATE_DIR` | `./.state` | 상담 세션·AI 사용량 기록 저장 위치 |
| `LTC_TODAY` | 오늘 | 기준일 고정(테스트·재현용, YYYY-MM-DD) |

Windows PowerShell 예:
```powershell
$env:LLM_PROVIDER="anthropic"; $env:LLM_MODEL="<모델ID>"; $env:ANTHROPIC_API_KEY="<키>"; npm start
```

## 4. 구조
```
app/
  src/
    evidence.ts        F. 근거 DB 로더 (data/*.json) — 검증 상태가 OFFICIAL_VERIFIED 인 규칙만 자동 판단에 사용
    engine/extract.ts  A. 규칙 기반 정보 추출 (Mock 모드 기본 + LLM 결과 안전망), 원문 근거 저장
    llm/adapter.ts     A. 업체 독립 LLM 어댑터 (fetch), 개인정보 마스킹, 환각 검증기, 사용량 기록
    engine/questions.ts B. 추가 질문 엔진 (부족한 정보만, 답에 따라 분기, 최대 2개)
    engine/decide.ts   C. 판단 엔진(A~F) + D. 절차·서류 생성 (data/procedures.json)
    engine/explain.ts  E. 결과 설명(5개 영역) + 등급 사전검토(V1: 조사 항목 정리, 점수 계산 없음)
    session.ts         세션 저장·재개·답변 수정·변경 이력
    server.ts          웹 서버 + API
    cli.ts             터미널 데모
  public/              웹 화면 (index.html, app.js)
  fixtures/samples.json  RESULT_SAMPLES.md 17개 사례 → 자동 테스트
  tests/               자동 테스트 (node:test)
../data/               근거 DB: legal_rules.json, sources.json, documents.json, procedures.json, assessment_items.json, geriatric_diseases.json
```

## 5. API
| 메서드 | 경로 | 본문 |
|---|---|---|
| GET | `/api/health` | 규칙 수·무결성 점검 결과 |
| POST | `/api/sessions` | `{ "text": "상황 설명" }` → 세션 생성 + 분석 |
| POST | `/api/sessions/:id/messages` | `{ "text": "추가 설명" }` |
| POST | `/api/sessions/:id/answers` | `{ "questionId": "Q-GRADE", "value": "4" }` |
| PATCH | `/api/sessions/:id/facts` | `{ "key": "grade", "value": 2 }` (수정) / `value: null` (삭제 → 다시 질문) |
| GET | `/api/sessions/:id` | 저장된 상담 재개 |

## 6. 기준이 바뀌었을 때
- 법령·고시 개정 → `data/legal_rules.json` 규칙 문구·근거 수정, 필요 시 `verification_status` 변경
- 서류·절차 변경 → `data/documents.json`, `data/procedures.json` 수정 (코드 수정 불필요)
- 규칙을 `OFFICIAL_VERIFIED` 가 아닌 상태로 바꾸면 해당 판단·단계·서류는 자동 안내에서 빠지고 추적 로그에 경고가 남음
- 수정 후 `npm test` 로 17개 사례와 동적 테스트 재확인

## 7. 오류 추적
- 결과의 `trace` (웹 화면 하단 "판단 추적 로그")에 단계·규칙 ID·경고가 남음
- 존재하지 않는 규칙·서류를 참조하면 서버 시작 시 무결성 경고, `/api/health` 의 `integrity` 에 표시
