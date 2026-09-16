# Criticality classification reference

Read this when tiering is ambiguous, when the repo is unfamiliar, or when you are
unsure whether a hunk actually reaches money, access, data, or an external contract.

## Contents

- [The one-question test](#the-one-question-test)
- [The hunk test](#the-hunk-test)
- [P0 surfaces in detail](#p0-surfaces-in-detail)
- [P1 surfaces in detail](#p1-surfaces-in-detail)
- [P2 and P3](#p2-and-p3)
- [Email and notifications](#email-and-notifications)
- [Signal vocabulary](#signal-vocabulary)
- [Reversibility test](#reversibility-test)
- [Consumer-count heuristic](#consumer-count-heuristic)
- [Repo-level overrides](#repo-level-overrides)
- [CarsXE monorepo map](#carsxe-monorepo-map)
- [Worked tiering examples](#worked-tiering-examples)

---

## The one-question test

For each changed hunk, ask: **if this line is wrong and ships, what is the worst thing
that happens before anyone notices?**

| Worst outcome                                                                                                                                                                | Tier |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| Wrong money charged or not charged, wrong entitlement granted, data exposed to the wrong party, data destroyed, every API consumer breaks at once                            | P0   |
| A feature silently produces wrong results for many users, a job stops or duplicates work, cache serves stale data across requests, a provider integration drifts out of sync | P1   |
| One feature breaks loudly for the users of that feature                                                                                                                      | P2   |
| Someone reads a wrong word                                                                                                                                                   | P3   |

"Before anyone notices" is the important clause. Silent wrongness ranks above loud
breakage at the same scope, because loud breakage gets fixed in an hour.

## The hunk test

The tier applies only if the **changed lines** can produce that worst outcome.

- A type-only or comment change in `packages/billing` is P3, not P0.
- A dashboard component that happens to sit next to a usage number, without
  computing it, is P2/P3, not P0.
- Importing a payment module is a reason to open the hunk, not a reason to assign P0.
- User-facing ≠ P0/P1. Loud, revertible UI and copy are P2. Elevate only when the
  changed lines compute or authorize money/access, or change a public contract.
- Jobs, queues, webhooks, and email workflows stay P1 for *how hard you look*
  (retries, idempotency, recipients). They are not an automatic human-review gate.

If after opening the hunk the lines cannot move money, access, data, or external
contracts, lower the tier. "Could be P0" before reading is a reason to look.

---

## P0 surfaces in detail

### Money

Price tables and constants, plan definitions, quota and limit values, credit and token
accounting, usage metering and aggregation, proration, discounts and coupons, tax
handling, currency conversion and rounding, invoice generation, refund logic, payment
provider calls, subscription lifecycle handling, webhook handlers that mutate billing
state, entitlement checks derived from plan.

Rounding and unit bugs belong here. A cents/dollars mix-up is a P0 with a one-character
diff. Any change to how an amount is computed, stored, compared, or displayed on an
invoice is P0 even when the diff looks cosmetic.

### Identity and access

Authentication flows, session issuance and validation, token generation, expiry and
refresh, password and OTP and magic-link flows, permission and role checks,
tenant/org scoping in queries, API key issuance and verification, impersonation and
admin overrides, CORS and cookie flags on credentialed routes.

The classic P0 with a tiny diff: a query that loses its `where organizationId` clause,
or an authorization check moved from the server to the client.

### Data destruction and irreversible migration

`DROP`, `TRUNCATE`, `DELETE` without a bounded predicate, column type narrowing,
non-nullable additions without defaults on populated tables, backfills that overwrite,
cascade deletes, retention/purge jobs, anything writing to a table it cannot restore.

### Public contract

Anything a consumer outside this repository depends on: published SDK exports, REST/GraphQL
request and response shapes, status codes, error envelope structure, webhook payloads
you emit, event schemas, public TypeScript types shipped in a package, documented query
parameters, rate limit semantics.

Removal and renaming are obvious. The subtler P0s: changing a default value, tightening
validation that previously accepted something, changing null vs absent, changing
ordering that clients depend on, changing an error code.

Adding an optional field is P0 *scrutiny* until you confirm it is additive and
optional. Once you have, it can self-merge. Strict parsers are a reason to look, not
an automatic human gate on a confirmed-optional field.

### Secrets and production configuration

Key handling, credential rotation, environment variable semantics, IAM and service
permissions, deploy configuration, feature flags that gate P0 behavior, anything that
changes what runs in production or with what privileges.

---

## P1 surfaces in detail

P1 sets how hard you look (retries, idempotency, cache keys, shared callers). A
tested or observed P1 change self-merges. P1 is not an automatic human-review gate.

- **Shared/core modules**: anything imported by many features. Use the consumer-count heuristic below rather than intuition.
- **Async infrastructure**: queues, workers, cron jobs, schedulers, retry and backoff policy, idempotency keys, dead-letter handling.
- **Webhooks you receive**: signature verification, replay protection, ordering assumptions, partial-failure handling.
- **Caching**: keys, TTLs, invalidation paths, stampede protection. Cache bugs are silent and cross-user, which is why they outrank their apparent size.
- **Non-destructive schema change**: additive columns, new tables, new indexes on large tables (lock risk).
- **External integrations**: provider clients, API version pinning, response parsing, error mapping.
- **Observability that gates incident response**: if removing a log or metric means an incident goes unnoticed, that removal is P1.
- **CI/release pipeline**: a broken release path blocks every fix, including the fix for itself.

---

## P2 and P3

P2 is the healthy default for feature work. Contained, loud on failure, revertible.

Do not inflate P2 to P1 because the feature is important to the business. Importance is
not blast radius. A prominent dashboard breaking is visible and fixable; a shared
rounding helper breaking is invisible and expensive. User-facing screens are P2 unless
the changed lines compute or authorize money/access.

P3 requires that the change is genuinely non-behavioral. Verify before you claim it:

- A "docs-only" PR that edits a code sample in a README consumers copy-paste is not P3 if the sample is wrong.
- A "test-only" PR that weakens or deletes assertions is not P3 — it removes detection, which is a P1/P2 concern.
- A "formatting-only" PR that reflows a template string, a regex, or YAML indentation is not P3.
- A rename is only P3 if every reference is updated _and_ nothing resolves the old name dynamically (string lookups, reflection, serialized values, DB-stored identifiers, API params).

## Email and notifications

Unsendability means you must verify content, recipients, and trigger. It does not by
itself require a human, and it does not make every mail change P0.

| Change | Tier | Merge if verified |
| --- | --- | --- |
| Subject, copy, styling, template layout | P3 | Self-merge |
| Delay, retry schedule, which internal workflow step sends it | P2 | Self-merge |
| Recipients, unsubscribe, or whether a message sends | P1 | Self-merge if tests/observed |
| Amounts, entitlements, receipts, password-reset/auth links, billed invoices | P0 | Self-merge only if intent is stated **and** content/recipients/amounts were observed |

---

## Signal vocabulary

Grep-able hints. Presence means look, not conclude.

**Money**: `price`, `pricing`, `plan`, `tier`, `quota`, `limit`, `credit`, `balance`,
`invoice`, `charge`, `refund`, `discount`, `coupon`, `proration`, `subscription`,
`meter`, `usage`, `overage`, `stripe`, `payout`, `currency`, `cents`, `amount`, `tax`

**Access**: `auth`, `session`, `token`, `jwt`, `permission`, `role`, `policy`, `acl`,
`tenant`, `org`, `workspace`, `apiKey`, `secret`, `credential`, `impersonate`, `admin`

**Data**: `migration`, `schema.prisma`, `drop`, `truncate`, `deleteMany`, `cascade`,
`backfill`, `purge`, `retention`

**Contract**: `sdk/`, `packages/*/src/index.ts`, `exports` in `package.json`,
`openapi`, `*.proto`, `/v1/`, `/v2/`, `routes/`, `webhook`, `events/`, `types/public`

**Ops**: `Dockerfile`, `.github/workflows`, `terraform`, `k8s`, `.env.example`,
`fly.toml`, `vercel.json`, `wrangler.toml`

---

## Reversibility test

Ask: **if this is wrong at 2am, what does the fix require?**

| Fix required                                                                                                  | Modifier                                                  |
| ------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| Revert the commit and redeploy                                                                                | none                                                      |
| Flip a feature flag                                                                                           | −1 tier (only if the flag genuinely gates every new path) |
| Revert plus a data repair script                                                                              | +1 tier                                                   |
| Revert plus contacting customers, reissuing invoices, or cleaning up provider-side state                      | +1 tier; human review only if that side effect was not verified |
| Cannot be undone (deleted data with no backup, published package version, mail already blasted)               | P0 scrutiny; verify content/recipients/trigger. Unsendability is not an automatic human stamp. |

Apply +1 when revert cannot restore **customer-visible state that already happened**
(money moved, data deleted, package published, mail already blasted). A workflow
config, template, delay, or unshipped email change is still revertible — do not +1 it.

Irreversibility is the modifier reviewers most often skip. A P2 feature change that
writes a bad value into a table users will edit over the next week is not a P2 problem
anymore — the code revert no longer fixes it. An email delay that has not shipped is
still a P2 problem.

---

## Consumer-count heuristic

Use evidence, not intuition, for "is this shared?":

```bash
# Direct importers of a changed module
rg -l "from ['\"].*module-name" --type ts | wc -l
rg -l "require\(.*module-name" | wc -l

# Call sites of a changed export
rg -n "\bfunctionName\s*\(" --type ts

# Consumers of a changed route
rg -n "/api/v1/resource" --type ts --type tsx
```

| Direct consumers                                               | Baseline                            |
| -------------------------------------------------------------- | ----------------------------------- |
| 0 (new, unreferenced)                                          | Additive — reduce a tier            |
| 1–2, all inside one feature                                    | P2                                  |
| 3–10, across features                                          | P1                                  |
| 10+, or crosses a package boundary, or is re-exported publicly | P1 minimum, P0 if the surface is P0 |

Count the consumers you can find and say the number in the review. "Used by 14 call
sites across 3 packages" is evidence; "widely used" is not.

---

## Deriving the scrutiny list from the repo itself

The tier tables in this file are a generic starting point. A repo's real high-blast-radius
areas are recorded in its own incident history, and mining them beats inheriting someone
else's list. Do this once per repo and write the result into a project criticality file.
The result is a **look-harder list**, not a path deny-list for the merge gate.

```bash
# Files that have been reverted or hotfixed — empirical blast radius
git log --oneline -i --grep='revert' --grep='hotfix' --grep='incident' --grep='rollback' \
  --name-only --format='' | grep -v '^$' | sort | uniq -c | sort -rn | head -30

# Files with the most fix-shaped commits
git log -i --grep='fix' --name-only --format='' --since='1 year ago' \
  | grep -v '^$' | sort | uniq -c | sort -rn | head -30

# Where the team already demands ownership
cat CODEOWNERS .github/CODEOWNERS 2>/dev/null

# Paths that already require approval in CI
rg -n 'paths:|required|approval' .github/workflows/ | head -40
```

A file that has been reverted twice is a P0/P1 candidate regardless of what it is named.
Present the derived list for the repo owner to confirm rather than adopting it silently —
history explains where pain happened, not where policy should sit.

---

## Repo-level overrides

The repo's own configuration outranks this file. Before tiering an unfamiliar repo,
check for and honor:

- `CODEOWNERS` — a routing hint for *who* to name if a human review fires. Paths with
  dedicated owners are not automatically P1. Security, platform, or billing owners are
  a reason to look harder, not a reason to gate. CODEOWNERS is a merge gate only if
  branch protection or required reviews actually demand that approval.
- `CLAUDE.md`, `AGENTS.md`, `.cursor/rules/`, `.greptile/` — explicit team rules and danger zones.
- `CONTRIBUTING.md` — stated review requirements.
- Branch protection and required checks — if the repo already demands approval for a path, never issue SELF-MERGE OK for it; name that policy.
- A project-specific criticality file if one exists (e.g. `.pr-review/criticality.md`) — read it and let it override the defaults here.

If the repo disagrees with this reference, the repo wins. Say which rule you applied.

---

## CarsXE monorepo map

Defaults for `carsxe-platform` (Prisma, Elysia, Better-Auth, Stripe). Verify against the
actual tree — module layout changes and this map is a starting point, not truth.

| Area                                                                                                              | Default tier                         | Notes                                                                                                     |
| ----------------------------------------------------------------------------------------------------------------- | ------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| Billing, plans, quotas, Stripe integration, usage metering, invoicing                                             | **P0**                               | Includes any per-request quota decrement or credit accounting                                             |
| Better-Auth config, session handling, API key issuance and verification, tenant scoping                           | **P0**                               | API keys are the product's front door; key verification changes are P0 even when they look like refactors |
| Public API route contracts under the versioned API surface (request/response shape, status codes, error envelope) | **P0**                               | External developers integrate against these; unversioned shape changes break them silently                |
| Published client SDKs / packages consumed outside the repo                                                        | **P0**                               | Once published, a version cannot be unpublished cleanly                                                   |
| Prisma schema and migrations                                                                                      | **P0** destructive / **P1** additive | Column drops, type narrowing, and non-nullable additions on populated tables are P0                       |
| Vehicle identity resolution (VIN decode/normalization)                                                            | **P1**                               | Feeds every downstream product; wrong normalization is silent and corrupts caches                         |
| Plate lookup, vehicle history data pipelines                                                                      | **P1**                               | Upstream provider integrations; parsing changes fail silently on subsets of records                       |
| Upstream data-provider clients, retries, rate limits, caching                                                     | **P1**                               | Provider cost and quota exposure; retry bugs can multiply spend                                           |
| Elysia route handlers for internal/non-public endpoints                                                           | **P2**                               | P1 if shared middleware is touched                                                                        |
| Dashboard, docs site, marketing pages, internal tooling                                                           | **P2/P3**                            | P2 for feature UI. P0 only when the changed lines *compute or authorize* a price, quota, or entitlement — not because a price is displayed nearby |
| Demo/video rendering, folder-structure viewer, internal scripts                                                   | **P3**                               |                                                                                                           |
| Email/notification templates, subjects, styling                                                                   | **P3**                               | See the email overlay. Delay/workflow routing is P2; amounts/auth links/receipts are P0                      |
| Background jobs, workers, scheduled refresh                                                                       | **P1** scrutiny                      | Self-merge when the changed behavior is tested or observed. Not an automatic human gate.                   |

Cross-cutting CarsXE rules:

- Anything that changes **how a request is counted or billed** is P0 regardless of file location. Quota decrements often live far from the billing module. A file in `billing/` that does not change counts or amounts is not P0.
- Anything that changes **VIN or plate normalization** is P1 minimum and needs a cache-invalidation answer: previously cached results were computed under the old rules.
- Anything that changes **upstream provider request shape or retry policy** is P1 — it spends real money per call and can trip provider rate limits in production only.
- API **breaking** shape changes (rename, remove, default, type) are P0 for paying integrators unless versioned. Adding a confirmed-optional field is P0 scrutiny, then self-merges if observed.

---

## Worked tiering examples

**Comment or TypeScript type-only change in `packages/billing`**
Surface looks like money, hunk does not compute or display an amount → **P3,
self-merge.** Neighborhood is not blast radius.

**Email workflow delay 1h → 2h, test updated, no recipient or amount change**
Surface job/notification, class behavior, revertible until shipped → **P2,
self-merge.** Unsendability is irrelevant; nothing has been sent.

**Receipt email that changes the billed amount in the template**
Surface P0 (money in the payload). Self-merge only if the PR states the new amount
and a test or preview asserts it. Unexplained amount change → human review (intent
unverified), not because "emails are P0".

**Dashboard copy next to a usage number, computation untouched**
Surface P3/P2 presentation → **self-merge.** Displaying a price nearby does not
inherit P0.

**`OVERAGE_RATE_CENTS` 4 → 3 in `packages/billing/src/plan-limits.ts`**
Surface P0 (money), class contract/behavior. If the PR says "new published price"
and a test asserts 3 → **P0, self-merge, observed.** Same change with no stated
intent → **human review** (ambiguous product question), not because pricing always
needs a human.

**300-line refactor of the dashboard's chart components**
Surface P2, class behavior change, no shared modules touched, reversible → **P2**. If
coverage was full: self-merge.

**Adding an optional field to a public API response**
Surface P0 (public contract), class additive. Confirm the field is optional and
documented. Additive optional with unknown consumers is P0 *scrutiny*; if you
confirmed it is optional → **self-merge**. Rename/remove/default/type change with
unknown consumers stays Gate 2.6 (human review).

**Renaming an internal helper across 40 files**
Surface P2, class non-behavioral _if_ every reference is updated → verify no dynamic
resolution, then **P3**. If the name appears in a serialized value, DB row, or API
param, it is not a rename — it is a contract change.

**Bumping a logging library patch version**
Dependency class, runs in production → **P1 floor**. Check the changelog for output
format changes; log-format changes can break alert parsing, which is the detection layer
for everything else. Self-merge if changelog is clean and the bump is observed in CI.

**Adding an index to a 40M-row table**
Surface P1 (schema), lock risk on deploy. Demand observation of the migration plan
(CONCURRENTLY / lock timeout). Human review if lock behavior is unverified; not
automatic because "it's a migration."

---

## When tiering is genuinely ambiguous

If you cannot decide between two tiers after opening the hunks, pick the higher one
and say why it was close. Then name the single fact that would settle it — "if
`computeQuota()` is only called from the admin backfill script this is P2; it is P0
if the request path calls it." After you have that fact, **lower the tier** if the
hunk cannot produce the worse outcome. "Could be P0" before reading is not a merge
gate.
