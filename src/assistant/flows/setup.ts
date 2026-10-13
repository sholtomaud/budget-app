/**
 * The setup conversation (FR-SETUP-001…006, ADR 0027): your data, your
 * budget, your plan. Every step can be finished with buttons alone.
 */
import type { Flow } from './engine.ts';

const NO = /^\s*(no|nope|nah|not now|none|skip|later|nothing)\b/i;

export const SETUP: Flow = {
  start: 'data.start',
  states: {
    'data.start': {
      section: 'data',
      say: "Let's set Crux up. Everything stays on this device.\n\nFirst, your transactions. **What do you have?**",
      choices: [
        { value: 'cdr', label: 'A bank export (CDR JSON or ZIP)' },
        { value: 'bank-csv', label: 'A bank CSV' },
        { value: 'accounting', label: 'An accounting export (MYOB, Xero)' },
        { value: 'spreadsheet', label: 'A personal budget spreadsheet' },
        { value: 'csvs', label: 'Several CSV files' },
        { value: 'sample', label: 'Try a sample household' },
        { value: 'none', label: 'Nothing yet' },
      ],
      phrases: [
        ['accounting', /\b(myob|xero|quickbooks|accounting|accountant)\b/i],
        ['csvs', /\b(several|multiple|many|lots of|a few|some)\b.*\bcsvs?\b/i],
        ['bank-csv', /\bcsv\b/i],
        ['cdr', /\b(cdr|open banking|json|zip)\b/i],
        ['spreadsheet', /\b(spreadsheet|excel|google sheets?|workbook)\b/i],
        ['sample', /\b(sample|demo|synthetic|example|made.up|try it)\b/i],
        ['none', NO],
      ],
      next: {
        cdr: 'data.cdr',
        'bank-csv': 'data.bank-csv',
        accounting: 'data.accounting',
        spreadsheet: 'budget.file',
        csvs: 'data.csvs',
        sample: 'data.sample',
        none: 'budget.start',
      },
    },
    'data.cdr': {
      section: 'data',
      say: 'Choose the files your bank or data recipient gave you: CDR JSON, or a ZIP of them. They are read here; nothing is uploaded.',
      files: {
        label: 'Choose files',
        accept: '.json,.zip,application/json,application/zip',
        multiple: true,
      },
      effect: 'import-transactions',
      choices: [{ value: 'back', label: 'Something else' }],
      next: { done: 'budget.start', failed: 'data.failed', back: 'data.start' },
    },
    'data.bank-csv': {
      section: 'data',
      say: 'Choose the CSV files your bank gave you (CommBank, ANZ, Westpac, NAB, ING or any other). I’ll work out the columns and show you what I found before anything is saved.',
      files: { label: 'Choose CSV files', accept: '.csv,text/csv', multiple: true },
      effect: 'preview-bank-csv',
      choices: [{ value: 'back', label: 'Something else' }],
      next: { ready: 'data.bank-confirm', failed: 'data.bank-failed', back: 'data.start' },
    },
    'data.accounting': {
      section: 'data',
      say: 'Export the bank account’s transactions as CSV: from Xero, a bank statement or the Account Transactions report; from MYOB, the bank register. Then choose the files. I’ll show you what I found before anything is saved.',
      files: { label: 'Choose CSV files', accept: '.csv,text/csv', multiple: true },
      effect: 'preview-bank-csv',
      choices: [{ value: 'back', label: 'Something else' }],
      next: { ready: 'data.bank-confirm', failed: 'data.bank-failed', back: 'data.start' },
    },
    'data.bank-confirm': {
      section: 'data',
      say: '**Import these?**',
      choices: [
        { value: 'import', label: 'Import them' },
        { value: 'check', label: 'Check the columns first' },
      ],
      phrases: [
        ['check', /\b(check|columns?|map|wizard|look)\b/i],
        ['import', /\b(yes|yep|sure|import|ok|okay|go)\b/i],
      ],
      next: { import: 'data.bank-commit', check: 'data.bank-check' },
      resume: 'data.bank-csv',
    },
    'data.bank-commit': {
      section: 'data',
      effect: 'commit-bank-csv',
      next: { done: 'budget.start', failed: 'data.bank-failed' },
    },
    'data.bank-check': {
      section: 'data',
      say: 'Open **Import** and choose the files there. It shows every column with what I think it holds, and you can change any of them. I remember your changes for next time. Come back here when you’re done.',
      links: [{ label: 'Open Import', path: '/import' }],
      choices: [{ value: 'next', label: 'Carry on' }],
      phrases: [['next', /\b(done|carry on|continue|next|ok|okay)\b/i]],
      next: { next: 'budget.start' },
    },
    'data.bank-failed': {
      section: 'data',
      say: 'I couldn’t find dates and amounts in those files. The Import screen lets you map the columns yourself.',
      links: [{ label: 'Open Import', path: '/import' }],
      choices: [
        { value: 'retry', label: 'Choose other files' },
        { value: 'sample', label: 'Try a sample household' },
        { value: 'skip', label: 'Skip to the budget' },
      ],
      phrases: [
        ['sample', /\b(sample|demo|synthetic|example)\b/i],
        ['skip', /\b(skip|budget|carry on|continue|later)\b/i],
        ['retry', /\b(again|retry|other|different)\b/i],
      ],
      next: { retry: 'data.bank-csv', sample: 'data.sample', skip: 'budget.start' },
    },
    'data.csvs': {
      section: 'data',
      say: 'Are they **bank transactions**, or **budget sheets** (each sheet of a spreadsheet saved as a CSV)?',
      choices: [
        { value: 'bank', label: 'Bank transactions' },
        { value: 'budget', label: 'Budget sheets' },
      ],
      phrases: [
        ['bank', /\b(bank|transactions?|statements?)\b/i],
        ['budget', /\b(budget|sheets?|spreadsheet)\b/i],
      ],
      next: { bank: 'data.bank-csv', budget: 'budget.file' },
    },
    'data.sample': {
      section: 'data',
      say: 'Pick a sample household. It is made-up data, labelled *illustrative* everywhere.',
      dynamic: 'personas',
      next: { '*': 'data.sample-load' },
      resume: 'data.start',
    },
    'data.sample-load': {
      section: 'data',
      effect: 'load-sample',
      next: { done: 'budget.start', failed: 'data.failed' },
    },
    'data.failed': {
      section: 'data',
      say: 'That didn’t work. You can try again, or try a sample household.',
      choices: [
        { value: 'retry', label: 'Try again' },
        { value: 'sample', label: 'Try a sample household' },
        { value: 'skip', label: 'Skip to the budget' },
      ],
      phrases: [
        ['sample', /\b(sample|demo|synthetic|example)\b/i],
        ['skip', /\b(skip|budget|carry on|continue)\b/i],
        ['retry', /\b(again|retry)\b/i],
      ],
      next: { retry: 'data.start', sample: 'data.sample', skip: 'budget.start' },
    },

    'budget.start': {
      section: 'budget',
      say: 'Next, your budget. **Do you have a budget spreadsheet?** Save each sheet (budget lines, big purchases, wish list) as a CSV file.',
      choices: [
        { value: 'file', label: 'Yes, choose CSV files' },
        { value: 'skip', label: 'Not now: use my spending' },
      ],
      phrases: [
        ['skip', NO],
        ['file', /\b(yes|yep|sure|csv|spreadsheet|file|sheet)\b/i],
      ],
      next: { file: 'budget.file', skip: 'plan.run' },
    },
    'budget.file': {
      section: 'budget',
      say: 'Choose the CSV files. I’ll work out which sheet is which and show you what I found before anything is saved.',
      files: { label: 'Choose CSV files', accept: '.csv,text/csv', multiple: true },
      effect: 'preview-budget',
      choices: [{ value: 'skip', label: 'Skip the budget' }],
      next: { ready: 'budget.confirm', failed: 'budget.failed', skip: 'plan.run' },
    },
    'budget.confirm': {
      section: 'budget',
      say: '**Import these?**',
      choices: [
        { value: 'import', label: 'Import them' },
        { value: 'wizard', label: 'Check them in the wizard' },
      ],
      phrases: [
        ['wizard', /\b(wizard|check|columns?|map)\b/i],
        ['import', /\b(yes|yep|sure|import|ok|okay|go)\b/i],
      ],
      next: { import: 'budget.commit', wizard: 'budget.wizard' },
      resume: 'budget.start',
    },
    'budget.commit': {
      section: 'budget',
      effect: 'commit-budget',
      next: { done: 'plan.run', failed: 'budget.failed' },
    },
    'budget.wizard': {
      section: 'budget',
      say: 'Open **Budget** and choose the files under *Import a budget CSV*. The wizard shows every column and lets you change how each is read. Come back here when you’re done.',
      links: [{ label: 'Open Budget', path: '/budget' }],
      choices: [{ value: 'next', label: 'Carry on' }],
      phrases: [['next', /\b(done|carry on|continue|next|ok|okay)\b/i]],
      next: { next: 'plan.run' },
    },
    'budget.failed': {
      section: 'budget',
      say: 'Those files didn’t import. The wizard on the Budget screen can map unusual layouts column by column.',
      links: [{ label: 'Open Budget', path: '/budget' }],
      choices: [
        { value: 'retry', label: 'Choose other files' },
        { value: 'skip', label: 'Skip the budget' },
      ],
      phrases: [
        ['skip', /\b(skip|later|not now|carry on|continue)\b/i],
        ['retry', /\b(again|retry|other|different)\b/i],
      ],
      next: { retry: 'budget.file', skip: 'plan.run' },
    },

    'plan.run': {
      section: 'plan',
      say: 'Last, your plan. I’ll run it in 500 simulated futures with the settings on the Freedom screen.',
      effect: 'plan-chance',
      next: { done: 'plan.done', failed: 'plan.done' },
    },
    'plan.done': {
      section: 'plan',
      say: 'Setup is done. Ask me anything about your plan, or open a screen from the menu.',
      links: [
        { label: 'Open Freedom', path: '/freedom' },
        { label: 'Open Transactions', path: '/ledger' },
      ],
      next: {},
    },
  },
};
