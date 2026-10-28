// Compile check: every server .js file and every <script> block in
// every root .html file must parse. This mirrors scripts/check.mjs
// (which uses node --check) so the suite itself catches a broken
// client script even if the check script is not run.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import vm from 'node:vm';
import { extractScripts, root } from './gas-mocks.mjs';
import { join } from 'node:path';

describe('syntax', () => {
  for (const name of readdirSync(root).sort()) {
    if (name.endsWith('.js')) {
      it(`${name} parses`, () => {
        assert.doesNotThrow(() => new vm.Script(readFileSync(join(root, name), 'utf8'), { filename: name }));
      });
    } else if (name.endsWith('.html')) {
      const blocks = extractScripts(name);
      it(`${name} has script blocks that parse`, () => {
        assert.ok(blocks.length > 0, 'expected at least one <script> block');
        blocks.forEach((code, i) => {
          assert.doesNotThrow(
            () => new vm.Script(code, { filename: `${name}#script${i + 1}` }),
            `${name} script block ${i + 1} failed to parse`,
          );
        });
      });
    }
  }

  it('no spreadsheet or script identifier is committed anywhere', () => {
    const idPattern = /\b1[A-Za-z0-9_-]{20,}\b/;
    for (const name of readdirSync(root).sort()) {
      // package-lock.json integrity hashes are base64 and routinely
      // start with a digit; they are not Google identifiers.
      if (name === 'package-lock.json') continue;
      if (name.endsWith('.js') || name.endsWith('.html') || name.endsWith('.json') || name.endsWith('.md')) {
        const text = readFileSync(join(root, name), 'utf8');
        assert.doesNotMatch(text, idPattern, `${name} appears to contain a Google identifier`);
      }
    }
  });

  it('no server file references the old global CONFIG object', () => {
    for (const name of ['config.js', 'util.js', 'checklist.js', 'offeror.js', 'sins.js', 'resources.js']) {
      const text = readFileSync(join(root, name), 'utf8');
      assert.doesNotMatch(text, /\bCONFIG\./, `${name} still references CONFIG.`);
    }
  });
});
