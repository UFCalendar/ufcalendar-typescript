/**
 * Hand-written shapes for the payloads people actually consume. Field names
 * come from the serializers in `apps/api/src/routes/*.ts`, not from
 * imagination — if a field is not here it is because the API does not send
 * it. The generated `paths` type (from the OpenAPI document) is exported
 * alongside these for anything not covered.
 *
 * Everything is snake_case because the wire is.
 */

/** `{"data": ..., "meta": ...}` — every JSON response. */
export interface Envelope<T> {
  data: T;
  meta?: Meta;
}

export interface Meta {
  pagination?: { next_cursor: string | null; has_more: boolean };
  [k: string]: unknown;
}

export interface RateLimit {
  /** Monthly quota. */
  limit: string | null;
  remaining: string | null;
  reset: string | null;
}

/* ── orgs ────────────────────────────────────────────────────────────── */

export interface Org {
  slug: string;
  name: string;
  short_name: string | null;
  sport: string;
  country: string | null;
  /** ISO-3166 alpha-2 (2026-09-24). */
  country_code: string | null;
  website: string | null;
  capabilities: {
    stats: boolean;
    rounds: boolean;
    rankings: boolean;
    broadcasts: boolean;
    predictions: boolean;
    scorecards: boolean;
    /** UFCalendar consensus odds (`fightOdds()`), 2026-09-25. */
    odds: boolean;
  };
}

/* ── events ──────────────────────────────────────────────────────────── */

export type EventStatus = 'announced' | 'scheduled' | 'live' | 'completed' | 'cancelled';

/** A row of `GET /v1/events`. The card lives on the detail route. */
export interface EventSummary {
  id: number;
  slug: string;
  title: string;
  short_title: string | null;
  numbering: string | null;
  org: string;
  sport: string;
  /** UTC ISO-8601. */
  starts_at: string | null;
  main_card_at: string | null;
  prelims_at: string | null;
  early_prelims_at: string | null;
  /** Venue IANA timezone, snapshotted at write time. */
  tz: string | null;
  status: EventStatus | string;
  is_ppv: boolean;
  is_title_card: boolean;
  /** Present with `include: ['headline']`: the card's main event, or null when it has none. */
  headline?: EventHeadline | null;
}

/** Extra blocks `events({ include })` accepts. */
export type EventListInclude = 'headline';
/** Extra blocks `event(id, { include })` accepts. */
export type EventInclude = 'eta' | 'odds';
/** Extra blocks `fight(id, { include })` accepts. */
export type FightInclude = 'odds';

export interface HeadlineCorner {
  id: number;
  slug: string | null;
  name: string | null;
}

/** The main event of a card (`include: ['headline']`). A replaced main event is skipped for the active one. */
export interface EventHeadline {
  fight_id: number;
  fighter_a: HeadlineCorner | null;
  fighter_b: HeadlineCorner | null;
  weight_class: string | null;
  is_title: boolean;
  winner_fighter_id: number | null;
  method: string | null;
  round: number | null;
  time: string | null;
}

export interface Venue {
  id: number;
  slug: string | null;
  name: string;
  city: string | null;
  region: string | null;
  country: string | null;
  tz: string | null;
  capacity: number | null;
}

export interface Broadcast {
  region: string | null;
  provider: string | null;
  kind: string | null;
  url: string | null;
}

export interface EventDetail extends EventSummary {
  venue: Venue | null;
  card: Fight[];
  broadcasts: Broadcast[];
}

export interface EventChange {
  id: number;
  kind: string;
  before: unknown;
  after: unknown;
  observed_at: string | null;
}

/** The kinds `GET /v1/changes` serves (and filters by). */
export type ChangeKind =
  | 'fight-added'
  | 'fight-cancelled'
  | 'fight-reinstated'
  | 'opponent-changed'
  | 'time-changed'
  | 'venue-changed'
  | 'fighter-merged';

/** The event a feed row or a search row belongs to. */
export interface EventRef {
  id: number;
  slug: string;
  title: string;
  org: string;
  starts_at: string | null;
}

/** One row of `GET /v1/changes`: a card change plus its event. */
export interface ChangeFeedEntry extends EventChange {
  event: EventRef;
}

/** One row of `GET /v1/fights/search`: a bout plus its event. */
export interface FightSearchRow extends Fight {
  event: EventRef;
}

/** `method=` on `findFights`. */
export type FightSearchMethod = 'ko' | 'sub' | 'dec' | 'finish' | 'any';

/* ── fights ──────────────────────────────────────────────────────────── */

/** Identity fields only — the full record is on `/v1/fighters/{id}`. */
export interface FighterRef {
  id: number;
  slug: string;
  name: string;
  nickname: string | null;
  nationality: string | null;
  /** ISO-3166 alpha-2 derived from `nationality` (2026-09-24). */
  country_code: string | null;
}

