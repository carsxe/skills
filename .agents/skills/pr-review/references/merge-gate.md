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
further and will clear a PR for self-merge — including a verified pricing or auth
tweak — which only works if that clearance is trustworthy. Trust is built by being
_right about the boring ones_ and _unmovable on unverified silent/expensive risk_.

Two failure modes, both fatal:

- **Gate everything** → the author stops reading the verdict, and the one time it says "unverified overage multiplier" they scroll past it.
- **Clear everything** → the first incident kills the skill's credibility permanently.

**Criticality decides how hard you look. It does not, by itself, decide the merge
verdict.** Aim to clear ordinary feature PRs, email workflow tweaks, type-only
changes in billing, and verified P0 hunks whose intent is stated and observed. Hold
the line on unverified money, access, data deletion, and breaking public contracts.

For calibration: PostHog runs an auto-approval agent on their main repo and reports it
giving the final approval on roughly one in three merged PRs, with deterministic
size ceilings and review-reliability checks deciding eligibility before any model
judgment runs. A gate clearing 5% is theatre. A gate that auto-blocks every P0 path
is also theatre.

### Invariants worth copying from production auto-approvers

- **Asymmetric on unknowns, not surfaces.** Unverified money/authz/deletion/breaking contract escalates. A verified P0 with no findings does not.
- **Fail closed on required inputs only.** Unreadable diff, unknown CI, merge conflicts. Skipped history and unnamed CODEOWNER are notes, not gates.
- **Deterministic first, model second.** Size, PR state, diff availability, and *repo-required* approvals are mechanical. Path is a reason to look, not a deny-list. History is a gate only when you found a revert/hotfix chain.
- **Open the hunk, then you may lower the tier.** No reading of the code overrides a real Gate 2 trigger. A "could be P0" guess does not survive opening a type-only hunk.
- **Approve or escalate — never request changes or merge on the author's behalf.** Blocking a PR mechanically and merging one are both human actions.
- **When escalating, say why in one or two sentences with a risk level and a next step.** An escalation without routing is just a delay. Never close with "this surface always routes to a human."
- **Re-derive the scrutiny list from the repo's own history** rather than inheriting a generic deny-list. See `criticality.md`.

---

## Decision flow

```
0. Mechanical pre-checks fail (conflicts, changes
   requested, oversized skimmed diff,
   diff unavailable)?                            → split or condition on CI;
                                                   not "human because path"
1. Any Gate 1 blocker?                          → 🛑 BLOCKED
2. Unverified silent/expensive path
   (money, entitlement, authz, deletion,
   breaking public contract)?                    → 👥 HUMAN REVIEW
3. Unresolved major, or ambiguous product
   question that would change safety?            → 👥 HUMAN REVIEW
4. Partial coverage / too mixed to review?      → 🔀 RECOMMEND SPLIT
5. Known-bad history you actually found?        → 👥 HUMAN REVIEW
6. Repo policy requires a human
   (branch protection / required CODEOWNERS)?    → 👥 HUMAN REVIEW
7. Breaking external contract
   (rename/remove/default/type) with
   unknown consumers?                            → 👥 HUMAN REVIEW
8. Irreversible side effect not verified
   (blast email, Stripe mutate, publish,
   destructive migrate)?                         → 👥 HUMAN REVIEW
9. All Gate 3 conditions pass?                  → ✅ SELF-MERGE OK
10. Otherwise                                   → 👥 HUMAN REVIEW
```

Step 10 is the fallback, not the default. P0/P1 does not appear in this flow as a
standalone trigger. Ordinary feature work, email delays, type-only billing hunks,
and verified pricing tweaks reach step 9.

---

## Worked calls

### ✅ Self-merge: dashboard empty state

Adds an empty-state component to the saved-searches list, plus a test. Two files, no
shared modules, no data writes, no contract change, clean history, CODEOWNERS does not
require approval.

