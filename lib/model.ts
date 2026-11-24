// Token Radar's model: the snapshot of the protocol universe in, one ranked board out.
//
// A protocol's launch is the token it may issue one day. This file does not predict whether or when a
// token is issued; it answers a narrower question that the snapshot can support: if the protocol's
// record stayed as it is, what would a token that claims that record be worth on today's market?
//
// The model is one formula applied to every protocol, with no name ever special-cased:
//
//   implied = tvl_usd
//           x category_multiple        (what the market pays for this kind of protocol)
//           x momentum                 (seven-day TVL growth, clamped)
//           x maturity                 (how long it has run with no token)
//           x chain_multiple           (how many chains it reaches)
//
// The four factors and every constant are printed in the dashboard's methodology panel, and the page's
// app.js recomputes each row from the same snapshot figures so the board's arithmetic can be checked.
//
// The board keeps the watchlist (the house's floor) and adds the pre-token protocols below it, which is
// where a radar earns its name: a protocol at $20M of TVL with no token is the early row a reader wants.
// Protocols whose token already trades are kept apart; their market cap is a fact, not a model.

/** One protocol in the sealed snapshot: exactly the ten fields the input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** One category family and the multiple the model pays it. */
export interface Family {
  key: string;
  label: string;
  multiple: number;
  why: string;
}

/**
 * The eight families every DefiLlama category folds into, with the multiple each one carries. The
 * ordering of FAMILIES is the order the page prints its table in, not a rule: familyOf decides.
 */
export const FAMILIES: Family[] = [
  { key: 'perp', label: 'Perp DEX', multiple: 0.6, why: 'Fee flow is visible and a token has a market to claim.' },
  { key: 'dex', label: 'DEX', multiple: 0.55, why: 'Volume-driven fees, the most-priced launch category.' },
  { key: 'lending', label: 'Lending', multiple: 0.5, why: 'Spread income is durable, so the market pays for it.' },
  { key: 'cdp', label: 'CDP', multiple: 0.45, why: 'A stablecoin mint is valuable once it has float, not before.' },
  { key: 'rwa', label: 'RWA', multiple: 0.45, why: 'Real yield is scarce, but the launch is a governance token.' },
  { key: 'yield', label: 'Yield', multiple: 0.4, why: 'Crowded, mercenary liquidity, priced below DEX and lending.' },
  { key: 'restaking', label: 'Restaking', multiple: 0.35, why: 'Receipt tokens already exist; the launch is a points layer.' },
  { key: 'other', label: 'Other', multiple: 0.3, why: 'No comparable launch to price against; the base multiple.' },
];

const FAMILY_BY_KEY: { [key: string]: Family } = Object.fromEntries(FAMILIES.map((f) => [f.key, f]));

/** The model's constants, printed in the dashboard and applied by every row. */
export interface ModelConstants {
  momentum_weight: number;
  momentum_floor: number;
  momentum_cap: number;
  maturity_log_divisor: number;
  chain_step: number;
  chain_cap: number;
  unknown_momentum: number;
  unknown_maturity: number;
}

export const MODEL: ModelConstants = {
  momentum_weight: 3,
  momentum_floor: 0.6,
  momentum_cap: 2.5,
  maturity_log_divisor: 4,
  chain_step: 0.05,
  chain_cap: 4,
  unknown_momentum: 1,
  unknown_maturity: 1,
};

/** The model's version label: the dashboard names it and the board's rows carry its factors. */
export const MODEL_VERSION = 'cannon-1';

/** How many pre-token protocols below the watchlist floor the early radar carries, by TVL. */
export const EARLY_ROWS = 220;

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** A row's model breakdown: every factor the formula applied, at full precision. */
export interface ModelBreakdown {
  category_multiple: number;
  momentum: number;
  momentum_clamped: boolean;
  maturity: number;
  chain_multiple: number;
  chain_count: number;
  raw_value: number;
}

/** One row of board.json, and of the dashboard's data. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  family: string;
  family_label: string;
  chains: string[];
  chain_count: number;
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  watchlist: boolean;
  token_status: 'pre-token';
  implied_value_usd: number;
  model: ModelBreakdown;
  farm_steps: string[];
}

/** The dashboard's compact view of a live-token protocol: its market cap is a fact, not a model. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  family: string;
  family_label: string;
  chains: string[];
  chain_count: number;
  tvl_usd: number;
  mcap_usd: number;
  change_7d: number | null;
  symbol: string | null;
  listed_at: string | null;
  age_days: number | null;
}

/** Everything the dashboard renders, written beside the page as data.js. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  families: Family[];
  watchlist_size: number;
  watchlist_covered: number;
  board_size: number;
  early_size: number;
  live_size: number;
  protocols_total: number;
  pre_token_total: number;
  rows: BoardRow[];
  live: LiveRow[];
  chain_counts: { chain: string; count: number }[];
  family_counts: { family: string; label: string; count: number }[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/**
 * The family a DefiLlama category folds into. The rules are matched in this exact order, so a category
 * that reads like two families (Liquid Restaking is both staking and restaking) takes the narrower one.
 * No protocol name takes part in this, only the category string the snapshot carries.
 */
