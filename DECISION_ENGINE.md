# DECISION_ENGINE — 자격 및 시설급여 판단 구조

## 1. 설계 원칙
- 법령상 명확한 조건 = **규칙 엔진(결정적 코드)**. LLM은 진술 이해·설명만 담당, 법적 결론 생성 금지
- 판단 A~F를 **독립적으로** 수행하고, 각 결과에 `rule_ids`, `sources`, `next_actions` 필수
- 입력 슬롯이 `unknown`이면 결과는 반드시 `NEEDS_CHECK` (추정 금지)
- 규칙 상태가 `SECONDARY_ONLY/UNVERIFIED/CONFLICT`이면 결과는 최대 `NEEDS_EXPERT`

## 2. 결과 코드
| 코드 | 의미(사용자 표시) |
|---|---|
| MET | 현재 확인된 조건 충족 |
| PROCEDURE_REQUIRED | 추가 절차를 완료해야 함 |
| NEEDS_CHECK | 조건 충족 여부 확인 필요 |
| NOT_ELIGIBLE | 현재 확인된 조건상 해당 급여 이용 대상 아님 |
| NEEDS_EXPERT | 전문가 또는 관계 기관 확인 필요 |

## 3. 판단 로직

**A. 신청 대상인가?** (R-ELIG-01, R-ELIG-02)
```
if age unknown or insurance unknown → NEEDS_CHECK
if insurance not in [가입자, 피부양자, 의료급여] → NEEDS_EXPERT   # 외국인·자격상실 등
if age >= 65 → MET
if age < 65:
   diagnosis unknown → NEEDS_CHECK
   diagnosis stated & 별표1 목록(geriatric_diseases.json)과 명확히 일치 → MET (단, "진단서·소견서로 공단이 확인" 표시)
   diagnosis stated & 불일치/애매 → NEEDS_EXPERT
   진단 없음 확인 → NOT_ELIGIBLE (현재) + "진단을 받으면 다시 확인" 안내
```

**B. 현재 등급이 있는가?** (R-VALID-01/02, R-FAC-04)
```
인정서 확인됨 & 유효기간 내 → MET (grade 기록)
진술만 있음 → NEEDS_CHECK ("인정서의 등급·유효기간을 확인해 주세요")
만료 90일 이내 → PROCEDURE_REQUIRED (갱신)
만료 → PROCEDURE_REQUIRED (갱신/재신청, 공단 확인)
없음 → PROCEDURE_REQUIRED (최초 신청)
```

**C. 현재 등급에서 시설급여 이용 가능한가?** (R-FAC-01~04, R-GRADE-02)
```
B != MET → NOT_ELIGIBLE (현재) + A 결과에 따른 신청 안내
grade in [1,2] → MET
grade in [3,4,5]:
   인정서 급여종류에 시설급여 포함 확인 → MET
   미포함 → PROCEDURE_REQUIRED (→ D)
   모름 → NEEDS_CHECK
grade == 인지지원 → NOT_ELIGIBLE (재가급여 안내)
```

**D. 별도 인정·변경 절차가 필요한가?** (R-FAC-02, R-CHANGE-01/02)
```
C == PROCEDURE_REQUIRED:
  사유 후보 평가(진술 기반, '해당 가능성'만 표시):
    ① 주수발 가족 수발 곤란 ← 동거가족 없음/고령 배우자만/주돌봄자 취업·질병
    ② 주거환경 열악 ← 계단·화장실·난방 등 진술
    ③ 치매 등 문제행동으로 재가급여 이용 불가 ← 행동변화 항목 + 재가서비스 거부·실패 진술
  하나 이상 가능 → PROCEDURE_REQUIRED (급여종류 변경신청) + 증빙은 NEEDS_EXPERT(R-CHANGE-02)
  모두 정보부족 → NEEDS_CHECK
  모두 해당 없음 → NOT_ELIGIBLE(현재) + 상태 변화 시 등급변경 안내
```

**E. 현재 정보만으로 판단 가능한가?**
```
A~D 중 NEEDS_CHECK 존재 → 부족 슬롯 목록 + 우선 질문 생성
모순 플래그 존재 → NEEDS_EXPERT
```

**F. 입소 준비 과정에서 남은 행정절차** (R-FAC-05/06, R-CONTRACT-01, R-ADMIT-01, R-COST-01/02)
```
C == MET → [인정서·이용계획서 준비, 건강진단서, 급여계약 내용 확인, 비급여·본인부담 확인, 재가급여 중복 정리]
신청 중 & 돌볼 가족 없음 가능 → '신청일부터 급여' 가능성 안내(R-FAC-05)
```

## 4. 출력 구조
```json
{
  "decision": "C",
  "result": "PROCEDURE_REQUIRED",
  "summary_for_user": "현재 4등급으로, 요양원(시설급여)을 이용하려면 급여종류 변경 신청과 등급판정위원회 인정이 필요해요.",
  "rule_ids": ["R-FAC-02", "R-CHANGE-01"],
  "sources": [{"src":"SRC-NOTICE-BENEFIT","article":"제2조제2항"}],
  "inputs_used": {"grade": {"value":4,"status":"confirmed_by_document"}},
  "missing_inputs": [],
  "next_actions": ["공단 지사에 급여종류 변경 신청 방법과 필요한 증빙 확인"],
  "is_official_decision": false,
  "engine_version": "0.1-draft"
}
```

## 5. 사용자 결과 화면 (8단계) — 판단 결과의 표시 방식
| 영역 | 내용 | 데이터 출처 |
|---|---|---|
| ① 돌봄 상태 요약 | 쉬운 말 요약, 진술/확인 구분 아이콘 | 슬롯 |
| ② 등급 사전 검토 | 영역별로 '도움이 필요한 항목 / 확인 안 된 항목'을 **고시 기준(52)·공단 안내 기준(65)** 두 가지로 정리. V1에서는 등급 숫자 표시 안 함 | assessment 매핑 |
| ③ 시설급여 가능 여부 | 판단 C·D 결과 코드 + 근거 조항 펼치기 | 규칙 엔진 |
| ④ 서류·신청 단계 | 현재 단계 서류 체크리스트, 이후 서류는 접힘, 일정(판정 30일 등) | checklist |
| ⑤ 지금 할 일 | 우선순위 최대 3개 (안전 > 기한 임박 > 절차 순서) | 판단 F |
- 모든 화면 상단 고정 문구: "이 결과는 참고용 사전 안내이며, 등급과 급여 인정은 국민건강보험공단이 결정합니다."
- 공유: 가족 공유 링크(만료 설정) + PDF 저장. 공유본에는 식별정보 제외.

## 6. 이의신청 기한 계산 (R-APPEAL-01, 원문 확인)
`처분을 안 날 + 90일`과 `처분일 + 180일` 중 빠른 날을 표시. "안 날"은 사용자가 입력(보통 통지서 받은 날). 기한 7일 이내면 ⑤ 지금 할 일 1순위 + 전문가 연결.

## 7. 투명성 (개인정보 보호법 제37조의2 대비)
이 엔진은 법적 결정을 하지 않는 참고 안내지만, 판단 기준(이 문서·LEGAL_RULES)을 사용자에게 공개하고 "사람 검토 요청" 버튼을 둔다.

## 8. 전문가 검토 자동 분류 트리거
65세 미만 / 보험 자격 불명확 / 진술 모순 / 3~5등급 시설급여 사유 판단 / 이의신청 희망 / 학대·방임 의심 / SECONDARY_ONLY 규칙이 결론에 관여 / 사용자 이의 제기
