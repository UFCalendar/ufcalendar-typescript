/**
 * Thin, dependency-free client for https://api.ufcalendar.com/v1.
 *
 * Every method returns the parsed `data` value of the JSON envelope
 * (`{"data": ..., "meta": ...}`); list endpoints are async generators that
 * follow cursor pagination for you. Errors throw `FightAPIError` carrying
 * the API's `code`, `message` and `requestId` — quote the request id when
 * you write to api@ufcalendar.com.
 *
 * Mirrors sdk/python/ufcalendar/client.py one method per endpoint, in
 * camelCase. The two clients are kept in lockstep by
 * `apps/api/src/surfaces.test.ts`.
 *
 * Odds are the UFCalendar consensus line: one anonymised line per corner
 * across the sportsbooks we track (`sources` = how many books backed each
 * point; book identities are never exposed). Information only, not betting
 * advice. Fighter `images` are Wikimedia
 * Commons / Creative Commons files — the `license` and `artist` fields you
 * receive must be displayed as a credit.
 */
import { VERSION } from './version';
import type {
  Article,
  ArticleLocale,
  ArticleSummary,
  EventPickem,
  EventOdds,
  FightInclude,
  FightOdds,
  OddsHistoryPoint,
  Compare,
  Matchup,
  WhosNext,
  EventStorylines,
  YearStats,
  EventWatch,
  OrgDivision,
  LeaderboardRow,
  RecordBookSection,
  StatScope,
  RightsSeries,
  SplitDecisionRow,
  ChangeFeedEntry,
  ChangeKind,
  FightSearchMethod,
  FightSearchRow,
  BroadcastRight,
  CareerBout,
  CareerStats,
  Champion,
  EventInclude,
  EventListInclude,
  JudgeScorecardRow,
  PowerIndexMover,
  PowerIndexRow,
  PowerIndexView,
  Envelope,
  EventChange,
  EventDetail,
  EventSummary,
  Fight,
  Fighter,
  FighterInclude,
  FighterSummary,
  Judge,
  Meta,
  Org,
  Plans,
  PowerIndex,
  RankingsBoard,
  RateLimit,
  Scorecards,
  Usage,
  Venue,
  WebhookEndpoint,
} from './types';

export const DEFAULT_BASE_URL = 'https://api.ufcalendar.com/v1';
const DEFAULT_TIMEOUT_MS = 30_000;

export interface FightAPIOptions {
  /** `ufcalendar_…` key from https://www.ufcalendar.com/account/api. Falls back
   * to `UFCALENDAR_API_KEY` / `UFCAL_API_KEY` in the environment. Only
   * `plans()` works without one. */
  apiKey?: string;
  /** Override for testing; defaults to the production `/v1`. */
  baseUrl?: string;
  /** Inject a fetch (a test double, an instrumented fetch, undici). */
  fetch?: typeof fetch;
  /** Per-request timeout. Default 30s. */
  timeoutMs?: number;
  /** Extra headers on every request. */
  headers?: Record<string, string>;
}

/** An error response from the Fight API. */
export class FightAPIError extends Error {
  readonly status: number;
  readonly code: string;
  readonly requestId: string | null;

  constructor(status: number, code: string, message: string, requestId: string | null = null) {
    super(`${status} ${code}: ${message}${requestId ? ` (request_id=${requestId})` : ''}`);
    this.name = 'FightAPIError';
    this.status = status;
    this.code = code;
    this.requestId = requestId;
  }
}

export type QueryValue = string | number | boolean | null | undefined;
export type Query = Record<string, QueryValue>;

interface PageOptions {
  /** Stop after this many rows (across pages). */
  limit?: number;
}

/**
 * A browser forbids setting User-Agent on fetch, so we only set ours
 * off-browser. The test is `document`, NOT `navigator`: Node 21+ ships a
 * global `navigator`, so a navigator check would silently drop the header
 * on every modern Node runtime — which is the one place it works.
 */
function canSetUserAgent(): boolean {
  return typeof document === 'undefined' && typeof window === 'undefined';
}

function envKey(): string | undefined {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
  return env?.UFCALENDAR_API_KEY || env?.UFCAL_API_KEY;
}

