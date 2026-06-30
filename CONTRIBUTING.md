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
pnpm --filter @plumpslabs/fennec-core dev

# Watch mode for CLI package
pnpm --filter @plumpslabs/fennec-cli dev

# Run tests in watch mode
pnpm --filter @plumpslabs/fennec-core test --watch
```

## Project Structure

```
fennec/
├── packages/
│   ├── core/              # MCP server — the heart of Fennec
│   │   ├── src/
│   │   │   ├── tools/          # 112 tools across 15 categories
│   │   │   ├── modules/        # FennecModule system
│   │   │   │   ├── browser/    # Browser module (existing tools)
│   │   │   │   ├── process/    # Process module (existing tools)
│   │   │   │   └── mobile/     # Mobile/Android module (11 tools via ADB)
│   │   │   ├── module/         # FennecModule interface + ModuleRegistry
│   │   │   ├── browser/        # BrowserEngine abstraction (BrowserSession)
│   │   │   ├── session/        # Session manager + types
│   │   │   ├── middleware/     # Pipeline middleware
│   │   │   └── ...
│   └── cli/               # CLI — pipe, attach, watch commands
├── docs/                  # Documentation
├── examples/              # Usage examples
└── .github/               # CI/CD and templates
```

For detailed structure, see the [README](README.md#project-structure).

## Options for Adding Tools

Fennec supports two patterns for adding tools, depending on whether the tool belongs to an existing category or a new domain.

### Option A: Adding a Tool to an Existing Category

For small additions to an existing category like navigation or storage, add the tool directly to the existing file in `packages/core/src/tools/`.

### Option B: Creating a New Module (Recommended for New Domains)

For new domains (e.g., database, git, docker), create a **FennecModule** in `packages/core/src/modules/`:

#### 1. Create the Module Directory

```
packages/core/src/modules/mymodule/
├── index.ts       # Tools + Module export
└── my-client.ts   # Client/wrapper (optional)
```

#### 2. Create Tools with `createTool`

```typescript
// packages/core/src/modules/mymodule/index.ts

import { z } from "zod";
import type { FennecModule, ModuleContext } from "../../module/index.js";
import type { ToolDefinition, ToolContext } from "../../tools/_registry.js";
import { createTool } from "../../tools/_registry.js";

export const myTool = createTool({
  name: "mymodule_action",
  category: "mycategory",
  description: "What this tool does for AI agents.",
  inputSchema: z.object({
    param1: z.string().describe("What param1 does"),
  }),
  handler: async (input, { responseBuilder }: ToolContext) => {
    try {
      return responseBuilder.success({ done: true });
    } catch (error) {
      return responseBuilder.error(error);
    }
  },
});
```

#### 3. Export as a FennecModule

```typescript
export const myModule: FennecModule = {
  name: "mymodule",
  description: "What my module does",
  tools: [myTool],
  capabilities: ["my-capability"],
  initialize: async (context: ModuleContext) => {
    // Check dependencies, start services
  },
};
```

#### 4. Register in server.ts

Import the module in `packages/core/src/server.ts` and it will be auto-registered:

```typescript
import { myModule } from './modules/mymodule/index.js';

// In registerModules():
this.moduleRegistry.register(myModule);
```

### Tool Development Guidelines

1. **Use `createTool`** — provides consistent typing and error handling
2. **Use Zod schemas** — all tool inputs must be validated
3. **Use `responseBuilder.success/error`** — consistent response format
4. **Add actionable suggestions** — help the AI agent recover from errors
5. **Register in server.ts** — add both to `registerAllTools()` and `registerModules()`
6. **Export from core/index.ts** — make classes/types available programmatically

### Writing Tests

Add unit tests in `packages/core/tests/unit/`:

```typescript
import { describe, it, expect } from "vitest";

describe("mymodule_action", () => {
  it("should handle valid input", async () => {
    // Test implementation
  });
});
```

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
