/**
 * The app's LLM features, each one call through the egress gate (§13.2).
 * They only ever propose: categories the user can change, a column mapping
 * the user confirms. No figure comes from an LLM (NFR-HON-002).
 */
import { classifyPrompt, labelsFromAnswer } from '../api/classify-llm.ts';
import { parseStructured, structuredRequest } from '../api/llm.ts';
import { activeProvider, send } from './egress.ts';
import { refresh } from './data.ts';
import { ingest } from './workers.ts';
import type { DataView } from '../data/service.ts';
import type { Mapping } from '../budget/workbook.ts';
import { mappingPrompt, toMapping, type MappingAnswer } from '../api/mapping-llm.ts';

export async function suggestCategories(v: DataView, limit = 40): Promise<string> {
  const ap = await activeProvider();
  if (!ap.ok) throw new Error(ap.reason);
  const items = await ingest().llmCandidates(limit);
  if (!items.length) return 'Nothing in the review queue.';
  const p = classifyPrompt(items, v.categories);
  const req = structuredRequest(ap.provider, {
    system: p.system,
    user: p.user,
    schema: p.schema,
    name: 'category_labels',
  });
  const json = await send({
    provider: ap.provider,
    auth: ap.provider,
    purpose: 'classify',
    purposeLabel: `Suggest categories for ${items.length} transactions you haven't labelled.`,
    note: 'Each transaction is sent as a number, the merchant, the description with account numbers removed, an amount range and the direction. No account, card or exact amount is sent.',
    request: req,
  });
  const answer = parseStructured<{ labels: { ref: number; categoryId: string | null }[] }>(
    ap.provider,
    json,
    p.schema
  );
  const labels = labelsFromAnswer(p, answer);
  await ingest().applyLlmLabels(labels, ap.provider.model);
  await refresh();
  return `${labels.length} of ${items.length} suggested by ${ap.provider.label}; ${items.length - labels.length} left for you. Suggestions are marked "llm" and you can change any of them.`;
}

/** Ask the LLM for a column mapping of a CSV sheet (FR-ING-017). The user confirms it in the wizard. */
export async function suggestMapping(
  rows: string[][],
  tierIds: string[],
  fileName: string
): Promise<{ mapping: Mapping; by: string }> {
  const ap = await activeProvider();
  if (!ap.ok) throw new Error(ap.reason);
  const p = mappingPrompt(rows, tierIds);
  const json = await send({
    provider: ap.provider,
    auth: ap.provider,
    purpose: 'mapping',
    purposeLabel: `Suggest how the columns of ${fileName} map to budget fields.`,
    note: 'Only the first rows are sent, with every amount replaced by a range, dates by <date>, and account numbers and emails removed.',
    request: structuredRequest(ap.provider, {
      system: p.system,
      user: p.user,
      schema: p.schema,
      name: 'mapping_spec',
    }),
  });
  const answer = parseStructured<MappingAnswer>(ap.provider, json, p.schema);
  return { mapping: toMapping(answer, rows), by: ap.provider.label };
}
