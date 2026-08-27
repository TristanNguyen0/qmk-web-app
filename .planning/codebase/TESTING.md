# Testing Patterns

**Analysis Date:** 2026-08-27

## Test Framework

**Runner:**
- Vitest 2.1.8 (`vitest` in `devDependencies`)
- Config: `vitest.config.ts` at repository root
- TypeScript support built-in (no separate compilation needed)

**Assertion Library:**
- Vitest's built-in `expect` API (Jest-compatible)
- No additional assertion library needed

**Run Commands:**
```bash
pnpm test              # Run all tests once (CI mode)
pnpm test:watch       # Run tests in watch mode (interactive)
```

Root `package.json` defines:
```json
"test": "vitest run",
"test:watch": "vitest"
```

## Test File Organization

**Location:**
- Co-located with source files in same directory
- Pattern: `module.test.ts` adjacent to `module.ts`
- Applies across all workspace packages, services, and apps

**Examples:**
- `packages/domain/src/validate.ts` → `packages/domain/src/validate.test.ts`
- `services/worker/src/queue-runner.ts` → `services/worker/src/queue-runner.test.ts`
- `apps/api/src/routes/catalog.ts` → `apps/api/src/routes/catalog.test.ts`
- `apps/web/src/lib/editor-state.ts` → `apps/web/src/lib/editor-state.test.ts`

**Naming:**
- `*.test.ts` suffix (never `.spec.ts`)
- File names match their source module

**Discovery:**
Vitest includes test files via patterns in `vitest.config.ts`:
```typescript
include: ['packages/**/*.test.ts', 'services/**/*.test.ts', 'apps/**/*.test.ts']
```

## Test Structure

**Suite Organization:**
```typescript
import { describe, expect, it } from 'vitest';

describe('functionName', () => {
  it('does X when given Y', () => {
    // Arrange
    const input = makeTestData();
    
    // Act
    const result = functionUnderTest(input);
    
    // Assert
    expect(result).toBe(expectedValue);
  });
});
```

**Patterns:**

1. **Setup/Teardown with beforeEach/afterEach:**
   ```typescript
   let store: ArtifactStore;
   
   beforeEach(() => {
     store = new InMemoryArtifactStore();
   });
   
   afterEach(() => {
     // Cleanup if needed
   });
   ```

2. **One-time Setup with beforeAll/afterAll:**
   ```typescript
   let app: FastifyInstance;
   
   beforeAll(() => {
     const store = new CatalogStore();
     store.add(catalog);
     app = buildApp({ store, /* ... */ });
   });
   ```

3. **Helper Functions for Test Data:**
   ```typescript
   function config(overrides: Record<string, unknown> = {}): Record<string, unknown> {
     return {
       id: '22222222-2222-4222-8222-222222222222',
       name: 'Test',
       // ... defaults
       ...overrides,
     };
   }
   
   function buildRecord(overrides: Partial<BuildRecord> = {}): BuildRecord {
     return {
       id: randomUUID(),
       // ... defaults
       ...overrides,
     };
   }
   ```

4. **Custom Test Helpers for Assertions:**
   ```typescript
   function expectCode(input: unknown, code: string): void {
     try {
       validateConfiguration(input, { catalog });
       throw new Error(`expected validation to fail with ${code}`);
     } catch (error) {
       expect(error).toBeInstanceOf(DomainError);
       expect((error as DomainError).code).toBe(code);
     }
   }
   
   describe('validateConfiguration', () => {
     it('rejects unknown fields', () => {
       expectCode(config({ injected: 'value' }), ERROR_CODES.CONFIG_INVALID);
     });
   });
   ```

5. **Reducer Testing with Helper:**
   ```typescript
   function run(initial: EditorState, ...actions: Parameters<typeof editorReducer>[1][]): EditorState {
     return actions.reduce(editorReducer, initial);
   }
   
   describe('bindings', () => {
     it('sets a binding and marks the document dirty', () => {
       const next = run(state(), {
         type: 'set_binding',
         layerIndex: 0,
         position: 3,
         binding: { kind: 'keycode', keycode: 'KC_A' },
       });
       expect(next.document.layers[0]?.bindings['3']).toEqual(/* ... */);
     });
   });
   ```

6. **HTTP Testing with Fastify Inject:**
   ```typescript
   async function get(url: string) {
     const res = await app.inject({ method: 'GET', url });
     return { status: res.statusCode, body: res.json() as Record<string, unknown> };
   }
   
   describe('catalog', () => {
     it('returns 200', async () => {
       const { status, body } = await get('/v1/catalog');
       expect(status).toBe(200);
     });
   });
   ```

