# System Architecture for Stack

## Overview

Defines the technical architecture for Stack: technology choices, structure, and integration patterns. Feature-specific requirements are documented in individual feature specifications in the `.xe/features` folder. Product-level design choices are in [`.xe/features/design-decisions.md`](features/design-decisions.md).

For engineering principles and standards, see [`.xe/engineering.md`](engineering.md).

For the development process, see [`.xe/process/development.md`](process/development.md).

## Technology Stack

### Runtime Technologies

| Aspect          | Details                                                                                           |
| --------------- | ------------------------------------------------------------------------------------------------- |
| Runtime Env     | Node.js 22+, TypeScript                                                                           |
| App Platform    | Azure Static Web Apps free tier with managed Functions; secrets in app settings                   |
| Data & Storage  | Markdown in a private GitHub repo behind a storage interface (git adapter, direct commits)        |
| Auth            | SWA built-in auth allow-listed to the owner; hashed, scoped, revocable API tokens                 |
| AI/ML           | MCP server for agents; per-task autonomy level                                                    |
| Observability   | Logs with no task data                                                                            |

### Development Technologies

| Aspect            | Details                                                    |
| ----------------- | ---------------------------------------------------------- |
| Languages         | TypeScript                                                 |
| Dev Env           | pnpm                                                       |
| AI Coding         | Claude Code with Catalyst                                  |
| Test Framework    | Jest with ts-jest; browser e2e for the web app             |
| DevOps Automation | GitHub Actions; Bicep (build-only IaC)                     |
| Distribution      | npm package (`@xerilium/stack`); SWA for web               |

## Repository Structure

One package with shared core logic for every surface.

```text
stack/
├── .xe/        # Catalyst context, features, rollouts
├── src/
│   ├── core/   # Task model, parser, scoring, lifecycle, summaries, config
│   ├── storage/ # Storage interface and git adapter
│   ├── cli/    # CLI
│   ├── api/    # REST, auth, MCP
│   └── web/    # Web app
├── tests/      # Tests mirroring src
└── tasks/      # Example task files
```

## Technical Architecture Patterns

### Dependency Abstraction Pattern

Applies to storage (git today, database later), formatters (emoji-markdown, clean), and the scoring engine (legacy formula default): each sits behind an interface so it can be swapped and tested alone.
