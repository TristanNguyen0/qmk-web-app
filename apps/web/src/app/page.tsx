/**
 * Keyboard picker.
 *
 * Every fact on this page comes from the catalog API. The page has no keyboard list
 * of its own (claude.md § Catalog interfaces: the frontend "must not carry its own
 * unofficial keyboard catalog").
 */
import { fetchCatalogMeta, fetchKeyboards } from '../lib/api.ts';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 48;

interface PageProps {
  searchParams: Promise<{ search?: string; page?: string; includeUnsupported?: string }>;
}

export default async function KeyboardPickerPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const search = params.search ?? '';
  const includeUnsupported = params.includeUnsupported === 'true';
  const page = Number.parseInt(params.page ?? '1', 10) || 1;

  const [meta, results] = await Promise.all([
    fetchCatalogMeta(),
    fetchKeyboards({ search, page, pageSize: PAGE_SIZE, includeUnsupported }),
  ]);

  function pageHref(target: number): string {
    const q = new URLSearchParams();
    if (search) q.set('search', search);
    if (includeUnsupported) q.set('includeUnsupported', 'true');
    q.set('page', String(target));
    return `/?${q.toString()}`;
  }

  return (
    <>
      <h1>Choose a keyboard</h1>

      {/*
        Provenance is shown up front: the user should always know which QMK revision
        the data came from (claude.md § Discovery process, step 6).
      */}
      <p className="provenance">
        Catalog <code>{meta.catalogVersion}</code> from QMK{' '}
        <code>{meta.qmkCommit.slice(0, 12)}</code> — {meta.supportedKeyboards.toLocaleString()} of{' '}
        {meta.totalKeyboards.toLocaleString()} keyboards supported.
      </p>

      <form className="search-form" method="get" role="search">
        <label className="skip-link" htmlFor="search">
          Search keyboards
        </label>
        <input
          id="search"
          name="search"
          type="search"
          defaultValue={search}
          placeholder="Search by name or id, e.g. crkbd or planck"
        />
        {includeUnsupported ? (
          <input type="hidden" name="includeUnsupported" value="true" />
        ) : null}
        <button type="submit">Search</button>
      </form>

      <p className="muted" style={{ fontSize: '0.875rem' }}>
        {results.totalItems.toLocaleString()} match{results.totalItems === 1 ? '' : 'es'}
        {' · '}
        <a
          href={`/?${new URLSearchParams({
            ...(search ? { search } : {}),
            ...(includeUnsupported ? {} : { includeUnsupported: 'true' }),
          }).toString()}`}
        >
          {includeUnsupported ? 'Hide unsupported keyboards' : 'Show unsupported keyboards'}
        </a>
      </p>

      {results.items.length === 0 ? (
        <p className="notice">
          No keyboards match “{search}” in catalog {meta.catalogVersion}. This catalog only
          contains keyboards whose metadata could be fully validated from the pinned QMK
          revision.
        </p>
      ) : (
        <ul className="keyboard-grid">
          {results.items.map((kb) => (
            <li key={kb.keyboardId}>
              <a className="keyboard-card" href={`/keyboards/${kb.keyboardId}`}>
                <div>
                  <strong>{kb.displayName}</strong>{' '}
                  {kb.supported ? null : (
                    <span className="unsupported-badge">Unsupported</span>
                  )}
                </div>
                <div className="keyboard-card__id">{kb.keyboardId}</div>
                <div className="keyboard-card__meta">
                  {kb.supported ? (
                    <>
                      {kb.processor} · {kb.layoutNames.length} layout
                      {kb.layoutNames.length === 1 ? '' : 's'}
                    </>
                  ) : (
                    <>Cannot be offered: {kb.unsupportedReason?.replace(/_/g, ' ')}</>
                  )}
                </div>
              </a>
            </li>
          ))}
        </ul>
      )}

      {results.totalPages > 1 ? (
        <nav className="pagination" aria-label="Pagination">
          {results.page > 1 ? <a href={pageHref(results.page - 1)}>← Previous</a> : null}
          <span className="muted">
            Page {results.page} of {results.totalPages}
          </span>
          {results.page < results.totalPages ? (
            <a href={pageHref(results.page + 1)}>Next →</a>
          ) : null}
        </nav>
      ) : null}
    </>
  );
}
