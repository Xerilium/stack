---
id: design-review
title: Design Review
author: flanakin
description: "One click sends a page screenshot and its goals to ChatGPT and files the reply as a GitHub issue."
dependencies: [api, desktop-shell, feedback-button, inbox-page, web-shell]
---

<!-- markdownlint-disable single-title -->

# Feature: Design Review

## Purpose

Get an outside design opinion on every Stack page with no manual screenshots or copy and paste. Each review lands as one GitHub issue so the work can be triaged later.

## Scope

- In: the page goals file, the `Design review` action in the feedback panel, `POST /design-review`, the ChatGPT call, the issue.
- Non-goals: fixing the findings, reviewing all pages in one click, driving the chatgpt.com web app, attaching the screenshot to the issue, a CLI.

## Scenarios

### FR:goals: Page goals

The reviewer needs each page's purpose so that its feedback judges the page against what the page is for.

- **FR:goals.file** (P1): `src/core/page-goals.ts` lists the goals of every page
  - **FR:goals.file.pages** (P1): Pages: `now`, `home`, `today`, `asks`, `prs`, `inbox`, `sessions`, `projects`, `list`, `settings`, `qm`
  - **FR:goals.file.entry** (P1): Each page has a name and 2 to 5 goals
- **FR:goals.route** (P1): Resolver MUST take the page from the route hash (`#/asks`, `#asks`, `/#/asks?x=1`) the way the web app reads it
  - **FR:goals.route.empty** (P1): Resolver MUST treat no hash as `now`
  - **FR:goals.route.alias** (P1): Resolver MUST map the web app hash aliases to their page (`#/agents` is `sessions`)
  - **FR:goals.route.unknown** (P1): Resolver MUST treat any other name as `now`, the page the app shows

### FR:ui: Action

The owner needs one click per page so that a review never needs a manual screenshot.

- **FR:ui.button** (P1): Feedback panel MUST show a `Design review` button next to `Send`
  - **FR:ui.button.text** (P1): Feedback panel MUST enable the button with no text
- **FR:ui.shot** (P1): Feedback panel MUST capture the page as feedback does
  - Desktop app: `capture: true`. Browser: the Screen Capture API
  > - @req FR:feedback-button/ui.shot
  - **FR:ui.shot.hide** (P1): Feedback panel MUST stay hidden until the capture is done
- **FR:ui.progress** (P1): Feedback panel MUST show `Reviewing with ChatGPT…` while the review runs
- **FR:ui.no-shot** (P1): Feedback panel MUST send nothing when the browser gives no screenshot
  - **FR:ui.no-shot.message** (P1): Feedback panel MUST show `A screenshot is needed`
- **FR:ui.result** (P1): Feedback panel MUST show `Filed` with the issue link on success
  - **FR:ui.result.focus** (P1): Feedback panel MUST move focus to the issue link
- **FR:ui.error** (P1): Feedback panel MUST show the error and stay open on failure
  - **FR:ui.error.focus** (P1): Feedback panel MUST move focus to the text box

### FR:api: API

The page needs one owner-only route so that the web app and the desktop app run a review the same way.

- **FR:api.route** (P1): Interface: `POST /design-review` `{route, viewport?, theme?, capture?, png?}` returns 201 `{page, url}`
  - Field rules match `POST /feedback`. Documented in `docs/api/openapi.yaml`
  > - @req FR:feedback-button/api.route
- **FR:api.owner** (P1): Route MUST answer 403 to anyone but the owner
- **FR:api.absent** (P1): Route MUST answer 404 when the host has no reviewer
- **FR:api.shot** (P1): Route MUST answer 422 when there is no screenshot
  - No `png`, and no host capture
- **FR:api.down** (P1): Route MUST answer 503 when ChatGPT is not connected or fails
  - **FR:api.down.first** (P1): Route MUST check the connection before the capture
- **FR:api.issue** (P1): Route MUST answer 502 when the issue fails

### FR:review: ChatGPT review

The owner needs a fresh opinion per page so that one page's feedback never colors the next.

- **FR:review.connect** (P1): Reviewer MUST read the OpenAI API key from `STACK_OPENAI_API_KEY`, else `OPENAI_API_KEY`
  - No key means not connected
- **FR:review.fresh** (P1): Reviewer MUST send each review as a new, stateless request
  - No earlier response id, no conversation id, and `store: false`
- **FR:review.input** (P1): Input: one user message with the page name, goals, viewport, theme, and the screenshot as a PNG image
- **FR:review.model** (P2): Reviewer MUST use `STACK_DESIGN_REVIEW_MODEL`, default `gpt-5`
- **FR:review.output** (P1): Output: the reply text
  - **FR:review.output.empty** (P1): Reviewer MUST reject an empty reply

### FR:issue: Issue

The owner needs one issue per review so that findings can be triaged later, one page at a time.

- **FR:issue.repo** (P1): Issue writer MUST file in `STACK_DESIGN_REVIEW_REPO`, default `Xerilium/stack`
- **FR:issue.title** (P1): Output: title `design(<page>): Design review of <Page name>`
- **FR:issue.body** (P1): Output: body that starts with `🤖 [AI] `, then goals, viewport, theme, model, and reply
  - **FR:issue.body.cap** (P1): Issue writer MUST cut the reply, with a note, to keep the body at most 60,000 characters
- **FR:issue.redact** (P1): Issue writer MUST remove token-like strings from the reply before filing
  > - @req FR:feedback-button/store.redact
- **FR:issue.mentions** (P1): Issue writer MUST break each `@` mention in the reply

## Data Model

- Page goals: `{name: string; goals: string[]}` keyed by page id.
- Review result: `{page, url}`.

## Architecture Constraints

- The screenshot and goals go to OpenAI only on the owner's click. Nothing runs on a timer.
- The OpenAI API is the ChatGPT connection. Stack does not script the chatgpt.com web app.
- The issue uses the host's existing GitHub issue filer (`gh issue create`).
- No new dependency: `fetch` only.

## External Dependencies

- OpenAI Responses API (`POST https://api.openai.com/v1/responses`).
- GitHub CLI (`gh`) for the issue.

## Dependencies

- api (routes, owner gate, body rules), desktop-shell (window capture), feedback-button (panel, capture, redaction), inbox-page (issue filer), web-shell (views)
