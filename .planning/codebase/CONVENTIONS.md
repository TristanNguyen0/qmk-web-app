# Coding Conventions

**Analysis Date:** 2026-08-27

## Naming Patterns

**Files:**
- `kebab-case.ts` for module files (e.g., `queue-runner.ts`, `artifact-store.ts`)
- Component files use `PascalCase.tsx` (e.g., `KeymapEditor.tsx`, `BuildPanel.tsx`)
- Test files use `.test.ts` suffix (e.g., `validate.test.ts`, `catalog.test.ts`)
- Index files named `index.ts` or `index.tsx` to re-export from packages

**Functions:**
- `camelCase` for all function names, including React components that are lowercase utilities
- Higher-order functions and helper factories use `camelCase` (e.g., `createEditorState()`, `toFieldErrors()`)
- Function names should be descriptive verbs: `parseConfiguration()`, `validateConfiguration()`, `updateConfiguration()`
- Private methods and internal functions use `#` prefix for private class fields: `#process()`, `#options`

**Variables:**
- `camelCase` for all variable, parameter, and property names
- Boolean flags start with `is` or `can`: `isDraft`, `canRedo`, `canUndo`, `produceArtifact`
- Use explicit names for state: `SaveState` discriminated union with `status` field
- Constants within functions use `UPPER_SNAKE_CASE` (e.g., `NOW`, `WORKER`, `OWNER`)

**Types & Interfaces:**
- `PascalCase` for all TypeScript types, interfaces, and type aliases
- Prefix discriminated union types with descriptive name (e.g., `SaveState`, `ProcessOutcome`)
- Interface names often end with `Props` for component properties (e.g., `KeymapEditorProps`)
- Response/request types suffixed with `Response`/`Input`/`Request` (e.g., `ConfigurationResponse`, `SaveConfigurationInput`)
- Error/exception classes extend `Error` and use `PascalCase` (e.g., `DomainError`, `ApiRequestError`)
- Use `readonly` for immutable properties: `readonly fieldErrors: readonly FieldError[]`

**Constants:**
- `UPPER_SNAKE_CASE` for module-level constants (e.g., `GENERATOR_VERSION`, `MAX_JSON_MACROS`, `ERROR_CODES`)
- Export constants as `as const` for type-safe discriminated unions: `ERROR_CODES = { ... } as const`

## Code Style

**Formatting:**
- No explicit ESLint or Prettier config found; code follows ES2023 standards
- Consistent use of semicolons throughout
- Two-space indentation inferred from TypeScript config and examples
- Line breaks after imports, between logical sections

**Linting:**
- No project-level linting config; rely on TypeScript strict mode enforcement
- Type checking via `tsc --noEmit` (see `package.json` script)
- See **TypeScript Configuration** below for strict settings applied

**TypeScript Configuration:**
Configured in `tsconfig.base.json` with strict mode enabled:
- `"strict": true` — all strict type-checking options enabled
- `"noUncheckedIndexedAccess": true` — prevents accessing objects without bounds checking
- `"exactOptionalPropertyTypes": true` — distinguishes between `undefined` and absent properties
- `"noImplicitOverride": true` — requires `override` keyword in subclasses
- `"noFallthroughCasesInSwitch": true` — prevents fallthrough in switch statements
- `"noUnusedLocals": true` — flags unused variables
- `"noUnusedParameters": true` — flags unused function parameters
- `"verbatimModuleSyntax": true` — imports must match export syntax exactly
- `"isolatedModules": true` — each file can be transpiled independently
- `"allowImportingTsExtensions": true` — allows `.ts` in import specifiers (no build step)
- `"noEmit": true` — TypeScript used only for checking, not code generation

**Import Organization:**

Order imports by category:
1. Node.js built-in modules (`node:*`)
2. External packages from npm
3. Package exports from workspace (prefixed with `@qmk-web-app/`)
4. Relative local imports (`./` or `../`)

Example from `services/worker/src/queue-runner.ts`:
```typescript
import { randomUUID } from 'node:crypto';
import { artifactKey, logKey, type ArtifactStore } from '@qmk-web-app/artifact-store';
import type { BuildQueue, ClaimedBuild } from '@qmk-web-app/build-queue';
import { DomainError, validateConfiguration } from '@qmk-web-app/domain';
import type { BuildSandbox, SandboxLimits } from '@qmk-web-app/qmk-sandbox';
import { runBuild } from './run-build.ts';
import { redactLog } from './redact.ts';
```

**Path Aliases:**
- Workspace packages imported with `@qmk-web-app/*` prefix (e.g., `@qmk-web-app/domain`, `@qmk-web-app/artifact-store`)
- All imports must use `.ts` extension (no extension omission due to `verbatimModuleSyntax`)
- Import types explicitly with `type` keyword: `import type { Catalog } from '@qmk-web-app/domain'`

## Error Handling

**Patterns:**
- Custom domain errors use `DomainError` class (`packages/domain/src/errors.ts`) with stable error codes
- API errors use `ApiRequestError` class (`apps/web/src/lib/client.ts`) with HTTP status codes
- Errors include diagnostic messages and optional field-level errors for validation failures

**Custom Error Classes:**
All extend `Error` and include contextual information:

