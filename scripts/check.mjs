// Syntax gate: every server .js file and every <script> block inside
// every root .html file must parse with node --check. Client code
// lives inside HTML files, so a plain `node --check` over .js files
// alone would never see it. Run with: npm run check
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const { readdirSync } = await import('node:fs');

const tmp = mkdtempSync(join(tmpdir(), 'gsa-checklist-check-'));
let failures = 0;

function checkFile(label, contents) {
  const file = join(tmp, label.replace(/[^A-Za-z0-9._-]/g, '_') + '.js');
  writeFileSync(file, contents);
  try {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
  } catch (error) {
    failures += 1;
    process.stderr.write(`FAIL ${label}\n${error.stdout?.toString()}${error.stderr?.toString()}`);
  }
}

try {
  for (const name of readdirSync(root).sort()) {
    if (name.endsWith('.js')) {
      checkFile(name, readFileSync(join(root, name), 'utf8'));
    } else if (name.endsWith('.html')) {
      const html = readFileSync(join(root, name), 'utf8');
      const blocks = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
      if (blocks.length === 0) {
        failures += 1;
        process.stderr.write(`FAIL ${name}: no <script> block found\n`);
      }
      blocks.forEach((match, i) => checkFile(`${name}#script${i + 1}`, match[1]));
    }
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

if (failures > 0) {
  process.stderr.write(`${failures} syntax check(s) failed\n`);
  process.exit(1);
}
console.log('Syntax check passed: all server .js files and HTML <script> blocks parse.');
