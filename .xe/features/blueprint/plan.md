# Blueprint Implementation Plan

## Overview

This plan describes the methodology for creating and maintaining the Stack product blueprint, which breaks down the product vision into discrete, implementable features with clear dependencies and priorities.

## Data Model

### Feature Entity

Each feature in the blueprint is defined with:

- **Feature ID** (string, kebab-case): Unique identifier (e.g., "git-integration", "task-model")
- **Feature Number** (string): Sequential identifier (e.g., "F001", "F002")
- **Feature Name** (string): Human-readable display name
- **Phase** (enum): Product strategy phase - POC, Mainstream, Innovation, Platform, Scale
- **Dependencies** (array of feature IDs): Features this feature depends on
- **Complexity** (enum): Effort estimate - Small (1-2 days), Medium (3-5 days), Large (1-2 weeks)
- **Priority** (integer): Implementation order number (1 = highest priority)
- **Scope** (string): 1-2 sentence description defining clear boundaries of what the feature does and doesn't do

### Dependency Relationship

Features have dependencies that form a directed acyclic graph (DAG):

- **Source Feature**: The feature that depends on another
- **Target Feature**: The feature that is depended upon
- **Dependency Type**: "required" (hard dependency, must be implemented first)

### Phase Definition

Phases align with Product Strategy:

- **Phase Name** (enum): POC, Mainstream, Innovation, Platform, Scale
- **Phase Goal** (string): Strategic objective for this phase
- **Phase Features** (array): Features assigned to this phase
- **Phase Order** (integer): Sequential phase number

## Implementation Approach

### 1. Product Analysis

The blueprint creation process starts with comprehensive product analysis:

1. **Extract requirements** from issue description, product.md, and architecture.md
2. **Identify user journeys** and core workflows
3. **Map journeys to capabilities** needed to support them
4. **Break capabilities into features** with clear scope boundaries
5. **Apply SOLID principles** to ensure features are:
   - **Single Responsibility**: Each feature has one well-defined purpose
   - **Separation of Concerns**: Features are organized by functional layer
   - **Don't Repeat Yourself**: Common logic is extracted into reusable features

### 2. Feature Definition

Each feature is defined with precision:

1. **Naming**: Use kebab-case IDs that clearly convey purpose (e.g., "task-storage", "cli-init")
2. **Scope boundaries**: Define what is included AND what is excluded (1-2 sentences)
3. **Dependency identification**: List all features this feature requires
4. **Complexity estimation**: Based on implementation time (Small/Medium/Large)
5. **Validation**: Ensure feature is independently testable and deployable

### 3. Dependency Graph Construction

Build a directed acyclic graph (DAG) of feature dependencies:

1. **Identify direct dependencies**: What features does this feature directly use?
2. **Validate no circular dependencies**: Ensure DAG property is maintained
3. **Calculate dependency tiers**: Group features by dependency depth
   - Tier 0: No dependencies (foundation features)
   - Tier 1: Depends only on Tier 0 features
   - Tier 2: Depends on Tier 0 or Tier 1 features
   - And so on...
4. **Visualize with Mermaid**: Create graph diagram for easy understanding

### 4. Phase Assignment

Assign features to phases based on Product Strategy:

1. **Read Product Strategy** from `.xe/product.md` to understand phase goals
2. **Match features to phases** based on strategic fit:
   - **POC**: Core CLI functionality, prove the concept works
   - **Mainstream**: Web UI, perfect the user experience
   - **Innovation**: AI-powered features, breakthrough capabilities
   - **Platform**: Extensibility and reusability (built into other phases)
   - **Scale**: Mobile apps, broader audience support
3. **Validate phase progression**: Each phase builds on previous phases

### 5. Priority Assignment

Determine implementation order within each phase:

1. **Dependency-first ordering**: Features with no dependencies get highest priority
2. **Within same tier**: Order by business value and risk
   - High value + low risk = higher priority
   - High value + high risk = implement early to derisk
   - Low value + high risk = defer or eliminate
3. **Sequential numbering**: Assign priority numbers starting from 1
4. **Parallel opportunities**: Features in same tier can be built concurrently

### 6. Blueprint Documentation

Document the complete feature roadmap:

1. **Create spec.md**: Canonical feature list with all metadata
   - Product phases and goals
   - Core entities
   - Feature dependency graph (Mermaid diagram)
   - Detailed Phase 1 features (all fields populated)
   - High-level Phase 2-4 features (to be detailed later)
2. **Create plan.md**: This document - methodology and approach
3. **Create tasks.md**: Implementation checklist with Phase 1 tasks
4. **Create research.md**: Analysis findings and decisions

## Constraints

### Technical Constraints

- Features must be independently implementable and testable
- Dependency graph must be acyclic (no circular dependencies)
- Features should align with architectural patterns in `.xe/architecture.md`
- Complexity estimates should be realistic based on scope

### Process Constraints

- Blueprint is created once, then maintained through phase completions
- Phase 1 features must be detailed in initial blueprint creation
- Phase 2+ features are outlined at high level initially
- When a phase completes, run blueprint again to detail next phase features
- All feature development happens via `/catalyst:rollout {feature-id}`

### Documentation Constraints

- Feature scope descriptions must be 1-2 sentences (clear boundaries)
- Dependency graph must use Mermaid format for visualization
- Phase assignments must align with Product Strategy in product.md
- Avoid specific feature counts in descriptions (they become outdated)

## Phased Rollout Strategy

### Initial Blueprint Creation (Phase 1 Planning)

1. Research and analyze product requirements
2. Define all Phase 1 features in detail
3. Outline Phase 2-4 features at high level
4. Create dependency graph for Phase 1
5. Create tasks.md with Phase 1 implementation tasks
6. Create rollout plan and README index entry
7. Submit PR for review and approval

### Phase 1 Implementation

1. Implement features one-by-one via `/catalyst:rollout {feature-id}`
2. Check off tasks in tasks.md as features are completed
3. Features can be implemented in parallel if in same dependency tier
4. Update blueprint spec if feature scope changes during implementation

### Phase 2 Planning (After Phase 1 Complete)

1. Run `/catalyst:blueprint` to trigger Phase 2 planning
2. Review Phase 1 implementation learnings
3. Detail Phase 2 features with full metadata
4. Update dependency graph to include Phase 2
5. Insert Phase 2 implementation tasks in tasks.md
6. Submit PR for Phase 2 planning review

### Subsequent Phases

Repeat the planning process for each phase after the previous phase completes.

## Error Handling

### Invalid Dependencies

- **Detection**: Check for circular dependencies during graph construction
- **Resolution**: Refactor features to break circular dependency cycles
- **Prevention**: Review dependencies carefully during feature definition

### Scope Creep

- **Detection**: Feature scope description exceeds 2 sentences or multiple concerns
- **Resolution**: Split into multiple features with clear boundaries
- **Prevention**: Apply Single Responsibility Principle during feature definition

### Phase Misalignment

- **Detection**: Feature assigned to phase that doesn't match Product Strategy goals
- **Resolution**: Re-evaluate feature purpose and assign to correct phase
- **Prevention**: Review Product Strategy before assigning phases

## Success Metrics

- Blueprint spec.md is complete and approved
- All Phase 1 features have detailed specifications
- Dependency graph is acyclic and validated
- Features are properly prioritized by dependencies and value
- Phase assignments align with Product Strategy
- Blueprint serves as canonical roadmap for feature development
