// Pre-token radar, token-radar-01 entry (Node 22, standard library only).
//
// Reads the sealed snapshot (/input/snapshot.json, or --input <file|dir>), runs the model in
// dashboard/model.js (the same file the page runs), writes the ranked board to /output/board.json and
// the raw snapshot plus that board to /output/data.js, copies dashboard/ and screenshots/, and writes
// /output/dossier.json last with the vendored make.fun library.
//
// Two runs write the same bytes: no clock, no randomness, stable sorts, and files copied in name order.
//
// Outside the grader: MAKEFUN_OUTPUT_DIR=out node main.ts --input <kit>/input/snapshot.json

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const require = createRequire(import.meta.url);
const Radar = require('./dashboard/model.js');

const TEXT_MAX_BYTES = 65_536;
const SCREENSHOT_CAPS = { max: 4, max_bytes: 524_288 };
const IMAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const eq = process.argv.find((a) => a.startsWith(`--${name}=`));
  return eq === undefined ? fallback : eq.slice(name.length + 3);
}

function fail(message: string): never {
  process.stderr.write(`pre-token radar: ${message}\n`);
  process.exit(1);
}

const inputArg = arg('input', '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) fail(`no snapshot at ${inputFile}: pass --input <snapshot.json|directory> or mount /input`);
const out = arg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snapshot = JSON.parse(readFileSync(inputFile, 'utf8'));
const radar = Radar.buildRadar(snapshot);
const rows = Radar.boardRows(radar);

/** The gate's board rules, checked before anything is written. Returns the first problem or null. */
function boardProblem(): string | null {
  const known = new Set(snapshot.protocols.map((p: { slug: string }) => p.slug));
  if (rows.length < 100 || rows.length > 4000) return `${rows.length} rows: the gate takes 100 to 4000`;
  const seen = new Set<string>();
  let last = Infinity;
  for (const [i, r] of rows.entries()) {
    if (!known.has(r.slug)) return `${r.slug} is not in the snapshot`;
    if (seen.has(r.slug)) return `${r.slug} appears twice`;
    seen.add(r.slug);
    if (r.rank !== i + 1) return `rank ${r.rank} at position ${i + 1}`;
    if (!Number.isInteger(r.implied_value_usd) || r.implied_value_usd < 1 || r.implied_value_usd > last) return `value of ${r.slug} breaks the order`;
    last = r.implied_value_usd;
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) if (s.trim().length < 20 || s.trim().length > 600) return `${r.slug} has a farm step of ${s.trim().length} characters`;
  }
  for (const w of snapshot.watchlist) if (!seen.has(w)) return `watchlist protocol ${w} is not on the board`;
  if (new Set(rows.map((r: { implied_value_usd: number }) => r.implied_value_usd)).size < 2) return 'every value is the same';
  return null;
}
const problem = boardProblem();
if (problem !== null) fail(`the board breaks a gate rule: ${problem}`);

mkdirSync(out, { recursive: true });
// One row per line: the file reads as a table and stays near one line per ranked protocol.
const head = JSON.stringify({ as_of: snapshot.as_of, source: snapshot.source }).slice(0, -1);
writeFileSync(join(out, 'board.json'), `${head},"rows":[\n${rows.map((r: unknown) => JSON.stringify(r)).join(',\n')}\n]}\n`);
const board = rows.map((r: { slug: string; rank: number; implied_value_usd: number; farm_verdict: string }) => [r.slug, r.rank, r.implied_value_usd, r.farm_verdict]);
// The page rebuilds the board from `snapshot` and checks rows, order, totals and this checksum against what is written here.
writeFileSync(join(out, 'data.js'), `window.RADAR_INPUT = ${JSON.stringify({ snapshot, board, checksum: radar.checksum })};\n`);

function copyFiles(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(from).sort()) {
    if (name.startsWith('.')) continue;
    const path = join(from, name);
    if (!statSync(path).isFile()) continue;
    copyFileSync(path, join(to, name));
    copied.push(name);
  }
  return copied;
}

const pages = copyFiles(join(here, 'dashboard'), join(out, 'dashboard'));
const shots = copyFiles(join(here, 'screenshots'), join(out, 'screenshots'));
if (shots.length < 3) fail(`screenshots/ holds ${shots.length} images: hand in 3, the board, a detail view and a filtered view`);
for (const name of shots) if (!IMAGE_NAME.test(name)) fail(`screenshots/${name}: a name is letters, digits and . _ -`);

writeFileSync(join(out, 'dossier.json'), buildDossier(out, { text_max_bytes: TEXT_MAX_BYTES, screenshots: SCREENSHOT_CAPS, dashboard: { max_files: 400, max_bytes: 4_194_304 } }));

const c = radar.counts;
process.stdout.write(
  `pre-token radar: ${c.all} protocols: ${c.comp} priced peers, ${c.token} other tokens, ${c.aside} set aside, ${c.pre} ranked (watchlist ${c.watchRanked}/${c.watch})\n` +
    `pre-token radar: launch value fit on ${radar.model.peers.length} stand-alone peers, median held-out miss x${radar.model.missLoo.toFixed(2)} (leave-one-out), x${radar.model.missWf.toFixed(2)} (walk-forward) vs x${radar.model.flatLoo.toFixed(2)}, x${radar.model.flatWf.toFixed(2)} flat\n` +
    `pre-token radar: token odds Brier ${radar.odds.brierWf.toFixed(3)} forward vs ${radar.odds.brierWfBase.toFixed(3)} base rate; board checksum ${radar.checksum}, total ${radar.total}\n` +
    `pre-token radar: wrote board.json, data.js, dashboard/ (${pages.length} files), screenshots/ (${shots.length}) and dossier.json to ${out}\n`,
);
