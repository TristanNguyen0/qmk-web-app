/**
 * Lexical retrieval over the catalog's QMK documentation chunks.
 *
 * BM25, ~80 lines, no infrastructure: the corpus is a few hundred chunks of pinned
 * markdown, so a vector database and an embedding provider (which OpenRouter does not
 * offer, and which would put a second paid service on the assistant's critical path)
 * would both be complexity without a payoff. Deterministic, testable, and versioned
 * with the catalog like every other fact.
 */
import type { CatalogDocChunk } from '@qmk-web-app/domain';

/** Words too common in prose and prompts to say anything about relevance. */
const STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'with', 'is', 'are',
  'be', 'as', 'at', 'by', 'it', 'this', 'that', 'from', 'key', 'keys', 'keyboard',
  'if', 'when', 'you', 'your', 'can', 'will', 'not', 'no', 'my', 'me', 'i', 'we',
  'set', 'put', 'make', 'want', 'use', 'using', 'please', 'would', 'should',
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9_]+/)
    .filter((t) => t.length > 1 && !STOP_WORDS.has(t));
}

interface IndexedChunk {
  chunk: CatalogDocChunk;
  /** Term → count within the chunk. */
  counts: Map<string, number>;
  length: number;
}

export interface DocSearch {
  /** Chunks mentioning the query, best first, or [] when nothing scores. */
  search(query: string, limit?: number): { chunk: CatalogDocChunk; score: number }[];
}

/**
 * Builds a BM25 (k1=1.5, b=0.75) index over the chunks. Building is cheap (a few
 * hundred chunks) and done once per request, keeping the index out of process state.
 */
export function buildDocSearch(chunks: readonly CatalogDocChunk[]): DocSearch {
  const indexed: IndexedChunk[] = chunks.map((chunk) => {
    const tokens = tokenize(`${chunk.heading} ${chunk.text}`);
    const counts = new Map<string, number>();
    for (const token of tokens) counts.set(token, (counts.get(token) ?? 0) + 1);
    return { chunk, counts, length: tokens.length };
  });

  const totalLength = indexed.reduce((sum, c) => sum + c.length, 0);
  const averageLength = indexed.length > 0 ? totalLength / indexed.length : 1;
  const documentFrequency = new Map<string, number>();
  for (const c of indexed) for (const term of c.counts.keys()) documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1);

  const K1 = 1.5;
  const B = 0.75;
  const N = indexed.length;

  return {
    search(query, limit = 4) {
      const queryTerms = [...new Set(tokenize(query))].filter((t) => documentFrequency.has(t));
      if (queryTerms.length === 0) return [];

      const scored = indexed.map((c) => {
        let score = 0;
        for (const term of queryTerms) {
          const tf = c.counts.get(term) ?? 0;
          if (tf === 0) continue;
          const df = documentFrequency.get(term) ?? 0;
          const idf = Math.log((N - df + 0.5) / (df + 0.5) + 1);
          score += (idf * tf * (K1 + 1)) / (tf + K1 * (1 - B + B * (c.length / averageLength)));
        }
        return { chunk: c.chunk, score };
      });
      scored.sort((a, b) => b.score - a.score);
      // Require a real score, then a meaningful share of the best, so a prompt that
      // merely mentions "delete" does not drag in half a manual.
      const best = scored[0]?.score ?? 0;
      return scored.filter((s) => s.score > 0 && s.score >= best * 0.25).slice(0, limit);
    },
  };
}

/** A retrieved chunk for the prompt, trimmed to keep the injection bounded. */
export function formatDocChunk(result: { chunk: CatalogDocChunk }, maxChars = 900): string {
  const text = result.chunk.text.length > maxChars ? `${result.chunk.text.slice(0, maxChars)}…` : result.chunk.text;
  return `[QMK docs: ${result.chunk.doc} — ${result.chunk.heading}]\n${text}`;
}