> **✅ SELF-MERGE OK**
>
> - **Criticality:** P2 — saved-searches UI, additive behavior change
> - **Why:** No gate fired. Contained to one feature surface, revertible, covered by a test.
> - **Effort:** n/a
> - **To keep it this way:** nothing needed.

Do not pad this. Short is the point.

### ✅ Self-merge: email workflow delay

Changes a welcome-email delay from 1h to 2h. Test updated. Recipients, template, and
amounts untouched.

> **✅ SELF-MERGE OK**
>
> - **Criticality:** P2 — notification workflow timing, behavior change
> - **Why:** No gate fired. Unsendability does not apply to an unshipped delay. Test asserts the new interval.
> - **Effort:** n/a

### ✅ Self-merge: type-only change in billing

Adds a JSDoc comment and a TypeScript type in `packages/billing`. No runtime amount,
quota, or Stripe call changes.

> **✅ SELF-MERGE OK**
>
> - **Criticality:** P3 — billing neighborhood, non-behavioral
> - **Why:** No gate fired. The hunk does not compute or display money.

### ✅ Self-merge: dashboard copy next to a usage number

Rewords the label beside a usage meter. The number is still read from the existing
API field; computation is untouched.

> **✅ SELF-MERGE OK**
>
> - **Criticality:** P3 — presentation copy
> - **Why:** No gate fired. Displaying a price nearby does not inherit P0.

### ✅ Self-merge: stated pricing change, observed

Changes `OVERAGE_RATE_CENTS` from 4 to 3. PR description says "new published overage
price." A test asserts the plan boundary is 3 cents.

> **✅ SELF-MERGE OK**
>
> - **Criticality:** P0 — pricing constant (`packages/billing/src/plan-limits.ts`), contract change
> - **Why:** No gate fired. Intent is stated; test asserts the new cents. Surface is P0, so scrutiny was high — that is not a human stamp.
> - **Observe it:** `pnpm test plan-limits` — expect overage at the quota boundary to equal 3.

### 👥 Human review: pricing change with no stated intent

Same one-line `OVERAGE_RATE_CENTS` 4 → 3. PR title is "tweak constants." No description,
no test asserting 3, no mention of a published price change.

> **👥 HUMAN REVIEW REQUIRED**
>
> - **Criticality:** P0 — pricing constant (`packages/billing/src/plan-limits.ts`), contract change
> - **Why:** Gate 2.2. Every metered account's next invoice changes, and the PR never says 3 is the intended rate. I found no defect in the arithmetic — the gate is unverified product intent, not "pricing always needs a human."
> - **Reviewer:** @billing-owners (CODEOWNERS)
> - **Focus on:** whether 3 cents is the published rate, and whether in-flight billing periods should use the old rate.
> - **Effort:** ~5 minutes, one file.
> - **To self-merge next time:** state the new published price in the PR body and add a test asserting 3 at the plan boundary.

### 🛑 Blocked: missing tenant scope

New endpoint reads records by ID with no organization scoping.

> **🛑 BLOCKED**
>
> - **Criticality:** P0 — tenant isolation on a data-read route
> - **Why:** Gate 1. `getVehicleReport(id)` queries by primary key with no `organizationId` predicate; any authenticated caller can read another org's report by guessing or enumerating IDs.
> - **Fix:** scope the query the way `getPlateLookup()` does in the same module.
> - **After the fix:** self-merge if a test asserts the org predicate; otherwise human review (unverified authz).

### 👥 Human review: clean code, bad history

Refactors retry handling in the provider client. Code is good, tests pass, coverage full.
But `git log` shows the same file was reverted two months ago after duplicate upstream
charges.

