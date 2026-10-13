/**
 * Runs the setup conversation (FR-SETUP-001…006, ADR 0027) in a chat: shows
 * each state as a message with buttons, carries out its effects through the
 * same functions as the screens, and reads typed answers, first on the
 * device, then with the AI provider when one is set up.
 */
import {
  answerSchema,
  awaitsAnswer,
  interpret,
  nextState,
  resumeAt,
  type Choice,
  type Flow,
  type FlowState,
} from '../assistant/flows/engine.ts';
import { matchIntent, STARTERS } from '../assistant/intents.ts';
import { parseStructured, structuredRequest } from '../api/llm.ts';
import { SHEET_LABEL, type Mapping, type WorkbookPreview } from '../budget/workbook.ts';
import { parseCsv } from '../lib/csv.ts';
import { step, type ActivitySink } from './activity.ts';
import { fromInsight } from './assistant.ts';
import { cruxReply, type Conversation } from './conversation.ts';
import {
  commitWorkbook,
  data,
  ensureLoaded,
  filesToInputs,
  importFiles,
  loadSynthetic,
  previewWorkbook,
} from './data.ts';
import { activeProvider, send } from './egress.ts';
import { count, el } from './format.ts';
import { planChance } from './insights.ts';
import { suggestMapping } from './llm-actions.ts';
import { DEFAULT_SEED, PERSONA_LABEL } from './personas.ts';
import { sim, synth } from './workers.ts';

interface Saved {
  state: string;
}

interface Sheet {
  name: string;
  text: string;
  mapping: Mapping;
  rows: number;
}

const rowsIn = (p: WorkbookPreview) =>
  p.lines.length + p.assets.length + p.renewals.length + Object.keys(p.goal).length;

export class SetupRunner {
  private readonly flow: Flow;
  private readonly chat: Conversation;
  private readonly onState: (id: string) => void;
  private id: string;
  private personas: Choice[] = [];
  private persona = '';
  private sheets: Sheet[] = [];

  constructor(flow: Flow, chat: Conversation, onState: (id: string) => void = () => {}) {
    this.flow = flow;
    this.chat = chat;
    this.onState = onState;
    this.id = flow.start;
  }

  get state(): FlowState {
    return this.flow.states[this.id]!;
  }

  get stateId(): string {
    return this.id;
  }

  /** Pick up where setup stopped (FR-SETUP-005), or start it. */
  async begin(): Promise<void> {
    const saved = (await sim().loadKv('setup')) as Saved | null;
    await this.enter(resumeAt(this.flow, saved?.state));
  }

  /** Start again from the first question. */
  async restart(): Promise<void> {
    await this.enter(this.flow.start);
  }

  private async enter(id: string): Promise<void> {
    this.id = id;
    this.onState(id);
    const s = this.state;
    if (awaitsAnswer(s)) await sim().saveKv('setup', { state: id } satisfies Saved);
    if (s.dynamic === 'personas') await this.loadPersonas();
    if (s.say || s.links?.length)
      await this.chat.say(cruxReply({ text: s.say ?? '', links: s.links ?? [] }));
    if (s.effect && !s.files && !s.choices?.length) {
      await this.outcome(await this.run(s, []));
      return;
    }
    this.showButtons();
  }

  private async loadPersonas(): Promise<void> {
    if (this.personas.length) return;
    const list = await synth().personas();
    this.personas = list.map((p) => ({ value: p.name, label: PERSONA_LABEL[p.name] ?? p.name }));
  }

  private dynamic(): Choice[] {
    return this.state.dynamic === 'personas' ? this.personas : [];
  }

  /** The current state's buttons, and its file picker, under the conversation. */
  showButtons(): void {
    const s = this.state;
    const nodes: HTMLElement[] = [];
    if (s.files) {
      const input = el('input', {
        type: 'file',
        accept: s.files.accept,
        class: 'visually-hidden',
        'aria-label': s.files.label,
        ...(s.files.multiple ? { multiple: '' } : {}),
      }) as HTMLInputElement;
      input.onchange = () => {
        const files = [...(input.files ?? [])];
        if (files.length) void this.picked(files);
      };
      nodes.push(el('label', { class: 'button small pick' }, s.files.label, input));
    }
    for (const c of [...this.dynamic(), ...(s.choices ?? [])]) {
      const b = el('button', { type: 'button', class: 'secondary small choice' }, c.label);
      b.dataset.value = c.value;
      b.onclick = () => void this.choose(c.value, c.label);
      nodes.push(b);
    }
    if (nodes.length) this.chat.els.suggestions.replaceChildren(...nodes);
    // Setup is finished: the usual questions (not "Explain this screen": there's none here).
    else this.chat.showSuggestions(STARTERS.filter((q) => q !== 'Explain this screen'));
  }