/** Normalized method vocabulary; `method` keeps the source's spelling. */
export type MethodNormalized =
  | 'ko_tko' | 'submission' | 'technical_submission' | 'decision_unanimous' | 'decision_split'
  | 'decision_majority' | 'decision' | 'draw' | 'no_contest' | 'dq' | 'other';

export interface FightResult {
  winner_fighter_id: number | null;
  method: string | null;
  method_normalized: MethodNormalized | null;
  /** "Rear-Naked Choke", "Doctor's Stoppage", … when the source states it. */
  finish_detail: string | null;
  round: number | null;
  /** "m:ss" as the source printed it. */
  time: string | null;
  time_seconds: number | null;
  details: string | null;
}

export interface Fight {
  id: number;
  ordering: number | null;
  card_section: string | null;
  sport: string;
  weight_class: string | null;
  /** Slug twin in the rankings vocabulary (`womens-strawweight`, `catchweight`). */
  division_slug: string | null;
  is_title: boolean;
  is_main: boolean;
  scheduled_rounds: number | null;
  status: string | null;
  fighter_a: FighterRef | null;
  fighter_b: FighterRef | null;
  result: FightResult | null;
  referee: string | null;
  bonus: string | null;
  /**
   * Present with `event(id, { include: ['eta'] })`: estimated start (UTC ISO),
   * null for a cancelled bout. An estimate, re-anchored on each completed bout.
   */
  eta?: string | null;
  /**
   * Present with `include: ['odds']` (on `event()` and `fight()`): the latest
   * UFCalendar consensus line, or null when the bout is unpriced.
   */
  odds?: OddsPair | null;
}

/* ── consensus odds (information only, not betting advice) ───────────── */

/** One corner's side of a consensus point. */
export interface OddsLine {
  /** American moneyline (`-152`, `131`). */
  american: number;
  /** Decimal odds, 3 places. */
  decimal: number;
  /** Raw implied probability (market margin included), 4 places. */
  implied_probability: number;
}

/**
 * One UFCalendar consensus point: the mean across the sportsbooks we track
 * (book identities are never exposed). Oriented to the bout's
 * `fighter_a` / `fighter_b`.
 */
export interface OddsPair {
  a: OddsLine;
  b: OddsLine;
  /** The corner the market prices as more likely; null on an even pair. */
  favourite: 'a' | 'b' | null;
  /** Probability of corner a with the margin removed, 4 places. */
  fair_probability_a: number;
  /** How many sportsbooks backed this point. */
  sources: number;
  recorded_at: string;
}

export interface OddsMovement {
  /** Implied-probability points on corner a, opening → consensus (2 places). */
  delta_points_a: number;
  /** The corner the market moved toward; null when it did not move. */
  direction: 'a' | 'b' | null;
  since: string;
}

/** The odds block every bout carries on the odds routes. */
export interface OddsBlock {
  /** Latest point; null when the bout was never priced. */
  consensus: OddsPair | null;
  /** First point we recorded. */
  opening: OddsPair | null;
  /** Settled bouts only: the last point at or before the event start. */
  closing: OddsPair | null;
  movement: OddsMovement | null;
  /** Stored points (0 = never priced). */
  points: number;
  /** When the line last moved. */
  updated_at: string | null;
}

/** `GET /v1/fights/{id}/odds`. */
export interface FightOdds extends OddsBlock {
  fight_id: number;
  status: string | null;
  event: EventRef;
  fighter_a: { id: number; slug: string; name: string } | null;
  fighter_b: { id: number; slug: string; name: string } | null;
}

/** One bout of `GET /v1/events/{id}/odds`. */
export interface EventOddsRow extends OddsBlock {
  fight_id: number;
  status: string | null;
  fighter_a: { id: number; slug: string; name: string } | null;
  fighter_b: { id: number; slug: string; name: string } | null;
}

/** `GET /v1/events/{id}/odds` — card order, non-cancelled bouts, unpriced included. */
export interface EventOdds {
  event: { id: number; slug: string; title: string; org: string; starts_at: string | null; status: string };
  fights: EventOddsRow[];
}

/** One point of `GET /v1/fights/{id}/odds/history` (Pro plans and up). */
export interface OddsHistoryPoint extends OddsPair {
  id: number;
}

/* ── scorecards (the official commission record) ─────────────────────── */

export interface ScorecardRound {
  round: number;
  a: number | null;
  b: number | null;
}

export interface Scorecard {
  judge_id: number | null;
  judge_name: string | null;
  total_a: number | null;
  total_b: number | null;
  winner_fighter_id: number | null;
  is_draw: boolean;
  /**
   * False when the commission published only the outcome: totals are a
   * 1-0 / 1-1 / 0-0 placeholder and `rounds` is empty. Check it before
   * charting.
   */
  scores_known: boolean;
  rounds: ScorecardRound[];
}

