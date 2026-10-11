import { afterEach, describe, expect, test } from 'vitest';
import { expose, wrap, type Endpoint } from '../../src/workers/rpc.ts';

const channels: MessageChannel[] = [];
afterEach(() => {
  for (const c of channels.splice(0)) {
    c.port1.close();
    c.port2.close();
  }
});

function connect<T extends Record<string, (...args: never[]) => unknown>>(api: T) {
  const channel = new MessageChannel();
  channels.push(channel);
  expose(api, channel.port1 as unknown as Endpoint);
  return wrap<T>(channel.port2 as unknown as Endpoint);
}

describe('rpc', () => {
  test('calls sync and async methods and returns structured-cloned results', async () => {
    const remote = connect({
      add: (a: number, b: number) => a + b,
      slow: async (xs: number[]) => ({
        total: xs.reduce((s, x) => s + x, 0),
        at: new Float64Array(xs),
      }),
    });
    await expect(remote.add(2, 3)).resolves.toBe(5);
    const r = await remote.slow([1, 2, 3]);
    expect(r.total).toBe(6);
    expect(Array.from(r.at)).toEqual([1, 2, 3]);
  });

  test('matches concurrent replies to their calls', async () => {
    const remote = connect({
      wait: (ms: number, v: string) => new Promise<string>((res) => setTimeout(() => res(v), ms)),
    });
    const results = await Promise.all([
      remote.wait(30, 'a'),
      remote.wait(0, 'b'),
      remote.wait(10, 'c'),
    ]);
    expect(results).toEqual(['a', 'b', 'c']);
  });

  test('rejects with the remote error name and message', async () => {
    class PinMismatchError extends Error {
      override name = 'PinMismatchError';
    }
    const remote = connect({
      fail: () => {
        throw new PinMismatchError('hash differs');
      },
    });
    await expect(remote.fail()).rejects.toMatchObject({
      name: 'PinMismatchError',
      message: 'hash differs',
    });
  });

  test('rejects calls to unknown or inherited methods', async () => {
    const remote = connect({ ok: () => 1 }) as unknown as Record<string, () => Promise<unknown>>;
    await expect(remote.missing!()).rejects.toThrow('No RPC method "missing"');
    await expect(remote.toString!()).rejects.toThrow('No RPC method "toString"');
  });

  test('the proxy is not thenable, so it can be returned from async functions', async () => {
    const remote = connect({ ok: () => 1 });
    const same = await Promise.resolve(remote);
    await expect(same.ok()).resolves.toBe(1);
  });
});