export class FightAPI {
  readonly baseUrl: string;
  readonly apiKey: string | undefined;

  /** `meta` of the most recent response (pagination cursor, generated_at …). */
  lastMeta: Meta | null = null;
  /** `X-RateLimit-*` of the most recent response. */
  lastRateLimit: RateLimit = { limit: null, remaining: null, reset: null };

  readonly #fetch: typeof fetch;
  readonly #timeoutMs: number;
  readonly #headers: Record<string, string>;

  constructor(apiKeyOrOptions?: string | FightAPIOptions, options: FightAPIOptions = {}) {
    const opts: FightAPIOptions =
      typeof apiKeyOrOptions === 'string'
        ? { ...options, apiKey: apiKeyOrOptions }
        : { ...options, ...(apiKeyOrOptions ?? {}) };
    this.apiKey = opts.apiKey ?? envKey();
    this.baseUrl = (opts.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.#fetch = opts.fetch ?? globalThis.fetch;
    this.#timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.#headers = opts.headers ?? {};
    if (!this.#fetch) {
      throw new Error('No global fetch available. Use Node 18+ or pass { fetch }.');
    }
  }

  /* ---------------------------------------------------------------- core */

  #url(path: string, params?: Query): string {
    const url = new URL(`${this.baseUrl}/${path.replace(/^\/+/, '')}`);
    for (const [k, v] of Object.entries(params ?? {})) {
      if (v === undefined || v === null) continue;
      url.searchParams.set(k, String(v));
    }
    return url.toString();
  }