export interface Scorecards {
  fight_id: number;
  fighter_a_id: number | null;
  fighter_b_id: number | null;
  decision_type: string | null;
  deductions: unknown[];
  cards: Scorecard[];
  /** Who published the cards: `commission-record` (the athletic-commission /
   * officials-body record), `ufc-official-cards`, or a promotion's own slug
   * (`oktagon-official`, `pfl-official`, `aca-official`); null when empty. */
  source: PublicSource | null;
}

export interface Judge {
  id: number;
  name: string;
  fights?: number;
  rounds_scored?: number;
  /** Rounds this judge scored 10-8 or wider. */
  wide_rounds?: number;
  /** Three-judge cards of theirs where the panel did not agree. */
  split_fights?: number;
  three_judge_fights?: number;
  /** Three-judge cards where this judge alone picked the other corner. */
  lone_dissents?: number;
  /** ISO date of the first / latest card they turned in. */
  first_scored?: string | null;
  last_scored?: string | null;
  /** Promotion slugs they have judged in. */
  orgs?: string[];
  [k: string]: unknown;
}

/** `meta.league` on `judges()` — the whole directory's baseline, never the filtered subset. */
export interface JudgeLeague {
  judges: number;
  /** Judge-cards (one per judge per bout). */
  fights: number;
  rounds_scored: number;
  /** wide rounds / rounds scored. */
  wide_round_rate: number | null;
  /** split / three-judge cards. */
  split_rate: number | null;
  /** lone dissents / three-judge cards. */
  lone_dissent_rate: number | null;
}

/** Another judge's card on the same bout. */
export interface JudgeColleague {
  judge_id: number | null;
  judge_name: string | null;
  total_a: number | null;
  total_b: number | null;
  winner_fighter_id: number | null;
  is_draw: boolean;
}

/** One row of `judgeScorecards(id)`. */
export interface JudgeScorecardRow {
  fight_id: number;
  event: { id: number; slug: string; title: string; org: string; starts_at: string | null };
  fighter_a_id: number | null;
  fighter_b_id: number | null;
  decision_type: string | null;
  /** This judge's own card. */
  card: Scorecard | null;
  /** Three known verdicts and this judge alone differs from both others; null if the panel is not three or a verdict is unknown. */
  lone_dissent: boolean | null;
  /** Three known verdicts that do not all agree; null as above. */
  split: boolean | null;
  colleagues: JudgeColleague[];
}

/* ── fighters ────────────────────────────────────────────────────────── */

export interface FighterSummary {
  id: number;
  slug: string;
  name: string;
  nickname: string | null;
  nationality: string | null;
  /** ISO-3166 alpha-2 derived from `nationality`. */
  country_code: string | null;
  /** A second nationality when the source lists one (display name). */
  second_nationality: string | null;
}

/** Wikimedia Commons / Creative Commons only. Rendering one WITHOUT the
 * `license` + `artist` credit violates the licence, not just our terms. */
export interface FighterImage {
  url: string;
  width: number | null;
  height: number | null;
  license: string | null;
  license_url: string | null;
  artist: string | null;
  source_page: string | null;
}

/** One record in `Fighter.records`: `pro_mma` is the career MMA record, an
 * org key (`ufc`, `one`, `bkfc`) is the record INSIDE that promotion. */
/** `source` / `source_slug` values (2026-09-26): official publishers by slug,
 * every other publisher as `public-records` or `commission-record`. */
export type PublicSource =
  | 'ufcalendar'
  | 'ufc-stats'
  | 'ufc-official'
  | 'ufc-official-cards'
  | 'wikipedia'
  | 'public-records'
  | 'commission-record'
  | `${string}-official`
  | (string & {});

export interface RecordEntry {
  /** "W-L", "W-L-D" or "W-L-D (n NC)" as published. */
  value: string;
  wins: number | null;
  losses: number | null;
  draws: number | null;
  no_contests: number | null;
  /** Who published it: `ufc-stats`, a promotion's `*-official`, `ufcalendar`,
   * or `public-records` (the complete multi-promotion career record). */
  source: PublicSource;
  /** The `career_stats` scope this came from (`pro-mma`, `ufc-only`, …). */
  scope: string;
}

/** `Fighter.stats`: ONE per-minute panel, always the widest sample UFCalendar
 * holds. Read `basis` before quoting a rate — it names the bouts averaged. */
