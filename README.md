# Recall

A spaced-repetition flashcard app for iPhone, built as an installable web app (PWA). It implements the core of the Spaced Repetition Flashcard System FRD and imports your Anki desktop decks: notes, cards, progress, review history and media.

Everything runs and is stored on the device. There is no server.

## Put it on your iPhone

The app has to be served over HTTPS once. After that it works offline from the Home Screen.

1. Build it:
   ```bash
   npm install
   npm run build          # outputs dist/
   ```
   A prebuilt `dist/` is included in the zip, so you can skip this step.
2. Host `dist/` on any static HTTPS host. Pick one:
   - **Netlify Drop**: drag the `dist` folder onto https://app.netlify.com/drop.
   - **Cloudflare Pages / Vercel**: point them at the repo, build command `npm run build`, output `dist`.
   - **GitHub Pages**: build with the repo name as the base path, e.g. `BASE_PATH=/recall/ npm run build`, then publish `dist/`.
3. On the iPhone, open the URL in **Safari**, tap **Share › Add to Home Screen**, and launch Recall from the icon.

Installing to the Home Screen matters: iOS can clear storage for websites you haven't visited recently, but it keeps data for Home Screen apps.

## Bring over your Anki decks

1. In Anki on your computer: **File › Export**, choose **Anki Deck Package (.apkg)**, tick **Include scheduling information** and **Include media**, and export. (A whole-collection **.colpkg** works too.)
2. Get the file to your phone (AirDrop, iCloud Drive, email).
3. In Recall: **Decks › Import** (the download icon) › **Choose a file**.

Both the current Anki format and the "Support older Anki versions" format are supported. Cards keep their due dates and FSRS memory state. Cards scheduled by Anki's older SM-2 algorithm get a memory state rebuilt from their review history. Deck presets come along, including your FSRS parameters.

**Re-importing:** with **Update cards I already have** on (the default), importing a newer export of the same deck updates edited notes and brings in newer progress. Cards are matched by Anki's note GUID, so nothing is duplicated. Use this to carry desktop progress to the phone.

## What's included

| Area | Included |
| --- | --- |
| Content | Notes and fields, note types with templates, Basic, Basic + reversed, optional reversed, type-in answer and Cloze (nested clozes and hints); images and audio; tags; nested decks |
| Templates | `{{Field}}`, `{{#Field}}`/`{{^Field}}` sections, `{{FrontSide}}`, `cloze:`, `type:`, `text:`, `hint:`, `furigana:`/`kana:`/`kanji:`, special fields; each note type's CSS is isolated in a shadow root |
| Chapters | Mark chapters you haven't reached as not started: they add no new words, even when you study the deck above them, while words you've already learned in them still come up for review. Start one chapter, or every chapter up to a point, in one tap |
| Study | Show answer, then Again/Hard/Good/Easy with the next interval on each button; daily new and review limits with subdeck roll-up; learning steps; sibling burying; leech tagging and suspension; undo; flag, bury, suspend and delete from the card; keyboard shortcuts (space, 1 to 4, u, e) |
| Scheduling | FSRS (ts-fsrs, FSRS-6) with desired retention, learning and relearning steps, interval fuzz, maximum interval and custom parameters; presets shared across decks; a study day that starts at 4 a.m. by default |
| Browse | Anki-style search (`deck:`, `tag:`, `is:due/new/learn/review/suspended/buried/leech`, `flag:`, `note:`, `card:`, `prop:ivl>=30`, `added:`, `rated:`, `field:value`, `re:`, `-`, `or`, parentheses, `*` and `_` wildcards); sorting; bulk suspend, move, flag, tag, set due date, reset and delete |
| Stats | Today's answers, time and accuracy; 30-day forecast; 30-day review history; young and mature retention; card counts |
| Import and backup | .apkg and .colpkg in every format; CSV, TSV and Anki's text export with column mapping; full backup and restore as a .zip including media |
| PWA | Works offline, installs to the Home Screen, light and dark themes, safe-area aware |

## Not included yet

- **Sync.** Progress made on the phone doesn't flow back to Anki desktop. Desktop to phone works by re-importing.
- **FSRS parameter optimizer.** Optimize in Anki desktop; the parameters come over on import, or can be pasted into Deck options.
- **Image occlusion** cards, and JavaScript inside card templates (it doesn't run).
- Filtered decks and custom study sessions.

## Project layout

Layers depend only downward: `ui → data/import → domain`.

```
src/
  domain/     Pure logic, no I/O: types, FSRS scheduler wrapper, template and cloze rendering,
              card generation, search parser, day-boundary time maths
  data/       IndexedDB (Dexie) storage: collection operations, daily queues and limits,
              answering with undo, media, stats, backup
  import/     ZIP reader (streams large files), protobuf decoder, .apkg/.colpkg reader for
              schema 11 and 18, scheduling conversion, merge into the collection, CSV import
  ui/         React screens and components, styles, theme
tests/        Vitest: domain rules, study flow, and imports of real Anki-generated packages
fixtures/     .apkg files produced by the official `anki` Python package, plus the scripts that make them
```

## Development

```bash
npm install
npm run dev      # local dev server
npm test         # unit and import tests
npm run build    # type-check and production build
```

To regenerate the test decks: `pip install anki zstandard` and run `python3 fixtures/make_fixtures.py`.