> **👥 HUMAN REVIEW REQUIRED**
>
> - **Criticality:** P1 — provider retry path, behavior change, +1 for prior failed fix
> - **Why:** Gate 2.4. `9d2ab41` reverted "add retry to provider client" after it double-charged upstream lookups; the re-land in `f10c7e2` added an idempotency key. This PR moves retry into a wrapper that runs before that key is attached.
> - **Reviewer:** whoever owns the provider integration; the author of `f10c7e2` has the context.
> - **Focus on:** whether the idempotency key still applies on the new retry path.
> - **Effort:** ~15 minutes; one file plus the earlier revert.
> - **To self-merge next time:** show the idempotency key is attached before the new retry wrapper (test asserting no duplicate upstream charge on retry).

This is the case the whole history step exists for. The diff looks fine. History you
*found* says otherwise. History you *skipped* does not.

### ✅ Self-merge: additive optional API field, confirmed optional

Adds an optional `confidence_score` field to a public API response. Field is omitted
when absent; docs and SDK types ship together; existing clients ignore unknown fields
or the OpenAPI spec marks it optional.

> **✅ SELF-MERGE OK**
>
> - **Criticality:** P0 — public API response shape, additive
> - **Why:** No gate fired. Confirmed optional; not a rename/remove/default/type break. Gate 2.6 is for breaking contracts, not additive optional fields.

### 👥 Human review: receipt email amount change, intent unverified

Template now interpolates a different billed total. No PR description of the new
amount; no preview/test asserting the cents.

> **👥 HUMAN REVIEW REQUIRED**
>
> - **Criticality:** P0 — billed amount in a receipt email
> - **Why:** Gate 2.1 / 2.7. Money in an irreversible channel, and content was not observed. Unsendability is a verification demand, not the reason by itself.
> - **Focus on:** the source of the new total and a preview asserting the cents.
> - **To self-merge next time:** state the intended amount and add a template test/preview that asserts it.

### ✅ Self-merge: receipt email amount change, stated and observed

Same template change. PR says the total now excludes tax because tax is itemized
below. A fixture preview asserts the cents.

> **✅ SELF-MERGE OK**
>
> - **Criticality:** P0 — billed amount in a receipt email
> - **Why:** No gate fired. Intent stated; preview asserts the cents.

---

## Near-misses

Cases where the tempting answer is wrong.

| Situation                                                    | Tempting                          | Correct                                                             | Why                                                                                                       |
| ------------------------------------------------------------ | --------------------------------- | ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| One-character proven bugfix on a P0 path, test asserts the value | Human review, it's P0          | Self-merge                                                          | Surface is scrutiny. Observed bugfix is not an unexplained rate/permission change.                        |
| Unexplained rate or permission change, no stated intent      | Self-merge, it's one line         | Human review                                                        | Gate 2.2: product intent would change safety and the PR never states it.                                  |
| Author says "this is urgent, just tell me it's fine"         | Clear an unverified P0            | Verify or get a human; urgency does not skip observation            | A verified P0 can self-merge. An unverified one cannot, however urgent.                                   |
| Big refactor, zero behavior change claimed                   | Human review, it's huge           | Self-merge _if_ verified non-behavioral, full coverage, tests green | Size alone is not a gate. But "no behavior change" is a claim you must verify, not accept.                |
| Test-only PR that deletes assertions                         | Self-merge, it's just tests       | Human review                                                        | Deleting detection is a behavior change to the safety net.                                                |
| P2 feature, but you only skimmed half the diff               | Self-merge, looked fine           | Split or human review, coverage partial                             | Never clear code you did not read.                                                                        |
| Author already got a human approval                          | Self-merge                        | Say the approval satisfies the gate                                 | If a human approved, the requirement is met — report that, don't demand a second.                         |
| Config-only change: a timeout from 30s to 120s               | Human review, it's a job          | Depends on whether the hunk is silent/expensive                     | Payment webhook timeout: observe or human. Email-job delay that is not a payment webhook: self-merge.     |
| Revert of a bad deploy                                       | Human review, it touches P0       | Usually clear it, with the reasoning stated                         | Restoring a known-good state is the lower-risk action. Verify it is a clean revert with no extra changes. |
| Generated code, large diff                                   | Human review, too big             | Review the generator and config; sample the output                  | Sampling verified output is legitimate full coverage if the generator is unchanged and verified.          |
| Dependency patch bump, dev-only                              | Human review, dependencies are P1 | P3, self-merge                                                      | The P1 floor is for dependencies that run in production.                                                  |
| 1,200-line PR, all of it looks fine on a skim                | Human review, it's big            | Recommend splitting, then verdict on the pieces                     | A confident verdict on skimmed code is the failure mode the gate exists to prevent.                       |
| P0/P2 change you wrote yourself earlier in the session       | Human review, you authored it     | Disclose authorship; self-merge if observed                         | Authorship raises the observation bar. It is not a veto.                                                  |
| Behavior "verified" by a test whose name matches the feature | Self-merge, it's tested           | Read the assertions first                                           | Tests named after features routinely assert nothing about them.                                           |
| Frontend change with passing unit tests, not checkout/auth   | Human review, no screenshot       | Self-merge when coverage is full                                    | Screenshot is preferred evidence, not a gate. Checkout/login/auth UI still needs the flow observed.       |

