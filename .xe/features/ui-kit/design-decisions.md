# Design Decisions: Shared UI components

## Each component names the markup it owns; a test fails on copies

**Decision**: A component file in `web/src/ui/` carries `@owns class:…` and `@owns role:…` tags. `web/tests/ui-reuse.test.ts` fails when a view outside `web/src/ui/` writes that class or role. A view that still has a copy is listed on the tag (`legacy: View.tsx=1`) and keeps that count, no more.

**Date**: 2026-11-19

**Why**: The rule "reuse the shared components" was only in a standard and in reviews. Two tab bars, four menus and a card built by hand were in the views. A test stops a new copy on the PR that adds it. The allowed copies sit next to the component that replaces them, so a PR that adds a component and a PR that moves a view never edit the same list.

**Rejected**: A custom ESLint rule (a new plugin and JSX parsing for the same result as a 40-line test). One shared baseline file (every PR that moves a view edits it, so parallel PRs conflict). A check that fails when a `legacy:` count is too high (a PR opened before the guard then breaks `main` when it removes a copy). A catalog test that needs every component listed (a component PR that merges without a rebase then breaks `main`); the catalog test checks only that listed components exist.
