# Engineering Principles for Stack

## Core Principles

- **Plain Language**: Write like a human explaining the idea to a teammate. Every word earns its place. Active voice, one idea per sentence, the same word for the same thing. State the rule; explain why only when asked. Before submitting, cut what you would not say aloud: filler, hedges, context the reader has, preamble, balance clauses, ceremony, jargon, invented terms, legalese, and contrast used for effect ("not just X — Y"). If a simpler sentence keeps the meaning, use it.
- **Boy Scout Rule**: Leave every artifact better than you found it — code, specs, docs, tests, issues, PRs
- **Convention over Configuration**: Standard patterns over options. Consistency reduces decisions, errors, and explanation.
- **KISS**: Simple, straightforward solutions over complex ones, avoid premature optimization
- **YAGNI**: Build only what is needed, avoid implementing features "just in case"
- **Separation of Concerns**: Logic organized by purpose, components have single responsibilities
- **Single Responsibility**: Each module handles exactly one well-defined function
- **Open/Closed**: Open for extension, closed for modification via configuration and composition
- **Dependency Inversion**: Depend on abstractions, not concrete implementations
- **Principle of Least Astonishment**: Behavior matches user expectations, consistent patterns
- **DRY**: Single source of truth, no duplication of logic or configuration
- **Fail Fast**: Detect and report errors immediately with clear, actionable messages
- **Design for Testability**: Easy to test and validate, comprehensive coverage
- **Deterministic Processing**: Consistent, predictable output for identical inputs

## Technical Standards

See `.xe/standards/typescript.md` for coding standards.

- **Agents never block on a human**: Agents choose the next task, work within its autonomy level, and move on. They never merge or deploy.
- **Tooling**: pnpm, TypeScript, Jest
- **Quality**
  - Priority classifications:
    - P1 (Critical): Security, data integrity, core functionality
    - P2 (Important): Error handling, key features, integration points
    - P3 (Standard): Regular functionality, validation, formatting
    - P4 (Minor): Performance + optimizations, tooling, automation
    - P5 (Informational): Documentation, process
  - Priority threshold: P3
    - Requirements traceability: 100%
    - Code coverage: 90%

## Development Process

See `.xe/process/development.md` for the complete development workflow and implementation process.
