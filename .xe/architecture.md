# System Architecture for Stack

## Overview

This document defines the technical architecture for the Stack project: technology choices, structure, and integration patterns. Feature-specific requirements are documented in individual feature specifications in the `.xe/features` folder.

For engineering principles and standards, see [`.xe/engineering.md`](engineering.md).

For the development process, see [`.xe/process/development.md`](process/development.md).

## Technology Stack

| Aspect              | Details                                                                                     |
| ------------------- | ------------------------------------------------------------------------------------------- |
| Runtime Environment | Node.js (TypeScript compiled to CommonJS) for CLI, web, and shared core logic              |
| Data Storage        | Markdown files in Git repositories (tasks/ folder), summary files at repo root             |
| Automation Tools    | GitHub Actions for auto-generating summary files, CI/CD, and AI integration                |
| AI Integration      | Claude API and GitHub Copilot for server-side execution (web/mobile and GitHub Actions)    |
| Testing Framework   | Jest with ts-jest for unit and integration testing                                          |
| Deployment Method   | npm registry for CLI (@xerilium/stack), GitHub Pages for web, TBD for mobile               |
| Security Measures   | GitHub OAuth for authentication, Git commit signing, input validation                      |
| Monitoring/Logging  | Console logging for CLI, GitHub Actions logs for automation                                |

## Repository Structure

This project uses a **shared codebase approach** where all platforms (CLI, web, mobile) share a single package with common core logic. This maximizes code reuse and simplifies dependency management during initial development.

```text
stack/
├── src/
│   ├── core/           # Shared business logic (task management, Git operations)
│   ├── cli/            # CLI-specific interface code
│   ├── models/         # Data models and interfaces (Task, Project, etc.)
│   ├── services/       # External integrations (Git, GitHub API, AI)
│   └── utils/          # Helper functions and utilities
├── tests/              # Unit and integration tests
├── tasks/              # Example task files (markdown per project)
├── .xe/                # Project context and specifications
│   ├── features/       # Feature specifications and plans
│   ├── process/        # Development process documentation
│   └── rollouts/       # Active rollout orchestration plans
├── dist/               # Compiled JavaScript output
└── package.json        # Single package for CLI and shared core logic
```

**Note:** As web and mobile platforms are added to `src/web/` and `src/mobile/`, they will initially share this package structure. If platform-specific dependency conflicts arise, the project may evolve to a monorepo structure with separate packages managed by npm/yarn/pnpm workspaces.

## Technical Architecture Patterns

### Dependency Abstraction

Isolate external dependencies (Git CLI, GitHub API, AI APIs) behind abstraction layers for testability, swappability, and consistent error handling.

### Shared Core Logic

The `src/core/` directory contains all business logic that can be reused across CLI, web, and mobile applications. Platform-specific code lives in separate directories (e.g., `src/cli/`, future `src/web/`, `src/mobile/`).

### Markdown as Data Store

Tasks are stored as structured markdown files with YAML frontmatter for metadata. This provides human readability, Git-friendly diffs, and easy parsing with existing libraries.

### Git-Centric Workflow

All task changes are committed to Git automatically. The application treats the Git repository as the "database" and uses commits for audit trails, synchronization, and rollback capabilities.

### Summary File Generation

Summary files (README.md, projects.md, stack.md, scheduling.md) are auto-generated from task files. This can be triggered manually via CLI or automatically via GitHub Actions on push events.
