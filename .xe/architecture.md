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

A pnpm workspace: one core package, a web package, and two thin shells that start the same host.

```text
stack/
├── .xe/          # Catalyst context, features, rollouts
├── src/
│   ├── core/     # Task model, parser, scoring engines, overrides, lifecycle, summaries, storage (interface + git), config
│   ├── api/      # REST routes, auth, OpenAPI, push
│   ├── mcp/      # MCP server over the same lifecycle
│   ├── cli/      # CLI, and `stack web` (the local Node host the web app and the desktop shell use)
│   ├── agents/   # Agent drivers: Claude SDK, ACP (stdio), sessions and runs
│   ├── inbox/    # Agent inbox and connectors
│   ├── email/    # Email triage, hygiene, voice
│   ├── calendar/ # Live calendar (Graph) and ICS
│   ├── graph/    # Microsoft Graph sign-in
│   ├── bots/     # Chat bots
│   └── host/     # Azure Functions wiring (settings, git repo, push sender)
├── host/         # Azure Functions package entry (host.json, main.ts)
├── web/          # Web app (Preact, Vite, Vitest, Playwright)
├── desktop/      # Electron shell: starts `stack web` in-process
├── infra/        # Bicep
├── tests/        # Tests mirroring src
└── docs/         # User and operator docs
```

## Technical Architecture Patterns

### Dependency Abstraction Pattern

Applies to storage (git today, database later), formatters (emoji-markdown, clean), and the scoring engines: each sits behind an interface so it can be swapped and tested alone. `legacy` (the PowerShell formula) is the default for the generated files (`stack update`); `stack` (legacy plus due dates and blockers) is the default for `stack next`, `GET /next` and `GET /rank`; `autopri` is opt-in.