export function familyOf(category: string | null): Family {
  const c = (category ?? '').toLowerCase();
  if (c === '') return FAMILY_BY_KEY['other']!;
  if (/perp|perpetual|derivative/.test(c)) return FAMILY_BY_KEY['perp']!;
  if (/\bcdp\b|collateral market/.test(c)) return FAMILY_BY_KEY['cdp']!;
  if (/lend|credit/.test(c)) return FAMILY_BY_KEY['lending']!;
  if (/\brwa\b|real.?world/.test(c)) return FAMILY_BY_KEY['rwa']!;
  if (/restak|staking|stake/.test(c)) return FAMILY_BY_KEY['restaking']!;
  if (/\bdex\b|dexs|decentralized exchange/.test(c)) return FAMILY_BY_KEY['dex']!;
  if (/yield|farm|basis trading|options vault|index|curator|allocator|treasury/.test(c)) return FAMILY_BY_KEY['yield']!;
  return FAMILY_BY_KEY['other']!;
}

/** A whole day count from `listed_at` to `as_of`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/**
 * One protocol's four factors and the value they imply. The momentum and maturity factors are allowed
 * to be exactly 1 when the snapshot does not report their input; that is the model's assumption, not a
 * guess about the protocol.
 */
export function breakdownOf(p: SnapshotProtocol, asOf: string, model: ModelConstants = MODEL): { implied: number; row: ModelBreakdown; age: number | null; family: Family } {
  const family = familyOf(p.category);
  const age = ageDays(asOf, p.listed_at);

  let momentum: number;
  let momentumClamped = false;
  if (p.change_7d === null || !Number.isFinite(p.change_7d)) {
    momentum = model.unknown_momentum;
  } else {
    const raw = 1 + (p.change_7d / 100) * model.momentum_weight;
    momentum = Math.min(model.momentum_cap, Math.max(model.momentum_floor, raw));
    momentumClamped = momentum !== raw;
  }

  const maturity = age === null || age < 1 ? model.unknown_maturity : 1 + Math.log10(age) / model.maturity_log_divisor;

  const chainCount = Array.isArray(p.chains) ? p.chains.length : 0;
  const chainMultiple = 1 + Math.min(Math.max(chainCount - 1, 0), model.chain_cap) * model.chain_step;

  const rawValue = p.tvl_usd * family.multiple * momentum * maturity * chainMultiple;
  const implied = Math.max(1, Math.round(rawValue));
  const row: ModelBreakdown = {
    category_multiple: family.multiple,
    momentum: round6(momentum),
    momentum_clamped: momentumClamped,
    maturity: round6(maturity),
    chain_multiple: round6(chainMultiple),
    chain_count: chainCount,
    raw_value: Math.round(rawValue),
  };
  return { implied, row, age, family };
}

const round6 = (n: number): number => Math.round(n * 1e6) / 1e6;

/** Whether a protocol records no token at all. Say "records no token", never "has none". */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Whether a protocol is a launch subject the early radar may add below the watchlist floor. */
export function isEarlySubject(p: SnapshotProtocol): boolean {
  return isPreToken(p) && p.category !== 'CEX' && !VERSIONED.test(p.name);
}

/** The headline figures the page prints above the board. */
export interface BoardSummary {
  watchlist_size: number;
  watchlist_covered: number;
  board_size: number;
  early_size: number;
  live_size: number;
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const index = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const chosen = new Map<string, SnapshotProtocol>();

