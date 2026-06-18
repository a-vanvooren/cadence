/**
 * Tiny demo: load the example profile and print a keystroke plan for two
 * different cognitive loads. Run with `pnpm --filter @cadence/engine demo`
 * (requires `tsx`).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { plan, type TypingProfile, type Action } from '../src/index';

const here = dirname(fileURLToPath(import.meta.url));
const profile: TypingProfile = JSON.parse(
  readFileSync(resolve(here, '../../../schema/example-profile.json'), 'utf8'),
);

function render(label: string, actions: Action[], estimatedMs: number) {
  console.log(`\n=== ${label}  (~${(estimatedMs / 1000).toFixed(1)}s, ${actions.length} actions) ===`);
  let line = '';
  for (const a of actions) {
    if (a.type === 'key') line += a.char;
    else if (a.type === 'backspace') line += '⌫';
    else if (a.type === 'deleteWord') line += '⌫word';
    else if (a.type === 'pause') line += `⟨${a.reason} ${Math.round(a.delayMs)}ms⟩`;
  }
  console.log(line);
}

// Light load: a quick chat message.
const chat = plan('hey, running 5 min late — grab us a table?', profile, {
  targetHint: 'slack',
  seed: 42,
});
render('LIGHT (Slack)', chat.actions, chat.estimatedMs);

// Heavy load: research prose with a citation, which triggers a long pre-quote pause.
const paper = plan(
  'The results were unambiguous. As one review put it, "the effect persists across every cohort we examined" (Nguyen, 2023). We interpret this cautiously.',
  profile,
  { targetHint: 'Google Docs', seed: 42 },
);
render('HEAVY (Google Docs)', paper.actions, paper.estimatedMs);
