# Design review

<!-- @req FR:design-review/review.connect @req FR:design-review/issue.repo -->

Get ChatGPT's design feedback on a Stack page in one click. Each review files one GitHub issue.

## Connect ChatGPT (once)

Set an OpenAI API key where the Stack host (desktop app or `stack web`) starts:

| Setting                     | Default          | Use                             |
| --------------------------- | ---------------- | ------------------------------- |
| `STACK_OPENAI_API_KEY`      | `OPENAI_API_KEY` | The OpenAI API key              |
| `STACK_DESIGN_REVIEW_MODEL` | `gpt-5`          | The model that reviews the page |
| `STACK_DESIGN_REVIEW_REPO`  | `Xerilium/stack` | The repo that gets the issue    |

The issue is filed with `gh issue create`, so `gh` must be signed in.

## Review a page

1. Open the page.
2. Open the feedback panel (the icon, or `Shift+F`).
3. Select `Design review`.

Stack captures the page, sends it with the page goals to ChatGPT in a new request, and files the reply. The panel shows the issue link.

- Desktop app: the window is captured. No prompt.
- Browser: the Screen Capture API asks for the tab. No screenshot, no review.

## Page goals

Each page's goals are in [`src/core/page-goals.ts`](../src/core/page-goals.ts). Change them there to change what the review judges.

## Privacy

The screenshot and goals go to OpenAI only when you select `Design review`. The request is not stored (`store: false`). Token-like strings are removed from the reply before it goes into the issue.