  // The watchlist is the floor: every slug in it is scored, whatever the row's own TVL says.
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }

  // The early radar: pre-token protocols below the floor, by TVL, capped. A watchlist row is never
  // displaced by an early one, and the cap is high enough that no subject below it is left out here.
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isEarlySubject(p) && p.tvl_usd < snapshot.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || byCodeUnit(a.slug, b.slug))
    .slice(0, EARLY_ROWS);
  for (const p of early) chosen.set(p.slug, p);

  const scored = [...chosen.values()].map((p) => {
    const { implied, row, age, family } = breakdownOf(p, snapshot.as_of, model);
    return { p, implied, breakdown: row, age, family };
  });
  scored.sort((a, b) => b.implied - a.implied || byCodeUnit(a.p.slug, b.p.slug));

  // Every implied value is distinct by construction of the snapshot's own figures; the check below is
  // the guard that keeps that claim honest if the model's constants ever change. Two rows that rounded
  // to one dollar would be one value and the gate refuses a board that ranks nothing by value.
  for (let i = 1; i < scored.length; i++) {
    if (scored[i]!.implied === scored[i - 1]!.implied) {
      throw new SnapshotError(`two protocols round to the same implied value $${scored[i]!.implied}: ${scored[i - 1]!.p.slug} and ${scored[i]!.p.slug}`);
    }
  }

  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    family: s.family.key,
    family_label: s.family.label,
    chains: s.p.chains,
    chain_count: s.p.chains.length,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    age_days: s.age,
    watchlist: snapshot.watchlist.includes(s.p.slug),
    token_status: 'pre-token',
    implied_value_usd: s.implied,
    model: s.breakdown,
    farm_steps: farmPlan(s.p, s.age, s.family),
  }));
}

/** Code-unit order, so the board's ordering never depends on a locale. */
function byCodeUnit(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

// ---------------------------------------------------------------- farm plans

/** How much capital one position needs, from the protocol's own TVL. */
function capitalFor(tvl: number): number {
  if (tvl >= 5_000_000_000) return 500;
  if (tvl >= 1_000_000_000) return 250;
  if (tvl >= 100_000_000) return 100;
  return 50;
}

/** How long a position should be held, from how young the protocol is: young ones need the longer run. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 60;
  if (age < 180) return 90;
  if (age < 365) return 60;
  return 45;
}

/** A rough gas figure for one transaction on the first chain the snapshot names. */
function gasFor(chains: string[]): number {
  const chain = (chains[0] ?? '').toLowerCase();
  if (chain === 'ethereum') return 9;
  if (chain === 'solana') return 0.02;
  if (/arbitrum|base|optimism|op mainnet|polygon|linea|scroll|zksync|blast|mantle|mode|unichain|berachain/.test(chain)) return 0.4;
  return 1.5;
}

/** A dollar figure as the plan's text writes it. */
function dollars(n: number): string {
  if (n < 1) return `$${n.toFixed(2)}`;
  return `$${Math.round(n)}`;
}

/** The one position a farmer opens, in the words of the protocol's own family. */
function actionFor(p: SnapshotProtocol, family: Family, capital: number, chain: string): string {
  const name = p.name;
  switch (family.key) {
    case 'perp':
      return `Deposit ${dollars(capital)} of USDC as margin on ${name} on ${chain}, open one small hedge and keep the account funded.`;
    case 'dex':
      return `Provide ${dollars(capital)} of USDC to ${name}'s deepest pool on ${chain} and leave the position open.`;
    case 'lending':
      return `Supply ${dollars(capital)} of USDC to ${name} on ${chain}, borrow a stable asset against a third of it and keep both legs open.`;
    case 'cdp':
      return `Mint ${dollars(capital)} of ${name}'s stablecoin against collateral on ${chain} and hold the mint open.`;
    case 'rwa':
      return `Deposit ${dollars(capital)} of USDC into ${name}'s yield asset on ${chain} and keep the receipt.`;
    case 'yield':
      return `Deposit ${dollars(capital)} of USDC into ${name}'s main vault on ${chain} and let the shares compound.`;
    case 'restaking':
      return `Stake ${dollars(capital)} of ${chain}'s staking asset through ${name} and keep the receipt token in the same wallet.`;
    default:
      return `Deposit ${dollars(capital)} of USDC into ${name} on ${chain} and keep the position open through the next snapshot.`;
  }
}

/**
 * A protocol's farm plan: seven steps, each with the cost and the time it takes. Every input is the
 * protocol's own record (category, chains, TVL, age), so two protocols with the same record get the
 * same plan and no name is hand-written. The steps are the same shape for every row on purpose: a
 * reader comparing two plans compares the numbers, not the prose.
 */
export function farmPlan(p: SnapshotProtocol, age: number | null, family: Family): string[] {
  const chain = p.chains.length > 0 ? p.chains[0]! : 'its main chain';
  const capital = capitalFor(p.tvl_usd);
  const hold = holdDaysFor(age);
  const gas = gasFor(p.chains);
  const action = actionFor(p, family, capital, chain);
  const tvl = `$${(p.tvl_usd / 1e6).toFixed(1)}M`;
  const steps = [
    `Open a fresh wallet that will hold only this farm's funds and write its recovery phrase on paper; do not reuse a wallet that already holds balances. Cost: ${dollars(gas)} of gas to fund it the first time. Time: 10 minutes.`,
    `${action} Cost: ${dollars(capital)} of capital plus about ${dollars(gas)} of gas. Time: 20 minutes to set up.`,
    `Keep the position above a fifth of your deposit at all times and top it up after any market move, because a liquidated position earns nothing. Cost: no fee to check, ${dollars(gas)} to top up. Time: 5 minutes a week.`,
    `Return once a week to make one qualifying move, a supply, a borrow, a swap or a governance vote, so the wallet is active in every seven-day window. Cost: about ${dollars(gas * 4)} a month in gas. Time: 10 minutes a week.`,
    `Hold for at least ${hold} days so the activity covers more than one snapshot and a full points season. Cost: the ${dollars(capital)} stays in the position and is not spendable. Time: ${hold} days.`,
    `Check that the protocol's TVL of ${tvl} is at least ten times your position, read the contract address from its own documentation, and claim rewards only on its official page, never through a link someone sends you. Cost: no fee, and never pay to claim. Time: 15 minutes.`,
    `Withdraw into the same asset you deposited, then record the dates, the amounts and every transaction hash in a farm log so the position can be repeated or audited. Cost: about ${dollars(gas)} of gas to exit. Time: 20 minutes.`,
  ];
  // The gate takes 3 to 12 steps of 20 to 600 characters; every step above is written to sit inside
  // that band, and the guard keeps a longer protocol name from pushing one over the edge.
  return steps.map((s) => (s.length > 600 ? `${s.slice(0, 596)}...` : s));
}

// ---------------------------------------------------------------- live set

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd || byCodeUnit(a.slug, b.slug))
    .slice(0, LIVE_ROWS)
    .map((p) => {
      const family = familyOf(p.category);
      return {
        slug: p.slug,
        name: p.name,
        category: p.category,
        family: family.key,
        family_label: family.label,
        chains: p.chains,
        chain_count: p.chains.length,
        tvl_usd: p.tvl_usd,
        mcap_usd: p.mcap_usd ?? 0,
        change_7d: p.change_7d,
        symbol: p.symbol,
        listed_at: p.listed_at,
        age_days: ageDays(snapshot.as_of, p.listed_at),
      };
    });
}

