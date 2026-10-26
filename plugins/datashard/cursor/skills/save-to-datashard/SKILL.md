---
name: save-to-datashard
description: Saves knowledge to the company's Datashard knowledge base, through its save tool or as a fact file in the project's OKF bundle, after the person approves the exact text. Use when the person asks to save, record or share something with the team, to update or retire a Datashard fact, or agrees to save a decision, contract or gotcha the agent offered to save.
---

# Save to Datashard

Four steps, in order. The person approves before anything is written: they are recorded as having verified it.
Facts are kept small: one topic each, within 4,000 characters, a long text split into linked facts.

## 1. Check what is there

- `search` Datashard for the topic: 2–6 distinctive words, and the project's tags (see `DATASHARD.md`).
- With a bundle, also search its files: they may hold changes not imported yet.
- Read the closest facts. If one already covers the topic, update it rather than add a new one. A short addition
  goes into that fact when the result stays within 4,000 characters.
- If what you would save contradicts a fact, tell the person before anything else, quoting the fact and its owner.

## 2. Write the fact

- One topic per fact. A title a colleague would search for, a one-line description, a short body that gives the reason
  along with the rule.
- Title, description and body together at most 4,000 characters, the body ideally under 1,500 (the part search by
  meaning reads). `save` refuses a longer fact; the import warns about one.
- **Longer, or more than one topic: split it.**
  1. Split at the headings, one fact per topic. Merge a section under about 300 characters into its neighbour.
  2. Each part's title and first line name its subject ("Acme webhook: retries", not "Retries"), so it is understood
     on its own.
  3. Add an overview fact: what the whole is about, then one line per part, each linking straight to the part.
  4. To split a fact that is already too long, it becomes the overview, keeping its id (or its file), and the parts
     are new facts.
- Tag what the fact is about (a client, a system, a project) with up to 5 tags from the brief's list: those without a
  `section`, and those of the section you save to, most used first. Reuse before anything new.
- Only when no tag fits, propose one new tag in `newTags`: `{id, about}`, an id a colleague would use for that client,
  system or project, never a ticket id, a type or a status. One per save, and it goes on the fact. A fact in a bundle
  can't create one: a bundle's tags come in with its import.
- Link the related facts you found, as `[title](fact:<id>)` for `save`, or as a relative link to the file in a bundle.
- Never include keys, tokens, passwords, or personal data beyond names and work roles.

## 3. Show it and wait

Show the exact title, description, body, tags and section (or the file's path and full text) of every fact, with the
section's under, client and project from the brief, so the person sees whose knowledge it becomes. Show a new
tag and its `about` apart from the fact's text, and, when an update moves a fact to another section, the old section's
tags it drops. The
section is the project's (see `DATASHARD.md`) unless the person names another. A client's cost, rates, budget and margin
go in `commercial`, never in its client section. Show when the fact should be reviewed too, as `reviewIn`:
pricing and rates `90d`, customer context `60d`, runbooks and architecture `6m`, policies `1y`, decisions `never`; left
out, its section's interval applies. Save only after the person says yes; one yes covers all the facts shown together.

## 4. Save

A fact for the project's section, when the project keeps a bundle, is a file. Any other fact goes through `save`.

**The `save` tool.**

- New fact: `save` with `section`, `type`, `title`, `description`, `body`, `tags`. In a section that keeps facts about
  clients, such as `commercial`, also pass `about`: the client's project or organisation id from the brief's `parties`.
- A split: save the parts first, then the overview with the parts' ids (`save` refuses a link to a fact that does not
  exist yet). Pass the same ids as the overview's `parts`, so search returns the family once and each part carries the
  overview's title. Parts are in the overview's section; a part of another overview, or an overview itself,
  is refused (`bad-part` names it).
- Update: also pass the fact's `id` and the `version` you read. Retire: also pass `status: deprecated`, and leave out
  the title, description, body and tags, which are kept as they are; put the reason or the replacement in a fact that
  links to it.
- Review, when you are the fact's reviewer and it is still right: pass its `id` and `version` and leave out its text, so
  it is kept as it is and its review date moves. Pass `closes` with the ids of the flags you showed the
  person, which the review answers. To mark it out of date until you can fix it, also pass `markStale`: every reader
  sees it as stale until its next review. `not-the-reviewer` names who reviews the fact; `imported` means review it in its
  bundle.
- If it is refused, act on the message: `conflict` means read the fact again and redo step 3; an unknown tag names the
  nearest known ones; an unknown link names the link to fix; a secret means take it out; `too-long` means split the
  fact as in step 2; `retire-changes-fact` means retire it with its text and tags left out; `bad-part` names the part to leave out or fix;
  `about` refused means pick an id from the brief's `parties`, or save another client's knowledge in its own section;
  `near-tag` names the tag the new one is the same as or near: use it, or, only if the person says the new one means
  something else, save again with it in the new tag's `distinctFrom`; `not-a-tag` means pick an id for what the fact is about;
  `tag-limit` means use one of the section's tags; `too-many-tags` means leave one out of `tags`.
- If the answer lists `droppedTags`, tell the person the fact no longer carries them.
- If the answer lists `hiddenLinks`, tell the person which roles can't open which linked facts.
- Give the person the saved fact's url and version. Never say a fact was saved unless `save` answered with it.

**A file in the bundle.**

- Write or edit the file as [fact-format.md](fact-format.md) describes, and add a line to the bundle's `log.md`.
  To split or merge facts in a bundle, follow its "Splitting and merging" section.
- Tell the person the fact reaches Datashard after an authorized importer uploads the bundle ZIP through
  **Import** on their install's home page, reviews the preview, and confirms the import. Editing the file alone
  does not publish it. Do not suggest the retired `import-okf --apply` command.
