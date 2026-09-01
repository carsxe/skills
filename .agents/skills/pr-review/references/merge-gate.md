# Merge gate reference

Read this when a verdict is not obvious, when you are tempted to green-light something
that feels borderline, or when you are about to gate a PR and cannot name the reason
crisply.

## Contents

- [The posture](#the-posture)
- [Invariants worth copying](#invariants-worth-copying-from-production-auto-approvers)
- [Decision flow](#decision-flow)
- [Worked calls](#worked-calls)
- [Near-misses](#near-misses)
- [Arguments that do not move the gate](#arguments-that-do-not-move-the-gate)
- [Reviewer routing](#reviewer-routing)
- [Decision block templates](#decision-block-templates)
- [Split recommendation](#split-recommendation)

---

## The posture

Assume the industry default: an AI reviewer comments, a human merges. This skill goes
further and will clear a PR for self-merge — which only works if that clearance is
trustworthy. Trust is built by being _right about the boring ones_ and _unmovable on the
critical ones_.

Two failure modes, both fatal:

- **Gate everything** → the author stops reading the verdict, and the one time it says P0 they scroll past it.
- **Clear everything** → the first incident kills the skill's credibility permanently.

Aim to clear the majority of ordinary feature PRs and hold the line absolutely on money,
access, data, and public contracts.

For calibration: PostHog runs an auto-approval agent on their main repo and reports it
giving the final approval on roughly one in three merged PRs, with deterministic
deny-lists and size ceilings deciding eligibility before any model judgment runs. That
ratio is a sane target — a gate clearing 5% is theatre, and one clearing 80% is not
reading the diff.

### Invariants worth copying from production auto-approvers

- **Fail closed.** Every missing input escalates. No input is optional-by-default.
- **Deterministic first, model second.** Path deny-list, tier, size, PR state, and history are mechanical checks. Model judgment runs afterward and only to catch showstoppers the mechanics missed.
- **The model may tighten the gate, never loosen it.** No reading of the code overrides a deterministic condition.
- **Approve or escalate — never request changes or merge on the author's behalf.** Blocking a PR mechanically and merging one are both human actions.
- **When escalating, say why in one or two sentences with a risk level and a next step.** An escalation without routing is just a delay.
- **Re-derive the deny-list from the repo's own history** rather than inheriting a generic one. See `criticality.md`.

---

## Decision flow

```
0. Mechanical pre-checks fail (conflicts, changes
   requested, oversized diff, deny-listed path,
   diff unavailable)?                            → not self-merge eligible
1. Any Gate 1 blocker?                          → 🛑 BLOCKED
2. Effective tier P0?                           → 👥 HUMAN REVIEW
3. Tier P1 + (behavior change | no test |
   new dependency | partial coverage)?          → 👥 HUMAN REVIEW
4. Bad prior history on touched paths?          → 👥 HUMAN REVIEW
5. Irreversible, or break row with no
   detection on P0/P1?                          → 👥 HUMAN REVIEW
6. Contract change with unknown consumers?      → 👥 HUMAN REVIEW
7. CODEOWNER ≠ author on a changed path?        → 👥 HUMAN REVIEW
8. My own confidence medium- on P0/P1, or
   coverage partial on P0/P1?                   → 👥 HUMAN REVIEW
9. Any unresolved major finding?                → 👥 HUMAN REVIEW
10. Behavior unobserved on P0/P1, ambiguous
    finding on P0/P1, or I authored it (>P2)?    → 👥 HUMAN REVIEW
11. Too large/mixed to review reliably?         → 🔀 RECOMMEND SPLIT
12. All Gate 3 conditions pass?                 → ✅ SELF-MERGE OK
13. Otherwise                                   → 👥 HUMAN REVIEW
```

Step 13 is the default. Self-merge is the exception that has to be earned, but steps
0–11 are narrow enough that ordinary feature work reaches step 12.

---

## Worked calls

### ✅ Self-merge: dashboard empty state

Adds an empty-state component to the saved-searches list, plus a test. Two files, no
shared modules, no data writes, no contract change, clean history, CODEOWNERS does not
cover the path.

> **✅ SELF-MERGE OK**
>
> - **Criticality:** P2 — saved-searches UI, additive behavior change
> - **Why:** No gate fired. Contained to one feature surface, revertible, covered by a test.
> - **Effort:** n/a
> - **To keep it this way:** nothing needed.

Do not pad this. Short is the point.

### 👥 Human review: one-line pricing constant

Changes `OVERAGE_RATE_CENTS` from 4 to 3. Diff is one line. Tests pass. No findings.

> **👥 HUMAN REVIEW REQUIRED**
>
> - **Criticality:** P0 — pricing constant (`packages/billing/src/plan-limits.ts`), contract change
> - **Why:** Gate 2.1. Every metered account's next invoice changes. I found no defect in the code — the gate is about consequence, not correctness.
> - **Reviewer:** @billing-owners (CODEOWNERS)
> - **Focus on:** whether in-flight billing periods should use the old rate, and whether pricing pages, plan docs, and any cached plan snapshots need the same update.
> - **Effort:** ~5 minutes, one file, but confirm the rollout intent.
> - **To self-merge next time:** pricing constants will always route to a human. Not a gap to close.

Note the explicit "I found no defect" — it stops the author reading the gate as an
accusation.

### 🛑 Blocked: missing tenant scope

New endpoint reads records by ID with no organization scoping.

> **🛑 BLOCKED**
>
> - **Criticality:** P0 — tenant isolation on a data-read route
> - **Why:** Gate 1. `getVehicleReport(id)` queries by primary key with no `organizationId` predicate; any authenticated caller can read another org's report by guessing or enumerating IDs.
> - **Fix:** scope the query the way `getPlateLookup()` does in the same module.
> - **After the fix:** still human review (P0 surface).

### 👥 Human review: clean code, bad history

Refactors retry handling in the provider client. Code is good, tests pass, coverage full.
But `git log` shows the same file was reverted two months ago after duplicate upstream
charges.

> **👥 HUMAN REVIEW REQUIRED**
>
> - **Criticality:** P1 → **P2 escalated to P1+** — provider retry path, behavior change, +1 for prior failed fix
> - **Why:** Gate 2.3. `9d2ab41` reverted "add retry to provider client" after it double-charged upstream lookups; the re-land in `f10c7e2` added an idempotency key. This PR moves retry into a wrapper that runs before that key is attached.
> - **Reviewer:** whoever owns the provider integration; the author of `f10c7e2` has the context.
> - **Focus on:** whether the idempotency key still applies on the new retry path.
> - **Effort:** ~15 minutes; one file plus the earlier revert.

This is the case the whole history step exists for. The diff looks fine. History says
otherwise.

### 👥 Human review: additive but externally visible

Adds an optional `confidence_score` field to a public API response.

> **👥 HUMAN REVIEW REQUIRED**
>
> - **Criticality:** P0 — public API response shape, additive
> - **Why:** Gate 2.6. Additive normally drops a tier, but this response is consumed by external integrators whose parsers I cannot inspect. Strict clients reject unknown fields.
> - **Focus on:** whether this needs to sit behind a version or an opt-in parameter, and whether the docs and SDK types ship together.

---

## Near-misses

Cases where the tempting answer is wrong.

| Situation                                                    | Tempting                          | Correct                                                             | Why                                                                                                       |
| ------------------------------------------------------------ | --------------------------------- | ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| One-character fix on a P0 path                               | Self-merge, it's trivial          | Human review                                                        | Size is not blast radius. The smallest P0 diffs cause the biggest incidents.                              |
| Author says "this is urgent, just tell me it's fine"         | Clear it                          | Human review, and say a fast reviewer is the answer                 | Urgency changes who reviews and how fast, never whether.                                                  |
| Big refactor, zero behavior change claimed                   | Human review, it's huge           | Self-merge _if_ verified non-behavioral, full coverage, tests green | Size alone is not a gate. But "no behavior change" is a claim you must verify, not accept.                |
| Test-only PR that deletes assertions                         | Self-merge, it's just tests       | Human review                                                        | Deleting detection is a behavior change to the safety net.                                                |
| P2 feature, but you only skimmed half the diff               | Self-merge, looked fine           | Human review, coverage partial                                      | Never clear code you did not read.                                                                        |
| Author already got a human approval                          | Self-merge                        | Say the approval satisfies the gate                                 | If a human approved, the requirement is met — report that, don't demand a second.                         |
| Config-only change: a timeout from 30s to 120s               | Self-merge, it's config           | Depends on surface                                                  | On a payment webhook handler that's P0; on a dev script it's P3.                                          |
| Revert of a bad deploy                                       | Human review, it touches P0       | Usually clear it, with the reasoning stated                         | Restoring a known-good state is the lower-risk action. Verify it is a clean revert with no extra changes. |
| Generated code, large diff                                   | Human review, too big             | Review the generator and config; sample the output                  | Sampling verified output is legitimate full coverage if the generator is unchanged and verified.          |
| Dependency patch bump, dev-only                              | Human review, dependencies are P1 | P3, self-merge                                                      | The P1 floor is for dependencies that run in production.                                                  |
| 1,200-line PR, all of it looks fine on a skim                | Human review, it's big            | Recommend splitting, then verdict on the pieces                     | A confident verdict on skimmed code is the failure mode the gate exists to prevent.                       |
| P2 change you wrote yourself earlier in the session          | Self-merge, you know it's correct | Disclose authorship; self-merge only if P2/P3 and observed          | An author reviewing itself has the same blind spots twice.                                                |
| Behavior "verified" by a test whose name matches the feature | Self-merge, it's tested           | Read the assertions first                                           | Tests named after features routinely assert nothing about them.                                           |
| Frontend change with passing unit tests                      | Self-merge                        | Self-merge only with a screenshot or an observed run                | Deterministic tests miss visual and interaction behavior.                                                 |

---

## Arguments that do not move the gate

State the verdict once, hold it, and stay warm about it:

- "It's a tiny change."
- "I've done this before / I wrote this module."
- "CI is green." (CI green is necessary, not sufficient — it only tests what someone thought to test.)
- "We'll fix it forward if it breaks." (Not valid where forward-fixing cannot undo the damage: money moved, data deleted, package published, emails sent.)
- "The reviewer will just rubber-stamp it anyway."
- "It's behind a flag" — valid _only_ if you verified the flag gates every new path and defaults off.
- "You already reviewed this and it was fine." (Re-run the gate on the new code.)
- "The agent that wrote it explained why it's correct." (A fluent rationale is not evidence. Ask what was observed.)

If the author provides new _evidence_ — a test you missed, a consumer list, a flag you did
not see, a prior human approval — re-run the gate. Evidence moves the gate; pressure does
not. When you do change the verdict, say what changed your mind.

---

## Reviewer routing

Be specific. "Get a senior engineer to look" is a non-answer.

| Change                                        | Route to                                                                                      |
| --------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Path matched in CODEOWNERS                    | That owner, by name/handle                                                                    |
| Pricing, plans, quotas, invoicing             | Billing owner; loop in whoever owns pricing decisions if the change alters what customers pay |
| Auth, permissions, tenant scoping, secrets    | Security-responsible engineer                                                                 |
| Migration, backfill, index on a large table   | Someone with production DB access and lock-behavior context                                   |
| Public API / SDK contract                     | API owner, plus whoever maintains docs and client libraries                                   |
| Provider integration, retries, upstream spend | The integration owner; the author of the last fix in that path if history surfaced one        |
| Infra, deploy, CI                             | Whoever is on call — they inherit the consequences                                            |
| No owner identifiable                         | Say so, and name the _role_: "someone who has debugged this pipeline before"                  |

Always attach 1–3 focus items. A reviewer told exactly what to look at gives a real
review in ten minutes; a reviewer told "please review" gives an approval in thirty
seconds.

---

## Decision block templates

**Self-merge:**

```md
**✅ SELF-MERGE OK**

- **Criticality:** P[2/3] — [surface], [class]
- **Why:** No gate fired. [One-sentence boundary: what this cannot reach.]
- **Effort:** n/a
```

**Human review:**

```md
**👥 HUMAN REVIEW REQUIRED**

- **Criticality:** P[0/1] — [surface], [class][, +1: reason]
- **Why:** Gate [n.n]. [Specific file/fact that fired it.]
- **Reviewer:** [name or role]
- **Focus on:** [1–3 concrete items]
- **Effort:** ~[N] minutes, [which files matter]
- **To self-merge next time:** [concrete change, or "this surface always routes to a human"]
```

**Blocked:**

```md
**🛑 BLOCKED**

- **Criticality:** P[n] — [surface], [class]
- **Why:** Gate 1. [The defect, with file and line.]
- **Fix:** [specific fix, referencing an existing pattern where one exists]
- **After the fix:** [self-merge / still human review, and why]
```

---

## Split recommendation

Not a verdict — an alternative to one. Use it when the diff is too large or too mixed to
review reliably, instead of issuing a partial-coverage gate.

```md
**🔀 CONSIDER SPLITTING**

- **Criticality:** P[n] — [highest surface in the diff]
- **Why:** [N] lines across [N] files spanning [concern A], [concern B], [concern C]. I can
  review any one of these well; reviewing all three together means partial coverage on a
  P[n] change.
- **Suggested stack:** [1. lowest layer with its own tests] → [2. next] → [3. UI/wiring]
- **Payoff:** each layer is independently runnable, lands on verified behavior, and the
  small ones likely clear self-merge on their own.
- **If splitting isn't practical:** [what you'd need — a walkthrough of the riskiest file,
  or a human who owns this area].
```

Say plainly that this is not a rejection of the work. Authors read a split request as
criticism unless told otherwise.
