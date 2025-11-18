# Blueprint Research

**Date:** 2025-11-18

## Product Analysis

### Product Vision
Stack is an AI-powered, smart task-tracking application that helps users manage and execute tasks efficiently across multiple projects using Git/GitHub as the storage backend.

### Target Users
- Developers and technical professionals who already use Git/GitHub
- Project managers tracking multiple projects
- Solo developers managing personal and professional work
- Teams collaborating on GitHub repositories

### Core User Journeys

#### 1. Initial Setup Journey
- User installs Stack CLI globally
- User navigates to project repository
- User initializes Stack in the repo
- System creates task directory structure and configuration
- System sets up GitHub Actions for automation

#### 2. Daily Task Management Journey
- User views current prioritized tasks
- User updates task status (start/complete/skip)
- System updates markdown files and commits to Git
- User adds new tasks to projects
- System generates summary files automatically

#### 3. Project Organization Journey
- User creates new project files
- User organizes tasks into Active/Next/Backlog sections
- User manages priority with emoji indicators
- System maintains task state across files

### Product Phases (from Product Strategy)

1. **Phase 1 - POC (Prove the concept works)**: Node.js CLI with core features
2. **Phase 2 - Mainstream (Perfect the UX)**: Web application with intuitive interface
3. **Phase 3 - Innovation (Breakthrough capability)**: AI-powered features
4. **Phase 4 - Scale (Mobile + Broader markets)**: Mobile apps with offline-first architecture

## Feature Breakdown

### Phase 1: CLI Core Features (POC)

Based on the issue requirements, Phase 1 must deliver complete feature parity with the PowerShell prototype. Breaking this into discrete, independently implementable features:

#### Core Infrastructure Features (Tier 0 - Foundation)
1. **git-integration** - Git operations abstraction layer
   - Scope: Validate Git installation, execute Git commands, handle errors
   - Dependencies: None
   - Complexity: Small

2. **file-system** - File system operations abstraction
   - Scope: Read/write markdown files, create directories, validate paths
   - Dependencies: None
   - Complexity: Small

3. **markdown-parser** - Parse and manipulate markdown task files
   - Scope: Parse markdown with emoji status, extract tasks, preserve structure
   - Dependencies: file-system
   - Complexity: Medium

#### Core Data Model Features (Tier 1 - Data Layer)
4. **task-model** - Task entity and validation
   - Scope: Task data structure, status types, emoji mappings, validation rules
   - Dependencies: None
   - Complexity: Small

5. **project-model** - Project entity and structure
   - Scope: Project data structure, Active/Next/Backlog sections, validation
   - Dependencies: task-model
   - Complexity: Small

6. **timeblock-model** - Time block configuration
   - Scope: Time block structure, capacity allocations, filtering rules
   - Dependencies: None
   - Complexity: Small

#### Storage Features (Tier 2 - Persistence)
7. **task-storage** - Task persistence layer
   - Scope: Read/write tasks from markdown files, maintain file structure
   - Dependencies: task-model, project-model, markdown-parser, file-system
   - Complexity: Medium

8. **config-storage** - Configuration persistence
   - Scope: Read/write Stack configuration, GitHub Actions setup
   - Dependencies: file-system, timeblock-model
   - Complexity: Small

#### Core Business Logic Features (Tier 3 - Domain Logic)
9. **task-operations** - Task lifecycle operations
   - Scope: Create, update, delete tasks; status transitions; validation
   - Dependencies: task-model, task-storage, git-integration
   - Complexity: Medium

10. **priority-engine** - Task prioritization logic
    - Scope: Priority calculation based on status, impact, effort, time blocks
    - Dependencies: task-model, timeblock-model
    - Complexity: Medium

11. **summary-generator** - Generate summary files
    - Scope: Generate README.md, projects.md, stack.md, my-day.md
    - Dependencies: task-storage, priority-engine
    - Complexity: Large

#### CLI Interface Features (Tier 4 - User Interface)
12. **cli-framework** - CLI framework and command parser
    - Scope: Command-line argument parsing, help text, command routing
    - Dependencies: None
    - Complexity: Small

13. **cli-init** - Initialize Stack in repository
    - Scope: `stack init` command implementation
    - Dependencies: cli-framework, config-storage, git-integration
    - Complexity: Small

14. **cli-list** - List and view tasks
    - Scope: `stack list` and `stack` (default) command implementation
    - Dependencies: cli-framework, task-storage, priority-engine
    - Complexity: Small

15. **cli-status** - Update task status
    - Scope: `stack start`, `stack complete`, `stack skip`, `stack pause`, `stack resume`, `stack block` commands
    - Dependencies: cli-framework, task-operations
    - Complexity: Medium

16. **cli-add** - Add new tasks
    - Scope: `stack add` command implementation
    - Dependencies: cli-framework, task-operations
    - Complexity: Small

17. **cli-project** - Create new projects
    - Scope: `stack project` command implementation
    - Dependencies: cli-framework, task-storage, git-integration
    - Complexity: Small

18. **cli-update** - Update task properties
    - Scope: `stack update` command for impact/effort/priority changes
    - Dependencies: cli-framework, task-operations
    - Complexity: Small