export interface StatsPanel {
  slpm: string | null;
  str_acc: string | null;
  sapm: string | null;
  str_def: string | null;
  td_avg: string | null;
  td_acc: string | null;
  td_def: string | null;
  sub_avg: string | null;
  /** Numeric twins: rates as numbers, percentages as 0–1 fractions. */
  values: {
    slpm: number | null; str_acc: number | null; sapm: number | null; str_def: number | null;
    td_avg: number | null; td_acc: number | null; td_def: number | null; sub_avg: number | null;
  };
  /** `source` is `ufcalendar` (computed from per-fight totals) or `ufc-stats`. */
  basis: { bouts: number; orgs: string[]; source: PublicSource; scope: string };
}

/** Raw per-source row (`Fighter.career_stats`). Prefer `records` / `stats`. */
export interface CareerStats {
  /** `pro-mma`, `ufc-only`, … */
  scope: string;
  /** Who published this row (see `PublicSource`). */
  source: PublicSource;
  record: string | null;
  slpm: string | null;
  str_acc: string | null;
  sapm: string | null;
  str_def: string | null;
  td_avg: string | null;
  td_acc: string | null;
  td_def: string | null;
  sub_avg: string | null;
}

export type PowerIndexView = 'current' | 'movers' | 'peaks';

export interface PowerIndexFighter {
  id: number;
  slug: string;
  name: string;
  nationality: string | null;
}

/** A `current` / `peaks` board row. */
export interface PowerIndexRow {
  position: number;
  fighter: PowerIndexFighter;
  rating: number;
  peak: number;
  peak_at: string | null;
  last_fought_at: string | null;
  fights_rated: number;
  /** Division slug of the fighter's latest bout; null for a catchweight. */
  division: string | null;
}

/** A `view: 'movers'` row: rating change over the window. */
export interface PowerIndexMover {
  position: number;
  fighter: PowerIndexFighter;
  /** Rating at the end of the window. */
  rating: number;
  start_rating: number;
  delta: number;
  fights_in_window: number;
  division: string | null;
}

export interface PowerIndex {
  rating: number;
  peak: number;
  peak_at: string | null;
  fights_rated: number;
  last_fought_at: string | null;
}

export interface Fighter extends FighterSummary {
  height_inches: number | null;
  weight_lbs: number | null;
  reach_inches: number | null;
  stance: string | null;
  /** YYYY-MM-DD. */
  dob: string | null;
  team: string | null;
  birthplace: string | null;
  /** Career + per-org records by clean key (`pro_mma`, `ufc`, `amateur_mma`, …). */
  records: Record<string, RecordEntry>;
  /** One stats panel with its `basis`, or null when no real panel exists. */
  stats: StatsPanel | null;
  /** Raw per-source rows; `records` / `stats` are built from these. */
  career_stats: CareerStats[];
  power_index: PowerIndex | null;
  images: FighterImage[];
  /** Next booked bout (not completed/cancelled, event not cancelled); `result` is always null. */
  next_fight?: FighterBout | null;
  /** Most recent completed or no-contest bout. */
  last_fight?: FighterBout | null;
  /** Present only with `include: ['bonuses']`. */
  bonuses?: BonusLedger;
  /** Present only with `include: ['credentials']`. */
  credentials?: FighterCredentials;
}

/** A tracked bout from the fighter's side — the `source: "native"` row of `/history`. */
export interface FighterBout {
  source: 'native';
  fight_id: number;
  event_id: number;
  event_title: string;
  event_slug: string;
  org_slug: string;
  /** YYYY-MM-DD (UTC). */
  date: string | null;
  opponent_id: number | null;
  opponent_name: string | null;
  opponent_slug: string | null;
  result: 'win' | 'loss' | 'draw' | 'nc' | null;
  method: string | null;
  round: number | null;
  time: string | null;
  weight_class: string | null;
  is_title: boolean;
  sport: string | null;
}

export type BonusAward = 'fotn' | 'potn' | 'kotn' | 'sotn';

/** UFC post-fight bonus ledger: FOTN credits both corners, the rest the winner. Counts only, no dollars. */
export interface BonusLedger {
  org: 'ufc';
  total: number;
  counts: Record<BonusAward, number>;
  /** Newest first. */
  fights: { fight_id: number; event_slug: string; date: string | null; awards: BonusAward[] }[];
}

export type FighterInclude = 'bonuses' | 'credentials';

/** `confirmed` = an official body or 2+ independent sources; `reported` = one credible outlet. */
export type CredentialConfidence = 'confirmed' | 'reported';

/** One combat-sports credential (belt, medal, title, national team, base style…). */
export interface FighterCredential {
  /** belt-rank · competition-result · professional-title · national-team · base-style · training-started · athletic-education · sports-club · award · sport-rank · record */
  kind: string;
  discipline: string | null;
  competition: string | null;
  placement: string | null;
  rank: string | null;
  year: number | null;
  /** Kind-specific extras (awarded_by, degree, org_name, level, club…). */
  detail: Record<string, unknown> | null;
  note: string | null;
  /** Public reference URLs behind the claim (Wikipedia, the promotion's own
   * pages, official bodies). May be empty: only public references are listed. */
  sources: string[];
  confidence: CredentialConfidence;
}

