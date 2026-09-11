import {readFile, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {WORKBENCH_VERSION} from './version.mjs';
import {CORE_PROTOCOL} from './protocol.mjs';

export const RELEASE_SKILLS = Object.freeze(['creativity-media', 'creativity-project']);

/** Synchronize only current release metadata; leave dated reference text intact. */
export async function syncReleaseMetadata(root) {
  const manifestPath = join(root, 'workbench', 'manifest.json');
  const manifestText = await readFile(manifestPath, 'utf8'), manifest = JSON.parse(manifestText);
  const entries = manifest.capabilities?.filter(item => item.id === 'workbuddy-core-mcp');
  if (entries?.length !== 1) throw new Error('Manifest must contain one workbuddy-core-mcp capability.');
  const core = entries[0], files = [];
  if (core.skillVersion !== WORKBENCH_VERSION || core.protocolVersion !== CORE_PROTOCOL) {
    core.skillVersion = WORKBENCH_VERSION; core.protocolVersion = CORE_PROTOCOL;
    files.push([manifestPath, JSON.stringify(manifest, null, 2) + '\n']);
  }
  for (const name of RELEASE_SKILLS) {
    const path = join(root, 'workbench', 'skills', name, 'SKILL.md'), text = await readFile(path, 'utf8');
    const frontmatter = text.match(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/)?.[0];
    const versions = frontmatter?.match(/^version:[^\r\n]*/gm);
    if (versions?.length !== 1) throw new Error(`${name}/SKILL.md must declare exactly one frontmatter version.`);
    const updated = text.replace(frontmatter, () => frontmatter.replace(/^version:[^\r\n]*/m, 'version: ' + WORKBENCH_VERSION));
    if (text !== updated) files.push([path, updated]);
  }
  // Validate all inputs before writing; malformed metadata cannot produce a
  // partly refreshed install package. Unchanged files are not rewritten.
  for (const [path, text] of files) await writeFile(path, text);
  return files.map(([path]) => path);
}