  private async choose(value: string, label: string): Promise<void> {
    if (this.chat.busy) return;
    this.chat.user(label);
    await this.go(value);
  }

  private async go(value: string): Promise<void> {
    if (this.state.dynamic) this.persona = value;
    const to = nextState(this.flow, this.id, value, this.dynamic());
    if (to) await this.enter(to);
    else this.showButtons();
  }

  private async picked(files: File[]): Promise<void> {
    if (this.chat.busy) return;
    this.chat.user(files.map((f) => f.name).join(', '));
    this.chat.els.suggestions.replaceChildren();
    await this.outcome(await this.run(this.state, files));
  }

  private async outcome(o: string): Promise<void> {
    const to = nextState(this.flow, this.id, o);
    if (to) await this.enter(to);
    else this.showButtons();
  }

  /**
   * A typed message while setup waits for an answer: a button's words or a
   * known phrase, on the device; a question Crux knows, answered as usual;
   * otherwise the AI reads it against the state's choices (FR-SETUP-003).
   */
  async typed(text: string): Promise<void> {
    if (this.chat.busy || !text) return;
    const s = this.state;
    const dyn = this.dynamic();
    const local = interpret(s, text, dyn);
    if (local) {
      this.chat.els.input.value = '';
      this.chat.user(text);
      await this.go(local);
      return;
    }
    if (matchIntent(text) || !(s.choices?.length || dyn.length)) {
      await this.chat.ask(text);
      this.showButtons();
      return;
    }
    const ap = await activeProvider();
    if (!ap.ok) {
      this.chat.els.input.value = '';
      this.chat.user(text);
      await this.chat.say(
        cruxReply({
          text: 'I didn’t catch that. Pick one of these, or say it another way. (With an AI provider turned on in Settings, I can understand more.)',
        })
      );
      this.showButtons();
      return;
    }
    this.chat.els.input.value = '';
    this.chat.user(text);
    let choice: string;
    try {
      choice = await this.chat.work((say) => this.readWithAi(text, s, dyn, say));
    } catch (err) {
      await this.chat.say(
        cruxReply({
          text: `I couldn’t use the AI for that (${err instanceof Error ? err.message : String(err)}). Pick one of these instead.`,
        })
      );
      this.showButtons();
      return;
    }
    if (choice === 'other') {
      // Not an answer to this step: a question for the AI, as in the panel.
      await this.chat.ask(text);
      this.showButtons();
      return;
    }
    const label = [...dyn, ...(s.choices ?? [])].find((c) => c.value === choice)?.label ?? choice;
    await this.chat.say(cruxReply({ text: `Understood: *${label}*.` }));
    await this.go(choice);
  }

  private async readWithAi(
    text: string,
    s: FlowState,
    dyn: readonly Choice[],
    say: ActivitySink
  ): Promise<string> {
    const ap = await activeProvider();
    if (!ap.ok) throw new Error(ap.reason);
    const schema = answerSchema(s, dyn);
    const options = [...dyn, ...(s.choices ?? [])].map((c) => `${c.value}: ${c.label}`);
    const request = structuredRequest(ap.provider, {
      system:
        'You read one answer in a budgeting app’s setup conversation. Pick the option the person means, or "other" if they are asking something else or none fits. Answer only with the requested JSON.',
      user: `Question: ${(s.say ?? '').replace(/[*_]/g, '')}\nOptions:\n${options.join('\n')}\n\nTheir answer: ${text}`,
      schema,
      name: 'setup_answer',
      maxTokens: 200,
    });
    return step(
      say,
      `Asking ${ap.provider.label} which option you mean…`,
      (c: string) => `${ap.provider.label} read it as: ${c === 'other' ? 'none of these' : c}`,
      async () => {
        const json = await send({
          provider: ap.provider,
          auth: ap.provider,
          purpose: 'setup',
          purposeLabel: 'Work out which setup option your message means.',
          note: 'Only this step’s question, its options and your message are sent.',
          request,
        });
        return parseStructured<{ choice: string }>(ap.provider, json, schema).choice;
      }
    );
  }

  /** Carry out a state's effect; the result is the outcome that picks the next state. */
  private async run(s: FlowState, files: File[]): Promise<string> {
    try {
      switch (s.effect) {
        case 'import-transactions':
          return await this.importTransactions(files);
        case 'load-sample':
          return await this.loadSample();
        case 'preview-budget':
          return await this.previewBudget(files);
        case 'commit-budget':
          return await this.commitBudget();
        case 'plan-chance':
          return await this.planChance();
        default:
          return 'failed';
      }
    } catch (err) {
      await this.chat.say(
        cruxReply({
          text: `Something went wrong: ${err instanceof Error ? err.message : String(err)}`,
        })
      );
      return 'failed';
    }
  }

