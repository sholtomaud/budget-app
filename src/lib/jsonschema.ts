/**
 * A small JSON Schema validator for the subset the pinned schemas use (ADR
 * 0007, FR-ING-002): type, required, properties, items, enum, const, pattern,
 * minimum/maximum, minItems/maxItems, minLength/maxLength, additionalProperties: false, oneOf, anyOf,
 * allOf, $ref to #/$defs, and the CDR standard's `x-cds-type` string formats.
 * It reports the first failure with its JSON path.
 */
export interface Schema {
  type?: string | string[];
  required?: string[];
  properties?: Record<string, Schema>;
  additionalProperties?: boolean | Schema;
  items?: Schema;
  enum?: unknown[];
  const?: unknown;
  pattern?: string;
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number;
  minItems?: number;
  maxItems?: number;
  minLength?: number;
  maxLength?: number;
  oneOf?: Schema[];
  anyOf?: Schema[];
  allOf?: Schema[];
  $ref?: string;
  $defs?: Record<string, Schema>;
  'x-cds-type'?: string;
  [k: string]: unknown;
}

export interface ValidationError {
  path: string;
  message: string;
}

/** Formats the CDR standard declares with x-cds-type. */
const CDS_TYPES: Record<string, RegExp> = {
  AmountString: /^-?\d+(\.\d+)?$/,
  CurrencyString: /^[A-Z]{3}$/,
  DateString: /^\d{4}-\d{2}-\d{2}$/,
  DateTimeString: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/,
  RateString: /^-?\d+(\.\d+)?$/,
  PositiveInteger: /^\d+$/,
  NaturalNumber: /^\d+$/,
};

function typeOf(v: unknown): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (typeof v === 'number') return Number.isInteger(v) ? 'integer' : 'number';
  return typeof v;
}

function typeMatches(v: unknown, t: string): boolean {
  const actual = typeOf(v);
  return actual === t || (t === 'number' && actual === 'integer');
}

const pathJoin = (path: string, key: string | number) =>
  typeof key === 'number'
    ? `${path}[${key}]`
    : /^[A-Za-z_$][\w$]*$/.test(key)
      ? `${path}.${key}`
      : `${path}[${JSON.stringify(key)}]`;

export function validate(
  schema: Schema,
  value: unknown,
  root: Schema = schema
): ValidationError | null {
  return check(schema, value, '$', root);
}

function resolve(ref: string, root: Schema): Schema {
  const m = /^#\/\$defs\/(.+)$/.exec(ref);
  const target = m ? root.$defs?.[m[1]!] : undefined;
  if (!target) throw new Error(`Unresolvable $ref ${ref}`);
  return target;
}

function check(s: Schema, v: unknown, path: string, root: Schema): ValidationError | null {
  if (s.$ref) return check(resolve(s.$ref, root), v, path, root);
  if (s.allOf) {
    for (const sub of s.allOf) {
      const e = check(sub, v, path, root);
      if (e) return e;
    }
  }
  if (s.anyOf && !s.anyOf.some((sub) => !check(sub, v, path, root))) {
    return { path, message: 'does not match any allowed shape' };
  }
  if (s.oneOf) {
    const n = s.oneOf.filter((sub) => !check(sub, v, path, root)).length;
    if (n !== 1)
      return {
        path,
        message: n ? 'matches more than one allowed shape' : 'does not match any allowed shape',
      };
  }
  if (s.type) {
    const types = Array.isArray(s.type) ? s.type : [s.type];
    if (!types.some((t) => typeMatches(v, t))) {
      return { path, message: `expected ${types.join(' or ')}, got ${typeOf(v)}` };
    }
  }
  if (s.const !== undefined && v !== s.const)
    return { path, message: `must be ${JSON.stringify(s.const)}` };
  if (s.enum && !s.enum.includes(v)) {
    return { path, message: `must be one of ${s.enum.map((x) => JSON.stringify(x)).join(', ')}` };
  }
  if (typeof v === 'string') {
    if (s.minLength !== undefined && v.length < s.minLength)
      return { path, message: `shorter than ${s.minLength}` };
    if (s.maxLength !== undefined && v.length > s.maxLength)
      return { path, message: `longer than ${s.maxLength}` };
    if (s.pattern && !new RegExp(s.pattern, 'u').test(v))
      return { path, message: `does not match ${s.pattern}` };
    const cds = s['x-cds-type'];
    const re = cds ? CDS_TYPES[cds] : undefined;
    if (re && !re.test(v)) return { path, message: `is not a valid ${cds}: ${JSON.stringify(v)}` };
  }
  if (typeof v === 'number') {
    if (s.minimum !== undefined && v < s.minimum)
      return { path, message: `must be ≥ ${s.minimum}` };
    if (s.exclusiveMinimum !== undefined && v <= s.exclusiveMinimum)
      return { path, message: `must be > ${s.exclusiveMinimum}` };
    if (s.maximum !== undefined && v > s.maximum)
      return { path, message: `must be ≤ ${s.maximum}` };
  }
  if (Array.isArray(v)) {
    if (s.minItems !== undefined && v.length < s.minItems)
      return { path, message: `needs at least ${s.minItems} item(s)` };
    if (s.maxItems !== undefined && v.length > s.maxItems)
      return { path, message: `allows at most ${s.maxItems} item(s)` };
    if (s.items) {
      for (let i = 0; i < v.length; i++) {
        const e = check(s.items, v[i], pathJoin(path, i), root);
        if (e) return e;
      }
    }
  }
  if (typeOf(v) === 'object') {
    const obj = v as Record<string, unknown>;
    for (const key of s.required ?? []) {
      if (!(key in obj)) return { path: pathJoin(path, key), message: 'is required' };
    }
    for (const [key, sub] of Object.entries(s.properties ?? {})) {
      if (key in obj) {
        const e = check(sub, obj[key], pathJoin(path, key), root);
        if (e) return e;
      }
    }
    if (s.additionalProperties !== undefined && s.additionalProperties !== true) {
      for (const key of Object.keys(obj)) {
        if (s.properties && key in s.properties) continue;
        if (s.additionalProperties === false)
          return { path: pathJoin(path, key), message: 'is not an allowed property' };
        const e = check(s.additionalProperties, obj[key], pathJoin(path, key), root);
        if (e) return e;
      }
    }
  }
  return null;
}

export function formatError(e: ValidationError): string {
  return `${e.path} ${e.message}`;
}
