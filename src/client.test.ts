/**
 * The client is a thin shell over fetch, so the tests mock fetch and assert
 * on the REQUEST it built and on how it unwrapped the answer. No network.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { FightAPI, FightAPIError, VERSION } from './index';

type Call = { url: URL; init: RequestInit & { headers: Record<string, string> } };

/** A fetch stub that records calls and replays the given responses in order. */
function stub(responses: { status?: number; body?: unknown; headers?: Record<string, string> }[]) {
  const calls: Call[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    calls.push({ url, init: (init ?? {}) as Call['init'] });
    const r = responses[calls.length - 1] ?? responses[responses.length - 1]!;
    return new Response(r.body === undefined ? null : JSON.stringify(r.body), {
      status: r.status ?? 200,
      headers: { 'content-type': 'application/json', ...(r.headers ?? {}) },
    });
  }) as typeof fetch;
  return { calls, fetchImpl };
}

const headersOf = (c: Call) => c.init.headers as Record<string, string>;

describe('request building', () => {
  it('sends the bearer key, JSON Accept and the versioned User-Agent', async () => {
    const { calls, fetchImpl } = stub([{ body: { data: [] } }]);
    const api = new FightAPI({ apiKey: 'ufcalendar_abc', fetch: fetchImpl });
    await api.champions();
    const c = calls[0]!;
    assert.equal(c.url.href, 'https://api.ufcalendar.com/v1/champions');
    assert.equal(headersOf(c).Authorization, 'Bearer ufcalendar_abc');
    assert.equal(headersOf(c).Accept, 'application/json');
    assert.equal(headersOf(c)['User-Agent'], `ufcalendar-typescript/${VERSION}`);
  });

  it('accepts a bare key string, like the docs samples do', async () => {
    const { calls, fetchImpl } = stub([{ body: { data: [] } }]);
    const api = new FightAPI('ufcalendar_xyz', { fetch: fetchImpl });
    await api.orgs();
    assert.equal(headersOf(calls[0]!).Authorization, 'Bearer ufcalendar_xyz');
  });

  it('drops undefined query parameters instead of sending "undefined"', async () => {
    const { calls, fetchImpl } = stub([{ body: { data: { org: 'ufc' } } }]);
    const api = new FightAPI({ apiKey: 'k', fetch: fetchImpl });
    await api.rankings('ufc', { date: undefined, board: 'official' });
    assert.equal(calls[0]!.url.search, '?board=official');
  });

  it('honours a custom base URL', async () => {
    const { calls, fetchImpl } = stub([{ body: { data: [] } }]);
    const api = new FightAPI({ apiKey: 'k', baseUrl: 'http://127.0.0.1:8787/v1/', fetch: fetchImpl });
    await api.orgs();
    assert.equal(calls[0]!.url.href, 'http://127.0.0.1:8787/v1/orgs');
  });

  it('builds the ICS feed URL without calling the network', () => {
    const { calls, fetchImpl } = stub([{ body: { data: [] } }]);
    const api = new FightAPI({ apiKey: 'ufcalendar_abc', fetch: fetchImpl });
    assert.equal(
      api.calendarIcsUrl('ufc'),
      'https://api.ufcalendar.com/v1/calendar/ufc.ics?key=ufcalendar_abc',
    );
    assert.equal(calls.length, 0);
  });

  it('refuses to build an ICS URL with no key', () => {
    // A `?key=` URL is pasted into a calendar app and fails there, hours
    // later, with nothing pointing back at this call.
    const { fetchImpl } = stub([{ body: { data: [] } }]);
    const api = new FightAPI({ fetch: fetchImpl });
    assert.throws(
      () => api.calendarIcsUrl('ufc'),
      (e: unknown) => e instanceof FightAPIError && e.code === 'no_api_key' && e.status === 401,
    );
  });
});

