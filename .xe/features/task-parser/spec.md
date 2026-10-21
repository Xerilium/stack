---
id: task-parser
title: Task Parser
author: flanakin
description: "Parse project markdown into a task tree and serialize it back byte-for-byte."
dependencies: []
---

# Feature: Task Parser

## Requirements

- **FR-1**: Parse a project file into title, metadata (`- **Key:** value`), sections (`## heading`), and a task tree by indentation.
- **FR-2**: Task = checkbox state, text, children (indented checkboxes), notes (indented non-checkbox lines).
- **FR-3**: `serialize(parse(x)) === x` for any input (BOM, CRLF, unknown lines preserved).
- **FR-4**: Mutations (`setChecked`) change only the target line.