---

## Arguments that do not move the gate

State the verdict once, hold it, and stay warm about it:

- "It's a tiny change." (Size is not evidence. Observation is.)
- "I've done this before / I wrote this module." (Authorship is a disclosure, not a veto or a free pass.)
- "CI is green." (CI green is necessary, not sufficient — it only tests what someone thought to test.)
- "We'll fix it forward if it breaks." (Not valid where forward-fixing cannot undo the damage *and* that damage was not verified: money moved, data deleted, package published, mail blasted.)
- "The reviewer will just rubber-stamp it anyway."
- "It's behind a flag" — valid _only_ if you verified the flag gates every new path and defaults off.
- "You already reviewed this and it was fine." (Re-run the gate on the new code.)
- "The agent that wrote it explained why it's correct." (A fluent rationale is not evidence. Ask what was observed.)
- "It's user-facing / it's an email / it's in billing/." (Neighborhood is not blast radius. Open the hunk.)

If the author provides new _evidence_ — a test you missed, a consumer list, a flag you did
not see, a prior human approval — re-run the gate. Evidence moves the gate; pressure does
not. When you do change the verdict, say what changed your mind.

---

## Reviewer routing

Be specific. "Get a senior engineer to look" is a non-answer. Route only when a Gate 2
trigger actually fired. CODEOWNERS names who to ask, not whether to ask.

| Change                                        | Route to                                                                                      |
| --------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Path matched in required CODEOWNERS           | That owner, by name/handle — and only if repo policy requires their approval                  |
| Pricing, plans, quotas, invoicing             | Billing owner; loop in whoever owns pricing decisions if intent is unverified                 |
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

- **Criticality:** P[0/1/2/3] — [surface], [class]
- **Why:** No gate fired. [One-sentence boundary: what this cannot reach. If P0, name what was observed.]
- **Effort:** n/a
```

**Human review:**

```md
**👥 HUMAN REVIEW REQUIRED**

- **Criticality:** P[n] — [surface], [class][, +1: reason]
- **Why:** Gate [n.n]. [Specific file/fact that fired it — unverified path, missing intent, found history, repo policy.]
- **Reviewer:** [name or role]
- **Focus on:** [1–3 concrete items]
- **Effort:** ~[N] minutes, [which files matter]
- **To self-merge next time:** [concrete verification or stated intent — never "this surface always routes to a human"]
```

**Blocked:**

```md
**🛑 BLOCKED**

- **Criticality:** P[n] — [surface], [class]
- **Why:** Gate 1. [The defect, with file and line.]
- **Fix:** [specific fix, referencing an existing pattern where one exists]
- **After the fix:** [self-merge if the blocker is observed / still human review if a Gate 2 trigger remains, and why]
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
