// Token Radar's model, version cannon-2-fit.
//
// The snapshot carries its own evidence: 128 protocols record both a TVL and a live market cap. That
// is a labelled set, and this file fits the model to it instead of asserting constants. The equation
// is a log-linear regression, estimated in closed form with the standard library:
//
//   ln(mcap) = a
//            + b_tvl    * ln(tvl_usd)
//            + b_age    * ln(days since first listed)
//            + b_change * 30 * tanh(change_7d / 30)      (bounded, so one +4,448% week cannot run away)
//            + b_chains * chains.length
//            + b_miss   * (listing date missing)
//            + b_family * (one indicator per category family)
//
// A pre-token protocol's token does not exist, while every row of the training set is a token that
// trades. The model therefore applies one stated prior, SHRINK = 0.65, to the fitted market value: a
// launch has no market, no liquidity and a real chance of never happening. It is named here, printed
// in the dashboard and multiplied into every row, so it changes no rank.
//
// The page's app.js re-runs this same equation from the coefficients in data.js on every row and
// checks the result against board.json. Nothing here special-cases a protocol name; the only inputs
// are the snapshot's own fields.

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

/** One category family of the board, with its fitted effect and the observed market evidence. */
export interface FamilyFit {
  key: string;
  label: string;
  why: string;
  /** The fitted effect on ln(mcap) relative to the Other base. */
  coef: number;
  /** exp(coef): the family's multiplier on the fitted value, Other = 1. */
  multiplier: number;
  /** The family's standard error in the fit, and its t statistic. */
  se: number;
  t: number;
  /** How many training protocols the family holds. */
  n: number;
  /** Median market cap / TVL among the family's tokenized protocols; null when none. */
  observed_median_ratio: number | null;
}

/** The whole fit, as the dashboard prints it. */
export interface Fit {
  n: number;
  features: number;
  r2: number;
  adj_r2: number;
  rmse_log: number;
  /** Standard deviation of the residual in log space. */
  sigma_log: number;
  intercept: number;
  intercept_se: number;
  ln_tvl: number;
  ln_tvl_se: number;
  ln_age: number;
  ln_age_se: number;
  /** The coefficient the board uses for growth: the stated prior, not the unconstrained fit. */
  change: number;
  /** The unconstrained fit's growth estimate, its standard error and t, shown beside the prior. */
  change_fitted: number;
  change_se: number;
  change_t: number;
  chains: number;
  chains_se: number;
  age_missing: number;
  age_missing_se: number;
  change_scale: number;
  median_age: number;
  families: FamilyFit[];
  cex_coef: number;
  cex_n: number;
  holdout: { n: number; rmse_log: number; mae_log: number; r2: number };
  shrink: number;
  /** Protocols with a market cap at or below zero: their log value is undefined, so they are not fitted. */
  excluded_nonpositive: number;
}

/** The model's three stated numbers; only `growth_prior` sits inside the fit, the other two outside. */
export const MODEL = {
  /** The bounded transform's scale, in per cent: at small moves it is the raw change. */
  change_scale: 30,
  /** The launch prior a pre-token row is multiplied by; it moves no rank. */
  shrink: 0.65,
  /**
   * Seven-day growth's coefficient. The unconstrained fit gives a small negative number whose sign
   * cannot be trusted (its t is under 2) and which would let a crash lift a row; the model uses this
   * stated positive prior instead and prints the unconstrained estimate beside it.
   */
  growth_prior: 0.01,
};

/** The model's version label: the dashboard names it and the board's rows carry its fit. */
export const MODEL_VERSION = 'cannon-2-fit';

