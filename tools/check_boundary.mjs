// The engine / game boundary, checked (npm run check):
//   1. Nothing outside src/engine imports 'phaser' (only the engine knows what draws).
//   2. Nothing in src/engine imports from src/game (the engine is reusable by another game).
// Exits with 1 and lists the offending lines if either rule is broken.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const SRC = 'src';
const IMPORT = /^\s*import\s[^;]*?from\s+['"]([^'"]+)['"]/gm;

function files(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...files(path));
    else if (path.endsWith('.ts')) out.push(path);
  }
  return out;
}

const problems = [];
for (const file of files(SRC)) {
  const inEngine = relative(SRC, file).split(sep)[0] === 'engine';
  const text = readFileSync(file, 'utf8');
  for (const m of text.matchAll(IMPORT)) {
    const from = m[1];
    if (!inEngine && from === 'phaser') problems.push(file + ': imports phaser (only src/engine may)');
    if (inEngine && from.includes('/game/')) problems.push(file + ': the engine imports the game (' + from + ')');
  }
}

if (problems.length > 0) {
  console.error('Boundary broken:\n  ' + problems.join('\n  '));
  process.exit(1);
}
console.log('Boundary OK: only src/engine imports phaser, and the engine imports nothing from the game.');
