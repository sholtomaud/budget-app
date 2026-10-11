#!/usr/bin/env node
/** Check vendor/gssk/* against GSSK_PIN.json (NFR-KER-001). */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const pin = JSON.parse(readFileSync('vendor/gssk/GSSK_PIN.json', 'utf8'));
let ok = true;
for (const [file, expected] of Object.entries(pin.sha256)) {
  const actual = createHash('sha256')
    .update(readFileSync(`vendor/gssk/${file}`))
    .digest('hex');
  const match = actual === expected;
  ok &&= match;
  console.log(`${match ? 'ok  ' : 'FAIL'} ${file} ${actual}`);
}
console.log(`GSSK ${pin.version} from ${pin.repo} (${pin.branch} @ ${pin.commit})`);
if (!ok) process.exit(1);
