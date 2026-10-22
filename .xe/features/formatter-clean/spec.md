---
id: formatter-clean
title: Clean Formatter and Dual Output
author: flanakin
description: "Formatter interface, emoji-markdown default, a clean YAML formatter, per-repo format selection, and lossless converters."
dependencies: [task-parser, config]
---

<!-- markdownlint-disable single-title -->

# Feature: Clean Formatter and Dual Output

## Purpose

Let a repo store tasks as legacy emoji-markdown or as a clean YAML file, chosen by config, with lossless conversion between them.

## Scope

- In: `Formatter` interface (`src/core/formatter.ts`), emoji formatter (adapter over task-parser, behavior unchanged), clean YAML formatter, `format`/`alsoWrite` config keys, converters, round-trip fixtures.
- Non-goals: migrating legacy data, rewiring lifecycle/summaries/CLI/API to read clean files, scoring or date semantics, a model-level (`task-model`) mapping.
- Task text stays opaque in both formats (emoji, dates, `Mon D` stay in `text`).
- Lossless means: convert emoji to clean and back yields identical bytes, and clean to emoji and back yields identical bytes, for canonical files (LF, no BOM, 2-space indent, notes before subtasks, standard blank lines). Non-canonical emoji bytes (BOM, CRLF, tabs, prose, unknown lines, `[X]`) are preserved only by the emoji formatter on its own parse/serialize; converting to clean keeps the structure and drops them.

## Scenarios

### FR:iface: Formatter interface

- **FR:iface.@type** (P1): Interface: `Formatter { id: FormatId; extension: string; parse(src: string): Project; serialize(p: Project): string }` where `FormatId` is `'emoji' | 'clean'` and `Project` is the task-parser type
- **FR:iface.registry** (P1): `getFormatter(id)` MUST return the formatter; unknown ids MUST throw `FormatterError`
- **FR:iface.detect** (P2): `detectFormat(path)` MUST return `clean` for `.yaml`/`.yml` and `emoji` otherwise

### FR:emoji: Emoji formatter (default)

- **FR:emoji.adapter** (P1): The emoji formatter MUST delegate to `parseProject`/`serializeProject`, so existing behavior and byte-exact tests are unchanged
- **FR:emoji.generate** (P1): When a `Project` has no source lines (built by another formatter), `serialize` MUST emit canonical emoji-markdown: `# title`, metadata bullets, `## heading` sections, `- [ ]`/`- [x]` tasks indented 2 spaces per level, notes indented under their task, one blank line between blocks, trailing newline

### FR:clean: Clean formatter

- **FR:clean.shape** (P1): Clean files MUST be YAML with `title`, `metadata` (map), and `sections` (list of `heading`, `tasks`); each task has `text`, `done` (boolean), and optional `notes` (string list) and `subtasks` (task list)
- **FR:clean.parse** (P1): `parse` MUST return a `Project` with the same tree the emoji parser would give for the same content, with empty `lines` and `line: -1`
- **FR:clean.serialize** (P1): `serialize` MUST emit deterministic YAML from the tree, omitting empty `notes`/`subtasks`/`metadata`
- **FR:clean.invalid** (P1): Malformed YAML or wrong shapes MUST throw `FormatterError` naming the path
- **FR:clean.set-checked** (P2): `setChecked` on a clean-parsed `Project` MUST update the task and serialize MUST reflect it

### FR:select: Per-repo selection

- **FR:select.config** (P1): `StackConfig.format` MUST accept `emoji` (default) or `clean`; other values MUST throw `ConfigError`
- **FR:select.also** (P1): `StackConfig.alsoWrite` (default `[]`) MUST list extra formats to write alongside the primary; invalid ids or the primary itself MUST throw `ConfigError`
- **FR:select.render** (P1): `renderOutputs(project, config)` MUST return `{format, extension, content}` for the primary format first, then each `alsoWrite` format

### FR:convert: Converters

- **FR:convert.fn** (P1): `convert(src, from, to)` MUST parse with `from` and serialize with `to`
- **FR:convert.emoji-clean-emoji** (P1): Canonical emoji fixtures MUST round-trip emoji to clean to emoji byte-exact
- **FR:convert.clean-emoji-clean** (P1): Clean fixtures MUST round-trip clean to emoji to clean byte-exact

## External Dependencies

- `yaml` (npm) for parsing and stringifying the clean format
