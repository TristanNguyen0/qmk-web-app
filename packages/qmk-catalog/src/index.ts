export {
  normalizeCatalog,
  parseExtractorDump,
  keycodeNamesFromSpec,
  keycodeAliasesFromSpec,
  CatalogNormalizationError,
  NORMALIZER_VERSION,
} from './normalize.ts';
export type {
  ExtractorCommunityKeymapRecord,
  ExtractorDocsRecord,
  ExtractorDefaultKeymap,
  ExtractorKeyboardRecord,
  ExtractorKeycodeSpec,
  ExtractorProvenance,
  ExtractorRecord,
  NormalizeOptions,
} from './normalize.ts';
export { extractCatalog } from './extract.ts';
export type { ExtractOptions } from './extract.ts';
export { publishCatalog, PUBLISH_FORMAT_VERSION } from './publish.ts';
export type { CatalogIndex, CatalogIndexEntry } from './publish.ts';
export { openPublishedCatalog, isPublishedCatalogDir, PublishedCatalogError } from './read-published.ts';
export type { PublishedCatalog } from './read-published.ts';