// ---------------------------------------------------------------- the whole dataset

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData; summary: BoardSummary } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const slugs = new Set(board.map((r) => r.slug));
  const covered = snapshot.watchlist.filter((s) => slugs.has(s)).length;
  const early = board.filter((r) => !r.watchlist).length;

  const chainTally = new Map<string, number>();
  for (const r of board) for (const c of r.chains) chainTally.set(c, (chainTally.get(c) ?? 0) + 1);
  const chainCounts = [...chainTally.entries()]
    .map(([chain, count]) => ({ chain, count }))
    .sort((a, b) => b.count - a.count || byCodeUnit(a.chain.toLowerCase(), b.chain.toLowerCase()));

  const familyTally = new Map<string, number>();
  for (const r of board) familyTally.set(r.family, (familyTally.get(r.family) ?? 0) + 1);
  const familyCounts = FAMILIES.map((f) => ({ family: f.key, label: f.label, count: familyTally.get(f.key) ?? 0 }));

  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    families: FAMILIES,
    watchlist_size: snapshot.watchlist.length,
    watchlist_covered: covered,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    protocols_total: snapshot.protocols.length,
    pre_token_total: snapshot.protocols.filter(isPreToken).length,
    rows: board,
    live,
    chain_counts: chainCounts,
    family_counts: familyCounts,
  };
  const summary: BoardSummary = {
    watchlist_size: snapshot.watchlist.length,
    watchlist_covered: covered,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
  };
  return { board, radar, summary };
}

// ---------------------------------------------------------------- input and output

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/**
 * Why a board is not one the gate will take, or null. The program runs this before it writes anything,
 * so a model that drifted is a loud failure in the build, never a valid-looking entry.
 */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  if (board.length < 100 || board.length > 4000) return `the board holds ${board.length} rows`;
  const seen = new Set<number>();
  for (const r of board) {
    if (!Number.isSafeInteger(r.rank) || r.rank < 1 || r.rank > board.length) return `${r.slug} has rank ${r.rank}`;
    if (seen.has(r.rank)) return `rank ${r.rank} appears twice`;
    seen.add(r.rank);
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) {
      const t = s.trim();
      if (t.length < 20 || t.length > 600) return `${r.slug} has a farm step of ${t.length} characters`;
    }
  }
  for (let i = 1; i < board.length; i++) {
    if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  }
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
