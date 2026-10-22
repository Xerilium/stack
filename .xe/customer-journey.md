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
