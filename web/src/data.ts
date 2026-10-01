// 근거 DB 로드 (Vite·Vitest·Node 공통: JSON import attributes)
import legalRules from '../../data/legal_rules.json' with { type: 'json' };
import sources from '../../data/sources.json' with { type: 'json' };
import documents from '../../data/documents.json' with { type: 'json' };
import procedures from '../../data/procedures.json' with { type: 'json' };
import items from '../../data/assessment_items.json' with { type: 'json' };
import diseases from '../../data/geriatric_diseases.json' with { type: 'json' };
import formula from '../../data/grading_formula.json' with { type: 'json' };
import trees from '../../data/grading_trees.json' with { type: 'json' };
import approx from '../../data/approx_model.json' with { type: 'json' };
import questionnaire from '../../data/questionnaire.json' with { type: 'json' };
import applicationForm from '../../data/application_form.json' with { type: 'json' };
import guide from '../../data/guide_content.json' with { type: 'json' };
import { Kb, type RawData } from './engine/kb.ts';
import type { FormDef } from './engine/form.ts';

export const raw = { legalRules, sources, documents, procedures, items, diseases, formula, trees, approx, questionnaire, guide } as unknown as RawData;
export const kb = new Kb(raw);
export const formDef = applicationForm as unknown as FormDef;
