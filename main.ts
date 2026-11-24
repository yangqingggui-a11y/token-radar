// Token Radar: the program that turns the sealed snapshot into an entry.
//
// It reads /input/snapshot.json (or --input <file|dir>), scores every pre-token protocol with the model
// in lib/model.ts, writes the ranked board to /output/board.json, writes the dashboard's data beside the
// page as data.js, copies this repository's dashboard/ and screenshots/ into /output, and writes
// /output/dossier.json with the vendored make.fun library. The program is the only writer of every file
// the gate reads, and it writes the same bytes on every run: the snapshot is sealed and nothing here
// reads the clock, a locale, a random source or the network.
//
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot, SnapshotError } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));

/** The scorer's own caps: the text cap shapes the dossier's bytes, the rest only refuse. */
const TEXT_MAX_BYTES = 65_536;
const DASHBOARD_CAPS = { max_files: 400, max_bytes: 4_194_304 };
const SCREENSHOT_CAPS = { max: 4, max_bytes: 524_288, min_count: 3, min_short_side: 800, max_long_side: 1440 };
const SAFE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

/** --name <value> out of the arguments, or the fallback. */
function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const withEquals = process.argv.find((a) => a.startsWith(`--${name}=`));
  return withEquals === undefined ? fallback : withEquals.slice(name.length + 3);
}

function fail(message: string): never {
  process.stderr.write(`token radar: ${message}\n`);
  process.exit(1);
}

const inputArg = arg('input', '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) {
  process.stderr.write(`token radar: no snapshot at ${inputFile}: pass --input <snapshot.json|directory> or mount the sealed /input\n`);
  process.exit(2);
}
const out = arg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

// 1. Read and score. A snapshot the model cannot score, or a board the gate would refuse, stops the
//    build here with the reason; the program never writes half an entry.
let snapshot;
try {
  snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
} catch (err) {
  if (err instanceof SnapshotError) fail(err.message);
  throw err;
}
const { board, radar, summary } = buildRadar(snapshot);
const issue = boardIssue(board, snapshot);
if (issue !== null) fail(`the model wrote a board the gate refuses: ${issue}`);

// 2. Write the board and the page's data. Both are newline-terminated so a byte comparison of two runs
//    is a comparison of the whole file, not of a prefix.
mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'board.json'), `${JSON.stringify({ rows: board }, null, 0)}\n`);
writeFileSync(join(out, 'data.js'), dataScript(radar));

// 3. Copy the page's files. Only regular files are copied; a directory would silently vanish from the
//    artifact, and the dossier's file list is built from what is left.
function copyFiles(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(from).sort()) {
    if (name.startsWith('.')) continue;
    const path = join(from, name);
    if (!statSync(path).isFile()) continue;
    if (!SAFE_NAME.test(name)) fail(`${from}/${name}: a name is letters, digits and . _ -, 1 to 128 characters`);
    copyFileSync(path, join(to, name));
    copied.push(name);
  }
  return copied;
}

const pageFiles = copyFiles(join(here, 'dashboard'), join(out, 'dashboard'));
for (const required of ['index.html']) {
  if (!pageFiles.includes(required)) fail(`dashboard/${required} is missing: the page is the entry`);
}
if (!pageFiles.some((n) => n.endsWith('.css'))) fail('dashboard/ holds no .css file');
if (!pageFiles.some((n) => n.endsWith('.js'))) fail('dashboard/ holds no .js file');

// 4. Copy the screenshots and refuse any the gate would refuse, before the dossier is built from them.
const shots = copyFiles(join(here, 'screenshots'), join(out, 'screenshots'));
if (shots.length < SCREENSHOT_CAPS.min_count) {
  fail(`screenshots/ holds ${shots.length} image${shots.length === 1 ? '' : 's'}: hand in three, the board, a detail view and a filtered view`);
}
if (shots.length > SCREENSHOT_CAPS.max) fail(`screenshots/ holds ${shots.length} images: the gate takes at most ${SCREENSHOT_CAPS.max}`);
for (const name of shots) {
  if (!/\.(png|jpe?g)$/i.test(name)) fail(`screenshots/${name}: name a PNG or a JPEG`);
  const bytes = readFileSync(join(out, 'screenshots', name));
  if (bytes.length > SCREENSHOT_CAPS.max_bytes) fail(`screenshots/${name} is ${bytes.length} bytes, over the ${SCREENSHOT_CAPS.max_bytes} cap`);
  const png = bytes.length > 24 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  const jpeg = bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (!png && !jpeg) fail(`screenshots/${name} is neither a whole PNG nor a whole JPEG`);
  if (png) {
    // IHDR carries the dimensions at bytes 16..24: width then height, big-endian.
    const width = bytes.readUInt32BE(16);
    const height = bytes.readUInt32BE(20);
    const long = Math.max(width, height);
    const short = Math.min(width, height);
    if (long > SCREENSHOT_CAPS.max_long_side) fail(`screenshots/${name} is ${width}x${height}: the long side is over ${SCREENSHOT_CAPS.max_long_side}`);
    if (short < SCREENSHOT_CAPS.min_short_side) fail(`screenshots/${name} is ${width}x${height}: the short side is under ${SCREENSHOT_CAPS.min_short_side}`);
  }
}

// 5. The dossier is written last, from exactly the files the gate will read. The scorer rebuilds it from
//    this /output and compares bytes, so nothing may be written after it.
const dossier = buildDossier(out, { text_max_bytes: TEXT_MAX_BYTES, screenshots: SCREENSHOT_CAPS, dashboard: DASHBOARD_CAPS });
writeFileSync(join(out, 'dossier.json'), dossier);

const kb = (n: number): string => `${(n / 1024).toFixed(1)} KB`;
const dossierText = JSON.parse(Buffer.from(dossier).toString('utf8')) as { text: string };
process.stdout.write(
  `token radar: ${snapshot.protocols.length} protocols read, ${radar.pre_token_total} record no token, ${summary.watchlist_size} on the watchlist\n` +
    `token radar: board ${summary.board_size} rows, ${summary.watchlist_covered}/${summary.watchlist_size} watchlist covered, ${summary.early_size} early rows below the $${Math.round(radar.floor_usd / 1e6)}M floor, ${summary.live_size} live-token protocols set aside\n` +
    `token radar: wrote board.json (${kb(statSync(join(out, 'board.json')).size)}), data.js (${kb(statSync(join(out, 'data.js')).size)}), dashboard/ (${pageFiles.length} files), screenshots/ (${shots.length} images), dossier.json (${kb(dossier.length)}, source text ${kb(dossierText.text.length)})\n`,
);
