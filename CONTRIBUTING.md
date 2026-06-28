# Contributing to Fennec

First off, thank you for considering contributing to Fennec! We're building the AI-native observability layer for developers, and every contribution helps.

## Table of Contents

1. [Code of Conduct](#code-of-conduct)
2. [Development Setup](#development-setup)
3. [Project Structure](#project-structure)
4. [Adding a New Tool](#adding-a-new-tool)
5. [Coding Standards](#coding-standards)
6. [Testing](#testing)
7. [Documentation](#documentation)
8. [Pull Request Process](#pull-request-process)
9. [Branch Convention](#branch-convention)
10. [Commit Convention](#commit-convention)

## Code of Conduct

This project follows the [Contributor Covenant](CODE_OF_CONDUCT.md). By participating, you agree to uphold its standards.

## Development Setup

### Prerequisites

- **Node.js** >= 20.0.0
- **pnpm** >= 8.0.0
- **Git**

### Setup

```bash
# Clone the repository
git clone https://github.com/yourusername/fennec.git
cd fennec

# Install dependencies
pnpm install

# Build all packages
pnpm build

# Run tests
pnpm test

# Install Playwright browsers (for integration tests)
npx playwright install chromium
```

### Development Workflow

```bash
# Watch mode for core package
pnpm --filter @fennec/core dev

# Watch mode for CLI package
pnpm --filter @fennec/cli dev

# Run tests in watch mode
pnpm --filter @fennec/core test --watch
```

## Project Structure

```
fennec/
├── packages/
│   ├── core/              # MCP server — the heart of Fennec
│   └── cli/               # CLI — pipe, attach, watch commands
├── docs/                  # Documentation
├── examples/              # Usage examples
└── .github/               # CI/CD and templates
```

For detailed structure, see the [README](README.md#project-structure).

## Adding a New Tool

Every tool follows a consistent pattern. Here's how to add one:

### 1. Create the Tool File

Create a new file under the appropriate directory in `packages/core/src/tools/`:

```typescript
// packages/core/src/tools/mygroup/my-tool.ts

import { z } from "zod";
import { createTool } from "../_registry";
import type { ToolContext } from "../_registry";

export const myTool = createTool({
  name: "mygroup_myaction",
  description: `
    One-line description for AI agents.
    When to use: describe the use case.
    Returns: describe what AI agent will get.
  `,
  inputSchema: z.object({
    sessionId: z.string().optional().describe("Session ID, uses default if omitted"),
    myParam: z.string().describe("What this param does"),
  }),
  handler: async (input, context: ToolContext) => {
    const session = context.sessionManager.get(input.sessionId);
    try {
      // Implementation here
      return context.responseBuilder.success({
        data: { /* ... */ },
        meta: context.sessionManager.buildMeta(session),
      });
    } catch (error) {
      return context.responseBuilder.error(error, {
        suggestions: [
          "Actionable hint for AI agent",
          "Another hint",
        ],
      });
    }
  },
});
```

### 2. Register the Tool

The tool is auto-discovered via the registry pattern. Ensure the file is exported from the directory's `index.ts`.

### 3. Add Zod Schema

All tool inputs must be validated with Zod schemas. Follow existing patterns for consistency.

### 4. Write Tests

Add unit tests in `packages/core/tests/unit/tools/mygroup/my-tool.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { myTool } from "../../../src/tools/mygroup/my-tool";

describe("mygroup_myaction", () => {
  it("should return success with valid input", async () => {
    // Test implementation
  });

  it("should handle errors gracefully", async () => {
    // Error case test
  });
});
```

### 5. Document the Tool

Add documentation in `docs/tools/mygroup.md` with:
- Description and use cases
- Input parameters
- Example inputs and outputs
- Error scenarios with suggestions

## Coding Standards

### General Principles

- **AI-Native**: Every response is designed for AI consumption — structured, context-rich, actionable
- **ARIA-First**: Selectors default to ARIA role + accessible name before CSS/XPath
- **No Unhandled Exceptions**: Every error is caught and returned as a structured `success: false` response
- **No `any` Types**: TypeScript strict mode, no casting to `any`

### Style

- **Language**: TypeScript (strict mode)
- **Formatting**: Prettier (see `.prettierrc`)
- **Linting**: ESLint with TypeScript rules
- **Naming**: camelCase for variables/functions, PascalCase for classes/types, kebab-case for files

### Response Format

All tool responses follow this structure:

```typescript
// Success
{
  success: true,
  data: { ... },
  meta: { elapsed: number, sessionId: string, timestamp: string }
}

// Error
{
  success: false,
  error: {
    code: string,
    message: string,
    suggestions: string[],
    context: { ... }
  },
  meta: { elapsed: number, sessionId: string, timestamp: string }
}
```

## Testing

- **Framework**: Vitest
- **Coverage Goal**: 80%+ for v1.0
- **Test Types**:
  - Unit tests for individual tools and utilities
  - Integration tests for cross-layer functionality
  - E2E tests for full workflows

```bash
# Run all tests
pnpm test

# Run tests with coverage
pnpm test -- --coverage

# Run specific test file
pnpm test -- packages/core/tests/unit/tools/navigation/navigate.test.ts
```

## Documentation

Documentation is as important as code. Every feature must include:

1. **Inline JSDoc** comments on exported functions and types
2. **Tool documentation** in `docs/tools/` with examples
3. **Guide updates** if the feature affects user workflows

## Pull Request Process

1. **Fork** the repository and create your branch from `dev`
2. **Implement** your changes following the standards above
3. **Write tests** for your changes
4. **Update documentation** as needed
5. **Run tests** locally — all must pass
6. **Create a PR** with a clear title and description
7. **Address review feedback** promptly

### PR Checklist

- [ ] Code follows project style and conventions
- [ ] Tests added/updated and passing
- [ ] Documentation updated
- [ ] Changes are backward-compatible (or breaking changes documented)
- [ ] Commit messages follow convention
- [ ] PR description explains the what and why

## Branch Convention

```
main          → Stable releases
dev           → Integration branch
feat/*        → New features (e.g., feat/storage-indexeddb)
fix/*         → Bug fixes (e.g., fix/network-cors-handling)
docs/*        → Documentation only (e.g., docs/auth-guide)
perf/*        → Performance improvements
test/*        → Test additions/improvements
chore/*       → Maintenance, dependencies, build config
```

## Commit Convention

This project uses [Conventional Commits](https://www.conventionalcommits.org/).

```
feat(storage): add indexeddb read access
fix(network): handle CORS preflight correctly
docs(auth): add session persistence guide
test(console): add filter by keyword coverage
perf(cdp): reduce CDP session overhead
chore(deps): update playwright to 1.40.0
```

## Questions?

Open a [Discussion](https://github.com/yourusername/fennec/discussions) or join our community channels.

---

_Every contribution makes Fennec better. Thank you for being part of this journey!_
