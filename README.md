# @ufcalendar/sdk — TypeScript client for the UFCalendar Fight API

The [UFCalendar Fight API](https://www.ufcalendar.com/developers) is a REST API for MMA data: **UFC, PFL, OKTAGON, BKFC and RIZIN** events, full fight cards, results within minutes, per-fight and round-by-round statistics, complete fighter careers, the only **UFC rankings API with point-in-time history back to 2013**, and the only one serving **judges' scorecards** — every official, every round — plus the **UFCalendar consensus odds line** (current, opening and closing on every plan, line movement on Pro). This package is a dependency-free `fetch` wrapper over it: one method per endpoint, cursor pagination handled for you, ESM + CJS, Node 18+, browsers and edge runtimes.

```bash
npm install @ufcalendar/sdk
```

Get a key (free 1-day trial, 100 requests, no card) at <https://www.ufcalendar.com/account/api?trial=1>. Paid plans from $19/month for 30,000 requests (Pro $49 for 200,000, Business $149 for 1,000,000) — hard caps, no overage.

## Quickstart

```ts
import { FightAPI } from '@ufcalendar/sdk';

const api = new FightAPI(process.env.UFCALENDAR_API_KEY); // or new FightAPI({ apiKey })

// Upcoming UFC schedule, soonest first
for await (const ev of api.events({ org: 'ufc', limit: 5 })) {
  console.log(ev.starts_at, ev.title, ev.is_ppv ? 'PPV' : '');
}

// Full card + results of the newest completed UFC event
const [latest] = await Array.fromAsync(api.events({ org: 'ufc', status: 'completed', limit: 1 }));
const card = await api.event(latest!.slug);
for (const f of card.card) {
  if (f.result) {
    console.log(f.fighter_a?.name, 'vs', f.fighter_b?.name, '->', f.result.method, `R${f.result.round}`);
  }
}

// The judges' scorecards for one bout — the official commission record
const cards = await api.fightScorecards(card.card[0]!.id);

// UFC rankings on any date since February 2013 (rank 0 = champion)
const board = await api.rankings('ufc', { date: '2016-11-14' });

// A fighter's complete multi-promotion career
const history = await api.fighterHistory('islam-makhachev');
```

List endpoints are **async generators** that follow `meta.pagination.next_cursor` for you; pass `limit` to stop after N rows. Everything else returns the envelope's `data`. The last response's `meta` and rate-limit headers stay on the client (`api.lastMeta`, `api.lastRateLimit`).

## What's covered

| Method | Endpoint |
|---|---|
| `plans()` | `GET /v1/plans` — plans, quotas, trial terms, MCP endpoint (no key required) |
| `orgs()` / `org(slug)` | `GET /v1/orgs` / `…/{slug}` |
| `events({ org, status, from, to, order, isTitleCard, isPpv, include: ['headline'], limit })` | `GET /v1/events` (paginated; `headline` = each card's main event and its result) |
| `event(slug, { include: ['eta', 'odds'] })` / `eventChanges(slug)` | `GET /v1/events/{slug}` / `…/changes` (`eta` = per-bout estimated start; `odds` = each bout's latest consensus line) |
| `eventWatch(slug, { country })` | `GET /v1/events/{slug}/watch` — how to watch one event, per country: the rights deals for its series merged with the event's own listings |
| `changes({ org, since, kind, limit })` | `GET /v1/changes` — the card-change feed across every event, newest first (paginated; default last 90 days) |
| `eventLive(slug)` | `GET /v1/events/{slug}/live` — real-time `LiveState` on fight night (Pro plans and up); the same document streams over `wss://live.ufcalendar.com/v1?key=…` |
| `subscribeLive(slug, onFrame, opts?)` | the **WebSocket** itself — every `LiveFrame` as it lands (Pro plans and up); returns an unsubscribe function |
| `fight(id, { include: ['odds'] })` / `fightStats(id)` / `fightRounds(id)` | `GET /v1/fights/{id}` / `…/stats` / `…/rounds` |
| `fightOdds(id)` / `eventOdds(slug)` | `GET /v1/fights/{id}/odds` / `GET /v1/events/{slug}/odds` — the UFCalendar consensus line: current, opening, closing (settled bouts), movement and `sources` (how many sportsbooks backed each point). Information only, not betting advice |
| `fightOddsHistory(id, { from, to })` | `GET /v1/fights/{id}/odds/history` — every consensus point, oldest first (async generator; Pro plans and up) |
| `findFights({ org, titleOnly, method, division, fighter, winner, from, to, mainEventsOnly, order, limit })` | `GET /v1/fights/search` — completed bouts, filtered, newest first (at least one narrowing filter; 25 a page, 10 pages deep) |
| `fightScorecards(id)` | `GET /v1/fights/{id}/scorecards` — judges, rounds, totals, deductions |
| `judges({ q, org, minFights })` / `judge(id)` / `judgeScorecards(id)` | `GET /v1/judges` / `…/{id}` / `…/{id}/scorecards` (`lastMeta.league` = baseline rates; each card row flags `lone_dissent` / `split` and lists `colleagues`) |
| `splitDecisions({ org, from, to, limit })` | `GET /v1/scorecards/splits` — split and majority decisions, newest first, with every judge's card and the dissenters named (paginated) |
| `fighters({ q, org, country })` / `fighter(slug, { include: ['bonuses', 'credentials'] })` | `GET /v1/fighters` / `…/{slug}` (always carries `next_fight` / `last_fight`; `bonuses` = the UFC bonus ledger; `credentials` = grappling and wrestling pedigree, gyms and coaches, each row sourced and confidence-graded) |
| `fighterHistory` / `fighterStats` / `fighterRankings` / `fighterPowerIndex` | `GET /v1/fighters/{slug}/…` |
| `rankings(org, { date })` / `divisionRankings(org, division)` / `champions()` | `GET /v1/rankings/…` / `/v1/champions` (entries carry `movement`, `is_new`, `country_code`; `lastMeta` names the previous/next snapshot) |
| `powerIndex(org, { view, division, days, limit })` / `predictionsUpcoming({ event })` | `GET /v1/power-index/{org}` (`view`: `current` · `movers` · `peaks`) / `/v1/predictions/upcoming` |
| `matchmaker(org, { division, limit })` / `whosNext(fighter, { limit })` | `GET /v1/matchmaker/{org}` / `…/next/{fighter}` — UFCalendar's matchmaker: the fights worth making (scored 0–100, per division or across the roster; not bookings), and one fighter's best next opponents with the win probability for each and the bout already booked |
| `leaderboard(org, metric, { division, country, population, limit })` / `recordBook(org, { division, country, population, scope, top })` | `GET /v1/stats/leaders` / `…/record-book` — the Record Book: one leaderboard (48 metrics; ties flagged, sample size on every row), or every board's top rows grouped by category |
| `orgDivision(org, division)` | `GET /v1/orgs/{org}/divisions/{division}` — one weight class: rankings board, upcoming bouts, latest results, roster by recency |
| `yearStats(year, { org })` | `GET /v1/stats/years/{year}` — one calendar year in numbers for one promotion (or every covered one): methods, divisions, fastest finishes, upsets, Power Index climbers, busiest fighters, countries, judges |
| `compare(a, b)` | `GET /v1/compare` — two fighters side by side: bios, career stats, strike mix, streaks, previous meetings, common opponents, booked bout, model prediction (UFC), Power Index |
| `eventStorylines(slug)` | `GET /v1/events/{slug}/storylines` — the talking points of one card: title fights, eliminators, closest bout, rematches, streaks, debuts, returns, ranked fighters, nations |
| `eventPickem(slug)` | `GET /v1/events/{slug}/pickem` — how the UFCalendar community is picking each bout on one card (picks per corner, total, percentage); crowd sentiment, not a market and not a forecast |
| `broadcastRights(org, { country, series })` / `venue(id)` / `search(q)` / `usage()` | misc (`series: 'dwcs' \| 'rtufc'` = a UFC sub-series grid) |
| `venues({ q, country, limit })` / `venueEvents(id, { status, from, to, order, limit })` | `GET /v1/venues` / `…/{id}/events` — venue search, and every covered event at one venue, newest first (paginated) |
| `articles({ q, tag, locale, limit })` / `article(slug, { locale })` | `GET /v1/articles` / `…/{slug}` — UFCalendar's own editorial archive, newest first, in any of the 13 site languages (paginated), and one article's full Markdown body |
| `webhookEndpoints()` / `createWebhookEndpoint(url, events)` / `rotateWebhookSecret(id)` / `deleteWebhookEndpoint(id)` | `/v1/webhook-endpoints` (Pro+; kinds `event.announced`, `fight.result`, `card.changed`, `event.completed`, `odds.moved` — the consensus line moved 5+ points or the favourite flipped) |
| `calendarIcsUrl(org)` | `GET /v1/calendar/{org}.ics` (URL builder — no request) |
| `get(path, params)` / `getWithMeta(path, params)` | escape hatch for anything new |

Hand-written types cover events, fights, fighters, rankings, scorecards, consensus odds and plans; the generated `paths` / `operations` types from the OpenAPI document are exported for everything else.

## Consensus odds

```ts
const o = await api.fightOdds(83379);
console.log(o.consensus?.a.american, o.consensus?.b.american, o.consensus?.sources);
console.log(o.movement?.delta_points_a, o.closing); // closing = last line before the start (settled bouts)

for await (const point of api.fightOddsHistory(83379)) {  // Pro plans and up
  console.log(point.recorded_at, point.a.american, point.b.american);
}
```

One anonymised UFCalendar consensus line per corner across the sportsbooks we track;
book identities are never exposed. Information only, not betting advice.

## Live stream (UFC fight nights, Pro plans and up)

The **UFC live API**: a WebSocket that pushes the fight-night document the moment it
changes — card order and statuses, the bout in progress (round, running clock,
unofficial in-fight stats, per-round splits, a timestamped action timeline) and the
last result. It is the streaming half of `eventLive()`, and it is the **UFC live stats
API** you want instead of polling.

```ts
import { FightAPI } from '@ufcalendar/sdk';

const api = new FightAPI(); // UFCAL_API_KEY

const stop = api.subscribeLive(
  'ufc-331',
  (frame) => {
    // frame.type: "snapshot" | "update" | "fight.final" | "event.completed"
    const cur = frame.data?.current;
    if (cur) console.log(frame.type, 'R', cur.round, cur.clock_sec);
  },
  { until: 'final' },   // close after the first fight.final; omit to run all night
);

// later
stop();
```

`subscribeLive` uses the global `WebSocket` (browser, Node >= 22). On older Node inject
one: `{ WebSocketImpl: (await import('ws')).default as unknown as typeof WebSocket }`.
A dropped socket reconnects and re-subscribes once.

Runnable ticker: [`examples/live-ticker.ts`](examples/live-ticker.ts) — ~40 lines that
print `R2 3:41 · Oliveira 41 vs Makhachev 37 sig. strikes` as the round unfolds.

## Agents and MCP

The same data is a Model Context Protocol server, so an agent can call it without an HTTP client:

```
claude mcp add --transport http ufcalendar https://api.ufcalendar.com/mcp \
  --header "Authorization: Bearer $UFCALENDAR_API_KEY"
```

There is an installable agent skill too: `npx skills add UFCalendar/fight-api-skill`. Agent quickstart: <https://www.ufcalendar.com/developers/agents>.

## Options

```ts
new FightAPI({
  apiKey,                 // or UFCALENDAR_API_KEY / UFCAL_API_KEY in the environment
  baseUrl,                // default https://api.ufcalendar.com/v1
  fetch,                  // inject your own fetch
  timeoutMs,              // default 30_000
  headers,                // extra headers on every request
});
```

## Errors and rate limits

Every error throws `FightAPIError` with `.status`, `.code`, `.message` and `.requestId` — quote the request id when you write to api@ufcalendar.com. After each call `api.lastRateLimit` holds the `X-RateLimit-*` headers (monthly quota).

## Notes

- Odds are the UFCalendar consensus line only (no book identities). Information only, not betting advice.
- Fighter `images` are Wikimedia Commons / Creative Commons files: displaying the `license` and `artist` fields as a credit is a licence requirement, not a style preference.
- Scorecards are the official commission record. Media-member and fan scorecards are not part of the API.
- `source` / `source_slug` values (typed as `PublicSource`) name official publishers only — `ufc-stats`, `ufc-official`, `ufc-official-cards`, a promotion's `*-official`, `wikipedia`, `ufcalendar`. Every other publisher arrives as `public-records` (career records, history rows) or `commission-record` (judges' scorecards).
- Not affiliated with UFC, Zuffa, TKO or any promotion. Terms: <https://www.ufcalendar.com/developers/terms>

Full reference: <https://api.ufcalendar.com/docs> · OpenAPI 3.1: <https://api.ufcalendar.com/openapi.json> · Also on [PyPI (Python client)](https://pypi.org/project/ufcalendar/), [RapidAPI Hub](https://rapidapi.com/ceo-SP8r6F1JT/api/ufc-and-mma-fight-data-by-ufcalendar), [Postman](https://www.postman.com/ceo-5d84eedc/workspace/ufcalendar-fight-api) and the [hosted MCP server](https://github.com/UFCalendar/ufcalendar-mcp)

MIT licensed.
