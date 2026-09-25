/**
 * subscribeLive() over a fake WebSocket — no network, no global WebSocket.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { FightAPI } from './index';
import type { LiveFrame } from './index';

/** Records what the client sent, and lets the test push frames back. */
class FakeSocket {
  static opened: FakeSocket[] = [];
  readonly sent: string[] = [];
  closed = false;
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;

  constructor(readonly url: string) {
    FakeSocket.opened.push(this);
  }

  send(data: string) {
    this.sent.push(data);
  }

  close() {
    this.closed = true;
  }

  /** Simulate the server handshake + a frame. */
  open() {
    this.onopen?.();
  }

  emit(frame: unknown) {
    this.onmessage?.({ data: JSON.stringify(frame) });
  }

  drop() {
    this.onclose?.();
  }
}

function fresh() {
  FakeSocket.opened = [];
  return FakeSocket as unknown as typeof WebSocket;
}

describe('subscribeLive', () => {
  it('connects with the key, subscribes and hands every frame to the callback', () => {
    const Impl = fresh();
    const api = new FightAPI({ apiKey: 'ufcalendar_abc' });
    const frames: LiveFrame[] = [];
    const stop = api.subscribeLive('ufc-331', (f) => frames.push(f), { WebSocketImpl: Impl });

    const sock = FakeSocket.opened[0]!;
    assert.equal(sock.url, 'wss://live.ufcalendar.com/v1?key=ufcalendar_abc');
    sock.open();
    assert.deepEqual(JSON.parse(sock.sent[0]!), { action: 'subscribe', event: 'ufc-331' });

    sock.emit({ type: 'snapshot', data: { seq: 1 } });
    sock.emit({ type: 'update', data: { seq: 2 } });
    assert.deepEqual(frames.map((f) => f.type), ['snapshot', 'update']);

    stop();
    assert.equal(sock.closed, true);
  });

  it('closes itself after fight.final with { until: "final" }', () => {
    const Impl = fresh();
    const api = new FightAPI({ apiKey: 'ufcalendar_abc' });
    const frames: LiveFrame[] = [];
    api.subscribeLive('ufc-331', (f) => frames.push(f), { until: 'final', WebSocketImpl: Impl });

    const sock = FakeSocket.opened[0]!;
    sock.open();
    sock.emit({ type: 'update', data: { seq: 1 } });
    assert.equal(sock.closed, false);
    sock.emit({ type: 'fight.final', data: { seq: 2 } });
    assert.equal(sock.closed, true, 'closed on the final frame');
    assert.deepEqual(frames.map((f) => f.type), ['update', 'fight.final']);

    // and it does NOT reconnect after the close it asked for
    sock.drop();
    assert.equal(FakeSocket.opened.length, 1);
  });

  it('reconnects once on a dropped socket, then stops', () => {
    const Impl = fresh();
    const api = new FightAPI({ apiKey: 'ufcalendar_abc' });
    api.subscribeLive('ufc-331', () => {}, { WebSocketImpl: Impl });

    FakeSocket.opened[0]!.drop();
    assert.equal(FakeSocket.opened.length, 2, 'reconnected');
    const second = FakeSocket.opened[1]!;
    second.open();
    assert.deepEqual(JSON.parse(second.sent[0]!), { action: 'subscribe', event: 'ufc-331' });

    second.drop();
    assert.equal(FakeSocket.opened.length, 2, 'gave up after one reconnect');
  });

  it('never reconnects after the caller unsubscribed', () => {
    const Impl = fresh();
    const api = new FightAPI({ apiKey: 'ufcalendar_abc' });
    const stop = api.subscribeLive('ufc-331', () => {}, { WebSocketImpl: Impl });
    stop();
    FakeSocket.opened[0]!.drop();
    assert.equal(FakeSocket.opened.length, 1);
  });

  it('ignores an unparseable frame instead of throwing', () => {
    const Impl = fresh();
    const api = new FightAPI({ apiKey: 'ufcalendar_abc' });
    const frames: LiveFrame[] = [];
    api.subscribeLive('ufc-331', (f) => frames.push(f), { WebSocketImpl: Impl });
    const sock = FakeSocket.opened[0]!;
    sock.onmessage?.({ data: 'not json' });
    sock.emit({ type: 'update', data: null });
    assert.deepEqual(frames.map((f) => f.type), ['update']);
  });

  it('explains itself when no WebSocket implementation exists', () => {
    const api = new FightAPI({ apiKey: 'ufcalendar_abc' });
    const g = globalThis as { WebSocket?: unknown };
    const saved = g.WebSocket;
    delete g.WebSocket;
    try {
      assert.throws(() => api.subscribeLive('ufc-331', () => {}), /WebSocket/);
    } finally {
      if (saved !== undefined) g.WebSocket = saved;
    }
  });
});