7. **Contract Tests with Factory:**
   ```typescript
   function contractFor(name: string, make: () => ArtifactStore) {
     describe(name, () => {
       let store: ArtifactStore;
       beforeEach(() => {
         store = make();
       });
       // Shared tests run against both InMemory and Filesystem implementations
       it('stores and returns an object byte for byte', async () => { /* ... */ });
     });
   }
   
   contractFor('InMemoryArtifactStore', () => new InMemoryArtifactStore());
   contractFor('FilesystemArtifactStore', () => new FilesystemArtifactStore(root));
   ```

## Mocking

**Framework:** Vitest's `vi` utilities

**Patterns:**

1. **Spying on Methods with mockResolvedValue:**
   ```typescript
   import { vi } from 'vitest';
   
   it('abandons a build when completion loses the race', async () => {
     vi.spyOn(queue, 'complete').mockResolvedValue(false);
     
     expect(await runner.runOnce()).toBe('abandoned');
     expect(await artifacts.get(artifactKey(buildId))).toBeNull();
   });
   ```

2. **Fake Implementations for Complex Behavior:**
   Create test-specific implementations of interfaces instead of mocking everything:
   
   ```typescript
   class FakeSandbox implements BuildSandbox {
     outcome: SandboxOutcome = 'succeeded';
     firmware = Buffer.from('fake firmware');
     produceArtifact = true;
     readonly requests: SandboxRunRequest[] = [];
     onRun?: () => void | Promise<void>;
     
     async run(request: SandboxRunRequest): Promise<SandboxRunResult> {
       this.requests.push(request);
       await this.onRun?.();
       if (this.outcome === 'succeeded' && this.produceArtifact) {
         // Write fake firmware
       }
       return { outcome: this.outcome, /* ... */ };
     }
   }
   
   let sandbox: FakeSandbox;
   beforeEach(() => {
     sandbox = new FakeSandbox();
   });
   
   it('can simulate different outcomes', async () => {
     sandbox.outcome = 'failed';
     // Test failure path
   });
   ```

3. **Inline Factories as Mocks:**
   ```typescript
   const queue = new InMemoryBuildStore(async (id, revision) =>
     id === configurationId && revision === 1 ? configuration : null,
   );
   ```

**What to Mock:**
- External services (APIs, databases) — create in-memory fakes
- Async operations that are slow or require resources (Docker sandbox, file I/O)
- Callbacks and event handlers — use `vi.spyOn` for method verification

**What NOT to Mock:**
- Domain logic (validation, generation) — test the real implementation
- Structural types that just hold data — create test instances directly
- The module under test — always test with real code

Example of NOT mocking domain validation:
```typescript
// ✓ GOOD: Test real validation
const { configuration, keyboard } = validateConfiguration(input, { catalog });

// ✗ BAD: Don't mock the core logic
vi.mocked(validateConfiguration).mockReturnValue(fakeResult);
```

## Fixtures and Factories

**Test Data:**
Use factory functions to create consistent test data, allowing overrides:

```typescript
function config(overrides: Record<string, unknown> = {}): Configuration {
  return {
    id: '22222222-2222-4222-8222-222222222222',
    ownerId: null,
    schemaVersion: 1,
    catalogVersion: catalog.catalogVersion,
    qmkCommit: catalog.qmkCommit,
    keyboardId: 'crkbd/rev1',
    layoutId: 'LAYOUT_split_3x6_3',
    name: 'Test',
    revision: 1,
    createdAt: NOW,
    updatedAt: NOW,
    layers: [{
      id: '33333333-3333-4333-8333-333333333331',
      index: 0,
      name: 'Base',
      bindings: { '0': { kind: 'keycode', keycode: 'KC_A' } },
    }],
    macros: [],
    socd: null,
    generatorVersion: '1.0.0',
    ...overrides,
  };
}

// Use with overrides:
expectCode(config({ injected: 'value' }), ERROR_CODES.CONFIG_INVALID);
expectCode(config({ keyboardId: 'nonexistent/kb' }), ERROR_CODES.CATALOG_KEYBOARD_UNAVAILABLE);
```

**Shared Fixtures:**
Loaded once per test file:

```typescript
import { readCatalogSample } from '@qmk-web-app/qmk-fixtures';
const catalog = readCatalogSample() as Catalog;
```

The `@qmk-web-app/qmk-fixtures` package provides sample data:
- `readCatalogSample()` — returns a representative catalog for testing
- Used across `validate.test.ts`, `catalog.test.ts`, `queue-runner.test.ts`, etc.

**Location:**
- Test data factories defined in test files themselves (co-located)
- Shared fixtures imported from `@qmk-web-app/qmk-fixtures` package (`packages/qmk-fixtures/`)