describe('envelope and metadata', () => {
  it('returns data and exposes meta + rate-limit headers', async () => {
    const { fetchImpl } = stub([
      {
        body: { data: { id: 812, slug: 'ufc-320' }, meta: { generated_at: 'now' } },
        headers: {
          'X-RateLimit-Limit': '30000',
          'X-RateLimit-Remaining': '29999',
          'X-RateLimit-Reset': '1790000000',
        },
      },
    ]);
    const api = new FightAPI({ apiKey: 'k', fetch: fetchImpl });
    const ev = await api.event('ufc-320');
    assert.equal(ev.slug, 'ufc-320');
    assert.deepEqual(api.lastMeta, { generated_at: 'now' });
    assert.deepEqual(api.lastRateLimit, { limit: '30000', remaining: '29999', reset: '1790000000' });
  });

  it('getWithMeta hands back the whole envelope', async () => {
    const { fetchImpl } = stub([{ body: { data: [1, 2], meta: { pagination: { next_cursor: null, has_more: false } } } }]);
    const api = new FightAPI({ apiKey: 'k', fetch: fetchImpl });
    const env = await api.getWithMeta('orgs');
    assert.deepEqual(env.data, [1, 2]);
    assert.equal(env.meta?.pagination?.has_more, false);
  });
});

describe('pagination', () => {
  it('follows meta.pagination.next_cursor across pages', async () => {
    const { calls, fetchImpl } = stub([
      { body: { data: [{ id: 1 }], meta: { pagination: { next_cursor: 'CUR2', has_more: true } } } },
      { body: { data: [{ id: 2 }], meta: { pagination: { next_cursor: null, has_more: false } } } },
    ]);
    const api = new FightAPI({ apiKey: 'k', fetch: fetchImpl });
    const ids: unknown[] = [];
    for await (const row of api.events({ org: 'ufc' })) ids.push(row.id);
    assert.deepEqual(ids, [1, 2]);
    assert.equal(calls.length, 2);
    assert.equal(calls[0]!.url.searchParams.get('org'), 'ufc');
    assert.equal(calls[0]!.url.searchParams.get('cursor'), null);
    assert.equal(calls[1]!.url.searchParams.get('cursor'), 'CUR2');
  });

  it('never asks for a bigger page than the caller wants rows', async () => {
    const { calls, fetchImpl } = stub([
      { body: { data: [{ id: 1 }, { id: 2 }, { id: 3 }], meta: { pagination: { next_cursor: null } } } },
    ]);
    const api = new FightAPI({ apiKey: 'k', fetch: fetchImpl });
    for await (const _row of api.events({ limit: 3 })) void _row;
    assert.equal(calls[0]!.url.searchParams.get('limit'), '3');
  });

  it('still pages at 100 when the caller sets no limit', async () => {
    const { calls, fetchImpl } = stub([{ body: { data: [], meta: { pagination: { next_cursor: null } } } }]);
    const api = new FightAPI({ apiKey: 'k', fetch: fetchImpl });
    for await (const _row of api.events()) void _row;
    assert.equal(calls[0]!.url.searchParams.get('limit'), '100');
  });

  it('stops at the caller\'s limit without fetching another page', async () => {
    const { calls, fetchImpl } = stub([
      { body: { data: [{ id: 1 }, { id: 2 }], meta: { pagination: { next_cursor: 'CUR2', has_more: true } } } },
    ]);
    const api = new FightAPI({ apiKey: 'k', fetch: fetchImpl });
    const ids: unknown[] = [];
    for await (const row of api.fighters({ q: 'silva', limit: 1 })) ids.push(row.id);
    assert.deepEqual(ids, [1]);
    assert.equal(calls.length, 1);
  });
});

describe('errors', () => {
  it('raises FightAPIError carrying code, message and request id', async () => {
    const { fetchImpl } = stub([
      {
        status: 403,
        body: { error: { code: 'tier_required', message: 'Webhooks need Pro.', request_id: 'req_123' } },
      },
    ]);
    const api = new FightAPI({ apiKey: 'k', fetch: fetchImpl });
    await assert.rejects(
      () => api.webhookEndpoints(),
      (e: unknown) => {
        assert.ok(e instanceof FightAPIError);
        assert.equal(e.status, 403);
        assert.equal(e.code, 'tier_required');
        assert.equal(e.message.includes('Webhooks need Pro.'), true);
        assert.equal(e.requestId, 'req_123');
        return true;
      },
    );
  });

  it('falls back to the x-request-id header when the body is not JSON', async () => {
    const fetchImpl = (async () =>
      new Response('<html>502</html>', {
        status: 502,
        headers: { 'content-type': 'text/html', 'x-request-id': 'req_edge' },
      })) as unknown as typeof fetch;
    const api = new FightAPI({ apiKey: 'k', fetch: fetchImpl });
    await assert.rejects(
      () => api.orgs(),
      (e: unknown) => e instanceof FightAPIError && e.status === 502 && e.requestId === 'req_edge',
    );
  });

  it('refuses an authenticated call with no key, and says where to get one', async () => {
    const { calls, fetchImpl } = stub([{ body: { data: [] } }]);
    const api = new FightAPI({ fetch: fetchImpl });
    await assert.rejects(() => api.orgs(), /account\/api/);
    assert.equal(calls.length, 0);
  });
});

