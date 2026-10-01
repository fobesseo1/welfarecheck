# ltc-precheck — 장기요양 사전검토·입소 준비 안내 시스템 (설계 단계)

**다음 작업: `CLAUDE_CODE_PROMPT.md` (Claude Code 에 붙여넣을 지시서) · `CLAUDE.md` (Claude Code 가 자동으로 읽는 프로젝트 안내)**

(이전 버전 프로그램: `app/` — 자유문장 방식, 판단 엔진 재사용 예정)

처음 보는 분은 이 순서로 읽으세요.
1. `PROGRESS.md` — 지금 어디까지 왔는지
2. `GATE_A_REPORT.md` — 조사 결과 요약과 미확인 사항
3. `PROJECT_SCOPE.md` → `LEGAL_RULES.md` → `DECISION_ENGINE.md`

## 파일
| 파일 | 내용 |
|---|---|
| PROJECT_SCOPE.md | 범위·목표 |
| OFFICIAL_SOURCES.md | 출처 목록 (sources.json에서 자동 생성) |
| LEGAL_RULES.md | 판단 규칙 (legal_rules.json에서 자동 생성) |
| ASSESSMENT_SCHEMA.md | 인정조사 항목 구조 |
| QUESTION_FLOW.md | 대화 설계, 안전 분기 |
| ADMIN_PROCESS.md | 행정절차, 분기 흐름도 |
| DOCUMENT_CHECKLIST.md | 상황별 서류 |
| DECISION_ENGINE.md | 판단 A~F, 결과 화면 |
| AI_ARCHITECTURE.md | 시스템 구조 |
| PRIVACY_SECURITY.md | 개인정보 설계 |
| TEST_CASES.md | 테스트 시나리오 28개 |
| EVALUATION_REPORT.md | 지표·오류 대장 |
| MODEL_IMPROVEMENT.md | 등급 예측 V1~V4 |
| DEVELOPMENT_ROADMAP.md | 일정·원문 대조 목록 |
| IMPLEMENTATION_REPORT.md | **실제 구현 결과·테스트 결과** |
| app/ | **실행 가능한 시스템 (웹 + 엔진 + 테스트)** |
| data/procedures.json | 절차 13종 정의 (판단 엔진이 사용) |
| GATE_A_REPORT.md | 관문 A 판정·원문 대조 결과 |
| RESULT_SAMPLES.md | **보호자 안내문 샘플 17개** (판단 결과 유형 전체 커버) |
| GATE_B_REPORT.md | 관문 B: 보호자 질문 ↔ 조사표 65개 항목 연결표 |
| data/*.json, *.csv, evidence.sqlite | 근거 DB (geriatric_diseases.json: 노인성 질병 24종, grading_formula.json: 점수 산정식) |
| sources_raw/ | 국가법령정보센터 원문 (사용자 제공) |

## 검증 상태 표시
`OFFICIAL_VERIFIED`(원문 대조 완료) · `OFFICIAL_VIA_SUMMARY`(공식출처·요약경유) · `OFFICIAL_GUIDE`(공단 안내) · `SECONDARY_ONLY`(2차 자료) · `CONFLICT` · `UNVERIFIED`
출시에는 `OFFICIAL_VERIFIED` 규칙만 사용합니다(전문가 검수 후).

> 이 자료는 참고용 설계 문서이며 법률 자문이 아닙니다. 등급과 급여 인정은 국민건강보험공단이 결정합니다.
