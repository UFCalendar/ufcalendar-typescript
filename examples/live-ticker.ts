/**
 * Live fight-night ticker over the UFCalendar live WebSocket (Pro plans and up).
 *
 *   npm i @ufcalendar/sdk
 *   UFCAL_API_KEY=ufcalendar_... npx tsx live-ticker.ts ufc-331
 *
 * Prints one line per change, e.g.
 *
 *   R2 3:41 · Oliveira 41 vs Makhachev 37 sig. strikes
 *
 * Node >= 22 has a global WebSocket; on older Node pass
 * `{ WebSocketImpl: (await import('ws')).default as unknown as typeof WebSocket }`.
 *
 * Docs: https://api.ufcalendar.com/docs · keys: https://www.ufcalendar.com/account/api
 */
import { FightAPI } from '@ufcalendar/sdk';
import type { LiveState } from '@ufcalendar/sdk';

const slug = process.argv[2] ?? 'ufc-331';
const api = new FightAPI(); // reads UFCAL_API_KEY

const clock = (sec: number | null | undefined) =>
  sec == null ? '--:--' : `${Math.floor(Math.max(0, sec) / 60)}:${String(Math.max(0, sec) % 60).padStart(2, '0')}`;

function line(state: LiveState): string | null {
  const cur = state.current;
  if (!cur) return null;
  const bout = state.card.find((row) => row.src_id === cur.src_id);
  const a = bout?.a, b = bout?.b;
  const sa = cur.stats?.a?.sig_strikes_landed ?? null;
  const sb = cur.stats?.b?.sig_strikes_landed ?? null;
  const who = `${a?.short ?? a?.name ?? 'A'} ${sa ?? '-'} vs ${b?.short ?? b?.name ?? 'B'} ${sb ?? '-'}`;
  return `R${cur.round ?? '?'} ${clock(cur.clock_sec)} · ${who} sig. strikes`;
}

let last: string | null = null;
const stop = api.subscribeLive(slug, (frame) => {
  if (frame.type === 'error') {
    console.error('error:', frame.code, frame.message);
    return stop();
  }
  const state = frame.data;
  if (!state) return console.log(`${slug}: nothing streaming yet — waiting…`);
  const text = line(state);
  if (text && text !== last) console.log((last = text));
  if (frame.type === 'fight.final') {
    const r = state.last;
    console.log(`  FINAL · ${r?.method} R${r?.round} ${r?.time}`);
  }
  if (frame.type === 'event.completed') {
    console.log('card over');
    stop();
  }
});

process.on('SIGINT', () => {
  stop();
  process.exit(0);
});