/** How many pre-token protocols below the watchlist floor the early radar carries, by TVL. */
export const EARLY_ROWS = 220;

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** A row's model breakdown: every term the fitted equation added, in log space. */
export interface ModelBreakdown {
  intercept: number;
  ln_tvl: number;
  ln_tvl_term: number;
  ln_age: number;
  ln_age_term: number;
  change: number;
  change_term: number;
  chains: number;
  chain_term: number;
  family_coef: number;
  age_missing_term: number;
  log_value: number;
  fitted_usd: number;
  shrink: number;
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
  model: typeof MODEL;
  model_version: string;
  fit: Fit;
  families: FamilyFit[];
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
  family_counts: { family: string; label: string; count: number; multiple: number }[];
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

/** The board's category families and what each one's fitted effect means. */
const FAMILY_META: { key: string; label: string; why: string }[] = [
  { key: 'perp', label: 'Perp DEX', why: 'Few comparables in the snapshot, so the fitted effect is wide.' },
  { key: 'dex', label: 'DEX', why: 'Fee volume is legible to the market, so the fit pays for it.' },
  { key: 'lending', label: 'Lending', why: 'Spread income is durable; the fit prices it against TVL.' },
  { key: 'cdp', label: 'CDP', why: 'A stablecoin mint is worth more once it has float; the fit is wide here.' },
  { key: 'rwa', label: 'RWA', why: 'Real assets under management carry a premium in the fitted set.' },
  { key: 'yield', label: 'Yield', why: 'Crowded, mercenary liquidity; the fit discounts it against Other.' },
  { key: 'restaking', label: 'Restaking', why: 'Receipt tokens already exist, and the fit discounts them most.' },
  { key: 'bridge', label: 'Bridge', why: 'Bridges carry large TVL against a thin token float; the fit reflects that.' },
  { key: 'other', label: 'Other', why: 'The base the other families are measured against; its multiplier is 1 by construction.' },
];

/**
 * The family a DefiLlama category folds into, matched in this exact order so a category that reads
 * like two families (Liquid Restaking is both staking and restaking) takes the narrower one. CEX is
 * kept apart: an exchange's token prices the exchange, never a protocol launch, so no CEX row is
 * ranked and its indicator exists only in the fit.
 */
export function familyOf(category: string | null): string {
  const c = (category ?? '').toLowerCase();
  if (c === '') return 'other';
  if (c === 'cex' || c === 'centralized exchange') return 'cex';
  if (/perp|perpetual|derivative/.test(c)) return 'perp';
  if (/\bcdp\b|collateral market/.test(c)) return 'cdp';
  if (/lend|credit/.test(c)) return 'lending';
  if (/\brwa\b|real.?world/.test(c)) return 'rwa';
  if (/restak|staking|stake/.test(c)) return 'restaking';
  if (/bridge/.test(c)) return 'bridge';
  if (/\bdex\b|dexs|decentralized exchange/.test(c)) return 'dex';
  if (/yield|farm|basis trading|options vault|index|curator|allocator|treasury/.test(c)) return 'yield';
  return 'other';
}

/** The label shown for a family key. */
export function familyLabel(key: string): string {
  const meta = FAMILY_META.find((f) => f.key === key);
  if (meta !== undefined) return meta.label;
  return key === 'cex' ? 'CEX' : key;
}

/** A whole day count from `listed_at` to `as_of`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** Whether a protocol records no token at all. Say "records no token", never "has none". */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Whether a protocol is a launch subject the early radar may add below the watchlist floor. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
export function isEarlySubject(p: SnapshotProtocol): boolean {
  return isPreToken(p) && p.category !== 'CEX' && !VERSIONED.test(p.name);
}

// ---------------------------------------------------------------- linear algebra

/** Solve A x = b by Gaussian elimination with partial pivoting. */
function solveLinear(A: number[][], b: number[]): number[] {
  const n = A.length;
  const M: number[][] = A.map((row, i) => [...row, b[i]!]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r]![col]!) > Math.abs(M[pivot]![col]!)) pivot = r;
    if (pivot !== col) {
      const swap = M[col]!;
      M[col] = M[pivot]!;
      M[pivot] = swap;
    }
    const pv = M[col]![col]!;
    if (Math.abs(pv) < 1e-12) throw new SnapshotError('the regression is singular: its features are collinear');
    for (let r = col + 1; r < n; r++) {
      const f = M[r]![col]! / pv;
      if (f === 0) continue;
      for (let c = col; c <= n; c++) M[r]![c] = M[r]![c]! - f * M[col]![c]!;
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = M[r]![n]!;
    for (let c = r + 1; c < n; c++) s -= M[r]![c]! * x[c]!;
    x[r] = s / M[r]![r]!;
  }
  return x;
}