  private async importTransactions(files: File[]): Promise<string> {
    const rec = await this.chat.work((say) =>
      step(
        say,
        `Reading ${files.length} file${files.length === 1 ? '' : 's'} on this device…`,
        (r: { counts: { new: number } }) => `Imported ${count(r.counts.new)} new records`,
        async () => importFiles(await filesToInputs(files))
      )
    );
    const problems = rec.files.filter((f) => f.status === 'rejected');
    const v = data.getState().view;
    const lines = [
      rec.counts.new
        ? `Imported **${count(rec.counts.new)}** new records. You now have ${count(v?.txns.length ?? 0)} transactions in ${count(v?.accounts.length ?? 0)} account${v?.accounts.length === 1 ? '' : 's'}.`
        : 'Nothing new was imported.',
      ...problems.map((f) => `- ${f.name}: ${f.message ?? 'not imported'}`),
    ];
    await this.chat.say(
      cruxReply({
        text: lines.join('\n'),
        links: [{ label: 'Open Import', path: '/import' }],
      })
    );
    return rec.counts.new > 0 || rec.counts.duplicate > 0 ? 'done' : 'failed';
  }

  private async loadSample(): Promise<string> {
    const label = PERSONA_LABEL[this.persona] ?? this.persona;
    const rec = await this.chat.work((say) =>
      step(say, `Generating the “${label}” household…`, 'Generated and imported it', () =>
        loadSynthetic(this.persona, DEFAULT_SEED)
      )
    );
    const v = data.getState().view;
    await this.chat.say(
      cruxReply({
        text: `Loaded **${label}**: ${count(rec.counts.new)} records, ${count(v?.txns.length ?? 0)} transactions in ${count(v?.accounts.length ?? 0)} accounts. It is labelled *illustrative* everywhere.`,
      })
    );
    return 'done';
  }

  private async previewBudget(files: File[]): Promise<string> {
    const tiers = (await ensureLoaded()).budget.tiers.map((t) => t.id);
    const found: string[] = [];
    this.sheets = [];
    await this.chat.work(async (say) => {
      for (const f of files) {
        const text = await f.text();
        let p = await step(say, `Reading ${f.name}…`, `Read ${f.name}`, () =>
          previewWorkbook(f.name, text)
        );
        if (!rowsIn(p) && (await activeProvider()).ok) {
          // The layout isn't one Crux recognises: the AI proposes a mapping (FR-ING-017).
          try {
            const s = await step(
              say,
              `Asking the AI how ${f.name}'s columns map…`,
              (r: { by: string }) => `${r.by} suggested a mapping`,
              () => suggestMapping(parseCsv(text), tiers, f.name)
            );
            p = await previewWorkbook(f.name, text, { mapping: s.mapping });
          } catch {
            // Declined or failed: the wizard is still there.
          }
        }
        const n = rowsIn(p);
        found.push(
          n
            ? `- **${f.name}**: ${SHEET_LABEL[p.mapping.type]}, ${count(n)} row${n === 1 ? '' : 's'}${p.issues.length ? ` (${count(p.issues.length)} to check)` : ''}`
            : `- **${f.name}**: I couldn’t tell what this sheet holds`
        );
        if (n) this.sheets.push({ name: f.name, text, mapping: p.mapping, rows: n });
      }
    });
    const total = this.sheets.reduce((a, s) => a + s.rows, 0);
    await this.chat.say(cruxReply({ text: `Here is what I found:\n\n${found.join('\n')}` }));
    return total ? 'ready' : 'failed';
  }

  private async commitBudget(): Promise<string> {
    const sheets = this.sheets;
    if (!sheets.length) return 'failed';
    await this.chat.work(async (say) => {
      for (const s of sheets)
        await step(say, `Importing ${s.name}…`, `Imported ${s.name}`, () =>
          commitWorkbook(s.name, s.text, { mapping: s.mapping })
        );
    });
    this.sheets = [];
    const v = data.getState().view;
    const lines = v?.budget.lines.length ?? 0;
    await this.chat.say(
      cruxReply({
        text: `Imported ${count(sheets.length)} sheet${sheets.length === 1 ? '' : 's'}. Your budget has ${count(lines)} line${lines === 1 ? '' : 's'} and ${count(v?.assets.length ?? 0)} big purchases.`,
        links: [{ label: 'Open Budget', path: '/budget' }],
      })
    );
    return 'done';
  }

  private async planChance(): Promise<string> {
    const v = await ensureLoaded();
    const insight = await this.chat.work((say) =>
      step(say, 'Running your plan in 500 simulated futures…', 'Ran 500 simulated futures', () =>
        planChance(v)
      )
    );
    await this.chat.say({ ...fromInsight(insight), suggestions: [] });
    return 'done';
  }
}