describe('plans()', () => {
  it('works with no key at all and sends no Authorization header', async () => {
    const { calls, fetchImpl } = stub([{ body: { data: { currency: 'USD', plans: [] } } }]);
    const api = new FightAPI({ fetch: fetchImpl });
    const plans = await api.plans();
    assert.equal(plans.currency, 'USD');
    assert.equal(headersOf(calls[0]!).Authorization, undefined);
  });

  it('still sends the key when there is one (harmless, and it meters the same)', async () => {
    const { calls, fetchImpl } = stub([{ body: { data: { currency: 'USD', plans: [] } } }]);
    const api = new FightAPI({ apiKey: 'k', fetch: fetchImpl });
    await api.plans();
    assert.equal(headersOf(calls[0]!).Authorization, 'Bearer k');
  });
});

describe('timeout', () => {
  it('aborts the request after timeoutMs', async () => {
    const fetchImpl = ((_input: string, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal!.reason));
      })) as unknown as typeof fetch;
    const api = new FightAPI({ apiKey: 'k', fetch: fetchImpl, timeoutMs: 20 });
    // AbortSignal.timeout's timer is unref'd, so without a live handle the
    // event loop would drain before it ever fires.
    const keepAlive = setTimeout(() => {}, 1_000);
    try {
      await assert.rejects(
        () => api.orgs(),
        (e: unknown) => e instanceof FightAPIError && e.code === 'timeout',
      );
    } finally {
      clearTimeout(keepAlive);
    }
  });
});

describe('fighter() and rankings enrichments', () => {
  it('fighter() sends include as a comma list and types next/last fight + bonuses', async () => {
    const { calls, fetchImpl } = stub([{ body: { data: {
      id: 2215, slug: 'charles-oliveira-3', next_fight: null,
      last_fight: { fight_id: 5696, source: 'native', result: 'win' },
      bonuses: { org: 'ufc', total: 6, counts: { fotn: 3, potn: 3, kotn: 0, sotn: 0 }, fights: [] },
    } } }]);
    const api = new FightAPI({ apiKey: 'k', fetch: fetchImpl });
    const f = await api.fighter('charles-oliveira-3', { include: ['bonuses'] });
    assert.equal(calls[0]!.url.pathname, '/v1/fighters/charles-oliveira-3');
    assert.equal(calls[0]!.url.search, '?include=bonuses');
    assert.equal(f.next_fight, null);
    assert.equal(f.last_fight?.fight_id, 5696);
    assert.equal(f.bonuses?.counts.fotn, 3);
  });

  it('fighter() without include sends no query string', async () => {
    const { calls, fetchImpl } = stub([{ body: { data: { id: 1 } } }]);
    const api = new FightAPI({ apiKey: 'k', fetch: fetchImpl });
    await api.fighter(1);
    assert.equal(calls[0]!.url.search, '');
  });

  it('rankings entries carry movement / is_new / country_code', async () => {
    const { fetchImpl } = stub([{ body: {
      data: { org: 'ufc', board: 'official', snapshot_date: '2016-11-07', divisions: [{ division: 'lightweight', entries: [
        { rank: 1, is_champion: false, fighter_id: 1257, fighter_slug: 'tony-ferguson', name: 'Tony Ferguson', nationality: 'United States', country_code: 'US', movement: 2, is_new: false },
      ] }] },
      meta: { previous_snapshot_date: '2016-10-12', next_snapshot_date: '2016-11-16' },
    } }]);
    const api = new FightAPI({ apiKey: 'k', fetch: fetchImpl });
    const board = await api.rankings('ufc', { date: '2016-11-14' });
    const e = board.divisions[0]!.entries[0]!;
    assert.equal(e.movement, 2);
    assert.equal(e.is_new, false);
    assert.equal(e.country_code, 'US');
    assert.equal(api.lastMeta?.previous_snapshot_date, '2016-10-12');
  });
});

