import type { NoteType, Preset } from './types';

export const DEFAULT_CSS = `.card {
  font-family: "Literata Variable", Georgia, serif;
  font-size: 22px;
  line-height: 1.45;
  text-align: center;
  color: var(--card-ink);
}
.cloze { font-weight: 600; color: var(--cloze); }
`;

const BACK = '{{FrontSide}}\n\n<hr id=answer>\n\n{{Back}}';

type Stock = Omit<NoteType, 'id' | 'mtime'>;

export const STOCK_NOTE_TYPES: Stock[] = [
  {
    name: 'Basic',
    kind: 'normal',
    fields: [{ name: 'Front', ord: 0 }, { name: 'Back', ord: 1 }],
    templates: [{ name: 'Card 1', ord: 0, qfmt: '{{Front}}', afmt: BACK }],
    css: DEFAULT_CSS,
    sortField: 0,
  },
  {
    name: 'Basic (and reversed card)',
    kind: 'normal',
    fields: [{ name: 'Front', ord: 0 }, { name: 'Back', ord: 1 }],
    templates: [
      { name: 'Card 1', ord: 0, qfmt: '{{Front}}', afmt: BACK },
      { name: 'Card 2', ord: 1, qfmt: '{{Back}}', afmt: '{{FrontSide}}\n\n<hr id=answer>\n\n{{Front}}' },
    ],
    css: DEFAULT_CSS,
    sortField: 0,
  },
  {
    name: 'Basic (optional reversed card)',
    kind: 'normal',
    fields: [{ name: 'Front', ord: 0 }, { name: 'Back', ord: 1 }, { name: 'Add Reverse', ord: 2 }],
    templates: [
      { name: 'Card 1', ord: 0, qfmt: '{{Front}}', afmt: BACK },
      {
        name: 'Card 2',
        ord: 1,
        qfmt: '{{#Add Reverse}}{{Back}}{{/Add Reverse}}',
        afmt: '{{FrontSide}}\n\n<hr id=answer>\n\n{{Front}}',
      },
    ],
    css: DEFAULT_CSS,
    sortField: 0,
  },
  {
    name: 'Basic (type in the answer)',
    kind: 'normal',
    fields: [{ name: 'Front', ord: 0 }, { name: 'Back', ord: 1 }],
    templates: [
      { name: 'Card 1', ord: 0, qfmt: '{{Front}}\n\n{{type:Back}}', afmt: '{{Front}}\n\n<hr id=answer>\n\n{{type:Back}}' },
    ],
    css: DEFAULT_CSS,
    sortField: 0,
  },
  {
    name: 'Cloze',
    kind: 'cloze',
    fields: [{ name: 'Text', ord: 0 }, { name: 'Back Extra', ord: 1 }],
    templates: [{ name: 'Cloze', ord: 0, qfmt: '{{cloze:Text}}', afmt: '{{cloze:Text}}<br>\n{{Back Extra}}' }],
    css: DEFAULT_CSS,
    sortField: 0,
  },
];

export function defaultPreset(id: number, name = 'Default'): Preset {
  return {
    id,
    name,
    newPerDay: 20,
    reviewsPerDay: 200,
    learningSteps: ['1m', '10m'],
    relearningSteps: ['10m'],
    desiredRetention: 0.9,
    maximumInterval: 36500,
    enableFuzz: true,
    buryNew: true,
    buryReviews: true,
    leechThreshold: 8,
    leechAction: 'tag',
    fsrsParams: [],
    newOrder: 'added',
    mtime: Date.now(),
  };
}
