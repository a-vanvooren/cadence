# @cadence/engine

Framework-agnostic simulation engine. Pure functions, no DOM — turns a
`TypingProfile` + target text + `PlanContext` into a timed `Action[]` plan that
an injector replays.

```ts
import { plan } from '@cadence/engine';
import profile from '../../schema/example-profile.json';

const { actions, estimatedMs, seedUsed } = plan(
  'Hey — can you send the deck before the call?',
  profile,
  { targetHint: 'gmail', load: 'light', seed: 7 },
);
// actions: [{type:'key',char:'H',delayMs:...}, {type:'pause',reason:'inter-burst',...}, ...]
```

## Model map

| Concept (Phase 2) | Where |
|---|---|
| Seeded RNG, Gaussian / log-normal sampling | `humanize.ts` |
| Spatial typos + correction styles | `typos.ts` |
| Load inference, lexical complexity, sentence/quote pauses | `cognitive.ts` |
| Pipeline: bursts, fatigue, timing, error injection | `index.ts` (`plan`) |

## Determinism

Pass `seed` in the context for a reproducible plan (same profile + text + seed →
identical `Action[]`). Omit it to get a fresh take. This is what powers a
"re-roll" button in the UI.

## Run the demo

```bash
pnpm install
pnpm --filter @cadence/engine demo
```

(Requires Node + the `tsx` dev dependency. The package itself is dependency-free.)
