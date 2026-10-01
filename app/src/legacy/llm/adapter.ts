// AI 모델 호출 어댑터 (업체 독립)
// LLM_PROVIDER=mock | anthropic | openai | gemini  (기본 mock)
// 실제 API 는 SDK 없이 fetch 로 호출한다. LLM 은 '정보 추출'에만 쓰고, 법적 판단은 규칙 엔진이 한다.
import { appendFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { extract, evidenceInText } from '../extract.ts';
import type { FactMap, Fact } from '../../types.ts';

export interface ExtractResult { facts: FactMap; provider: string; dropped: { key: string; reason: string }[]; usage?: { input_tokens?: number; output_tokens?: number } }

export function maskPII(text: string): string {
  return text
    .replace(/\d{6}\s*-?\s*[1-4]\d{6}/g, '[주민번호]')
    .replace(/01[016789]-?\d{3,4}-?\d{4}/g, '[전화번호]')
    .replace(/0\d{1,2}-\d{3,4}-\d{4}/g, '[전화번호]');
}

const ENUMS: Record<string, (v: any) => boolean> = {
  relation: (v) => typeof v === 'string' && v.length <= 10,
  age: (v) => Number.isInteger(v) && v >= 1 && v <= 120,
  insurance: (v) => ['health', 'medical_aid_basic', 'medical_aid_other'].includes(v),
  grade_status: (v) => ['none', 'pending', 'out_of_grade', 'graded'].includes(v),
  grade: (v) => [1, 2, 3, 4, 5, 'cognitive'].includes(v),
  validity_end: (v) => /^\d{4}-\d{2}-\d{2}$/.test(v),
  facility_in_cert: (v) => typeof v === 'boolean',
  current_home_services: (v) => typeof v === 'boolean',
  dementia: (v) => ['diagnosed', 'suspected', 'none'].includes(v),
  diseases: (v) => Array.isArray(v) && v.every((x) => typeof x === 'string'),
  living: (v) => ['alone', 'elderly_only', 'minor_or_elderly_only', 'with_family'].includes(v),
  caregiver_difficulty: (v) => typeof v === 'boolean',
  housing_poor: (v) => typeof v === 'boolean',
  behavior_problem: (v) => typeof v === 'boolean',
  goal: (v) => ['facility', 'home', 'info'].includes(v),
  in_nursing_hospital: (v) => typeof v === 'boolean',
  applied_date: (v) => /^\d{4}-\d{2}-\d{2}$/.test(v),
  notice_date: (v) => /^\d{4}-\d{2}-\d{2}$/.test(v),
  dissatisfied_result: (v) => typeof v === 'boolean',
  condition_worsened: (v) => typeof v === 'boolean',
};

export const EXTRACTION_PROMPT = (today: string) => `너는 한국 노인장기요양 상담의 정보 추출기다. 보호자 글에서 아래 키만 JSON으로 추출한다.
규칙: (1) 글에 명시된 것만. 추정·상식으로 채우지 말 것. (2) 각 키는 {"value":..., "evidence":"원문에서 그대로 복사한 구절"} 형식. (3) 없는 키는 생략. (4) 법적 판단·등급 예측을 하지 말 것.
오늘 날짜: ${today}. 월/일만 있으면 문맥상 가장 가까운 날짜로 YYYY-MM-DD.
키: relation(돌봄 대상과 보호자의 관계, 예 "어머니"), age(정수), insurance(health|medical_aid_basic|medical_aid_other), grade_status(none|pending|out_of_grade|graded), grade(1~5 또는 "cognitive"), validity_end, facility_in_cert(인정서에 시설급여 포함 여부), current_home_services, dementia(diagnosed|suspected|none), diseases(시행령 별표1 노인성 질병 KCD 코드 배열, 진단이 명시된 경우만), living(alone|elderly_only|minor_or_elderly_only|with_family), caregiver_difficulty, housing_poor, behavior_problem, goal(facility|home|info), in_nursing_hospital, applied_date, notice_date, dissatisfied_result, condition_worsened.
출력은 JSON 객체 하나만.`;

function validate(raw: any, text: string, provider: string): { facts: FactMap; dropped: ExtractResult['dropped'] } {
  const facts: FactMap = {}; const dropped: ExtractResult['dropped'] = [];
  for (const [k, obj] of Object.entries(raw ?? {})) {
    const o = obj as any;
    if (!(k in ENUMS)) { dropped.push({ key: k, reason: '허용되지 않은 키' }); continue; }
    if (!o || !('value' in o)) { dropped.push({ key: k, reason: '형식 오류' }); continue; }
    if (!ENUMS[k](o.value)) { dropped.push({ key: k, reason: `허용되지 않은 값 ${JSON.stringify(o.value)}` }); continue; }
    if (!evidenceInText(String(o.evidence ?? ''), text)) { dropped.push({ key: k, reason: '원문에 없는 근거(환각 방지 검증 실패)' }); continue; }
    facts[k] = { value: o.value, status: 'stated_by_guardian', evidence: String(o.evidence), source: 'llm', updatedAt: new Date().toISOString() } as Fact;
  }
  return { facts, dropped };
}

async function callProvider(provider: string, prompt: string, text: string): Promise<{ json: any; usage?: any }> {
  const model = process.env.LLM_MODEL;
  if (!model) throw new Error('LLM_MODEL 환경변수가 필요합니다');
  const timeout = AbortSignal.timeout(Number(process.env.LLM_TIMEOUT_MS ?? 30000));
  if (provider === 'anthropic') {
    const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', signal: timeout, headers: { 'content-type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY ?? '', 'anthropic-version': '2023-06-01' }, body: JSON.stringify({ model, max_tokens: 1500, system: prompt, messages: [{ role: 'user', content: text }] }) });
    if (!r.ok) throw new Error(`anthropic ${r.status}: ${await r.text()}`);
    const j: any = await r.json(); const t = j.content?.[0]?.text ?? '{}';
    return { json: JSON.parse(t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1)), usage: j.usage };
  }
  if (provider === 'openai') {
    const r = await fetch('https://api.openai.com/v1/chat/completions', { method: 'POST', signal: timeout, headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.OPENAI_API_KEY ?? ''}` }, body: JSON.stringify({ model, response_format: { type: 'json_object' }, messages: [{ role: 'system', content: prompt }, { role: 'user', content: text }] }) });
    if (!r.ok) throw new Error(`openai ${r.status}: ${await r.text()}`);
    const j: any = await r.json();
    return { json: JSON.parse(j.choices?.[0]?.message?.content ?? '{}'), usage: j.usage };
  }
  if (provider === 'gemini') {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY ?? ''}`, { method: 'POST', signal: timeout, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ systemInstruction: { parts: [{ text: prompt }] }, contents: [{ role: 'user', parts: [{ text }] }], generationConfig: { responseMimeType: 'application/json' } }) });
    if (!r.ok) throw new Error(`gemini ${r.status}: ${await r.text()}`);
    const j: any = await r.json();
    return { json: JSON.parse(j.candidates?.[0]?.content?.parts?.[0]?.text ?? '{}'), usage: j.usageMetadata };
  }
  throw new Error(`알 수 없는 LLM_PROVIDER: ${provider}`);
}

