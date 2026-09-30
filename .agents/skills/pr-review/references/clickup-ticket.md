# ClickUp ticket correspondence

Read this when the PR title contains `[CU-<ticket number>]`. The check answers one
question: **did this diff build the feature the ClickUp ticket describes, or a
different one?** Agents sometimes ship plausible, well-tested code for the wrong
feature. The code review alone cannot catch that; the ticket can.

## Contents

- [When it runs](#when-it-runs)
- [Lookup](#lookup)
- [Comparison rubric](#comparison-rubric)
- [How verdicts feed the gate](#how-verdicts-feed-the-gate)
- [Degradation](#degradation)
- [Output](#output)

---

## When it runs

Only when the **PR title** matches:

```
\[CU-([A-Za-z0-9-]+)\]
```

Match `CU` case-insensitively. Examples: `[CU-86abc123] Add plate cache`,
`[CU-1234] Add plate cache`.

- **No match in the title:** skip the check entirely. Do not call ClickUp. Do not
  scan the PR body, branch name, or commit messages for ticket ids. The review
  proceeds exactly as normal. Stats line: `ClickUp ticket: not in title`.
- **No PR title** (pasted diff, local uncommitted changes): skip the same way.
- **Several tokens:** check each distinct ticket. The diff should correspond to the
  union of what they ask for.

---

## Lookup

1. Extract the token from the title with the regex above.
2. Call the ClickUp tool `clickup_get_task` with `include: ["description"]`.
   - Try the custom id first: `task_id: "CU-<token>"`.
   - If that task does not exist, retry with the bare token: `task_id: "<token>"`
     (the native id from a `app.clickup.com/t/<id>` URL).
3. Use the task **name** and **description**. If the description references
   checklists or acceptance criteria you cannot see, you may add `"checklists"` to
   `include`. Nothing else.
4. The check is read-only. Never comment on, update, move, or change the status of
   the ticket.

---

## Comparison rubric

Compare the **behavior the ticket asks for** against the **behavior the diff
changes**. Extract the ask as 1–3 concrete statements first ("plate lookups are
cached for 24h", "cache is invalidated when a plate record is updated"), then map
each to hunks in the diff.

Ignore when judging correspondence:

- Wording differences between ticket and PR title.
- File layout, naming, or implementation approach the ticket does not prescribe.
- Extra tests, refactors, or cleanup that still serve the requested behavior.

| Verdict           | Condition                                                                                          | Disposition                                                                                                     |
| ----------------- | -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| **Corresponds**   | Every core ask maps to changed behavior in the diff                                                | No finding. One or two sentences quoting the ask and naming the behavior the diff implements                    |
| **Partial**       | Same feature, but a stated acceptance criterion is absent                                          | If that criterion is the point of the ticket → **major** that defeats the stated purpose. Secondary gap → question |
| **Divergent**     | The diff's user-facing behavior is a different feature than the ticket asks for                    | **Major** finding, Gate 1 BLOCKED. Name what the ticket asked and what the diff built                           |
| **Not verified**  | Ticket unavailable, empty, or too vague to compare                                                 | Note only. State why                                                                                            |

Rules:

- **Vague ticket, reasonable reading:** if the diff is a reasonable interpretation of
  a loosely written ticket, that is Corresponds or a question — never Divergent. Do
  not invent a mismatch.
- **Scope creep:** the diff does what the ticket asks and also something unrelated.
  That is Corresponds for the ticket; judge the unrelated part on its own merits and
  suggest splitting if it is substantial.
- **Stale ticket:** if the PR body explicitly says the scope changed and why, note
  the divergence as a question for whoever owns the ticket instead of blocking.
- **Evidence gate still applies.** A Divergent or Partial finding must quote the
  ticket text and name the changed files that do (or fail to do) the work.

---

## How verdicts feed the gate

The ticket is the PR's stated purpose. That is the only link to the merge gate:

- **Divergent** → Gate 1: "A major finding that defeats the PR's stated purpose."
  Verdict BLOCKED. The fix is to change the code to match the ticket, or update the
  ticket if it is stale and the new scope was agreed.
- **Partial on the core ask** → same Gate 1 trigger.
- **Partial on a secondary criterion** → a question. It does not fire Gate 2 unless
  the missing criterion is itself safety-relevant (amounts, entitlements, access).
- **Corresponds** → no effect. Ticket correspondence is not a new self-merge
  requirement; it only removes the "built the wrong thing" risk.
- **Not verified** → a note, same posture as a skipped history check. Never a gate.

---

## Degradation

| Situation                                        | Do                                                                    |
| ------------------------------------------------ | --------------------------------------------------------------------- |
| ClickUp tool not available in this environment   | `Ticket correspondence: not verified (ClickUp tool unavailable)`      |
| Neither `CU-<token>` nor `<token>` resolves      | `Ticket correspondence: not verified (task CU-<token> not found)`     |
| Auth error                                       | Try authenticating once; if it still fails, mark not verified         |
| Description empty or only a title                | Compare against the task name; mark not verified if the name is vague |

Never fabricate ticket contents. If you did not read the ticket, do not imply you did.

---

## Output

Section placed after Summary in the review:

```md
### Ticket correspondence

**[CU-1234] Cache plate lookups** — [link if returned] — **Corresponds / Partial / Divergent / Not verified**

[Ticket asks: "…quoted core ask…". The diff implements … in `path/to/file.ts`. /
The diff instead builds …, which the ticket does not mention.]
```

Stats line: `ClickUp ticket: CU-1234 — corresponds` (or `not in title`, `not verified`).