/** One camp link: gym, coach, training partner or manager. */
export interface FighterAffiliation {
  kind: 'gym' | 'coach' | 'training-partner' | 'manager' | string;
  name: string;
  role: string | null;
  /** current · former */
  status: string | null;
  is_primary: boolean;
  location: string | null;
  gym: string | null;
  discipline: string | null;
  relationship: string | null;
  as_of: string | null;
  period: string | null;
  note: string | null;
  sources: string[];
  confidence: CredentialConfidence;
}

/** `include: ['credentials']` — researched by UFCalendar from public sources; verify before republishing. */
export interface FighterCredentials {
  credentials: FighterCredential[];
  affiliations: FighterAffiliation[];
}

/** One line of `GET /v1/fighters/{id}/history` — native bouts and the wider
 * career record merged into one multi-promotion timeline. */
export interface CareerBout {
  source: 'native' | 'history';
  date: string | null;
  /** One vocabulary across native and history rows (2026-09-24). */
  status: 'win' | 'loss' | 'draw' | 'no_contest' | 'cancelled' | 'upcoming' | 'unknown';
  /** Raw result word as stored; prefer `status`. */
  result: string | null;
  opponent: { id: number | null; slug: string | null; name: string | null } | null;
  opponent_id: number | null;
  opponent_slug: string | null;
  opponent_name: string | null;
  fight_id: number | null;
  event_id: number | null;
  event_slug: string | null;
  event_title: string | null;
  event_name: string | null;
  org_slug: string | null;
  is_title: boolean | null;
  competition_level: string | null;
  /** `ufcalendar` on native rows; else an official publisher's slug or `public-records`. */
  source_slug: PublicSource | null;
  method: string | null;
  method_normalized: MethodNormalized | null;
  round: number | null;
  time: string | null;
  time_seconds: number | null;
  weight_class: string | null;
  sport: string | null;
  [k: string]: unknown;
}

/* ── rankings ────────────────────────────────────────────────────────── */

export interface RankingEntry {
  /** 0 = champion. Ties are real. */
  rank: number;
  is_champion: boolean;
  fighter_id: number | null;
  fighter_slug: string | null;
  name: string;
  /** The same reference shape cards carry (2026-09-24). */
  fighter: { id: number; slug: string | null; name: string } | null;
  nationality?: string | null;
  /** ISO-3166 alpha-2. */
  country_code?: string | null;
  /** Previous rank − current rank (positive = moved up); null when not on the previous board. Absent on /champions. */
  movement?: number | null;
  /** On this division's board but not on the previous snapshot's. Absent on /champions. */
  is_new?: boolean;
}

/** A rank-0 row of an org's latest official board. */
export interface Champion extends RankingEntry {
  org: string;
  division: string;
  snapshot_date: string;
}

export interface RankingDivision {
  division: string;
  entries: RankingEntry[];
}

/** Point-in-time board: valid until superseded. */
export interface RankingsBoard {
  org: string;
  board: string;
  snapshot_date: string;
  divisions: RankingDivision[];
}

/* ── stats (the Record Book) ─────────────────────────────────────────── */

/** What a board ranks: fighters (`career`), performances (`single_fight`,
 *  `round`), weight classes (`division`) or cards (`event`). */
export type StatScope = 'career' | 'single_fight' | 'round' | 'division' | 'event';

/** A board's registry entry (`meta.metric` on `/v1/stats/leaders`). */
export interface StatMetric {
  slug: string;
  scope: StatScope;
  category: 'fights' | 'time' | 'striking' | 'grappling' | 'records';
  /** Ranking order, not a verdict. */
  direction: 'asc' | 'desc';
  unit: 'count' | 'seconds' | 'minutes' | 'rate' | 'per_minute' | 'per_15_minutes';
  has_secondary: boolean;
  /** What `value_secondary` is, e.g. `{ unit: 'count', label: 'attempted' }`. */
  secondary: { unit: string; label: string } | null;
}

/** One row of a stat leaderboard. */
export interface LeaderboardRow {
  /** The rollup's own position. */
  rank: number;
  value: number;
  value_secondary: number | null;
  /** Bouts (or fighters) behind the value. */
  sample_n: number;
  /** Null on event and division boards. */
  fighter: { id: number; slug: string; name: string; nationality: string | null } | null;
  division: string | null;
  round_number: number | null;
  /** Single-fight and round boards: the bout the performance came from. */
  fight: {
    id: number;
    event: { id: number; slug: string; title: string; starts_at: string | null } | null;
    opponent: { id: number; slug: string; name: string } | null;
  } | null;
  /** Event boards: the card the row IS. */
  event: { id: number; slug: string; title: string; starts_at: string | null } | null;
  /** Equal values are a tie: the group's first rank. */
  display_rank: number;
  tied: boolean;
}

