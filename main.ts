// Puerto Vela — entry point for the gta6-01 entry.
//
// The game itself is static: every file the browser needs lives under game/ (index.html, its ES
// modules, the vendored three.js build), so opening game/index.html from disk plays it with no
// server, no build step and no network request. This program is the packaging step around it: it
// copies game/ and screenshots/ next to the output directory and writes dossier.json, the summary
// the judge reads, using the vendored buildDossier from vendor/makefun-game.ts.
//
// Run it with the output directory named in MAKEFUN_OUTPUT_DIR (the grader supplies /output):
//   MAKEFUN_OUTPUT_DIR=out node main.ts
// Play it locally with:
//   node serve.ts --port 8080     then open http://localhost:8080

import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

const repoRoot = fileURLToPath(new URL('.', import.meta.url));
const outputDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

mkdirSync(outputDir, { recursive: true });

// game/ is mandatory: it is the deliverable.
cpSync(join(repoRoot, 'game'), join(outputDir, 'game'), { recursive: true });

// screenshots/ holds the renders the judge looks at; the first by name is the cover.
const shotsSrc = join(repoRoot, 'screenshots');
mkdirSync(join(outputDir, 'screenshots'), { recursive: true });
if (existsSync(shotsSrc)) {
  cpSync(shotsSrc, join(outputDir, 'screenshots'), { recursive: true });
}

// Caps mirror the bounty's gate.json. Only text_max_bytes shapes the dossier's bytes; the rest make
// buildDossier refuse exactly what the scorer would refuse, so a bad entry fails here as well rather
// than silently producing a dossier the grader rejects.
const caps = {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
  game_path_max_bytes: 1000,
};

writeFileSync(join(outputDir, 'dossier.json'), buildDossier(outputDir, caps));

console.log(`wrote ${join(outputDir, 'dossier.json')}`);