## Coverage

**Requirements:** Not enforced by configuration

**View Coverage:**
No built-in coverage command configured. Coverage can be run via:
```bash
vitest run --coverage
```

## Test Types

**Unit Tests:**
- Scope: Single function/class in isolation (or with minimal dependencies)
- Approach: Test data factories + direct function calls
- Examples: `validate.test.ts`, `identifiers.test.ts`, `keycodes.test.ts`
- Dependencies: Injected as parameters or created in `beforeEach`

**Integration Tests:**
- Scope: Multiple components working together (API + storage, generator + filesystem)
- Approach: Real implementations with in-memory fakes where needed
- Examples: `catalog.test.ts` (Fastify app + store), `queue-runner.test.ts` (runner + fake sandbox)
- Setup: Opt-in by checking `QWA_INTEGRATION` env var (for Docker-based tests)
- Timeout: 30 seconds (`testTimeout: 30_000` in vitest config)

**E2E Tests:**
- Not currently used
- Docker-based integration tests opt-in via `QWA_INTEGRATION` environment variable

## Common Patterns

**Async Testing:**
```typescript
it('succeeds with a valid configuration', async () => {
  const { configuration, keyboard } = validateConfiguration(config(), { catalog });
  expect(configuration.keyboardId).toBe('crkbd/rev1');
  expect(keyboard.supported).toBe(true);
});

it('stores and returns an object byte for byte', async () => {
  const contents = Buffer.from([0x00, 0xff, 0x10, 0x7f]);
  await store.put({ key: artifactKey(BUILD_ID), contents, contentType: 'application/octet-stream' });
  const read = await store.get(artifactKey(BUILD_ID));
  expect(read).toEqual(contents);
});
```

**Error Testing:**
Use helper functions to assert error codes:

```typescript
function expectCode(input: unknown, code: string): void {
  try {
    validateConfiguration(input, { catalog });
    throw new Error(`expected validation to fail with ${code}`);
  } catch (error) {
    expect(error).toBeInstanceOf(DomainError);
    expect((error as DomainError).code).toBe(code);
  }
}

describe('validateConfiguration', () => {
  it('rejects unknown fields', () => {
    expectCode(config({ injected: 'value' }), ERROR_CODES.CONFIG_INVALID);
  });
  
  it('rejects a keyboard not in the catalog', () => {
    expectCode(config({ keyboardId: 'nonexistent/kb' }), ERROR_CODES.CATALOG_KEYBOARD_UNAVAILABLE);
  });
});
```

Direct assertion on HTTP error responses:

```typescript
it('404s an unknown catalog version', async () => {
  const { status, body } = await get('/v1/catalog/9.9.9-1/keyboards');
  expect(status).toBe(404);
  expect((body['error'] as Record<string, unknown>)['code']).toBe('NOT_FOUND');
});
```

**Throwing for Unexpected Behavior:**
When testing that something fails, throw an error if it doesn't:

```typescript
try {
  validateConfiguration(input, { catalog });
  throw new Error('expected validation to fail with CONFIG_INVALID');
} catch (error) {
  expect(error).toBeInstanceOf(DomainError);
  expect((error as DomainError).code).toBe(ERROR_CODES.CONFIG_INVALID);
}
```

**Type Narrowing in Tests:**
Use `as` to narrow types after assertions:

```typescript
const items = body['items'] as { keyboardId: string; supported: boolean }[];
expect(items.every((i) => i.supported)).toBe(true);

const broken = items.find((i) => i.keyboardId === 'broken/kb');
expect(broken?.unsupportedReason).toBe('qmk_parse_errors');
```

**Testing Side Effects:**
Store references to injected fakes to verify behavior:

```typescript
let sandbox: FakeSandbox;
beforeEach(() => {
  sandbox = new FakeSandbox();
  runner = new QueueRunner({ /* ..., sandbox */ });
});

it('passes validated arguments to the sandbox', async () => {
  const buildId = await enqueue();
  await runner.runOnce();
  
  const request = sandbox.requests[0]!;
  expect(request.verb).toBe('compile');
  expect(request.args).toEqual(['-kb', KEYBOARD_ID, '-km', generatedKeymapName(buildId), '-j', '4']);
});
```

**Mutation Testing:**
Verify that the code doesn't mutate input:

```typescript
it('does not mutate the previous document', () => {
  const initial = state();
  const snapshot = structuredClone(initial.document);
  run(initial, {
    type: 'set_binding',
    layerIndex: 0,
    position: 1,
    binding: { kind: 'keycode', keycode: 'KC_B' },
  });
  expect(initial.document).toEqual(snapshot);
});
```

---

*Testing analysis: 2026-08-27*
