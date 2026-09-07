/**
 * Live smoke test for the assistant against a real model, without the API or UI.
 *
 * Builds a configuration from a keyboard's QMK default keymap in the published
 * catalog, runs one assistant request, and prints the resolved result: the model's
 * summary, every concrete change, what it declared unsupported, what the resolver
 * refused, and the validation verdict. Nothing is saved anywhere.
 *
 * Usage (Anthropic key, or an OpenRouter `sk-or-...` key — see factory.ts):
 *   QWA_ASSISTANT_API_KEY=sk-... pnpm assistant:try <keyboardId> "<prompt>" [--layout NAME] [--json]
 *   QWA_ASSISTANT_API_KEY=sk-... pnpm assistant:try crkbd/rev1 "default qwerty, SOCD on WASD, Fn+Del toggles it"
 */
import { randomUUID } from 'node:crypto';
import { importDefaultKeymap, type Catalog, type Configuration } from '@qmk-web-app/domain';
import { openPublishedCatalog } from '@qmk-web-app/qmk-catalog';
import { loadManifest, publishedCatalogPath } from '../../../infra/qmk/manifest.ts';
import { createAssistantProviderFromEnv, ProviderError, runAssistant } from '../src/index.ts';

const args = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : undefined;
};
const positional = args.filter((a, i) => !a.startsWith('--') && (i === 0 || !args[i - 1]!.startsWith('--')));
const [keyboardId, prompt] = positional;
if (!keyboardId || !prompt) {
  console.error('usage: try-assistant.ts <keyboardId> "<prompt>" [--layout NAME] [--json]');
  process.exit(64);
}
const apiKey = process.env['QWA_ASSISTANT_API_KEY'];
if (!apiKey) {
  console.error('QWA_ASSISTANT_API_KEY is required');
  process.exit(64);
}

const manifest = loadManifest();
const published = openPublishedCatalog(publishedCatalogPath(manifest));
const keyboard = published.getKeyboard(keyboardId);
if (!keyboard?.supported) {
  console.error(`${keyboardId} is not a supported keyboard in catalog ${published.index.catalogVersion}`);
  process.exit(1);
}
const layoutId = flag('--layout') ?? keyboard.layouts[0]!.name;
const aliases = published.index.keycodeAliases ?? {};

const catalog: Catalog = {
  catalogVersion: published.index.catalogVersion,
  qmkCommit: published.index.qmkCommit,
  extractorVersion: published.index.extractorVersion,
  normalizerVersion: published.index.normalizerVersion,
  generatedAt: published.index.generatedAt,
  keycodeSpecVersion: published.index.keycodeSpecVersion,
  keycodeAliases: aliases,
  communityKeymaps: published.index.communityKeymaps ?? {},
  docChunks: published.index.docChunks ?? [],
  keyboards: [keyboard],
};

const imported = importDefaultKeymap({ keyboard, layoutId, keycodeAliases: aliases });
const now = new Date().toISOString();
const configuration: Configuration = {
  id: randomUUID(),
  ownerId: null,
  schemaVersion: 1,
  catalogVersion: catalog.catalogVersion,
  qmkCommit: catalog.qmkCommit,
  keyboardId,
  layoutId,
  name: `${keyboard.displayName} keymap`,
  revision: 0,
  createdAt: now,
  updatedAt: now,
  layers: imported.available ? imported.layers : [{ id: randomUUID(), index: 0, name: 'Base', bindings: {} }],
  macros: [],
  socd: null,
  generatorVersion: 'try',
};

const provider = createAssistantProviderFromEnv(process.env, { appTitle: 'qmk-web-app' })!;

console.error(`${keyboard.displayName} (${keyboardId}) / ${layoutId} — starting from ${imported.available ? 'QMK default' : 'blank'}; model ${provider.model}`);
const started = Date.now();
let result;
try {
  result = await runAssistant({ provider, configuration, catalog, prompt });
} catch (error) {
  if (error instanceof ProviderError) {
    console.error(`provider failure: ${error.message}`);
    process.exit(1);
  }
  throw error;
}
const elapsed = Date.now() - started;

if (args.includes('--json')) {
  console.log(JSON.stringify(result, null, 2));
  process.exit(0);
}

console.log(`\n${elapsed} ms, ${result.attempts} attempt(s), ${result.usage.inputTokens} in / ${result.usage.outputTokens} out tokens, ${result.model}\n`);
if (result.outcome === 'malformed') {
  console.log('MALFORMED — the model never produced a proposal that parses:');
  for (const e of result.errors) console.log(`  - ${e}`);
  process.exit(1);
}
const { resolved } = result;
console.log(`Summary: ${resolved.summary}\n`);
console.log(`Changes (${resolved.changes.length}):`);
for (const c of resolved.changes) console.log(`  - ${c.description}`);
if (resolved.unsupported.length > 0) {
  console.log(`\nUnsupported (${resolved.unsupported.length}):`);
  for (const u of resolved.unsupported) console.log(`  - ${u.request}: ${u.reason}${u.alternative ? ` (instead: ${u.alternative})` : ''}`);
}
if (resolved.issues.length > 0) {
  console.log(`\nRefused by the resolver (${resolved.issues.length}):`);
  for (const i of resolved.issues) console.log(`  - op ${i.operation} ${i.op}: ${i.reason}${i.candidates ? ` [${i.candidates.join('; ')}]` : ''}`);
}
console.log(`\nValidation: ${resolved.validation.ok ? 'ok' : `${resolved.validation.code} — ${resolved.validation.message}`}`);
console.log(`Result: ${resolved.ok ? 'OK — applicable as-is' : 'PARTIAL — review before applying'}`);
process.exit(resolved.ok ? 0 : 2);
