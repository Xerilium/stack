# Stack as the front end to agents: research and decision

Date: 2026-10-29. Spec: [.xe/features/agent-team/spec.md](../../.xe/features/agent-team/spec.md) (on top of `.xe/features/agent-sessions/spec.md`, PR 52). Ask contract: [docs/asks.md](../asks.md).

## Question

Michael wants AI on every Stack page (not a chat box), an agent per project folder that reviews each task and says whether it can do it, and agents working at scale on his spare Claude subscription capacity. Which link between the web page and the agents: ACP, the Claude Agent SDK, MCP, or the files-based ask loop that ships today?

## Options

| | What it is | Page ↔ agent | Permissions | Sessions | Cost | Auth / capacity | Agent-agnostic |
|---|---|---|---|---|---|---|---|
| **ACP** | JSON-RPC between an editor (client) and a coding agent (subprocess over stdio); "LSP for agents" [1] | Needs a local client process; remote HTTP/WebSocket "still a work in progress" [1] | `session/request_permission` with `allow_once`/`allow_always`/`reject_*` options [3] | `session/new`, `session/load` (capability), `session/update` streaming, `session/cancel` [2]; list/resume/fork only in the draft v2 [5] | Not in the protocol | Whatever the agent does; Claude via `@agentclientprotocol/claude-agent-acp` (built on the Agent SDK, Apache-2.0) [5] | Yes: Gemini CLI, Claude via adapter, Codex adapters [5], Catalyst PR 157 client (4 methods, no SDK) [6] |
| **Claude Agent SDK** | TypeScript/Python library that runs the Claude Code binary: tools, agent loop, permissions, sessions, hooks, subagents, MCP [7] | Node library inside `stack web` | `canUseTool(tool, input)` callback returns allow/deny; suggestions for "always allow" [7] | `resume`, `forkSession`, streaming input, `includePartialMessages`, `agents` option for named agent definitions, `settingSources` loads `.claude/` from cwd [7] | `result.total_cost_usd` and per-model usage per turn [8] | Signed-in Claude plan: "the SDK and `claude -p` count against your plan limits" [9]; `--bare` needs an API key [8]. Third parties may not *offer* claude.ai login in their products [7]; this is Michael's own tool on his own login | No (Claude only) |
| **MCP** | Tools and resources an agent calls | Wrong direction: agents call Stack (already shipped as `stack mcp`) | n/a | n/a | n/a | n/a | n/a |
| **Files-based ask loop** (PR 46/47) | Agents write `tasks/asks/<key>.md`; the page answers into the file; SSE pushes changes | Durable, host-agnostic, no runner; no streaming, no "start a session from the page" | Already modelled as asks | n/a | n/a | Any agent, any runner | Yes |

Measured on this machine (2026-10-29): `claude -p "Reply with exactly: ok" --output-format json` on the signed-in plan returned `ok` with `total_cost_usd: 0.30` (50k cached context tokens on a fresh session; `--bare` returned "Not logged in", so bare mode is out). Claude Code 2.1.215, SDK 0.3.312 (ESM-only; Stack is CJS, so it is loaded with a dynamic `import()`).

## Decision

1. **The page never speaks an agent protocol.** It talks to `stack web` over the existing REST + SSE (`/api/sessions/*`, `/events` kinds). The host decides whether a runner exists (local `stack web`: yes; Azure host: no, until stack-deploy says otherwise). This keeps "no separate server" true and the UI identical on both.
2. **Default runner: the Claude Agent SDK**, in-process in `stack web` (PR 52's `AgentDriver`, ACP-shaped; this feature adds per-prompt options to it). It is the only option that gives streaming, resume/fork, named agent definitions, a permission callback, and per-turn cost in one call, and it runs on the signed-in plan (spare capacity) [9]. Runner is an interface (`src/agents/runner.ts`); an ACP runner (port of the Catalyst PR 157 client [6]) is the second implementation when a non-Claude agent is wanted. ACP is not the default because the page cannot be an ACP client and the Claude adapter is itself the SDK underneath [5].
3. **Permissions and needs are asks.** A `canUseTool` call becomes an ask (`kind: approve`, key `perm-<session>-<n>`); a review's "what I need from you" becomes asks. One queue, one answer path, durable across restarts, visible on the phone. The streaming drawer only offers a fast path to the same ask.
4. **Agents are defined at the folder (project) level** in `tasks/agents/<slug>.md` with a `scope` of `project` or `project/section` prefixes; a project's existing `- **Agents:**` metadata names its team. The active agent for a task is the most specific scope match; `*` is the roll-up CoS.
5. **Review is explicit, not automatic.** Each session start costs about 50k context tokens on this repo; reviewing 900 tasks unasked would burn the capacity the feature exists to use. `R` on a task (or on a section) runs the scoped agent once with a JSON schema answer.
6. **MCP stays what it is**: the tool surface agents use to read and write Stack. Sessions started from the page get Stack's MCP server so the agent can act on tasks and asks.

## Rejected

- ACP as the default: no browser client, remote transport unfinished [1], no cost signal, and the Claude path is the SDK anyway [5].
- `claude -p` subprocess with `--permission-prompt-tool`: needs an MCP round trip for every permission and risks the long-tool-call backgrounding; the SDK's `canUseTool` is the same wire without the detour.
- Reading session transcripts for status: artifacts, not chat (design-decisions.md, 2026-10-28).
- Persisting sessions in the task repo: one commit per status change; sessions live in `~/.config/stack/sessions.json` and the SDK's own transcripts.

## Sources

1. ACP introduction: local agents as subprocesses over stdio; remote over HTTP/WebSocket "still a work in progress"; re-uses MCP JSON types. https://agentclientprotocol.com/overview/introduction
2. ACP protocol overview: `initialize`, `session/new`, `session/prompt`, `session/load`, `session/cancel`, `session/update`, `session/request_permission`. https://agentclientprotocol.com/protocol/overview
3. ACP tool calls and permission options (`allow_once`, `allow_always`, `reject_once`, `reject_always`; `outcome: selected|cancelled`). https://agentclientprotocol.com/protocol/tool-calls
4. Zed: Claude Code via ACP (adapter runs Claude Code as a separate process). https://zed.dev/blog/claude-code-via-acp
5. `@agentclientprotocol/claude-agent-acp`: built on the Claude Agent SDK, Apache-2.0, v2 draft sessions (list/resume/fork). https://github.com/zed-industries/claude-agent-acp
6. Catalyst ACP provider (stdio JSON-RPC client, no SDK dependency). https://github.com/Xerilium/catalyst/pull/157
7. Claude Agent SDK overview: capabilities, "does not allow third party developers to offer claude.ai login". https://code.claude.com/docs/en/agent-sdk/overview
8. Run Claude Code programmatically: `--output-format json` with `total_cost_usd`, `--bare` needs an API key, `--resume`, `stream-json`. https://code.claude.com/docs/en/headless
9. Claude support, "Agent SDK usage with your plan": "the SDK and `claude -p` count against your plan limits" when signed in; June 15 2026 changes paused. https://support.claude.com/en/articles/15036540
