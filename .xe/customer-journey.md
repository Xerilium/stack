# Customer Journey

## Work the next task

Owner asks Stack what to do next, acts on it, and marks it done. Stack scores the stack, commits the change, and rolls recurring rows.

```mermaid
sequenceDiagram
    actor Owner as Owner
    participant Stack as Stack System
    Owner->>Stack: next
    Stack-->>Owner: best task
    Owner->>Stack: complete
    Stack->>Stack: roll recurring row, commit
    Stack-->>Owner: updated stack
```

## Agent triage

AI Agent reads the next task, works within its autonomy level, and records the result. It never merges or deploys; Owner reviews asynchronously.

```mermaid
sequenceDiagram
    actor Agent as AI Agent
    actor Owner as Owner
    participant Stack as Stack System
    Agent->>Stack: next
    Stack-->>Agent: task and autonomy level
    Agent->>Stack: complete or triage, log result
    Owner->>Stack: review history later
```

## Morning

Owner opens Stack, does the one top task, answers the decisions that wait, then plans the rest of the day around meetings. Scenarios: `FR:next-task`, `FR:needs-you`, `FR:my-day`, `FR:priorities`.

```mermaid
sequenceDiagram
    actor Owner as Owner
    participant Stack as Stack System
    Owner->>Stack: open Now
    Stack-->>Owner: one top task (priorities first)
    Owner->>Stack: do it, or Defer
    Owner->>Stack: open Needs you
    Stack-->>Owner: priorities, ranked asks, sessions that wait
    Owner->>Stack: open My day
    Stack-->>Owner: schedule from wake to bed, meetings out
```

## Answer an ask

An agent or the mail triage raises a decision. Owner answers it in one step. The answer goes back to the agent as a file; the ask moves to Answered until the agent acts. Scenarios: `FR:needs-you`, `FR:inbox-zero`.

```mermaid
sequenceDiagram
    actor Agent as AI Agent
    actor Owner as Owner
    participant Stack as Stack System
    Agent->>Stack: raise ask (recommendation, deadline, link)
    Stack-->>Owner: ask ranked in Needs you
    Owner->>Stack: pick an option, or reply
    Stack->>Agent: answer file in the agent inbox
    Stack-->>Owner: ask moves to Answered
    Agent->>Stack: act on the answer
```

## Agent escalation via CoS

A worker agent hits a decision it cannot make. The CoS agent checks it, decides what it can, and escalates only the rest. Owner sees one ask, not the agent traffic. Scenarios: `FR:needs-you`, `FR:sessions`, `FR:pr-review`.

```mermaid
sequenceDiagram
    actor Worker as AI Agent
    actor CoS as CoS Agent
    actor Owner as Owner
    participant Stack as Stack System
    Worker->>CoS: blocked: needs a decision
    CoS->>CoS: decide, or keep for the owner
    CoS->>Stack: raise one ask
    Stack-->>Owner: ask in Needs you
    Owner->>Stack: answer
    Stack->>CoS: answer file
    CoS->>Worker: continue
```
