import { describe, expect, test } from 'vitest';
import { validate, type Schema } from '../../src/lib/jsonschema.ts';

const schema: Schema = {
  type: 'object',
  required: ['data'],
  properties: {
    data: {
      type: 'object',
      required: ['items'],
      properties: { items: { type: 'array', items: { $ref: '#/$defs/Item' } } },
    },
  },
  $defs: {
    Item: {
      type: 'object',
      required: ['amount', 'status'],
      properties: {
        amount: { type: 'string', 'x-cds-type': 'AmountString' },
        status: { type: 'string', enum: ['PENDING', 'POSTED'] },
        at: { type: 'string', 'x-cds-type': 'DateTimeString' },
      },
    },
  },
};

describe('jsonschema subset', () => {
  test('accepts valid documents and ignores unknown fields', () => {
    expect(
      validate(schema, {
        data: { items: [{ amount: '-1.50', status: 'POSTED', extra: 1 }] },
        'x-synthetic': {},
      })
    ).toBeNull();
  });

  test('reports the first failing path', () => {
    expect(
      validate(schema, {
        data: {
          items: [
            { amount: '1', status: 'POSTED' },
            { amount: 'abc', status: 'POSTED' },
          ],
        },
      })
    ).toEqual({
      path: '$.data.items[1].amount',
      message: 'is not a valid AmountString: "abc"',
    });
    expect(validate(schema, { data: {} })?.path).toBe('$.data.items');
    expect(
      validate(schema, { data: { items: [{ amount: '1', status: 'DONE' }] } })?.message
    ).toMatch(/one of/);
    expect(
      validate(schema, { data: { items: [{ amount: '1', status: 'POSTED', at: '2025-01-01' }] } })
        ?.path
    ).toBe('$.data.items[0].at');
  });

  test('additionalProperties: false and oneOf', () => {
    expect(
      validate(
        { type: 'object', properties: { a: {} }, additionalProperties: false },
        { a: 1, b: 2 }
      )?.path
    ).toBe('$.b');
    const one: Schema = { oneOf: [{ type: 'string' }, { type: 'object', required: ['normal'] }] };
    expect(validate(one, 'x')).toBeNull();
    expect(validate(one, { normal: [1] })).toBeNull();
    expect(validate(one, 3)).not.toBeNull();
  });

  test('maxLength and maxItems', () => {
    const schema: Schema = { type: 'array', maxItems: 2, items: { type: 'string', maxLength: 3 } };
    expect(validate(schema, ['abc', 'de'])).toBeNull();
    expect(validate(schema, ['abcd'])?.message).toBe('longer than 3');
    expect(validate(schema, ['a', 'b', 'c'])?.message).toBe('allows at most 2 item(s)');
  });
});
