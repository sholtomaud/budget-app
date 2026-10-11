import { deflateRawSync } from 'node:zlib';
import { describe, expect, test } from 'vitest';
import { parseCsv, writeCsv } from '../../src/lib/csv.ts';
import { crc32, readZip, writeZip } from '../../src/lib/zip.ts';

describe('csv', () => {
  test('round-trips quotes, commas, newlines and leading spaces', () => {
    const rows = [
      ['Item', 'Notes'],
      ['Rent, weekly', 'say "hi"'],
      ['Multi\nline', ' padded '],
      ['', ''],
    ];
    expect(parseCsv(writeCsv(rows))).toEqual(rows);
  });

  test('handles a BOM, CRLF and a missing final newline', () => {
    expect(parseCsv('﻿a,b\r\n1,2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
    expect(() => parseCsv('"open')).toThrow(/quoted/);
  });
});

describe('zip', () => {
  test('stored entries round-trip', async () => {
    const enc = new TextEncoder();
    const zip = writeZip([
      { name: 'a.json', data: enc.encode('{"a":1}') },
      { name: 'dir/b.json', data: enc.encode('{"b":2}') },
    ]);
    const entries = await readZip(zip);
    expect(entries.map((e) => [e.name, new TextDecoder().decode(e.data)])).toEqual([
      ['a.json', '{"a":1}'],
      ['dir/b.json', '{"b":2}'],
    ]);
  });

  test('reads deflated entries', async () => {
    const data = new TextEncoder().encode('{"hello":"world"}'.repeat(50));
    const comp = deflateRawSync(data);
    const name = new TextEncoder().encode('x.json');
    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(8, 8, true);
    lv.setUint32(14, crc32(data), true);
    lv.setUint32(18, comp.length, true);
    lv.setUint32(22, data.length, true);
    lv.setUint16(26, name.length, true);
    local.set(name, 30);
    const cen = new Uint8Array(46 + name.length);
    const cv = new DataView(cen.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(10, 8, true);
    cv.setUint32(16, crc32(data), true);
    cv.setUint32(20, comp.length, true);
    cv.setUint32(24, data.length, true);
    cv.setUint16(28, name.length, true);
    cen.set(name, 46);
    const end = new Uint8Array(22);
    const ev = new DataView(end.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(10, 1, true);
    ev.setUint32(12, cen.length, true);
    ev.setUint32(16, local.length + comp.length, true);
    const zip = new Uint8Array([...local, ...comp, ...cen, ...end]);
    const [entry] = await readZip(zip);
    expect(entry?.name).toBe('x.json');
    expect(entry?.data).toEqual(data);
  });

  test('rejects non-zip input', async () => {
    await expect(readZip(new Uint8Array(40))).rejects.toThrow(/Not a ZIP/);
  });
});