/** A symmetric matrix's inverse by Gauss-Jordan elimination; used only for standard errors. */
function invertMatrix(A: number[][]): number[][] {
  const n = A.length;
  const M: number[][] = A.map((row, i) => [...row, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r]![col]!) > Math.abs(M[pivot]![col]!)) pivot = r;
    if (pivot !== col) {
      const swap = M[col]!;
      M[col] = M[pivot]!;
      M[pivot] = swap;
    }
    const pv = M[col]![col]!;
    if (Math.abs(pv) < 1e-12) throw new SnapshotError('the regression is singular: its features are collinear');
    M[col] = M[col]!.map((v) => v / pv);
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r]![col]!;
      if (f === 0) continue;
      M[r] = M[r]!.map((v, c) => v - f * M[col]![c]!);
    }
  }
  return M.map((row) => row.slice(n));
}

/** A stable 32-bit hash of a slug, used only to split the fit's training and holdout rows. */
function hash32(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** The median of a non-empty list of numbers. */
function median(values: number[]): number {
  const v = [...values].sort((a, b) => a - b);
  const mid = Math.floor(v.length / 2);
  return v.length % 2 === 1 ? v[mid]! : (v[mid - 1]! + v[mid]!) / 2;
}

// ---------------------------------------------------------------- the fit

/** A training row's features and its observed log market cap. */
interface TrainingRow {
  slug: string;
  family: string;
  /** The displayed design's row (no growth column). */
  features: number[];
  /** The bounded growth the displayed model adds as the stated prior. */
  chg: number;
  y: number;
}

/** The unconstrained design: intercept, four numeric terms, a missing-age indicator, family dummies. */
const FEATURE_TERMS = ['intercept', 'ln_tvl', 'ln_age', 'change', 'chains', 'age_missing'];
/** The displayed design: the same without growth, which enters as the stated prior instead. */
const DISPLAY_TERMS = ['intercept', 'ln_tvl', 'ln_age', 'chains', 'age_missing'];
const DUMMY_FAMILIES = ['perp', 'dex', 'lending', 'cdp', 'rwa', 'yield', 'restaking', 'bridge', 'cex'];

/** The bounded change transform: the raw percentage near zero, never beyond ±scale. */
export function boundedChange(value: number | null, scale: number): number {
  if (value === null || !Number.isFinite(value)) return 0;
  return scale * Math.tanh(value / scale);
}

/** The design matrix's row for one protocol, given the training median age. */
function designRow(p: SnapshotProtocol, asOf: string, medianAge: number, scale: number): number[] {
  const age = ageDays(asOf, p.listed_at);
  const lnAge = age === null || age < 1 ? Math.log(medianAge) : Math.log(age);
  const row = [
    1,
    Math.log(p.tvl_usd),
    lnAge,
    boundedChange(p.change_7d, scale),
    p.chains.length,
    age === null ? 1 : 0,
  ];
  const family = familyOf(p.category);
  for (const key of DUMMY_FAMILIES) row.push(family === key ? 1 : 0);
  return row;
}

/** The observed y of a training row: the log of a positive market cap. */
function observedLogMcap(p: SnapshotProtocol): number {
  return Math.log(p.mcap_usd as number);
}

/** Ordinary least squares of y on X, with the statistics the page prints. */
function ols(rows: TrainingRow[], k: number): { beta: number[]; r2: number; adj: number; rmse: number; ssr: number; se: number[]; sigma2: number } {
  const XtX: number[][] = Array.from({ length: k }, () => new Array<number>(k).fill(0));
  const Xty: number[] = new Array<number>(k).fill(0);
  for (const row of rows) {
    const x = row.features;
    for (let i = 0; i < k; i++) {
      Xty[i] = Xty[i]! + x[i]! * row.y;
      for (let j = 0; j < k; j++) XtX[i]![j] = XtX[i]![j]! + x[i]! * x[j]!;
    }
  }
  const beta = solveLinear(XtX, Xty);
  let ssr = 0;
  let sumY = 0;
  for (const row of rows) {
    let pred = 0;
    for (let i = 0; i < k; i++) pred += beta[i]! * row.features[i]!;
    const residual = row.y - pred;
    ssr += residual * residual;
    sumY += row.y;
  }
  const meanY = sumY / rows.length;
  let sst = 0;
  for (const row of rows) sst += (row.y - meanY) * (row.y - meanY);
  const r2 = 1 - ssr / sst;
  const dof = rows.length - k;
  if (dof <= 0) throw new SnapshotError('the fit has no degrees of freedom');
  const sigma2 = ssr / dof;
  const inv = invertMatrix(XtX);
  const se = Array.from({ length: k }, (_, i) => Math.sqrt(sigma2 * inv[i]![i]!));
  return { beta, r2, adj: 1 - (1 - r2) * ((rows.length - 1) / dof), rmse: Math.sqrt(sigma2), ssr, se, sigma2 };
}

/** Drop the growth column: the displayed design. */
function displayFeatures(features: number[]): number[] {
  return [features[0]!, features[1]!, features[2]!, features[4]!, features[5]!, ...features.slice(6)];
}

/** Predict a training row's ln(mcap) under a displayed-model coefficient vector. */
function predictDisplayed(row: TrainingRow, beta: number[]): number {
  let z = 0;
  for (let i = 0; i < beta.length; i++) z += beta[i]! * row.features[i]!;
  return z + MODEL.growth_prior * row.chg;
}

/**
 * Fit the model to the snapshot's labelled protocols: those with a positive TVL and a positive market
 * cap (128 of them here). A cap of zero or less cannot be logged and is counted, not fitted. Two fits
 * are run: the unconstrained one, whose growth coefficient the page prints as evidence, and the
 * displayed one, which uses the stated growth prior and fits every other term around it.
 * A deterministic fifth of the rows is held out, fitted without, and scored, so the page can print a
 * number the displayed fit never saw. The board then uses the fit on all of them.
 */
export function fitModel(snapshot: Snapshot): Fit {
  const scale = MODEL.change_scale;
  const growthPrior = MODEL.growth_prior;
  const labelled = snapshot.protocols.filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0);
  if (labelled.length < 40) throw new SnapshotError(`the snapshot holds ${labelled.length} protocols with a market cap to fit against: too few for this model`);
  const ages = labelled.map((p) => ageDays(snapshot.as_of, p.listed_at)).filter((a): a is number => a !== null && a > 0);
  const medianAge = Math.max(1, median(ages));
  const k = DISPLAY_TERMS.length + DUMMY_FAMILIES.length;

  const evidenceRows: TrainingRow[] = labelled.map((p) => {
    const full = designRow(p, snapshot.as_of, medianAge, scale);
    return { slug: p.slug, family: familyOf(p.category), features: full, chg: full[3]!, y: observedLogMcap(p) };
  });
  const evidence = ols(evidenceRows, FEATURE_TERMS.length + DUMMY_FAMILIES.length);

  // The displayed fit: growth fixed at its prior, every other coefficient free. Its residual is
  // y - prior*chg, so the printed R² and RMSE belong to the equation the board actually runs.
  const allRows: TrainingRow[] = labelled.map((p) => {
    const full = designRow(p, snapshot.as_of, medianAge, scale);
    const chg = full[3]!;
    return { slug: p.slug, family: familyOf(p.category), features: displayFeatures(full), chg, y: observedLogMcap(p) - growthPrior * chg };
  });

  // The holdout: a fifth of the rows by a stable hash of the slug, never by order.
  const held = allRows.filter((r) => hash32(r.slug) % 5 === 0);
  const train = allRows.filter((r) => hash32(r.slug) % 5 !== 0);
  let holdout = { n: 0, rmse_log: 0, mae_log: 0, r2: 0 };
  if (held.length >= 10 && train.length > k + 10) {
    const inner = ols(train, k);
    let ss = 0;
    let aa = 0;
    let meanHeld = 0;
    for (const r of held) meanHeld += r.y + growthPrior * r.chg;
    meanHeld /= held.length;
    let sstHeld = 0;
    for (const r of held) {
      // Compare on the original scale: r.y is the growth-adjusted target, so add the prior term back.
      const z = predictDisplayed(r, inner.beta);
      const actual = r.y + growthPrior * r.chg;
      const residual = actual - z;
      ss += residual * residual;
      aa += Math.abs(residual);
      sstHeld += (actual - meanHeld) * (actual - meanHeld);
    }
    holdout = { n: held.length, rmse_log: Math.sqrt(ss / held.length), mae_log: aa / held.length, r2: 1 - ss / sstHeld };
  }

  const fit = ols(allRows, k);
  const beta = fit.beta;
  const se = fit.se;

  // Per-family evidence: the fitted effect, and the observed market's own median mcap/TVL.
  const families: FamilyFit[] = FAMILY_META.map((meta) => {
    const familyRows = labelled.filter((p) => familyOf(p.category) === meta.key);
    const dummyAt = DUMMY_FAMILIES.indexOf(meta.key);
    const coef = dummyAt >= 0 ? beta[DISPLAY_TERMS.length + dummyAt]! : 0;
    const coefSe = dummyAt >= 0 ? se[DISPLAY_TERMS.length + dummyAt]! : 0;
    return {
      key: meta.key,
      label: meta.label,
      why: meta.why,
      coef,
      multiplier: Math.exp(coef),
      se: coefSe,
      t: coefSe === 0 ? 0 : coef / coefSe,
      n: familyRows.length,
      observed_median_ratio: familyRows.length > 0 ? median(familyRows.map((p) => (p.mcap_usd as number) / p.tvl_usd)) : null,
    };
  });

  const cexRows = labelled.filter((p) => familyOf(p.category) === 'cex');
  const cexAt = DISPLAY_TERMS.length + DUMMY_FAMILIES.indexOf('cex');
  const fittedGrowth = evidence.beta[3]!;
  const fittedGrowthSe = evidence.se[3]!;

  return {
    n: allRows.length,
    features: k,
    r2: fit.r2,
    adj_r2: fit.adj,
    rmse_log: fit.rmse,
    sigma_log: fit.rmse,
    intercept: beta[0]!,
    intercept_se: se[0]!,
    ln_tvl: beta[1]!,
    ln_tvl_se: se[1]!,
    ln_age: beta[2]!,
    ln_age_se: se[2]!,
    change: growthPrior,
    change_fitted: fittedGrowth,
    change_se: fittedGrowthSe,
    change_t: fittedGrowthSe === 0 ? 0 : fittedGrowth / fittedGrowthSe,
    chains: beta[3]!,
    chains_se: se[3]!,
    age_missing: beta[4]!,
    age_missing_se: se[4]!,
    change_scale: scale,
    median_age: medianAge,
    families,
    cex_coef: beta[cexAt]!,
    cex_n: cexRows.length,
    holdout,
    shrink: MODEL.shrink,
    excluded_nonpositive: snapshot.protocols.filter((p) => p.mcap_usd !== null && p.mcap_usd <= 0).length,
  };
}

