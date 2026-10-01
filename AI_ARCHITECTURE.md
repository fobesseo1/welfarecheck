# AI_ARCHITECTURE — API 및 데이터베이스 설계 (초안)

## 1. 전제
- 개발 PC: GPU 없음, 저사양 → 로컬 LLM·학습 불필요 구조
- 기술 스택 후보: **TypeScript + Next.js** (사용자 숙련도 기준, 개발 착수 시 확정)
- AI API 키: 아직 없음 → 모델 호출부를 어댑터로 분리하고, 규칙 엔진·체크리스트는 AI 없이 동작하도록 설계

## 2. 최소 구조
```
[Next.js 웹 (보호자 화면 / 전문가 검토 화면)]
        │
[API 라우트]
  ├─ conversation   : 상담 상태(슬롯) 관리, 다음 질문 선택(규칙 기반)
  ├─ extractor      : LLM 호출 → JSON 스키마 출력 → 검증기
  ├─ rules          : 판단 A~F (순수 함수, LLM 없음)
  ├─ checklist      : 상황별 서류 생성 (documents.json)
  ├─ evidence       : 근거 검색 (규칙 ID → 출처·조항 조회, 이후 RAG)
  ├─ report         : 결과 5종 생성, 공유용 PDF/링크
  └─ llm-adapter    : provider 인터페이스 (OpenAI / Anthropic / Google / mock)
        │
[DB: 초기 SQLite → 운영 PostgreSQL]
  sources, rules, rule_sources, assessment_items, documents  ← data/evidence.sqlite 그대로 사용
  cases, slots(값·상태·원문근거·수정이력), decisions, checklists, reviews, llm_usage, audit_log
```

## 3. LLM 사용 범위
| 기능 | LLM | 비고 |
|---|---|---|
| 자유 서술 → 슬롯 추출 | 저가 모델 | JSON 스키마 강제, 원문 인용 필수 |
| 모호·모순 판단, 쉬운 설명 문장 | 저가 모델 | |
| 추출 신뢰도 낮음·모순·복잡 사례 | 고성능 모델로 승격 | 승격 조건을 규칙으로 정의 |
| 법적 판단 | **사용 안 함** | 규칙 엔진 |
| 안전 분기 문구 | **사용 안 함** | 고정 템플릿 |

## 4. 추출 결과 검증기 (환각 방지)
1. 스키마 검증 (enum, 타입)
2. `evidence_quote`가 사용자 원문에 존재하는지 문자열 대조 → 없으면 값 폐기, `unknown`
3. 원문에 없는 값(예: 나이 미언급인데 나이 채움) 차단
4. 상태 3분류 강제: `confirmed_by_document` / `stated_by_guardian` / `unknown`
5. 모순 규칙(예: 완전자립 vs 와상) 감지 → 플래그

## 5. 근거 검색(RAG) 단계화
- v0: 규칙 ID → 출처·조항 직접 조회 (검색 불필요)
- v1: 확보한 원문(법령·고시 텍스트)을 조문 단위로 분할·임베딩, 사용자 질문 답변 시 인용
- 법령 원문은 매 요청마다 AI에 전달하지 않고 DB에서 필요한 조문만 조회

## 6. 비용 기록
`llm_usage(case_id, provider, model, input_tokens, output_tokens, cost_estimate, purpose, created_at)` — 사용자 1인당 평균 비용 KPI 산출용

## 7. 미조사 (다음 단계)
- 모델별 최신 가격, 한국어 구조화 출력 품질, 음성인식(STT) 한국어 성능, **API 데이터의 학습 미사용 조건·데이터 보관 기간·국외 처리 지역** → 개발 착수 시점 기준으로 각 업체 공식 문서 확인 후 비교표 작성 (추측 가격 기재 금지)