describe('power index, predictions, judges, events enrichments', () => {
  it('powerIndex() sends view/division/days/limit and types a movers row', async () => {
    const { calls, fetchImpl } = stub([{ body: { data: [
      { position: 1, fighter: { id: 152, slug: 'islam-makhachev', name: 'Islam Makhachev', nationality: 'Russia' },
        rating: 1874, start_rating: 1831, delta: 43, fights_in_window: 2, division: 'welterweight' },
    ], meta: { org: 'ufc', view: 'movers', division: 'welterweight', days: 730 } } }]);
    const api = new FightAPI({ apiKey: 'k', fetch: fetchImpl });
    const rows = await api.powerIndex('ufc', { view: 'movers', division: 'welterweight', days: 730, limit: 5 });
    assert.equal(calls[0]!.url.pathname, '/v1/power-index/ufc');
    assert.equal(calls[0]!.url.search, '?view=movers&division=welterweight&days=730&limit=5');
    const r = rows[0]!;
    assert.ok('delta' in r);
    if ('delta' in r) assert.equal(r.delta, 43);
    assert.equal(r.division, 'welterweight');
  });

  it('powerIndex() with no options sends no query string', async () => {
    const { calls, fetchImpl } = stub([{ body: { data: [] } }]);
    const api = new FightAPI({ apiKey: 'k', fetch: fetchImpl });
    await api.powerIndex();
    assert.equal(calls[0]!.url.search, '');
  });

  it('predictionsUpcoming() narrows by event', async () => {
    const { calls, fetchImpl } = stub([{ body: { data: [], meta: { event: { id: 8, slug: 'ufc-320', title: 'UFC 320', status: 'scheduled' } } } }]);
    const api = new FightAPI({ apiKey: 'k', fetch: fetchImpl });
    await api.predictionsUpcoming({ event: 'ufc-320' });
    assert.equal(calls[0]!.url.search, '?event=ufc-320');
  });

  it('findFights() maps its filters to snake_case query params', async () => {
    const { calls, fetchImpl } = stub([{ body: { data: [
      { id: 185, is_title: true, event: { id: 8, slug: 'ufc-2026-06-14', title: 'UFC Freedom 250', org: 'ufc', starts_at: '2026-06-15T00:00:00.000Z' } },
    ], meta: { pagination: { next_cursor: null, has_more: false } } } }]);
    const api = new FightAPI({ apiKey: 'k', fetch: fetchImpl });
    const out = [];
    for await (const f of api.findFights({ org: 'ufc', titleOnly: true, method: 'ko', winner: 100, mainEventsOnly: false, limit: 5 })) out.push(f);
    assert.equal(calls[0]!.url.pathname, '/v1/fights/search');
    const q = calls[0]!.url.searchParams;
    assert.equal(q.get('title_only'), 'true');
    assert.equal(q.get('main_events_only'), 'false');
    assert.equal(q.get('method'), 'ko');
    assert.equal(q.get('winner'), '100');
    assert.equal(q.get('limit'), '5');
    assert.equal(q.has('titleOnly'), false);
    assert.equal(out[0]!.event.slug, 'ufc-2026-06-14');
  });

  it('eventWatch() passes country and returns the grid', async () => {
    const { calls, fetchImpl } = stub([{ body: { data: { series: 'dwcs', countries: [{ country: 'WORLD', providers: [] }] } } }]);
    const api = new FightAPI({ apiKey: 'k', fetch: fetchImpl });
    const w = await api.eventWatch('ufc-2025-08-26', { country: 'GB' });
    assert.equal(calls[0]!.url.pathname, '/v1/events/ufc-2025-08-26/watch');
    assert.equal(calls[0]!.url.searchParams.get('country'), 'GB');
    assert.equal(w.series, 'dwcs');
  });

  it('broadcastRights() passes series', async () => {
    const { calls, fetchImpl } = stub([{ body: { data: [] } }]);
    const api = new FightAPI({ apiKey: 'k', fetch: fetchImpl });
    await api.broadcastRights('ufc', { series: 'rtufc' });
    assert.equal(calls[0]!.url.pathname, '/v1/broadcast-rights/ufc');
    assert.equal(calls[0]!.url.searchParams.get('series'), 'rtufc');
  });

  it('venues() and venueEvents() page their lists', async () => {
    const { calls, fetchImpl } = stub([
      { body: { data: [{ id: 5, name: 'T-Mobile Arena' }], meta: { pagination: { next_cursor: null, has_more: false } } } },
      { body: { data: [{ id: 71, slug: 'ufc-326' }], meta: { pagination: { next_cursor: null, has_more: false } } } },
    ]);
    const api = new FightAPI({ apiKey: 'k', fetch: fetchImpl });
    const venues = [];
    for await (const v of api.venues({ q: 'T-Mobile', limit: 3 })) venues.push(v);
    assert.equal(calls[0]!.url.pathname, '/v1/venues');
    assert.equal(calls[0]!.url.searchParams.get('q'), 'T-Mobile');
    assert.equal(calls[0]!.url.searchParams.get('limit'), '3');
    const events = [];
    for await (const e of api.venueEvents(5, { status: 'completed' })) events.push(e);
    assert.equal(calls[1]!.url.pathname, '/v1/venues/5/events');
    assert.equal(calls[1]!.url.searchParams.get('status'), 'completed');
    assert.equal(venues[0]!.id, 5);
    assert.equal(events[0]!.id, 71);
  });

  it('splitDecisions() pages the splits list', async () => {
    const { calls, fetchImpl } = stub([{ body: { data: [
      { id: 184, decision_type: 'split', dissenting_judges: [{ judge_id: 35 }] },
    ], meta: { pagination: { next_cursor: null, has_more: false } } } }]);
    const api = new FightAPI({ apiKey: 'k', fetch: fetchImpl });
    const rows = [];
    for await (const r of api.splitDecisions({ org: 'ufc', from: '2020-01-01' })) rows.push(r);
    assert.equal(calls[0]!.url.pathname, '/v1/scorecards/splits');
    assert.equal(calls[0]!.url.searchParams.get('from'), '2020-01-01');
    assert.equal(rows[0]!.dissenting_judges[0]!.judge_id, 35);
  });

  it('leaderboard() sends org + metric and filters', async () => {
    const { calls, fetchImpl } = stub([{ body: { data: [
      { rank: 1, value: 28, value_secondary: null, sample_n: 46, fighter: { id: 17, slug: 'jim-miller', name: 'Jim Miller', nationality: null }, division: null, round_number: null, fight: null, event: null, display_rank: 1, tied: false },
    ], meta: { metric: { slug: 'wins', unit: 'count' } } } }]);
    const api = new FightAPI({ apiKey: 'k', fetch: fetchImpl });
    const rows = await api.leaderboard('ufc', 'wins', { population: 'active', limit: 5 });
    assert.equal(calls[0]!.url.pathname, '/v1/stats/leaders');
    assert.equal(calls[0]!.url.searchParams.get('org'), 'ufc');
    assert.equal(calls[0]!.url.searchParams.get('metric'), 'wins');
    assert.equal(calls[0]!.url.searchParams.get('population'), 'active');
    assert.equal(rows[0]!.fighter!.slug, 'jim-miller');
  });

  it('recordBook() and orgDivision() hit their routes', async () => {
    const { calls, fetchImpl } = stub([
      { body: { data: [{ category: 'records', boards: [] }] } },
      { body: { data: { org: 'ufc', division: { slug: 'womens-strawweight', name: "Women's Strawweight", weight_limit_lbs: 115 }, rankings: null, upcoming: [], recent: [], roster: [] } } },
    ]);
    const api = new FightAPI({ apiKey: 'k', fetch: fetchImpl });
    const book = await api.recordBook('ufc', { scope: 'single_fight', top: 3 });
    assert.equal(calls[0]!.url.pathname, '/v1/stats/record-book');
    assert.equal(calls[0]!.url.searchParams.get('top'), '3');
    assert.equal(book[0]!.category, 'records');
    const div = await api.orgDivision('ufc', 'womens-strawweight');
    assert.equal(calls[1]!.url.pathname, '/v1/orgs/ufc/divisions/womens-strawweight');
    assert.equal(div.division.weight_limit_lbs, 115);
  });

  it('compare() sends a and b', async () => {
    const { calls, fetchImpl } = stub([{ body: { data: {
      a: { id: 152, slug: 'islam-makhachev', name: 'Islam Makhachev', age: 34 },
      b: { id: 493, slug: 'charles-oliveira', name: 'Charles Oliveira', age: 36 },
      win_streak: { a: 16, b: 1 }, head_to_head: [], common_opponents: [], booked_bout: null, prediction: null,
      power_index: { a: null, b: null, win_probability_a: null },
    } } }]);
    const api = new FightAPI({ apiKey: 'k', fetch: fetchImpl });
    const cmp = await api.compare('islam-makhachev', 'charles-oliveira');
    assert.equal(calls[0]!.url.pathname, '/v1/compare');
    assert.equal(calls[0]!.url.searchParams.get('a'), 'islam-makhachev');
    assert.equal(calls[0]!.url.searchParams.get('b'), 'charles-oliveira');
    assert.equal(cmp.win_streak.a, 16);
  });

  it('eventStorylines() and yearStats() hit their routes', async () => {
    const { calls, fetchImpl } = stub([
      { body: { data: { summary: { title_fights: 2, ranked_fighters: 11, champions: 2, closest_bout: null }, fights: [], card: {} } } },
      { body: { data: { year: 2025, orgs_scope: ['ufc'], events_completed: 47 } } },
    ]);
    const api = new FightAPI({ apiKey: 'k', fetch: fetchImpl });
    const st = await api.eventStorylines('ufc-322-2025-11-15');
    assert.equal(calls[0]!.url.pathname, '/v1/events/ufc-322-2025-11-15/storylines');
    assert.equal(st.summary.title_fights, 2);
    const yr = await api.yearStats(2025, { org: 'ufc' });
    assert.equal(calls[1]!.url.pathname, '/v1/stats/years/2025');
    assert.equal(calls[1]!.url.searchParams.get('org'), 'ufc');
    assert.deepEqual(yr.orgs_scope, ['ufc']);
  });

  it('eventPickem() and fighter(include credentials) hit their routes', async () => {
    const { calls, fetchImpl } = stub([
      { body: { data: { event: { id: 16, slug: 'ufc-322-2025-11-15', title: 'UFC 322', org: 'ufc', starts_at: null, status: 'completed' },
        fights: [{ fight_id: 591, fighter_a: null, fighter_b: null, picks_a: 3, picks_b: 1, total: 4, pct_a: 75 }] } } },
      { body: { data: { id: 152, slug: 'islam-makhachev', name: 'Islam Makhachev',
        credentials: { credentials: [], affiliations: [{ kind: 'gym', name: 'AKA', role: null, status: 'current', is_primary: true,
          location: null, gym: null, discipline: null, relationship: null, as_of: null, period: null, note: null,
          sources: ['https://x'], confidence: 'reported' }] } } } },
    ]);
    const api = new FightAPI({ apiKey: 'k', fetch: fetchImpl });
    const pk = await api.eventPickem('ufc-322-2025-11-15');
    assert.equal(calls[0]!.url.pathname, '/v1/events/ufc-322-2025-11-15/pickem');
    assert.equal(pk.fights[0]!.pct_a, 75);
    const f = await api.fighter('islam-makhachev', { include: ['bonuses', 'credentials'] });
    assert.equal(calls[1]!.url.searchParams.get('include'), 'bonuses,credentials');
    assert.equal(f.credentials?.affiliations[0]!.confidence, 'reported');
  });

  it('articles() pages the archive and article() reads one', async () => {
    const { calls, fetchImpl } = stub([
      { body: { data: [{ slug: 'a' }], meta: { pagination: { next_cursor: 'C2', has_more: true } } } },
      { body: { data: [{ slug: 'b' }], meta: { pagination: { next_cursor: null, has_more: false } } } },
      { body: { data: { slug: 'a', body_md: '# A', locale: 'es', served_locale: 'en' } } },
    ]);
    const api = new FightAPI({ apiKey: 'k', fetch: fetchImpl });
    const rows = [];
    for await (const r of api.articles({ q: 'title fight', locale: 'es' })) rows.push(r.slug);
    assert.deepEqual(rows, ['a', 'b']);
    assert.equal(calls[0]!.url.pathname, '/v1/articles');
    assert.equal(calls[0]!.url.searchParams.get('q'), 'title fight');
    assert.equal(calls[0]!.url.searchParams.get('locale'), 'es');
    assert.equal(calls[1]!.url.searchParams.get('cursor'), 'C2');
    const art = await api.article('a', { locale: 'es' });
    assert.equal(calls[2]!.url.pathname, '/v1/articles/a');
    assert.equal(calls[2]!.url.searchParams.get('locale'), 'es');
    assert.equal(art.served_locale, 'en');
  });

  it('matchmaker() and whosNext() hit their routes', async () => {
    const { calls, fetchImpl } = stub([
      { body: { data: [{ key: '1-2', division: 'lightweight', a: null, b: null, score: 91, win_probability_a: 0.61, tags: [{ kind: 'title' }] }],
        meta: { org: 'ufc', division: 'lightweight', divisions: ['lightweight'] } } },
      { body: { data: { subject: { slug: 'islam-makhachev' }, org: 'ufc', division: 'welterweight',
        suggestions: [{ opponent: { slug: 'x' }, win_probability_subject: 0.62, score: 88, tags: [] }], booked_next: null, rankings_date: null } } },
    ]);
    const api = new FightAPI({ apiKey: 'k', fetch: fetchImpl });
    const board = await api.matchmaker('ufc', { division: 'lightweight', limit: 5 });
    assert.equal(calls[0]!.url.pathname, '/v1/matchmaker/ufc');
    assert.equal(calls[0]!.url.searchParams.get('division'), 'lightweight');
    assert.equal(calls[0]!.url.searchParams.get('limit'), '5');
    assert.equal(board[0]!.score, 91);
    const nxt = await api.whosNext('islam-makhachev');
    assert.equal(calls[1]!.url.pathname, '/v1/matchmaker/next/islam-makhachev');
    assert.equal(nxt.suggestions[0]!.score, 88);
  });

  it('changes() pages the cross-event feed', async () => {
    const { calls, fetchImpl } = stub([
      { body: { data: [{ id: 9, kind: 'fight-added' }], meta: { pagination: { next_cursor: 'C2', has_more: true } } } },
      { body: { data: [{ id: 8, kind: 'time-changed' }], meta: { pagination: { next_cursor: null, has_more: false } } } },
    ]);
    const api = new FightAPI({ apiKey: 'k', fetch: fetchImpl });
    const ids: number[] = [];
    for await (const c of api.changes({ org: 'ufc', kind: 'fight-added' })) ids.push(c.id);
    assert.deepEqual(ids, [9, 8]);
    assert.equal(calls[0]!.url.pathname, '/v1/changes');
    assert.equal(calls[0]!.url.searchParams.get('kind'), 'fight-added');
    assert.equal(calls[1]!.url.searchParams.get('cursor'), 'C2');
  });

  it('events() maps isTitleCard / isPpv / include to snake_case query params', async () => {
    const { calls, fetchImpl } = stub([{ body: { data: [
      { id: 8, slug: 'ufc-2026-06-14', headline: { fight_id: 185, fighter_a: { id: 99, slug: 'ilia-topuria', name: 'Ilia Topuria' }, fighter_b: null,
        weight_class: 'Lightweight', is_title: true, winner_fighter_id: 100, method: 'KO/TKO', round: 4, time: '5:00' } },
    ], meta: { pagination: { next_cursor: null, has_more: false } } } }]);
    const api = new FightAPI({ apiKey: 'k', fetch: fetchImpl });
    const out = [];
    for await (const e of api.events({ org: 'ufc', isTitleCard: true, isPpv: false, include: ['headline'] })) out.push(e);
    const q = calls[0]!.url.searchParams;
    assert.equal(q.get('is_title_card'), 'true');
    assert.equal(q.get('is_ppv'), 'false');
    assert.equal(q.get('include'), 'headline');
    assert.equal(q.has('isTitleCard'), false);
    assert.equal(out[0]!.headline?.fight_id, 185);
  });

  it('event() sends include=eta and types Fight.eta', async () => {
    const { calls, fetchImpl } = stub([{ body: { data: { id: 8, slug: 'ufc-320', card: [{ id: 1, eta: '2026-10-05T02:00:00.000Z' }] } } }]);
    const api = new FightAPI({ apiKey: 'k', fetch: fetchImpl });
    const e = await api.event('ufc-320', { include: ['eta'] });
    assert.equal(calls[0]!.url.search, '?include=eta');
    assert.equal(e.card[0]!.eta, '2026-10-05T02:00:00.000Z');
  });

  it('judgeScorecards() rows carry lone_dissent / split / colleagues', async () => {
    const { fetchImpl } = stub([{ body: { data: [
      { fight_id: 83379, lone_dissent: false, split: true, card: null,
        colleagues: [{ judge_id: 34, judge_name: 'Clemens Werner', total_a: 29, total_b: 28, winner_fighter_id: 213, is_draw: false }] },
    ], meta: { pagination: { next_cursor: null, has_more: false } } } }]);
    const api = new FightAPI({ apiKey: 'k', fetch: fetchImpl });
    const rows = [];
    for await (const r of api.judgeScorecards(36)) rows.push(r);
    assert.equal(rows[0]!.split, true);
    assert.equal(rows[0]!.colleagues[0]!.judge_id, 34);
  });
});