/** The log value of one protocol under a fit, and the terms that made it. */
export function breakdownOf(p: SnapshotProtocol, asOf: string, fit: Fit): { implied: number; row: ModelBreakdown; age: number | null; family: string } {
  const age = ageDays(asOf, p.listed_at);
  const lnTvl = Math.log(p.tvl_usd);
  const lnAge = age === null || age < 1 ? Math.log(fit.median_age) : Math.log(age);
  const change = boundedChange(p.change_7d, fit.change_scale);
  const chains = p.chains.length;
  const missing = age === null ? 1 : 0;
  const family = familyOf(p.category);
  const familyFit = fit.families.find((f) => f.key === family);
  const familyCoef = familyFit !== undefined ? familyFit.coef : family === 'cex' ? fit.cex_coef : 0;

  const lnTvlTerm = fit.ln_tvl * lnTvl;
  const lnAgeTerm = fit.ln_age * lnAge;
  const changeTerm = fit.change * change;
  const chainTerm = fit.chains * chains;
  const missingTerm = fit.age_missing * missing;
  const logValue = fit.intercept + lnTvlTerm + lnAgeTerm + changeTerm + chainTerm + missingTerm + familyCoef;
  const fitted = Math.exp(logValue);
  const implied = Math.max(1, Math.round(fitted * fit.shrink));

  const row: ModelBreakdown = {
    intercept: fit.intercept,
    ln_tvl: fit.ln_tvl,
    ln_tvl_term: lnTvlTerm,
    ln_age: fit.ln_age,
    ln_age_term: lnAgeTerm,
    change: fit.change,
    change_term: changeTerm,
    chains: fit.chains,
    chain_term: chainTerm,
    family_coef: familyCoef,
    age_missing_term: missingTerm,
    log_value: logValue,
    fitted_usd: Math.round(fitted),
    shrink: fit.shrink,
  };
  return { implied, row, age, family };
}

