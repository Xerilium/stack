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

All platforms (CLI, web, mobile) share a single package with common core logic to maximize reuse and simplify dependency management.

```text
stack/
├── .xe/                # Catalyst context and specifications
├── dist/               # Consolidated build outputs with subfolders per app/library
├── src/
│   ├── cli/            # CLI application code
│   ├── core/           # Core Stack library
│   ├── mobile/         # Mobile application (future)
│   ├── shared/         # Code shared across apps (if any)
│   └── web/            # Web application (future)
├── tasks/              # Example task files (markdown per project)
├── tests/              # Tests with subfolders per app/library
├── jest.config.js      # Root test configuration
├── package.json        # Single package.json
└── tsconfig.json       # Root TypeScript config
```

## Technical Architecture Patterns

### Dependency Abstraction

Isolate external dependencies (Git CLI, GitHub API, AI APIs) behind abstraction layers for testability, swappability, and consistent error handling.