/** One category of `GET /v1/stats/record-book`. */
export interface RecordBookSection {
  category: StatMetric['category'];
  boards: Array<{ metric: StatMetric; rows: LeaderboardRow[] }>;
}

/** `GET /v1/orgs/{slug}/divisions/{division}`. */
export interface OrgDivision {
  org: string;
  division: { slug: string; name: string; weight_limit_lbs: number | null };
  /** The official board for this division, or null where none is published. */
  rankings: (Omit<RankingsBoard, 'divisions'> & RankingDivision) | null;
  upcoming: FightSearchRow[];
  recent: FightSearchRow[];
  roster: Array<{
    id: number;
    slug: string;
    name: string;
    nickname: string | null;
    nationality: string | null;
    last_fought_at: string | null;
  }>;
}

/** A fighter reference inside the composite payloads. */
export interface FighterRef {
  id: number;
  slug: string;
  name: string;
}

/* ── compare ─────────────────────────────────────────────────────────── */

/** One completed bout from one fighter's side (`head_to_head`, `common_opponents`). */
export interface CompareBout {
  fight_id: number;
  event: { id: number; slug: string; title: string; starts_at: string | null };
  weight_class: string | null;
  is_title: boolean;
  is_main: boolean;
  opponent: { id: number; name: string | null; slug: string | null } | null;
  outcome: 'win' | 'loss' | 'draw' | 'nc';
  winner_fighter_id: number | null;
  method: string | null;
  round: number | null;
  time: string | null;
}

/** Per-fight averages over every completed bout with per-fight totals. */
export interface CompareAggregates {
  fights_analyzed: number;
  avg_sig_strikes: number | null;
  avg_takedowns: number | null;
  avg_control_time_sec: number | null;
  max_sig_strikes: number | null;
  max_takedowns: number | null;
  /** Whole percents; null when nothing was logged. */
  location_pct: { head: number; body: number; leg: number } | null;
  position_pct: { distance: number; clinch: number; ground: number } | null;
}

/** `GET /v1/compare?a=&b=`. */
export interface Compare {
  a: Omit<Fighter, 'records' | 'stats' | 'career_stats' | 'power_index' | 'images' | 'next_fight' | 'last_fight' | 'bonuses' | 'credentials'> & { age: number | null };
  b: Omit<Fighter, 'records' | 'stats' | 'career_stats' | 'power_index' | 'images' | 'next_fight' | 'last_fight' | 'bonuses' | 'credentials'> & { age: number | null };
  career_stats: { a: CareerStats[]; b: CareerStats[] };
  aggregates: { a: CompareAggregates; b: CompareAggregates };
  /** The last five settled entries of each merged timeline. */
  recent_form: { a: CareerBout[]; b: CareerBout[] };
  win_streak: { a: number; b: number };
  /** Previous meetings, from `a`'s side. */
  head_to_head: CompareBout[];
  common_opponents: Array<{ opponent: { id: number; name: string; slug: string | null }; a_fight: CompareBout; b_fight: CompareBout }>;
  booked_bout: {
    fight_id: number;
    event: EventRef;
    weight_class: string | null;
    is_title: boolean;
    fighter_a_id: number;
    fighter_b_id: number;
  } | null;
  /** UFCalendar model output for the booked bout, oriented to `a` (UFC only). Not betting advice. */
  prediction: { win_probability_a: number; win_probability_b: number; model_version: string; generated_at: string | null } | null;
  power_index: { a: PowerIndex | null; b: PowerIndex | null; win_probability_a: number | null };
}

/* ── event storylines ────────────────────────────────────────────────── */

export type StorylineTag =
  | { kind: 'title' }
  | { kind: 'eliminator' }
  | { kind: 'coin_flip' }
  | { kind: 'both_streaking'; a: number; b: number }
  | { kind: 'finishers'; pct: number }
  | { kind: 'trilogy_decider'; wins: number }
  | { kind: 'rematch'; a_wins: number; b_wins: number };

export type ProbabilitySource = 'model' | 'power_index';

/** A corner on the storylines card: rank on the event date (0 = champion)
 * and a signed streak (negative = consecutive losses). */
export interface StorylineCorner extends FighterRef {
  rank: number | null;
  streak: number;
}