describe('consensus odds', () => {
  const PAIR = {
    a: { american: 131, decimal: 2.31, implied_probability: 0.4329 },
    b: { american: -152, decimal: 1.658, implied_probability: 0.6032 },
    favourite: 'b',
    fair_probability_a: 0.4178,
    sources: 24,
    recorded_at: '2026-08-29T10:50:34.350Z',
  };

  it('fightOdds / eventOdds hit the odds routes and unwrap data', async () => {
    const { calls, fetchImpl } = stub([
      { body: { data: { fight_id: 83379, consensus: PAIR, opening: PAIR, closing: PAIR, movement: { delta_points_a: 9.28, direction: 'a', since: '2026-08-18T22:50:43.418Z' }, points: 57, updated_at: PAIR.recorded_at }, meta: { history: '/v1/fights/83379/odds/history' } } },
      { body: { data: { event: { id: 782, slug: 'ufc-2025-11-15' }, fights: [] }, meta: { priced: 0, unpriced: 0 } } },
    ]);
    const api = new FightAPI({ apiKey: 'k', fetch: fetchImpl });
    const o = await api.fightOdds(83379);
    assert.equal(calls[0]!.url.pathname, '/v1/fights/83379/odds');
    assert.equal(o.consensus?.sources, 24);
    assert.equal(o.movement?.direction, 'a');
    assert.equal(api.lastMeta?.history, '/v1/fights/83379/odds/history');
    const e = await api.eventOdds('ufc-322-2025-11-15');
    assert.equal(calls[1]!.url.pathname, '/v1/events/ufc-322-2025-11-15/odds');
    assert.deepEqual(e.fights, []);
  });

  it('include: [odds] on fight() and event()', async () => {
    const { calls, fetchImpl } = stub([
      { body: { data: { id: 83379, odds: PAIR } } },
      { body: { data: { id: 83379 } } },
      { body: { data: { slug: 'x', card: [] } } },
    ]);
    const api = new FightAPI({ apiKey: 'k', fetch: fetchImpl });
    const f = await api.fight(83379, { include: ['odds'] });
    assert.equal(calls[0]!.url.search, '?include=odds');
    assert.equal(f.odds?.favourite, 'b');
    await api.fight(83379);
    assert.equal(calls[1]!.url.search, '');
    await api.event('x', { include: ['eta', 'odds'] });
    assert.equal(calls[2]!.url.searchParams.get('include'), 'eta,odds');
  });

  it('fightOddsHistory pages oldest first with from/to', async () => {
    const { calls, fetchImpl } = stub([
      { body: { data: [{ id: 1, ...PAIR }], meta: { pagination: { next_cursor: 'C2', has_more: true } } } },
      { body: { data: [{ id: 2, ...PAIR }], meta: { pagination: { next_cursor: null, has_more: false } } } },
    ]);
    const api = new FightAPI({ apiKey: 'k', fetch: fetchImpl });
    const ids: number[] = [];
    for await (const p of api.fightOddsHistory(83379, { from: '2026-08-01', to: '2026-08-31' })) ids.push(p.id);
    assert.deepEqual(ids, [1, 2]);
    assert.equal(calls[0]!.url.pathname, '/v1/fights/83379/odds/history');
    assert.equal(calls[0]!.url.searchParams.get('from'), '2026-08-01');
    assert.equal(calls[0]!.url.searchParams.get('to'), '2026-08-31');
    assert.equal(calls[1]!.url.searchParams.get('cursor'), 'C2');
  });

  it('fightOddsHistory below Pro throws tier_required', async () => {
    const { fetchImpl } = stub([{ status: 403, body: { error: { code: 'tier_required', message: 'Odds history needs a Pro plan or higher.', request_id: 'r1' } } }]);
    const api = new FightAPI({ apiKey: 'k', fetch: fetchImpl });
    await assert.rejects(async () => {
      for await (const _ of api.fightOddsHistory(83379)) void _;
    }, (e: unknown) => e instanceof FightAPIError && e.code === 'tier_required' && e.status === 403);
  });
});
