# Stack Product Context

## System Overview

Stack is an AI-powered, smart task-tracking application that helps users manage and execute tasks efficiently across multiple projects. It uses Git/GitHub as the storage backend, stores tasks in markdown files, and leverages AI for intelligent task management and execution assistance. The system provides CLI, web, and mobile interfaces with cross-platform support.

## Product Strategy

1. **Prove the concept works (POC)** - Get the Node.js CLI working with core features
2. **Perfect the user experience (Mainstream)** - Ensure the web/mobile apps are intuitive and delightful
3. **Deliver breakthrough capability (Innovation)** - Implement AI-powered features that differentiate Stack
4. **Build extensible foundation (Platform)** - Create reusable architecture and shared logic
5. **Enterprise readiness (Enterprise)** - Consider team collaboration and enterprise features
6. **Scale to broader markets (Scale)** - Expand to broader audience beyond developers

## Design principles

- **Transparent: Work in the open**
  > All task changes are tracked via Git commits, providing a complete audit trail. Every task update, priority change, and status modification is reversible and traceable.

## Technical Requirements

- Git must be installed and configured for CLI operations
- GitHub account required for repository access and authentication
- Node.js runtime for CLI execution
- Markdown files stored in `tasks/` folder (one file per project)
- Summary files generated at repo root (e.g., README.md, projects.md, stack.md, my-day.md)
- Git commits for all task changes (audit trail and sync)
- GitHub Actions for automation and CI/CD integration
- Cross-platform compatibility (macOS, Windows, Linux)
- GitHub OAuth for web/mobile authentication

## Success Metrics

- CLI successfully published to npm registry and installable globally
- Users can create, update, and track tasks across multiple projects
- Summary files auto-generate accurately on task changes
- Git operations complete successfully with proper commit messages
- AI features provide measurable improvement in task prioritization and completion
- Web and mobile apps share 80%+ code with CLI core logic

## Non-Goals

- Python-based implementations (prefer TypeScript/C#/PowerShell ecosystem)
- Complex task hierarchies beyond simple project grouping

## Team

**Roles:**

- **Product Manager**: @flanakin
- **Architect**: @flanakin
- **Engineer**: @flanakin

**AI Reviewers:**

- Claude Code
- @copilot