19. **cli-clean** - Remove completed tasks
    - Scope: `stack clean` command implementation
    - Dependencies: cli-framework, task-operations
    - Complexity: Small

#### Integration Features (Tier 5 - External Integration)
20. **github-actions** - GitHub Actions workflow setup
    - Scope: Generate workflow files for auto-summary generation
    - Dependencies: config-storage
    - Complexity: Small

### Phase 2: Web Application (Mainstream UX)

High-level features for Phase 2 (to be detailed later):
- **web-auth** - GitHub OAuth authentication
- **web-ui** - Visual task management interface
- **web-sync** - Real-time summary updates
- **web-hosting** - GitHub Pages deployment

### Phase 3: AI-Powered Features (Innovation)

High-level features for Phase 3 (to be detailed later):
- **ai-prioritization** - Auto-prioritization based on context
- **ai-breakdown** - Intelligent task breakdown
- **ai-estimation** - Effort and impact estimation
- **ai-nlp** - Natural language task creation
- **ai-suggestions** - Context-aware execution suggestions
- **ai-scheduling** - Smart scheduling with time blocks

### Phase 4: Mobile Application (Scale)

High-level features for Phase 4 (to be detailed later):
- **mobile-ios** - iOS native app
- **mobile-android** - Android native app
- **mobile-offline** - Offline-first architecture
- **mobile-sync** - Sync with GitHub
- **mobile-notifications** - Push notifications
- **mobile-voice** - Voice input for quick capture

## Feature Dependency Graph

```
Tier 0 (Foundation):
  git-integration, file-system

Tier 1 (Data Layer):
  task-model, project-model, timeblock-model
  markdown-parser → file-system

Tier 2 (Persistence):
  task-storage → task-model, project-model, markdown-parser, file-system
  config-storage → file-system, timeblock-model

Tier 3 (Domain Logic):
  task-operations → task-model, task-storage, git-integration
  priority-engine → task-model, timeblock-model
  summary-generator → task-storage, priority-engine

Tier 4 (CLI Interface):
  cli-framework
  cli-init → cli-framework, config-storage, git-integration
  cli-list → cli-framework, task-storage, priority-engine
  cli-status → cli-framework, task-operations
  cli-add → cli-framework, task-operations
  cli-project → cli-framework, task-storage, git-integration
  cli-update → cli-framework, task-operations
  cli-clean → cli-framework, task-operations

Tier 5 (Integration):
  github-actions → config-storage
```

## Complexity Estimates

- **Small (1-2 days)**: 14 features
- **Medium (3-5 days)**: 5 features
- **Large (1-2 weeks)**: 1 feature
- **Total Phase 1**: ~6-8 weeks for full implementation

## Implementation Priority within Phase 1

Priority is based on dependencies and business value:

1. Foundation (Tier 0): git-integration, file-system
2. Data Layer (Tier 1): task-model, project-model, timeblock-model, markdown-parser
3. Persistence (Tier 2): task-storage, config-storage
4. CLI Framework (Tier 4 partial): cli-framework
5. Init Command (Tier 4 partial + Tier 3 partial): cli-init
6. Core Operations (Tier 3): task-operations, priority-engine
7. View Commands (Tier 4 partial): cli-list
8. Status Commands (Tier 4 partial): cli-status
9. Add Commands (Tier 4 partial): cli-add, cli-project
10. Update Commands (Tier 4 partial): cli-update, cli-clean
11. Summary Generation (Tier 3): summary-generator
12. GitHub Integration (Tier 5): github-actions

## Technical Decisions

### Architecture Approach
- **Layered architecture**: Infrastructure → Data → Domain → Application
- **Dependency Injection**: Abstract external dependencies for testability
- **Shared TypeScript core**: Maximize code reuse across CLI, web, mobile
- **Git-first storage**: All data in markdown files, version controlled

### Technology Choices
- **TypeScript + Node.js**: Cross-platform, large ecosystem, type safety
- **Jest**: Testing framework with good TypeScript support
- **Commander.js or similar**: CLI framework for argument parsing
- **Simple-git or direct exec**: Git operations abstraction
- **Unified markdown parser**: Consistent markdown handling

### Design Patterns
- **Repository Pattern**: For task storage abstraction
- **Strategy Pattern**: For different summary generation formats
- **Command Pattern**: For CLI command implementations
- **Factory Pattern**: For task and project creation

## Risks and Mitigations

1. **Risk**: Complex markdown parsing with nested tasks
   - **Mitigation**: Start with simple flat structure, add nesting incrementally

2. **Risk**: Git operations can fail (network, conflicts, permissions)
   - **Mitigation**: Robust error handling, clear error messages, validation

3. **Risk**: Cross-platform compatibility (Windows, macOS, Linux)
   - **Mitigation**: Use Node.js path APIs, test on all platforms, avoid shell-specific commands

4. **Risk**: Performance with large task files
   - **Mitigation**: Implement caching, lazy loading, benchmark with realistic data

## Open Questions

None at this time - issue provides comprehensive requirements.