// ---------------------------------------------------------------- the board

/** The headline figures the page prints above the board. */
export interface BoardSummary {
  watchlist_size: number;
  watchlist_covered: number;
  board_size: number;
  early_size: number;
  live_size: number;
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, fit: Fit): BoardRow[] {
  const index = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const chosen = new Map<string, SnapshotProtocol>();

  // The watchlist is the floor: every slug in it is scored, whatever the row's own TVL says.
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }

  // The early radar: pre-token protocols below the floor, by TVL, capped. A watchlist row is never
  // displaced by an early one.
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isEarlySubject(p) && p.tvl_usd < snapshot.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || byCodeUnit(a.slug, b.slug))
    .slice(0, EARLY_ROWS);
  for (const p of early) chosen.set(p.slug, p);

  const scored = [...chosen.values()].map((p) => {
    const { implied, row, age, family } = breakdownOf(p, snapshot.as_of, fit);
    return { p, implied, breakdown: row, age, family };
  });
  scored.sort((a, b) => b.implied - a.implied || byCodeUnit(a.p.slug, b.p.slug));

  // The fitted values are distinct on this snapshot; the check keeps that claim honest if the input or
  // the fit ever moves, because two rows that round to one dollar would be one value and the gate
  // refuses a board that ranks nothing by value.
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
    family: s.family,
    family_label: familyLabel(s.family),
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