function logUsage(entry: Record<string, unknown>) {
  try {
    const dir = process.env.LTC_STATE_DIR ?? path.resolve('.state');
    mkdirSync(dir, { recursive: true });
    appendFileSync(path.join(dir, 'llm_usage.jsonl'), JSON.stringify({ at: new Date().toISOString(), ...entry }) + '\n');
  } catch { /* 사용량 기록 실패는 무시 */ }
}

/** 추출: 규칙 기반 결과를 기본으로 하고, 실제 LLM 이 켜져 있으면 검증을 통과한 항목만 덮어쓴다 */
export async function extractFacts(text: string, today: string): Promise<ExtractResult> {
  const provider = (process.env.LLM_PROVIDER ?? 'mock').toLowerCase();
  const base = extract(text, { today });
  if (provider === 'mock') return { facts: base, provider: 'mock', dropped: [] };
  try {
    const masked = maskPII(text);
    const { json, usage } = await callProvider(provider, EXTRACTION_PROMPT(today), masked);
    const { facts, dropped } = validate(json, masked, provider);
    logUsage({ provider, model: process.env.LLM_MODEL, usage, dropped: dropped.length });
    // 조사 항목(items)과 세부 신호는 규칙 추출기가 담당, 나머지는 LLM 우선
    return { facts: { ...base, ...facts, items: base.items }, provider, dropped, usage };
  } catch (e) {
    logUsage({ provider, error: (e as Error).message });
    return { facts: base, provider: `${provider}→mock(오류: ${(e as Error).message.slice(0, 120)})`, dropped: [] };
  }
}

export { validate as validateLLMFacts };
