---
id: design-review
last_updated: 2026-11-18
execution_mode: autonomous
---

# Rollout: Design Review

## Active State

- **Model**: Feedback panel gets a `Design review` button; host route captures, calls OpenAI Responses, files a gh issue.
- **Decisions**: OpenAI API key as the ChatGPT connection — rejected scripting chatgpt.com (brittle, terms).
- **Open**: None
- **Next**: PR review loop.
- **Pins**: `src/core/feedback.ts` — capture hook and redaction; `src/inbox/request.ts` — gh issue filer
- **Assumptions**: `gh` is signed in on the owner's machine.

## Overview

Issue 170: one-click design review of each page by ChatGPT, filed as a GitHub issue.

## Features

#### design-review

- [x] Spec
- [x] Tests: `tests/core/design-review.test.ts`, `tests/api/design-review.test.ts`, `web/tests/design-review.test.ts`
- [x] Code: `src/core/page-goals.ts`, `src/core/design-review.ts`, route, OpenAPI, web host wiring, panel button
- [x] Docs: `docs/design-review.md`

## Notes

- Temp files: none.