/** How long a position should be held, from how young the protocol is. */
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
function actionFor(p: SnapshotProtocol, family: string, capital: number, chain: string): string {
  const name = p.name;
  switch (family) {
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
    case 'bridge':
      return `Bridge ${dollars(capital)} of USDC to ${chain} through ${name}, then use the bridged funds on the far side and keep the receipt.`;
    default:
      return `Deposit ${dollars(capital)} of USDC into ${name} on ${chain} and keep the position open through the next snapshot.`;
  }
}

/**
 * A protocol's farm plan: seven steps, each with the cost and the time it takes. Every input is the
 * protocol's own record (category, chains, TVL, age), so two protocols with the same record get the
 * same plan and no name is hand-written.
 */
export function farmPlan(p: SnapshotProtocol, age: number | null, family: string): string[] {
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
  return steps.map((s) => (s.length > 600 ? `${s.slice(0, 596)}...` : s));
}

// ---------------------------------------------------------------- the live set

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
        family,
        family_label: familyLabel(family),
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
export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData; summary: BoardSummary } {
  const fit = fitModel(snapshot);
  const board = buildBoard(snapshot, fit);
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
  const familyCounts = fit.families.map((f) => ({ family: f.key, label: f.label, count: familyTally.get(f.key) ?? 0, multiple: f.multiplier }));

  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model: MODEL,
    model_version: MODEL_VERSION,
    fit,
    families: fit.families,
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

/** Kept for callers that only know a protocol: the value under a fit, without the row's plan. */
export function impliedValueUsd(p: SnapshotProtocol, snapshot: Snapshot, fit: Fit): number {
  return breakdownOf(p, snapshot.as_of, fit).implied;
}

/** A finite number or the fallback, exported for the program's own argument checks. */
export const finiteOr = finite;
