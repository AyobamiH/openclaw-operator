// Repository-only, dependency-free foundation check. Run from any directory.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const required = ['AGENTS.md', '.agents/knowledge/README.md',
  '.agents/skills/secure-api-delivery/SKILL.md',
  '.agents/skills/secure-api-delivery/references/api-checks.md',
  '.agents/skills/secure-api-delivery/references/delivery-controls.md',
  '.agents/skills/secure-api-delivery/references/sources.md',
  '.agents/skills/secure-api-delivery/agents/openai.yaml',
  '.agents/skills/secure-api-delivery/assets/icon.svg'];
const errors = [];
function rejectLinks(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const target = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) errors.push('Symlink in foundation: ' + path.relative(root, target));
    else if (entry.isDirectory()) rejectLinks(target);
  }
}
rejectLinks(path.join(root, '.agents'));
for (const rel of required) {
  const file = path.join(root, rel);
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) errors.push('Missing file: ' + rel);
  else if (fs.lstatSync(file).isSymbolicLink()) errors.push('Symlink not portable: ' + rel);
}
for (const rel of ['.agents/knowledge/README.md', ...required.filter(p => p.startsWith('.agents/skills/') && p.endsWith('.md'))]) {
  const file = path.join(root, rel);
  if (!fs.existsSync(file)) continue;
  const body = fs.readFileSync(file, 'utf8');
  if (/\/home\/|\/Users\/|~\/\.agents|~\/\.codex/.test(body)) errors.push('Machine-specific dependency: ' + rel);
  for (const match of body.matchAll(/\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
    const ref = match[1].split('#')[0];
    if (!ref || /^[a-z][a-z\d+.-]*:/i.test(ref)) continue;
    const target = path.resolve(path.dirname(file), decodeURIComponent(ref));
    if (!target.startsWith(root + path.sep) || !fs.existsSync(target)) errors.push('Broken/escaping reference in ' + rel + ': ' + ref);
  }
}
const agents = fs.readFileSync(path.join(root, 'AGENTS.md'), 'utf8');
for (const ref of ['.agents/knowledge/README.md', '.agents/skills/secure-api-delivery/SKILL.md']) {
  if (!agents.includes(ref)) errors.push('Root discovery missing: ' + ref);
}
const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
if (!readme.includes('(AGENTS.md)')) errors.push('README must navigate to AGENTS.md');
if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log('PASS: repository-local foundation files, discovery and relative links');
