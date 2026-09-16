# Prior-attempt forensics

Read this when a PR fixes a bug, touches a fragile-looking file, or is P0/P1 and the
repository is available.

The premise: **code that has been fixed before is more likely to be fixed wrong again.**
A repeat fix means either the earlier attempts treated symptoms, or the code path has a
property nobody has fully understood. Both are reasons to look harder. Human review
fires only when you actually find a revert, hotfix, or repeat-fix chain. Both produce
the highest-value comment you can leave — "the last attempt at this missed X; does
this one handle it?"

## Contents

- [Budget](#budget)
- [Level 1: line lineage](#level-1-line-lineage)
- [Level 2: file history](#level-2-file-history)
- [Level 3: logic lineage](#level-3-logic-lineage)
- [Level 4: failure fingerprints](#level-4-failure-fingerprints)
- [Level 5: human context](#level-5-human-context)
- [Reading a revert chain](#reading-a-revert-chain)
- [Turning history into findings](#turning-history-into-findings)
- [Degradation](#degradation)

---

## Budget

Do not run all of this on every PR. Scale it:

| PR                                                          | Effort                       |
| ----------------------------------------------------------- | ---------------------------- |
| P3, or additive with no bug-fix framing                     | Skip                         |
| P2 bug fix                                                  | Level 1 on the changed lines |
| P1                                                          | Levels 1–3                   |
| P0, or a fix to a previously fixed area, or a churn hotspot | Levels 1–5                   |

Ten commands is a reasonable ceiling. Stop when the picture stops changing.

---

## Level 1: line lineage

Who last changed the exact lines this PR touches, and why?

```bash
git blame -L 40,80 -- src/billing/overage.ts
git log -1 --format='%H %an %ad %s' <sha>
git show <sha> --stat
git show <sha>                      # read the actual previous change
```

What you are looking for: the previous commit message says "fix overage
double-counting" and this PR is also fixing overage double-counting. That is the whole
signal. Now compare the two approaches and ask what the first one missed.

---

## Level 2: file history

```bash
# Recent history, newest first
git log --oneline --follow -20 -- src/billing/overage.ts

# Volatility over 90 days
git log --since='90 days ago' --oneline -- src/billing/overage.ts | wc -l
git log --since='90 days ago' --format='%an' -- src/billing/overage.ts | sort | uniq -c

# Repo-wide hotspots, to know whether this file is unusual
git log --since='6 months ago' --name-only --format='' \
  | grep -v '^$' | sort | uniq -c | sort -rn | head -20
```

Interpretation:

- **>8 commits in 90 days** on a non-generated file: hotspot. Note it; raise scrutiny.
- **4+ distinct authors in 90 days**: no clear owner. Ownership gaps and repeat bugs correlate.
- **Commits clustered within hours or days of each other**: those are fix-the-fix chains, not normal iteration. Read all of them.
- **A file that is normally quiet suddenly changing**: fine, but the reviewer of record probably has no recent context — worth naming in the routing.

---

## Level 3: logic lineage

Find where the _specific behavior_ came from, not just the file.

```bash
# Pickaxe: commits that added or removed this exact string
git log -S 'OVERAGE_MULTIPLIER' --oneline -- src/

# Regex variant: commits whose diff matches this pattern
git log -G 'roundHalfUp|Math\.round' --oneline -- src/billing/

# Follow a function across renames
git log --oneline --follow -- src/billing/overage.ts

# When did this test appear? (a test added alongside a past fix tells you what
# the previous author thought the bug was)
git log --diff-filter=A --oneline -- src/billing/__tests__/overage.test.ts
```

The pickaxe is the workhorse. If a constant is being changed, `git log -S` on that
constant usually surfaces every previous attempt to get it right.

---

## Level 4: failure fingerprints

Search commit messages for the vocabulary of things going wrong.

```bash
git log --oneline -i --grep='revert' -- src/billing/
git log --oneline -i --grep='hotfix' --grep='rollback' --grep='regression' -- src/billing/
git log --oneline -i --grep='incident' --grep='postmortem' --grep='p0' --grep='p1' -- src/billing/
git log --oneline -i --grep='fix again' --grep='re-fix' --grep='actually fix' --grep='proper fix'

# Reverts of reverts — the strongest possible signal
git log --oneline -i --grep='Revert "Revert'
```

"Actually fix X" and "proper fix for X" in a repo's history are gold. They mark exactly
the places where a previous fix was believed complete and was not.

---

## Level 5: human context

Commit messages are compressed; PR threads have the reasoning.

```bash
gh pr list --state all --search 'overage' --limit 20
gh pr list --state all --search 'is:merged path:src/billing' --limit 20
gh pr view 412 --comments
gh pr view 412 --json title,body,mergedAt,reviews,comments

gh issue list --state all --search 'double charge' --limit 20
gh issue view 388 --comments

# Which PR introduced a given commit
gh pr list --search '<sha>' --state all
```

What to extract:

- Concerns a reviewer raised last time. If this PR reintroduces the pattern a reviewer previously flagged, that is a high-confidence finding — cite the PR number.
- Why the previous fix was scoped the way it was. Sometimes the narrow fix was deliberate and documented, which changes your recommendation.
- Whether the previous fix shipped with a test. A repeat bug with no regression test is a strong argument for requiring one here.

---

## Reading a revert chain

When you find a revert, reconstruct the sequence before commenting:

1. `git show <revert_sha>` — what was reverted and does the message say why?
2. `git show <original_sha>` — what did the original attempt do?
3. `git log --oneline <revert_sha>..HEAD -- <path>` — what came after? Was it re-landed?
4. Compare the re-landed version to the original: what changed between attempt 1 and attempt 2? That delta is the thing everyone got wrong the first time — check whether the current PR respects it.

Report it as a narrative, not a data dump:

> `a3f9c21` added per-request quota decrementing; it was reverted three days later in
> `7b2e440` ("revert: quota decrement double-counts retried requests"). The re-landed
> version `c81d0f3` added an idempotency key on the request ID. This PR moves the
> decrement into the retry wrapper, which is the position that failed the first time —
> confirm the idempotency key is still applied on that path.

That paragraph is worth more than the rest of the review.

---

## Turning history into findings

| Observation                                                                 | How to use it                                                                                                                                          |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Previous fix in this path reverted or hotfixed within days                  | +1 criticality tier, human-review gate (only because you found the chain), and a direct question to the author                                          |
| This is the 3rd+ attempt at the same behavior                               | Make root-cause a blocking question: "attempts 1 and 2 patched the caller; this patches a third caller — should the fix be in `normalizeX()` instead?" |
| A past reviewer's concern is reintroduced here                              | High-confidence finding, cite the PR number                                                                                                            |
| Previous fix shipped with a regression test; this one deletes or weakens it | Blocking. The test is the only reason the bug stayed fixed.                                                                                            |
| Previous fix shipped without a test and the bug recurred                    | Require a test here; that is the pattern breaker                                                                                                       |
| Churn hotspot, no revert chain                                              | Note it, raise scrutiny, do not gate on it alone                                                                                                       |
| Clean history                                                               | State it in one line — it is genuine evidence supporting self-merge                                                                                    |

Two hard rules:

- **Never invent history.** If you did not run the commands, write "History: not checked."
- **Never use history to shame.** "This has broken three times" is context for the reviewer, not a verdict on the author. Frame it as "here is what the previous attempts missed", never "you keep getting this wrong."

---

## Degradation

| Available          | Do                                                                                                                        |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| Full repo + `gh`   | All five levels                                                                                                           |
| Full repo, no `gh` | Levels 1–4; note that PR discussion was unavailable                                                                       |
| Shallow clone      | `git fetch --unshallow` if cheap; otherwise say history depth was limited                                                 |
| Pasted diff only   | Skip entirely. Write "History: not checked (no repository access)." Skipping is a note, not a gate. |

Missing history is a note. It is not a Gate 2 trigger. Only a revert, hotfix, or
repeat-fix chain you actually found is.