  async #request<T>(
    method: string,
    path: string,
    { params, body, open = false }: { params?: Query; body?: unknown; open?: boolean } = {},
  ): Promise<Envelope<T>> {
    if (!this.apiKey && !open) {
      throw new FightAPIError(
        401,
        'no_api_key',
        'No API key. Pass new FightAPI("ufcalendar_...") or set UFCALENDAR_API_KEY. ' +
          'Keys (and the free 1-day trial) live at https://www.ufcalendar.com/account/api',
      );
    }
    const headers: Record<string, string> = { Accept: 'application/json', ...this.#headers };
    if (this.apiKey) headers.Authorization = `Bearer ${this.apiKey}`;
    if (canSetUserAgent()) headers['User-Agent'] = `ufcalendar-typescript/${VERSION}`;
    if (body !== undefined) headers['Content-Type'] = 'application/json';

    let res: Response;
    try {
      res = await this.#fetch(this.#url(path, params), {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(this.#timeoutMs),
      });
    } catch (e) {
      const err = e as { name?: string; message?: string };
      if (err?.name === 'TimeoutError') {
        throw new FightAPIError(0, 'timeout', `Request to ${path} timed out after ${this.#timeoutMs}ms`);
      }
      throw new FightAPIError(0, 'network_error', err?.message ?? String(e));
    }

    this.lastRateLimit = {
      limit: res.headers.get('X-RateLimit-Limit'),
      remaining: res.headers.get('X-RateLimit-Remaining'),
      reset: res.headers.get('X-RateLimit-Reset'),
    };

    if (res.status === 204) {
      this.lastMeta = null;
      return { data: undefined as T };
    }

    const text = await res.text();
    let parsed: unknown = undefined;
    try {
      parsed = text ? JSON.parse(text) : undefined;
    } catch {
      parsed = undefined;
    }

    if (!res.ok) {
      const err = (parsed as { error?: { code?: string; message?: string; request_id?: string } } | undefined)?.error;
      if (err) {
        throw new FightAPIError(
          res.status,
          String(err.code ?? 'error'),
          String(err.message ?? text.slice(0, 200)),
          err.request_id ?? res.headers.get('x-request-id'),
        );
      }
      throw new FightAPIError(res.status, 'http_error', text.slice(0, 200), res.headers.get('x-request-id'));
    }

    const env = (parsed ?? {}) as Envelope<T>;
    this.lastMeta = env.meta ?? null;
    return env;
  }

  /** Raw GET returning the `data` value. Escape hatch for new endpoints. */
  async get<T = unknown>(path: string, params?: Query): Promise<T> {
    return (await this.#request<T>('GET', path, { params })).data;
  }

  /** Raw GET returning the whole `{data, meta}` envelope. */
  async getWithMeta<T = unknown>(path: string, params?: Query): Promise<Envelope<T>> {
    return this.#request<T>('GET', path, { params });
  }

  async *#paginate<T>(path: string, params: Query, opts: PageOptions = {}): AsyncGenerator<T, void, void> {
    // Never fetch a bigger page than the caller wants rows: `limit: 3` used
    // to pull 100 rows and throw 97 away, burning the caller's quota on a
    // request they did not ask for (and, on a trial key, a noticeable slice
    // of the 100 they get).
    const pageSize = Math.min(100, opts.limit ?? 100);
    const query: Query = { limit: pageSize, ...params };
    let seen = 0;
    for (;;) {
      const env = await this.#request<T[]>('GET', path, { params: query });
      for (const row of env.data ?? []) {
        yield row;
        seen += 1;
        if (opts.limit !== undefined && seen >= opts.limit) return;
      }
      const cursor = env.meta?.pagination?.next_cursor;
      if (!cursor) return;
      query.cursor = cursor;
    }
  }

  /* --------------------------------------------------------------- plans */

  /**
   * Plans, quotas, the free 1-day trial rule, the MCP endpoint and the doc
   * links. The only endpoint that answers without a credential.
   */
  async plans(): Promise<Plans> {
    return (await this.#request<Plans>('GET', 'plans', { open: true })).data;
  }

  /* ---------------------------------------------------------------- orgs */

  /** Launch orgs with capability flags (stats / rounds / rankings / broadcasts / predictions / scorecards / odds). */
  orgs(): Promise<Org[]> {
    return this.get<Org[]>('orgs');
  }

  org(slug: string): Promise<Org> {
    return this.get<Org>(`orgs/${encodeURIComponent(slug)}`);
  }

  /**
   * One weight class in one promotion: its rankings board (null where the
   * promotion publishes none), upcoming bouts at that weight, the latest
   * results and the roster by recency. `division` is a slug, e.g.
   * `lightweight` or `womens-strawweight`.
   */
  orgDivision(org: string, division: string): Promise<OrgDivision> {
    return this.get<OrgDivision>(`orgs/${encodeURIComponent(org)}/divisions/${encodeURIComponent(division)}`);
  }

  /* -------------------------------------------------------------- events */

  /**
   * Schedule + results. Bare call = the upcoming calendar, soonest first.
   * `status: 'completed'` (or `order: 'desc'`) browses the archive
   * newest-first; `status: 'upcoming'` = every card not yet over (announced,
   * scheduled or live). `from` / `to` are `YYYY-MM-DD`.
   */
  events(
    opts: {
      org?: string;
      status?: string;
      from?: string;
      to?: string;
      order?: 'asc' | 'desc';
      /** Only cards with (true) / without (false) a title bout. */
      isTitleCard?: boolean;
      /** Only PPV (true) / non-PPV (false) cards. */
      isPpv?: boolean;
      /** `headline` adds each card's main event. */
      include?: EventListInclude[];
      limit?: number;
    } = {},
  ): AsyncGenerator<EventSummary, void, void> {
    const { limit, isTitleCard, isPpv, include, ...params } = opts;
    return this.#paginate<EventSummary>('events', {
      ...params,
      is_title_card: isTitleCard,
      is_ppv: isPpv,
      include: include?.length ? include.join(',') : undefined,
    } as Query, { limit });
  }

  /**
   * One event with its full fight card, venue and broadcasts.
   * `include: ['eta']` adds an estimated start time to every bout;
   * `include: ['odds']` adds each bout's current consensus line (the closing line once settled) (null when
   * unpriced). Pass both as `['eta', 'odds']`.
   */
  event(idOrSlug: string | number, opts: { include?: EventInclude[] } = {}): Promise<EventDetail> {
    return this.get<EventDetail>(
      `events/${encodeURIComponent(String(idOrSlug))}`,
      opts.include?.length ? { include: opts.include.join(',') } : undefined,
    );
  }

  /**
   * Who airs one event, per country: the promotion's rights deals for the
   * event's series merged with the event's own listings. `country` (ISO-2)
   * narrows to that market plus worldwide.
   */
  eventWatch(idOrSlug: string | number, opts: { country?: string } = {}): Promise<EventWatch> {
    return this.get<EventWatch>(`events/${encodeURIComponent(String(idOrSlug))}/watch`, opts as Query);
  }

  /**
   * The talking points of one card as of its start: title fights and
   * eliminators, the closest bout (UFCalendar model, else Power Index — not
   * betting advice), rematches and trilogy deciders, streaks, debuts and
   * returns, ranked fighters, nations, tallest / longest reach, the fastest
   * career finish.
   */
  eventStorylines(idOrSlug: string | number): Promise<EventStorylines> {
    return this.get<EventStorylines>(`events/${encodeURIComponent(String(idOrSlug))}/storylines`);
  }

  /**
   * How the UFCalendar community is picking each bout on one card: picks per
   * corner, the total and `pct_a`, in card order. Crowd sentiment from our
   * own pick'em game, not a market and not a forecast.
   */
  eventPickem(idOrSlug: string | number): Promise<EventPickem> {
    return this.get<EventPickem>(`events/${encodeURIComponent(String(idOrSlug))}/pickem`);
  }

  /**
   * The UFCalendar consensus odds for every non-cancelled bout on one card, in
   * card order: `consensus`, `opening`, `closing` (settled bouts), `movement`
   * and `points`. Unpriced bouts stay on the list with nulls and `points: 0`;
   * `lastMeta.priced` / `lastMeta.unpriced` count both. Information only, not
   * betting advice.
   */
  eventOdds(idOrSlug: string | number): Promise<EventOdds> {
    return this.get<EventOdds>(`events/${encodeURIComponent(String(idOrSlug))}/odds`);
  }

  /** Card-change diff log (fight added/removed, opponent swapped, date moved, profile merged). */
  eventChanges(idOrSlug: string | number): Promise<EventChange[]> {
    return this.get<EventChange[]>(`events/${encodeURIComponent(String(idOrSlug))}/changes`);
  }

  /**
   * The card-change feed across every event, newest first (default: the last
   * 90 days) — the `card.changed` webhook's audit trail, for callers that
   * poll. `since` is `YYYY-MM-DD` or an ISO-8601 datetime.
   */
  changes(
    opts: { org?: string; since?: string; kind?: ChangeKind; limit?: number } = {},
  ): AsyncGenerator<ChangeFeedEntry, void, void> {
    const { limit, ...params } = opts;
    return this.#paginate<ChangeFeedEntry>('changes', params as Query, { limit });
  }

  /* -------------------------------------------------------------- fights */

  /** One bout with its result. `include: ['odds']` adds the current consensus line (the closing line once the bout is settled). */
  fight(fightId: number | string, opts: { include?: FightInclude[] } = {}): Promise<Fight> {
    return this.get<Fight>(
      `fights/${encodeURIComponent(String(fightId))}`,
      opts.include?.length ? { include: opts.include.join(',') } : undefined,
    );
  }

  /**
   * The UFCalendar consensus line for one bout: `consensus` (latest point; the closing line once settled),
   * `opening`, `closing` (the last point at or before the event start,
   * settled bouts only), `movement` (opening → consensus in implied-probability
   * points on corner a) and `sources` on every point (how many sportsbooks
   * backed it; book identities are never exposed). An unpriced bout resolves
   * with null blocks and `points: 0`. Information only, not betting advice.
   */
  fightOdds(fightId: number | string): Promise<FightOdds> {
    return this.get<FightOdds>(`fights/${encodeURIComponent(String(fightId))}/odds`);
  }

  /**
   * Every consensus point for one bout, oldest first (Pro plans and up; a
   * lower plan throws `FightAPIError` 403 `tier_required`). A point is stored
   * only when the consensus moves. `from` / `to` are inclusive `YYYY-MM-DD`.
   */
  fightOddsHistory(
    fightId: number | string,
    opts: { from?: string; to?: string; limit?: number } = {},
  ): AsyncGenerator<OddsHistoryPoint, void, void> {
    const { limit, ...params } = opts;
    return this.#paginate<OddsHistoryPoint>(
      `fights/${encodeURIComponent(String(fightId))}/odds/history`,
      params as Query,
      { limit },
    );
  }

  /** Per-fight totals for both corners. */
  fightStats(fightId: number | string): Promise<Record<string, unknown>[]> {
    return this.get<Record<string, unknown>[]>(`fights/${encodeURIComponent(String(fightId))}/stats`);
  }

  /** Round-by-round stat lines for both corners. */
  fightRounds(fightId: number | string): Promise<Record<string, unknown>[]> {
    return this.get<Record<string, unknown>[]>(`fights/${encodeURIComponent(String(fightId))}/rounds`);
  }

  /**
   * The judges' scorecards for a bout — the official commission record:
   * decision type, point deductions, and one card per judge with every
   * round, the totals and `winner_fighter_id`. Scores are oriented to
   * `fighter_a_id` / `fighter_b_id`, both repeated on the payload.
   *
   * Check `scores_known` on a card before charting totals: when it is false
   * the commission published only the outcome. Throws 404 for a bout that
   * did not go to the judges.
   */
  fightScorecards(fightId: number | string): Promise<Scorecards> {
    return this.get<Scorecards>(`fights/${encodeURIComponent(String(fightId))}/scorecards`);
  }

  /**
   * Completed bouts, filtered — newest first unless `order: 'oldest'`. At
   * least one narrowing filter is required (`titleOnly`, `method`,
   * `division`, `fighter`, `winner`, `from`, `to`, `mainEventsOnly`); the
   * server serves 25 rows a page and at most 10 pages.
   */
  findFights(
    opts: {
      org?: string;
      titleOnly?: boolean;
      method?: FightSearchMethod;
      /** Division slug (`lightweight`) or a name fragment. */
      division?: string;
      /** Fighter slug or id — bouts they were in. */
      fighter?: string | number;
      /** Fighter slug or id — bouts they won. */
      winner?: string | number;
      from?: string;
      to?: string;
      mainEventsOnly?: boolean;
      order?: 'newest' | 'oldest';
      limit?: number;
    } = {},
  ): AsyncGenerator<FightSearchRow, void, void> {
    const { limit, titleOnly, mainEventsOnly, fighter, winner, ...rest } = opts;
    return this.#paginate<FightSearchRow>('fights/search', {
      ...rest,
      title_only: titleOnly,
      main_events_only: mainEventsOnly,
      fighter: fighter === undefined ? undefined : String(fighter),
      winner: winner === undefined ? undefined : String(winner),
    } as Query, { limit });
  }

  /* -------------------------------------------------------------- judges */

  /**
   * Every official who has scored a launch-org bout, busiest first. Rates
   * mean little below ~10 fights; pass `minFights: 10`.
   */
  judges(
    opts: { q?: string; org?: string; minFights?: number; limit?: number } = {},
  ): AsyncGenerator<Judge, void, void> {
    const { limit, minFights, ...rest } = opts;
    return this.#paginate<Judge>('judges', { ...rest, min_fights: minFights } as Query, { limit });
  }

  judge(judgeId: number | string): Promise<Judge> {
    return this.get<Judge>(`judges/${encodeURIComponent(String(judgeId))}`);
  }

  /**
   * Split and majority decisions, newest first, with every judge's card and
   * the dissenting judges named. Commission records only.
   */
  splitDecisions(
    opts: { org?: string; from?: string; to?: string; limit?: number } = {},
  ): AsyncGenerator<SplitDecisionRow, void, void> {
    const { limit, ...params } = opts;
    return this.#paginate<SplitDecisionRow>('scorecards/splits', params as Query, { limit });
  }

  /**
   * Every card this judge has turned in, newest first, with `lone_dissent`,
   * `split` and the `colleagues`' totals on each row.
   */
  judgeScorecards(
    judgeId: number | string,
    opts: { limit?: number } = {},
  ): AsyncGenerator<JudgeScorecardRow, void, void> {
    return this.#paginate<JudgeScorecardRow>(
      `judges/${encodeURIComponent(String(judgeId))}/scorecards`,
      {},
      opts,
    );
  }

  /* ------------------------------------------------------------ fighters */

  fighters(
    opts: { q?: string; org?: string; country?: string; limit?: number } = {},
  ): AsyncGenerator<FighterSummary, void, void> {
    const { limit, ...params } = opts;
    return this.#paginate<FighterSummary>('fighters', params as Query, { limit });
  }

  /**
   * Bio, records, career stats, Power Index, CC-licensed images, `next_fight`
   * and `last_fight`. `include: ['bonuses']` adds the UFC bonus ledger;
   * `include: ['credentials']` adds grappling and wrestling pedigree, gyms and
   * coaches (every row with `sources` and a `confidence` grade).
   */
  fighter(idOrSlug: string | number, opts: { include?: FighterInclude[] } = {}): Promise<Fighter> {
    return this.get<Fighter>(
      `fighters/${encodeURIComponent(String(idOrSlug))}`,
      opts.include?.length ? { include: opts.include.join(',') } : undefined,
    );
  }

  /** Complete multi-promotion career timeline. */
  fighterHistory(idOrSlug: string | number): Promise<CareerBout[]> {
    return this.get<CareerBout[]>(`fighters/${encodeURIComponent(String(idOrSlug))}/history`);
  }

  /** Raw career stat rows, one source-stamped row per scope (`pro-mma`, `ufc-only` …).
   *  For the readable split use `fighter().records` / `fighter().stats`. */
  fighterStats(idOrSlug: string | number): Promise<CareerStats[]> {
    return this.get<CareerStats[]>(`fighters/${encodeURIComponent(String(idOrSlug))}/stats`);
  }

  /** Every ranking row the fighter ever held, newest first, across every board
   *  (`board` is `official` / `meta`; `is_champion` when rank 0). The endpoint is
   *  cursor-paginated since 2026-09-24 — this walks every page so the array is
   *  complete (a long career is 900+ rows). */
  async fighterRankings(idOrSlug: string | number): Promise<Record<string, unknown>[]> {
    const out: Record<string, unknown>[] = [];
    for await (const row of this.#paginate<Record<string, unknown>>(
      `fighters/${encodeURIComponent(String(idOrSlug))}/rankings`, { limit: 500 } as Query)) out.push(row);
    return out;
  }

  fighterPowerIndex(idOrSlug: string | number): Promise<PowerIndex & Record<string, unknown>> {
    return this.get<PowerIndex & Record<string, unknown>>(
      `fighters/${encodeURIComponent(String(idOrSlug))}/power-index`,
    );
  }

  /**
   * Two fighters side by side (slugs or ids): bios with age, career stats,
   * strike mix, win streaks, previous meetings, common opponents, the booked
   * bout between them, the UFCalendar model prediction for it (UFC; not
   * betting advice) and Power Index ratings.
   */
  compare(a: string | number, b: string | number): Promise<Compare> {
    return this.get<Compare>('compare', { a: String(a), b: String(b) });
  }

  /* ------------------------------------------------------------ rankings */

  /**
   * Official board, point-in-time. `date: 'YYYY-MM-DD'` returns the board
   * that was valid on that day (UFC history back to 2013; rank 0 = champion).
   */
  rankings(org = 'ufc', opts: { date?: string; board?: string } = {}): Promise<RankingsBoard> {
    return this.get<RankingsBoard>(`rankings/${encodeURIComponent(org)}`, opts as Query);
  }

  divisionRankings(org: string, division: string, opts: { date?: string } = {}): Promise<RankingsBoard> {
    return this.get<RankingsBoard>(
      `rankings/${encodeURIComponent(org)}/${encodeURIComponent(division)}`,
      opts as Query,
    );
  }

  /** Current champions across every launch org, or one `org` / `division`. */
  champions(opts: { org?: string; division?: string } = {}): Promise<Champion[]> {
    return this.get<Champion[]>('champions', opts);
  }

  /**
   * UFCalendar Power Index board. `view: 'movers'` = biggest risers over
   * `days` (default 365), `view: 'peaks'` = all-time peak ratings;
   * `division` narrows any view.
   */
  powerIndex(
    org = 'ufc',
    opts: { view?: PowerIndexView; division?: string; days?: number; limit?: number } = {},
  ): Promise<(PowerIndexRow | PowerIndexMover)[]> {
    return this.get<(PowerIndexRow | PowerIndexMover)[]>(`power-index/${encodeURIComponent(org)}`, {
      view: opts.view,
      division: opts.division,
      days: opts.days,
      limit: opts.limit,
    });
  }

  /* ---------------------------------------------------------- matchmaker */

  /**
   * UFCalendar's matchmaker: the fights worth making in one MMA promotion,
   * scored 0–100, across the roster or for one `division` (`lastMeta.divisions`
   * lists the valid ones). Not a list of bookings; computed without the
   * site's Fight DNA factor.
   */
  matchmaker(org = 'ufc', opts: { division?: string; limit?: number } = {}): Promise<Matchup[]> {
    return this.get<Matchup[]>(`matchmaker/${encodeURIComponent(org)}`, {
      division: opts.division,
      limit: opts.limit,
    });
  }

  /**
   * Who one fighter (slug or id) should fight next: the best-scored
   * opponents with the Power Index win probability for each, plus the bout
   * already booked (`booked_next`).
   */
  whosNext(fighter: string | number, opts: { limit?: number } = {}): Promise<WhosNext> {
    return this.get<WhosNext>(`matchmaker/next/${encodeURIComponent(String(fighter))}`, { limit: opts.limit });
  }

  /* --------------------------------------------------------------- stats */

  /**
   * One Record Book leaderboard for one promotion (`metric` e.g. `wins`,
   * `fastest_knockout`, `finish_rate`). Narrow with `division` (slug),
   * `country` (ISO-2) or `population: 'active'` — not `country` and
   * `active` together. `lastMeta.metric` names the unit and what
   * `value_secondary` means.
   */
  leaderboard(
    org: string,
    metric: string,
    opts: { division?: string; country?: string; population?: 'all' | 'active'; limit?: number } = {},
  ): Promise<LeaderboardRow[]> {
    return this.get<LeaderboardRow[]>('stats/leaders', { org, metric, ...opts } as Query);
  }

  /**
   * Every leaderboard's top rows (`top`, default 10, max 25) for one
   * promotion, grouped by category.
   */
  recordBook(
    org: string,
    opts: { division?: string; country?: string; population?: 'all' | 'active'; scope?: StatScope; top?: number } = {},
  ): Promise<RecordBookSection[]> {
    return this.get<RecordBookSection[]>('stats/record-book', { org, ...opts } as Query);
  }

  /**
   * One calendar year in numbers for one promotion, or every covered
   * promotion when `org` is omitted: events, title fights, finish methods,
   * divisions, fastest finishes, upsets, Power Index climbers, busiest
   * fighters, host countries and the most-used judges.
   */
  yearStats(year: number, opts: { org?: string } = {}): Promise<YearStats> {
    return this.get<YearStats>(`stats/years/${encodeURIComponent(String(year))}`, opts as Query);
  }

  /* ---------------------------------------------------------------- misc */

  /** Model win probabilities for upcoming UFC bouts; `event` narrows to one card. */
  predictionsUpcoming(opts: { event?: string | number } = {}): Promise<Record<string, unknown>[]> {
    return this.get<Record<string, unknown>[]>(
      'predictions/upcoming',
      opts.event !== undefined ? { event: String(opts.event) } : undefined,
    );
  }

  /**
   * Who airs the promotion, per ISO-2 country — the org-wide deals, or a UFC
   * sub-series grid with `series: 'dwcs' | 'rtufc'`.
   */
  broadcastRights(org = 'ufc', opts: { country?: string; series?: RightsSeries } = {}): Promise<BroadcastRight[]> {
    return this.get<BroadcastRight[]>(`broadcast-rights/${encodeURIComponent(org)}`, opts as Query);
  }

  /**
   * Venues that hosted a covered promotion, alphabetical. `q` (2+ chars)
   * matches name or city; `country` is an ISO-2 code or an English name.
   */
  venues(opts: { q?: string; country?: string; limit?: number } = {}): AsyncGenerator<Venue, void, void> {
    const { limit, ...params } = opts;
    return this.#paginate<Venue>('venues', params as Query, { limit });
  }

  venue(venueId: number | string): Promise<Venue> {
    return this.get<Venue>(`venues/${encodeURIComponent(String(venueId))}`);
  }

  /** Every covered event at one venue, newest first (`order: 'asc'` reverses). */
  venueEvents(
    venueId: number | string,
    opts: { status?: string; from?: string; to?: string; order?: 'asc' | 'desc'; limit?: number } = {},
  ): AsyncGenerator<EventSummary, void, void> {
    const { limit, ...params } = opts;
    return this.#paginate<EventSummary>(`venues/${encodeURIComponent(String(venueId))}/events`, params as Query, { limit });
  }

  /** Typeahead across fighters and events. */
  search(q: string): Promise<Record<string, unknown>> {
    return this.get<Record<string, unknown>>('search', { q });
  }

  /**
   * UFCalendar's own editorial archive, newest first. `q` (2+ chars) matches
   * title, summary or a tag; `tag` is exact; `locale` is one of the 13 site
   * languages (English fallback).
   */
  articles(
    opts: { q?: string; tag?: string; locale?: ArticleLocale; limit?: number } = {},
  ): AsyncGenerator<ArticleSummary, void, void> {
    const { limit, ...params } = opts;
    return this.#paginate<ArticleSummary>('articles', params as Query, { limit });
  }

  /**
   * One article: full Markdown `body_md` (client widgets removed), author,
   * tags, `published_at`; `served_locale` names the language
   * delivered.
   */
  article(slug: string, opts: { locale?: ArticleLocale } = {}): Promise<Article> {
    return this.get<Article>(`articles/${encodeURIComponent(slug)}`, opts as Query);
  }

  /** Your key's month-to-date quota usage. */
  usage(): Promise<Usage> {
    return this.get<Usage>('usage');
  }

  /**
   * Subscribable ICS feed URL for calendar apps (authenticates via `?key=`).
   *
   * Throws without a key rather than returning `?key=`: that empty URL is
   * pasted into a calendar app, fails there hours later, and the failure
   * surfaces nowhere near this call.
   */
  calendarIcsUrl(org = 'ufc'): string {
    if (!this.apiKey) {
      throw new FightAPIError(
        401,
        'no_api_key',
        'No API key. Pass new FightAPI("ufcalendar_...") or set UFCALENDAR_API_KEY. ' +
          'Keys (and the free 1-day trial) live at https://www.ufcalendar.com/account/api',
      );
    }
    return `${this.baseUrl}/calendar/${encodeURIComponent(org)}.ics?key=${encodeURIComponent(this.apiKey)}`;
  }

  /* ------------------------------------------------------------ webhooks */

  webhookEndpoints(): Promise<WebhookEndpoint[]> {
    return this.get<WebhookEndpoint[]>('webhook-endpoints');
  }

  /**
   * Register a signed webhook (Pro and up). `events` ⊆ `event.announced`,
   * `fight.result`, `card.changed`, `event.completed`, `odds.moved` (the
   * consensus line on an upcoming bout moved 5+ implied-probability points or
   * the favourite flipped). The signing secret is returned ONCE, in this
   * response.
   */
  async createWebhookEndpoint(url: string, events?: string[]): Promise<WebhookEndpoint> {
    const body: Record<string, unknown> = { url };
    if (events?.length) body.events = events;
    return (await this.#request<WebhookEndpoint>('POST', 'webhook-endpoints', { body })).data;
  }

  async deleteWebhookEndpoint(endpointId: number | string): Promise<void> {
    await this.#request<unknown>('DELETE', `webhook-endpoints/${encodeURIComponent(String(endpointId))}`);
  }

  async rotateWebhookSecret(endpointId: number | string): Promise<WebhookEndpoint> {
    return (
      await this.#request<WebhookEndpoint>(
        'POST',
        `webhook-endpoints/${encodeURIComponent(String(endpointId))}/rotate-secret`,
      )
    ).data;
  }
}
