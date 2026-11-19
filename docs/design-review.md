# Design review

<!-- @req FR:design-review/review.connect @req FR:design-review/issue.repo -->

Get ChatGPT's design feedback on a Stack page in one click. Each review files one GitHub issue.

## Connect ChatGPT (once)

Set an OpenAI API key where the Stack host (desktop app or `stack web`) starts:

| Setting                      | Default          | Use                                |
| ---------------------------- | ---------------- | ---------------------------------- |
| `STACK_OPENAI_API_KEY`       | `OPENAI_API_KEY` | The OpenAI API key                 |
| `STACK_DESIGN_REVIEW_MODEL`  | `gpt-5`          | The model that reviews the page    |
| `STACK_DESIGN_REVIEW_REPO`   | `Xerilium/stack` | The repo that gets the issue       |
| `STACK_DESIGN_REVIEW_LABEL`  | none             | Optional label (must exist) added to each issue |
| `STACK_DESIGN_REVIEW_PUBLIC` | unset            | `1` allows filing in a public repo |

The issue is filed with `gh issue create`, so `gh` must be signed in.

## Review a page

1. Open the page.
2. Open the feedback panel (the icon, or `Shift+F`).
3. Select `Send for design review`.

Stack captures the page, sends it with the page goals to ChatGPT in a new request, and files the reply. The panel shows the issue link.

- Desktop app: the window is captured while the panel is hidden. No prompt.
- Browser: the Screen Capture API asks for the tab. No screenshot, no review.

## Page goals

Each page's goals are in [`src/core/page-goals.ts`](../src/core/page-goals.ts). Change them there to change what the review judges.

## Privacy

The screenshot and goals go to OpenAI only when you select `Send for design review`. The request is not stored (`store: false`). ChatGPT is told not to quote or name page content. Token-like strings are removed and `@` mentions and `#` references are broken (outside code) before the reply goes into the issue.

A public repo (the default `Xerilium/stack` is public) is refused unless `STACK_DESIGN_REVIEW_PUBLIC=1`. Set it only when you accept that a review can describe what was on screen. Otherwise point `STACK_DESIGN_REVIEW_REPO` at a private repo.
