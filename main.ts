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

// ---------------------------------------------------------------- paths

const repoRoot = fileURLToPath(new URL('.', import.meta.url));

// Where the packaged entry lands. The grader supplies MAKEFUN_OUTPUT_DIR (/output); the default
// keeps a bare `node main.ts` from ever writing outside the repo.
const outputDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

const gameSrcDir = join(repoRoot, 'game');
const shotsSrcDir = join(repoRoot, 'screenshots');
const shotsOutDir = join(outputDir, 'screenshots');

// ---------------------------------------------------------------- caps
//
// These mirror the bounty's gate.json. Only text_max_bytes shapes the dossier's own size; the
// rest make buildDossier refuse exactly what the scorer would refuse, so a bad entry fails here
// rather than silently producing a dossier the grader rejects.

const TEXT_MAX_BYTES = 163_840;          // 160 KiB — the dossier's text payload budget
const DOSSIER_MAX_BYTES = 1_572_864;     // 1.5 MiB — the finished dossier.json ceiling
const SCREENSHOT_MAX = 4;                // at most four images, first by name is the cover
const SCREENSHOT_MAX_BYTES = 262_144;    // 256 KiB each
const GAME_MAX_FILES = 993;              // file-count ceiling for game/
const GAME_MAX_BYTES = 50_331_648;       // 48 MiB total for game/
const GAME_PATH_MAX_BYTES = 1000;        // longest permitted relative path inside game/

const caps = {
  text_max_bytes: TEXT_MAX_BYTES,
  screenshots: { max: SCREENSHOT_MAX, max_bytes: SCREENSHOT_MAX_BYTES },
  game_max_files: GAME_MAX_FILES,
  game_max_bytes: GAME_MAX_BYTES,
  game_path_max_bytes: GAME_PATH_MAX_BYTES,
};

// ---------------------------------------------------------------- package

mkdirSync(outputDir, { recursive: true });

// game/ is mandatory: it is the deliverable.
cpSync(gameSrcDir, join(outputDir, 'game'), { recursive: true });

// screenshots/ holds the renders the judge looks at. It is optional, so a missing source
// directory is not an error — the destination is still created.
mkdirSync(shotsOutDir, { recursive: true });
if (existsSync(shotsSrcDir)) {
  cpSync(shotsSrcDir, shotsOutDir, { recursive: true });
}

// ---------------------------------------------------------------- dossier

const dossier = buildDossier(outputDir, caps);

// Fail loudly here instead of shipping a dossier the scorer would reject.
if (dossier.length > DOSSIER_MAX_BYTES) {
  throw new Error(
    `dossier.json is ${dossier.length} bytes, over the ${DOSSIER_MAX_BYTES}-byte cap`,
  );
}

writeFileSync(join(outputDir, 'dossier.json'), dossier);

console.log(`wrote ${join(outputDir, 'dossier.json')} (${dossier.length} bytes)`);