From `packages/domain/src/errors.ts`:
```typescript
export class DomainError extends Error {
  readonly code: ErrorCode;
  readonly fieldErrors: readonly FieldError[];
  constructor(code: ErrorCode, message: string, fieldErrors: readonly FieldError[] = []) {
    super(message);
    this.name = 'DomainError';
    this.code = code;
    this.fieldErrors = fieldErrors;
  }
}
```

From `apps/web/src/lib/client.ts`:
```typescript
export class ApiRequestError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fieldErrors: FieldError[];
  readonly currentRevision: number | undefined;
  constructor(status, code, message, fieldErrors = [], currentRevision) { ... }
}
```

**Error Codes:**
- Use stable string constants from `ERROR_CODES` object: `CONFIG_INVALID`, `CATALOG_KEYBOARD_UNAVAILABLE`, `BUILD_TIMEOUT`, etc.
- Never embed storage keys, paths, or internal IDs in error codes
- Error messages (diagnostic, for logs) can include detail; codes (for users/API) must be sanitized

**Try/Catch Pattern:**
```typescript
try {
  const result = validateConfiguration(input, { catalog });
  // process result
} catch (error) {
  if (error instanceof DomainError) {
    // Handle domain error with code and field errors
    setSave({ status: 'invalid', message: error.message, fieldErrors: error.fieldErrors });
  } else if (error instanceof ApiRequestError) {
    // Handle API error with status and code
  } else {
    // Handle unexpected errors
  }
}
```

**Field-Level Errors:**
Validation can return field-level errors for user display:
```typescript
interface FieldError {
  path: string;  // JSON path like 'layers.0.bindings.12'
  message: string;
}
```

## Logging

**Framework:** Console-based or custom event emitters (no centralized logger)

**Patterns:**
- `QueueRunner` accepts optional `log` callback: `log?: (event: QueueRunnerEvent) => void`
- Events have `level` ('info' | 'warn' | 'error') and contextual fields
- No logging infrastructure in place; applications log to console or structured handlers

## Comments

**When to Comment:**
- JSDoc blocks above functions, classes, and exports
- Inline comments for non-obvious algorithmic steps or security considerations
- Comments in test helpers describe purpose (e.g., "Supplies the catalog a build's configuration must be validated against")

**JSDoc/TSDoc:**
Required for all public exports and complex functions. Includes:
- Single-line description of purpose
- `@param` tags for parameters
- `@returns` tag for return type
- `@throws` for exceptions (optional)
- Multi-line blocks with context and design decisions

Example from `packages/qmk-generator/src/generate.ts`:
```typescript
/**
 * Deterministic generation of an application-owned QMK keymap.
 *
 * claude.md rule 4: "Generate source from a typed internal configuration model and
 * approved templates. Do not concatenate free-form user text into C, Make, shell
 * commands, paths, or compiler arguments."
 *
 * The MVP satisfies that rule in the strongest available form: **it emits no C, no
 * Make, and no headers at all.**
 */
```

Example from `packages/domain/src/validate.ts`:
```typescript
/** Parses and structurally validates, raising CONFIG_INVALID with field-level detail. */
export function parseConfiguration(input: unknown): Configuration {
  // ...
}
```

## Function Design

**Size:** Functions are concise and focused; complex logic split into helper functions
- Example: `toFieldErrors()` extracts Zod error conversion
- Example: `requireSupportedKeyboard()` encapsulates keyboard validation

**Parameters:**
- Use destructuring for complex parameter objects
- Type all parameters explicitly (strict mode enforces this)
- Separate required and optional parameters

Example:
```typescript
export function validateConfiguration(
  input: unknown,
  context: ValidationContext,
): { configuration: Configuration; keyboard: SupportedCatalogKeyboard }
```

**Return Values:**
- Return structured objects with named properties (not tuples)
- Use discriminated unions for conditional returns (e.g., `ProcessOutcome`)
- Throw exceptions for error cases; don't return null/undefined for failures

## Module Design

**Exports:**
- Use named exports; default exports only for single-purpose modules (rare)
- Re-export types with `type` keyword: `export type { Configuration } from './configuration.ts'`
- Barrel files (`index.ts`) re-export entire module interfaces

Example from `packages/build-queue/src/index.ts`:
```typescript
export type { BuildQueue, BuildRecord, ClaimedBuild, CompleteBuildArgs } from './types.ts';
export { InMemoryBuildStore } from './memory-store.ts';
export { PostgresBuildStore } from './postgres-store.ts';
```

**Barrel Files:**
Used in `packages/*/src/index.ts` to define package public API:
- Group related exports together
- Simplify consumer imports
- Allow package-level type re-exports

**Private Fields:**
Class private fields use `#` prefix:
```typescript
class QueueRunner {
  readonly #options: QueueRunnerOptions;
  #stopping = false;
  #running = false;
}
```

## Type Annotations

**Everywhere:**
- Every parameter must have a type annotation
- Return types should be annotated (inferred only when obvious)
- Use `readonly` for immutable collections and properties
- Use `as const` for literal type narrowing

Example:
```typescript
export const ALLOWED_GENERATED_FILES = Object.freeze([
  'qmk.json',
  'keymap.json',
] as const);

export type GeneratedFileName = (typeof ALLOWED_GENERATED_FILES)[number];
```

---

*Convention analysis: 2026-08-27*
