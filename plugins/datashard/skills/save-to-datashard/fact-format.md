# A fact file in an OKF bundle

A bundle is a folder (usually `.okf`) of Markdown files, one fact per file, in OKF v0.2 (Open Knowledge Format).
Its section's importers load it into that one section from the home page's Import, signed in; the bundle stays the master.

## The file

```markdown
---
type: Decision
title: Where a finished POD is written back to
description: One line that tells a reader whether this is the fact they need.
tags: [acme, webhook]
status: stable
generated: { by: claude-code/<model>, at: 2026-10-15T14:00:00Z }
sources:
  - id: workshop
    resource: A URL, or where it was said (a thread, a meeting, a file)
    title: What the source is
    author: human:<who>
    last_modified: 2026-10-15T14:00:00Z
---

# Overview

The rule, and why it holds.
```

## Fields

| Field | Rule |
|---|---|
| `type` | Required. The kind of fact in a word or two: Decision, Reference, Runbook, Behaviour… Reuse the kinds the bundle already has. |
| `title` | Required. |
| `description` | Required. One line. |
| `tags` | Up to 5, from the brief's tag list. The import drops any other tag, and keeps the first 5 known ones. |
| `status` | `draft`, `stable` or `deprecated`. Always write it: a missing status reads as `stable`. A `draft` is hidden from search. |
| `generated` | `by` and `at` together: who wrote the fact (`claude-code/<model>`, `human:<name>`) and when, in UTC. Never `claude/mcp`, which marks facts saved through MCP. On an edit, keep it and add `updated: { by, at }`. |
| `sources` | Optional: where the fact comes from. Kept as a list at the end of the fact's text. |
| `stale_after` | Optional: when the fact should be checked again. Not stored yet. |
| `datashard_master` | Optional, only `datashard`: the fact is now kept in Datashard (for example split there), so the import leaves it as it is. Its other fields and text are then ignored, so the file may be cut down to this one field. |

## What the import enforces

- A fact's id is the section plus the file's path without `.md`: `integrations/acme/identifiers.md` becomes
  `<section>/integrations/acme/identifiers`. Paths use lowercase letters, digits and `/ _ . -` only.
- Moving or renaming a file adds a new fact and deprecates the old one, so move files only for a reason.
- Deleting a file deprecates its fact at the next import: it stays readable, marked deprecated. Setting
  `status: deprecated` does the same and keeps the file.
- A Markdown file without `type` is not a fact (`index.md`, `log.md`): the import skips it.
- A file with `datashard_master: datashard` hands its fact to Datashard: the import never writes the file's text over
  it, re-owns it or deprecates it, and refuses the bundle if the install has no such fact. Edit that fact with `save`.
- A link to another fact file, relative (`../decisions/writeback-routing.md`) or from the bundle's root
  (`/decisions/writeback-routing.md`), becomes a link between the two facts.
- A file that looks like it holds a key, token or password stops the whole import.
- The bundle's root `index.md` has `okf_version: '0.2'` in its front matter.

## Splitting and merging

Facts are kept within 4,000 characters, title, description and body together (ADR 0028). The import warns about a
longer fact and notes one under about 300 characters (ADR 0029).

**Splitting a long fact.**

1. Its file stays and becomes the overview: same path, so the same id and URL, and links to it keep working.
2. Each part is a new file next to it, named for its topic, with its own `type`, `title`, `description` and `tags`;
   its title and first line name its subject.
3. The overview lists every part with a relative link, one line each.
4. The folder's `index.md` lists the new files, and `log.md` records the split.

**Merging two small facts on one topic.**

1. One file takes both texts, within 4,000 characters, keeps its path, and links to the other file.
2. The other file stays unchanged apart from `status: deprecated`: retiring keeps a fact's text, so it is found from
   the new one (its `linkedFrom`). Deleting it instead would leave the new file's link
   reaching nothing.
3. `log.md` records the merge, and the folder's `index.md` drops the retired file.

## Index and log

- Each folder's `index.md` lists its facts, one line each: `* [Title](file.md) - what it covers.` Add a new fact there.
- `log.md` records every change, newest day first:
  `* **Update**: [Title](/path/to/fact.md). What changed, and why.`