/** `GET /v1/events/{idOrSlug}/storylines`. */
export interface EventStorylines {
  event: { id: number; slug: string; title: string; org: string; starts_at: string | null; status: string };
  summary: {
    title_fights: number;
    ranked_fighters: number;
    champions: number;
    closest_bout: { fight_id: number; win_probability_a: number; probability_source: ProbabilitySource } | null;
  };
  fights: Array<{
    fight_id: number;
    ordering: number | null;
    card_section: string | null;
    weight_class: string | null;
    is_title: boolean;
    is_main: boolean;
    fighter_a: StorylineCorner;
    fighter_b: StorylineCorner;
    win_probability_a: number | null;
    probability_source: ProbabilitySource | null;
    tags: StorylineTag[];
  }>;
  card: {
    avg_age: number | null;
    tallest: { fighter: FighterRef; height_inches: number } | null;
    longest_reach: { fighter: FighterRef; reach_inches: number } | null;
    nations: Array<{ country: string; count: number }>;
    streak_leaders: Array<{ fighter: FighterRef; streak: number }>;
    debuts: FighterRef[];
    returns: Array<{ fighter: FighterRef; months: number }>;
    fastest_finish: { fighter: FighterRef; time: string } | null;
  };
}

/* ── matchmaker ──────────────────────────────────────────────────────── */

/** One corner of a matchmaker slip. */
export interface MatchmakerCorner {
  id: number;
  slug: string;
  name: string;
  nationality: string | null;
  /** Official rank: 0 = champion, null = unranked. */
  rank: number | null;
  power_index: number | null;
  /** Signed run of results: +3 = three straight wins, -2 = two losses. */
  streak: number;
  /** Already booked against someone else on an upcoming card. */
  booked: boolean;
}

/** Why a pairing scored — `kind` plus the numbers some kinds carry. */
export type MatchmakerTag =
  | { kind: 'title' | 'eliminator' | 'coinFlip' | 'unfinishedBusiness' | 'booked' | 'unrankedGem' | 'bounceBack' | 'steppingUp' | 'bothDue' | 'styleClash' }
  | { kind: 'bothStreaking'; a: number; b: number }
  | { kind: 'finishers'; pct: number }
  | { kind: 'trilogyDecider'; wins: number }
  | { kind: 'rematch'; aWins: number; bWins: number };

/** A row of `GET /v1/matchmaker/{org}`. */
export interface Matchup {
  /** `lo-hi` fighter ids. */
  key: string;
  division: string;
  /** Red corner — the better-credentialed side. */
  a: MatchmakerCorner;
  b: MatchmakerCorner;
  /** 0–100. */
  score: number;
  /** Power Index win probability of corner a. */
  win_probability_a: number;
  tags: MatchmakerTag[];
}

/** `GET /v1/matchmaker/next/{fighter}`. */
export interface WhosNext {
  subject: MatchmakerCorner & { days_since_last: number | null };
  org: string;
  division: string;
  suggestions: Array<{
    opponent: MatchmakerCorner;
    win_probability_subject: number;
    score: number;
    tags: MatchmakerTag[];
  }>;
  /** The bout already booked, or null. */
  booked_next: {
    opponent: { id: number; slug: string; name: string } | null;
    event: { id: number; slug: string; title: string; org: string; starts_at: string | null };
  } | null;
  rankings_date: string | null;
}

/* ── year in review ──────────────────────────────────────────────────── */

type YearFighter = { id: number; name: string; slug: string | null };
type YearEvent = { slug: string; title: string; starts_at: string | null };

/** `GET /v1/stats/years/{year}`. */
export interface YearStats {
  year: number;
  /** The promotions counted. */
  orgs_scope: string[];
  events_completed: number;
  title_fights: number;
  methods: { ko: number; sub: number; dec: number; other: number; total: number };
  divisions: Array<{ weight_class: string; fights: number; ko: number; sub: number }>;
  fastest_finishes: Array<{
    fight_id: number; seconds: number; time: string; method: string | null;
    event: YearEvent; winner: YearFighter; loser: YearFighter;
  }>;
  upsets: Array<{ fight_id: number; win_probability: number; winner: YearFighter | null; opponent: YearFighter | null; event: YearEvent }>;
  climbers: Array<{ fighter: YearFighter | null; fights: number; gain: number }>;
  busiest: Array<{ fighter: YearFighter | null; fights: number; wins: number }>;
  orgs: Array<{ slug: string; name: string; events: number; fights: number }>;
  countries: Array<{ country: string; events: number }>;
  judges: Array<{ judge_id: number; name: string; fights: number }>;
}

/* ── plans (the one open endpoint) ───────────────────────────────────── */

export interface Plan {
  key: string;
  name: string;
  price_monthly_usd: number | null;
  price_yearly_usd: number | null;
  requests_per_month: number;
  rpm: number;
  key_limit: number;
  features: string[];
  checkout_url: string;
}

export interface Plans {
  currency: string;
  plans: Plan[];
  trial: {
    hours: number;
    requests: number;
    card_required: boolean;
    per_account: number;
    start_url: string;
  };
  enterprise: { contact: string };
  mcp: {
    url: string;
    transport: string;
    auth: string[];
    oauth_metadata: string;
    protected_resource_metadata: string;
  };
  links: Record<string, string>;
}

/* ── misc ────────────────────────────────────────────────────────────── */

export interface BroadcastRight {
  country: string;
  provider: string;
  kind: string | null;
  url: string | null;
  note_key?: string | null;
  /** `null` = the org-wide deal; `dwcs` / `rtufc` = that UFC sub-series only. */
  series?: RightsSeries | null;
  [k: string]: unknown;
}

/** UFC sub-series with their own rights grid (`series=` on `broadcastRights`). */
export type RightsSeries = 'dwcs' | 'rtufc';

/** One provider in a country on `GET /v1/events/{idOrSlug}/watch`. */
export interface WatchProvider {
  provider: string;
  kind: string;
  url: string | null;
  note_key: string | null;
  /** True when the event's own listing names this provider. */
  event_confirmed: boolean;
  rank: number;
}

/** `GET /v1/events/{idOrSlug}/watch`: who airs one event, per country. */
export interface EventWatch {
  event: {
    id: number;
    slug: string;
    title: string;
    org: string;
    starts_at: string | null;
    main_card_at: string | null;
    prelims_at: string | null;
    early_prelims_at: string | null;
    tz: string | null;
    status: string;
    is_ppv: boolean;
  };
  /** The sub-series whose grid applies, or null for an ordinary card. */
  series: RightsSeries | null;
  /** `WORLD` first, then ISO order. */
  countries: Array<{ country: string; providers: WatchProvider[] }>;
}

/** A judge whose card disagrees with the official result. */
export interface DissentingJudge {
  judge_id: number | null;
  judge_name: string | null;
  total_a: number | null;
  total_b: number | null;
  winner_fighter_id: number | null;
  is_draw: boolean;
  scores_known: boolean;
}

/** One row of `GET /v1/scorecards/splits`. */
export interface SplitDecisionRow extends Fight {
  event: EventRef;
  decision_type: string | null;
  /** Null on a draw. */
  official_winner_fighter_id: number | null;
  cards: Scorecard[];
  dissenting_judges: DissentingJudge[];
}

export interface WebhookEndpoint {
  id: number;
  url: string;
  events: string[];
  /** Returned ONCE, on create and on rotate. */
  secret?: string;
  disabled?: boolean;
  created_at?: string | null;
  [k: string]: unknown;
}

export interface Usage {
  tier: string;
  /** "YYYYMM" (legacy) and "YYYY-MM". */
  month: string;
  period: string;
  requests_used: number;
  requests_limit: number;
  rpm_limit: number;
  /** Epoch seconds (legacy) and ISO-8601. */
  reset: number;
  reset_at: string;
  [k: string]: unknown;
}

/** One bout of `GET /v1/events/{id}/pickem`. */
export interface PickemSplit {
  fight_id: number;
  fighter_a: { id: number; slug: string; name: string } | null;
  fighter_b: { id: number; slug: string; name: string } | null;
  picks_a: number;
  picks_b: number;
  total: number;
  /** Percentage (0–100, one decimal) of picks on corner a; null when nobody picked. */
  pct_a: number | null;
}

/** `GET /v1/events/{id}/pickem` — UFCalendar community pick'em: crowd sentiment, not a market and not a forecast. */
export interface EventPickem {
  event: { id: number; slug: string; title: string; org: string; starts_at: string | null; status: string };
  /** Card order, non-cancelled bouts. */
  fights: PickemSplit[];
}

/** The 13 site languages an article is served in. */
export type ArticleLocale = 'en' | 'es' | 'pt' | 'de' | 'fr' | 'tr' | 'ru' | 'ka' | 'ja' | 'ko' | 'pl' | 'sr' | 'zh';

/** One row of `GET /v1/articles`. */
export interface ArticleSummary {
  slug: string;
  /** The canonical page on www.ufcalendar.com in the requested language. */
  url: string;
  title: string;
  description: string;
  author_name: string;
  tags: string[];
  published_at: string | null;
  /** The language actually served (English when no translation exists). */
  locale: ArticleLocale;
}

/** `GET /v1/articles/{slug}`. */
export interface Article {
  slug: string;
  url: string;
  title: string;
  description: string;
  author_name: string;
  author_slug: string | null;
  tags: string[];
  published_at: string | null;
  /** Markdown, with the site's client-only widgets removed. */
  body_md: string;
  /** Requested language. */
  locale: ArticleLocale;
  /** Delivered language: the translation when one exists, English otherwise. */
  served_locale: ArticleLocale;
}
