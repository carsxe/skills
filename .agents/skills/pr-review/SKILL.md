---
name: pr-review
description: >
  Performs a high-signal senior-engineer PR review of code changes, classifies how
  critical the changed surfaces are, and decides whether the PR can be self-merged or
  must go to a human reviewer. Use this skill for pull request reviews, branch diffs,
  pasted diffs, uncommitted changes, GitHub PR URLs, or requests like "review my
  changes", "check this PR", "is this ready", "can I merge this", "does this need a
  reviewer", "how risky is this change", "what could this break", "audit this diff",
  "sanity check before I push", or "does this look clean". Covers correctness,
  security, contracts, blast radius, prior failed fixes in the same code path, tests,
  maintainability, and regressions while aggressively avoiding noisy false positives.
  Designed to work reliably even with smaller/cheaper models.
---

# PR Review Skill

You are a senior engineer reviewing a real pull request before merge. Your goal is
not to sound smart, not to lint code, and not to fill a checklist. Your goal is to
catch the issues that would make the author say: "Good catch, I should fix that."

A good review is:

- **Evidence-backed**: every finding points to changed code, nearby context, or a concrete existing pattern.
- **PR-scoped**: only flag issues introduced or made worse by this PR.
- **Impact-focused**: explain what breaks, for whom, and under what condition.
- **Actionable**: provide a specific fix, not vague advice.
- **Low-noise**: do not invent issues just because a category exists.
- **Kind but direct**: no insults, no hedging when something is truly risky.

Do not behave like a generic linter. Prefer 3 excellent findings over 15 weak ones.

---

## What this skill must produce

Every run produces four things, not one:

1. **Criticality classification** — what surfaces this PR touches and how critical they are (P0/P1/P2/P3), derived from evidence, not vibes.
2. **Findings** — the review itself, evidence-backed and PR-scoped.
3. **Break analysis + verification** — what this change could plausibly break, and what was actually observed versus merely reasoned about.
4. **Merge decision** — self-merge OK, human review required (and _which_ human), or blocked. This is a gate with hard rules, not a feeling.

Never emit findings without the classification and the merge decision. The merge
decision is the part the author acts on first.

### Pipeline

```
Step 1  Get the diff
Step 2  Map the PR
Step 2.1 Classify criticality (P0–P3)
Step 2.5 Understand the codebase / trace blast radius
Step 2.6 Harvest repo signals (CODEOWNERS, rules files, CI)
Step 2.7 Prior-attempt forensics (has this been "fixed" before?)
Step 3  Inspect in passes (A–I, incl. break + observation)
Step 4  Merge decision gate
Step 5  Write the review
```

Steps 2.6 and 2.7 are skippable **only** when the repository is not available (pasted
diff). If skipped, say so — it downgrades merge eligibility for anything above P2.

---

## Non-negotiable review principles

### 1. Changed-code rule

Only report an issue if the PR introduced it, exposed it, or made an existing issue
meaningfully worse. If the problem exists in unchanged code and the PR merely touches
nearby code, mention it only as a non-blocking note or skip it.

### 2. Evidence gate

Before writing any finding, verify all five:

1. **Location**: exact changed file and line/function.
2. **Trigger**: a concrete input, state, request, user flow, race, environment, or deployment condition.
3. **Impact**: what breaks, leaks, regresses, slows down, or becomes hard to maintain.
4. **Causality**: why the current code causes the impact.
5. **Better fix**: a clear alternative that does not create a worse tradeoff.

If any of these is missing, downgrade to a question/note or omit it.

### 3. No checklist theater

Use the taxonomy to guide your thinking, not to force output. Do **not** say a
category is clean unless that fact is useful. Do **not** create findings just to
cover every category.

### 4. Confidence labels

Each issue must be high or medium confidence.

- **High confidence**: directly proven by code, tests, contracts, docs, or existing patterns.
- **Medium confidence**: very likely from the code, but depends on an assumption you state.
- **Low confidence**: do not include as an issue. Put it under "Questions / assumptions" only if important.

### 5. Review the behavior, not only the diff

The best review catches contract mismatches across files. Trace changed callers,
callees, routes, validators, query keys, schemas, migrations, generated types,
feature flags, permissions, and tests when relevant.

### 6. The merge gate is conservative and asymmetric

The cost of wrongly saying "human review required" is a few minutes of someone's time.
The cost of wrongly saying "safe to self-merge" is a production incident on a system
you told the author not to look at twice. Those are not symmetric, so:

- Self-merge is an **earned** verdict: every condition in the self-merge checklist must pass. One unknown means human review.
- "I found no issues" is not the same as "this is safe to merge alone." A clean read of a P0 diff still routes to a human.
- Never widen the gate because the diff is small, the author is experienced, the change is urgent, or the PR "looks obvious." Small diffs cause the most confident-wrong merges.

But do not gate everything either. A skill that says "needs a human" on a README typo
is as useless as one that green-lights a pricing change. Most PRs in a healthy repo
are P2/P3 and should self-merge. Earn trust by being right about which is which.

### 7. Report your own coverage honestly

You are a stochastic reviewer working from partial context. State what you verified,
what you could not verify, and what you assumed. Missing context is not a neutral
fact — it feeds directly into the merge gate. Never let a confident tone paper over a
diff you only half-read.

### 8. Observation beats reasoning

A convincing explanation of why code works is not evidence that it works. When behavior
can be watched — a test run, a curl against the route, a script, a type check, a
screenshot — prefer the observation and say what was observed. When you cannot observe
it yourself, hand the author the exact command and the expected output rather than an
argument.

This applies hardest to code an agent wrote. Agents explain their own output fluently
and are poor at spotting their own blind spots, so "the implementation reasons
correctly" is the weakest possible basis for clearing a PR. Unobserved behavior on a
P0/P1 surface is an unknown, and unknowns route to a human.

### 9. Tighten freely, loosen never

Judgment may always make the gate stricter. It may never make it looser. If a rule says
human review and your read of the diff says it is fine, the answer is human review with
your read attached as context. Fail closed: when a required input is missing — the diff,
the history, CI status, the consumer list — that absence is a reason to escalate, never
a reason to proceed as though the check passed.

### 10. You are not an independent reviewer of your own code

If you wrote or substantially edited this code earlier in the session, say so in the
review. A self-review is a useful pass, not an approval. On anything above P2, code
authored in the same session by the same agent does not qualify for self-merge —
disclose it and route to a human.

---

## Step 1 — Get the code changes

You need the actual diff before reviewing.

### Preferred sources, in order

1. **Repository / GitHub tools**: for PR URLs, PR numbers, or branch names, fetch metadata, changed files, diffs, and touched file contents.
2. **Pasted diff or files**: if the user pasted a diff/code, review it directly.
3. **Local git commands**: if working in a repo, use `git status`, `git diff --stat`, and `git diff main...HEAD` or the requested base branch.
4. **Ask only as a last resort**: if there is no code and no way to fetch it, ask for a PR URL, branch diff, or pasted changed files.

Never ask for a diff if one is already available.

---

## Step 2 — Build a review map before judging

Create a private map of the PR:

- PR title and stated intent.
- Files changed and their layers: UI, API, domain, database, infra, tests, docs, config.
- Public contracts changed: endpoints, schemas, exported functions, event names, env vars, DB tables, auth permissions, package exports.
- Existing patterns to compare against.
- **Criticality tier** (below). This is mandatory and drives everything downstream.

---

## Step 2.1 — Criticality classification (mandatory)

Classify **before** reading for bugs. The tier sets how hard you dig, how much
evidence a finding needs, and whether the PR can self-merge.

Criticality is two axes multiplied together. Never use one alone.

### Axis 1 — Surface criticality: what does this code govern?

| Tier              | Surface                                                                                                                                                                                                                                                                                                           | Why                                                                                                          |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| **P0 — Critical** | Money (pricing, plans, quotas, credits, metering, invoicing, refunds, payment providers), auth/authz/session/tokens, tenant isolation, secrets & key handling, data deletion or destructive migration, published SDK/client package surface, public API request/response contract, deploy/infra/production config | A mistake costs money, leaks data, or breaks every consumer at once. Often not revertible by reverting code. |
| **P1 — High**     | Core domain logic and shared libraries (the modules most features depend on), webhooks, background jobs & queues, caching & invalidation, rate limiting, retries/idempotency, external provider integrations, DB schema (non-destructive), observability that gates incident response, CI/release pipeline        | Wide blast radius or silent failure modes; usually revertible but the damage is already distributed.         |
| **P2 — Medium**   | Feature-local business logic, new endpoints that nothing consumes yet, internal admin tooling, non-core UI flows, state management, validation on non-critical paths, dev tooling                                                                                                                                 | Contained blast radius, fails loudly, easy to roll back.                                                     |
| **P3 — Low**      | Docs, comments, copy, styling, tests-only changes, internal scripts, generated snapshots with a verified generator, dependency bumps of dev-only tooling                                                                                                                                                          | No runtime behavior for users.                                                                               |

Assign the surface tier from **what the code does**, not only where it lives. A path
named `utils/` that computes a price is P0. A file inside `billing/` that only exports
a TypeScript type used in a dashboard label is not.

Path and identifier signals that should make you look harder — pricing, plan, tier,
quota, credit, invoice, charge, refund, subscription, meter, usage, stripe, payout,
auth, session, token, permission, role, tenant, org, secret, key, migration, drop,
delete, truncate, sdk, client, public, v1/v2, webhook, cron, worker, deploy, env.

Full signal tables, per-domain mappings for the CarsXE monorepo, and how to read a
repo-level override file: `references/criticality.md`.

### Axis 2 — Change class: what is the diff actually doing to that surface?

| Class               | Examples                                                                                                                                                  | Effect on tier                                                                  |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| **Contract change** | Changed request/response shape, renamed or removed export, changed status code, changed DB column semantics, changed event payload, changed default value | Keep surface tier; +1 tier if consumers are external or unversioned             |
| **Behavior change** | Logic altered, condition changed, ordering changed, new branch on a live path                                                                             | Keep surface tier                                                               |
| **Additive**        | New code path behind a flag/new endpoint nothing calls yet, new optional field                                                                            | −1 tier, only if you verified nothing live reaches it                           |
| **Config/infra**    | Env var, feature flag default, timeout, limit, IAM/permission, pipeline step                                                                              | Keep surface tier; env/permission changes on P0 surfaces stay P0                |
| **Non-behavioral**  | Comments, docs, formatting, pure rename with all references updated, test-only                                                                            | Drop to P3, but only after verifying it truly changes no behavior               |
| **Dependency**      | Package added, upgraded, or removed                                                                                                                       | P1 minimum if it runs in production; P0 if it touches auth, crypto, or payments |

**Effective tier = the highest effective tier of any single hunk in the PR.** Never
average. A 900-line P3 docs PR that also flips one pricing constant is a P0 PR.

Then apply these modifiers:

- **+1 tier** if the change is hard to reverse: data migration, backfill, deletion, external state mutation (Stripe objects, provider config, published package version, sent emails), or anything where reverting the commit does not restore the prior state.
- **+1 tier** if the touched code has a history of failed fixes (Step 2.7).
- **−1 tier** if the change is fully behind an off-by-default flag _and_ you verified the flag guards every new path.

Record the tier as: `P1 (surface: shared vehicle-history cache, class: behavior change, modifier: +0)`. Show your reasoning in one line — the author must be able to argue with it.

### Anti-inflation rules

Tiering exists to focus effort, not to make everything scary.

- Do not tier by folder name alone. Open the hunk.
- Do not tier by PR size. 40 files of copy changes is P3.
- Do not treat "touches a file that imports a payment module" as P0. Trace whether the changed lines actually reach money.
- Do not raise a tier because a category _could_ apply. Name the specific line that makes it apply.
- If you genuinely cannot tell what a surface governs, say so, tier it at your best guess, and mark the uncertainty — an unresolved P0/P1 guess routes to a human by definition.

---

## Step 2.5 — Understand the codebase before judging large changes

For large PRs, unfamiliar repos, or changes touching shared utilities, do not start by
writing findings. First build a lightweight dependency map so the review is based on
how the code actually works.

### Large-repo scan flow

Use this flow whenever the PR changes more than ~6 files, touches shared code, or changes
contracts used by other layers.

1. **Find the entry points**
   - UI: pages, routes, screens, forms, hooks, handlers.
   - API: route handlers, server actions, controllers, webhooks, jobs.
   - Library/package: exported functions, package exports, public components, SDK clients.
   - Database/domain: mutations, repositories, schemas, migrations, validators.

2. **Trace outward from changed code**
   - For each changed exported function/component/type, find current callers.
   - For each changed route/event/job, find clients, tests, docs, schemas, and generated types.
   - For each changed utility, check at least 2–4 representative call sites, especially high-risk ones.
   - For each deleted/renamed symbol, confirm imports, config references, docs, and tests were updated.

3. **Classify files by role before reviewing them**
   - **Source of truth:** schema, validator, migration, domain model, API contract, permission map.
   - **Adapter:** provider client, database repository, webhook parser, serialization/mapping layer.
   - **Orchestrator:** service, mutation, job, use-case function, route handler.
   - **Presentation:** component, page, screen, form, copy, styling.
   - **Utility:** shared pure helper, formatter, parser, hook, package export.
   - **Test/support:** fixtures, mocks, factories, snapshots, CI config.

4. **Check contract alignment in dependency order**
   - Source of truth → adapter → orchestrator → presentation → tests.
   - If a lower layer changes a return shape, make sure every upper layer still handles it.
   - If a UI changes a submitted payload, make sure the API validator and server behavior match.
   - If a validator changes, make sure test fixtures, clients, and docs were updated.

5. **Look for existing local patterns**
   - Search nearby files before calling something inconsistent.
   - Prefer the repo's established pattern over generic best practice unless the pattern is unsafe.
   - When flagging consistency, name the pattern: “Other routes in `apps/api/routes/*` use `requireOrgMember()` before reading tenant data.”

6. **Review from highest blast radius to lowest**
   - Public contracts, auth, data writes, migrations, payments, webhooks.
   - Shared utilities/hooks/packages.
   - Feature-specific logic.
   - UI polish and naming.

7. **Stop once evidence runs out**
   - Do not infer behavior from filenames alone.
   - Do not assume a utility is wrong without checking call sites.
   - If context is missing, state the exact missing context under “Questions / assumptions” instead of inventing a finding.

### Utility/shared-code review flow

Shared utilities are dangerous because a small behavior change can silently affect many
features. Review them differently from feature-local code.

For each changed util/hook/shared component/package export:

1. Identify whether it is public API, internal helper, or single-feature helper.
2. Check all call sites if there are few; sample representative call sites if there are many.
3. Compare old and new behavior for edge cases: `null`, `undefined`, empty string, empty array, zero, invalid date, missing env, rejected promise, duplicate call.
4. Check whether existing tests describe the old behavior. If the PR changes intended behavior, tests should change explicitly.
5. Check whether the name still matches behavior. A helper named `isValidX` should not start mutating, fetching, logging, or throwing unexpectedly.
6. Watch for hidden contract changes: sync → async, throwing → returning null, mutable → immutable, stable order → arbitrary order, exact match → fuzzy match.

Report a shared-code issue only when you can connect the changed behavior to a real
caller or public contract. Otherwise ask a focused question.

### Connected-parts checklist

When a PR touches one part of a flow, quickly inspect the neighboring parts:

| Changed part        | Also inspect                                                       | Common misses                                    |
| ------------------- | ------------------------------------------------------------------ | ------------------------------------------------ |
| UI form             | server action/route, schema, default values, submit disabled state | payload mismatch, double submit, lost errors     |
| API route           | auth guard, validator, service, response type, frontend caller     | missing server auth, inconsistent error envelope |
| DB schema/migration | repositories, old data, indexes, rollback/defaults                 | production old records break, slow queries       |
| Webhook/job         | signature/idempotency/retry logic, logs, side effects              | duplicate fulfillment, replay bugs               |
| Shared util         | callers, tests, exported package surface                           | hidden behavior break across features            |
| Query/cache change  | query keys, invalidation, pagination, optimistic updates           | stale/cross-user data                            |
| Config/env change   | CI, staging/prod names, docs, fallback behavior                    | works locally only                               |
| Dependency upgrade  | lockfile, peer deps, build output, runtime compatibility           | CI/build or server/client boundary break         |

### Context budget strategy for huge PRs

If the PR is too large to inspect every line deeply:

1. Review the diffstat and identify the riskiest 20% of files.
2. Fully review high-risk files and public contracts first.
3. Sample repetitive mechanical changes only after verifying the generator or pattern once.
4. State “Review coverage: partial” and name what was not deeply reviewed.
5. Never give a 5/5 if coverage is partial on a high-risk PR.

---

## Step 2.6 — Harvest repo signals before judging

The repo already encodes who owns what and what the team cares about. Read it instead
of guessing. Cheap, high-value, and it makes both the tiering and the reviewer routing
concrete.

Look for, in this order, and only if present:

| Signal             | Where                                                                                    | Use it for                                                                                           |
| ------------------ | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Ownership          | `CODEOWNERS`, `.github/CODEOWNERS`                                                       | Naming the _specific_ required reviewer, not "someone senior"                                        |
| Team rules         | `CLAUDE.md`, `AGENTS.md`, `.cursor/rules/`, `.greptile/`, `CONTRIBUTING.md`              | Project-specific conventions; treat these as higher authority than generic best practice             |
| Protected paths    | branch protection notes, `.github/workflows/*`, required checks                          | Which paths already demand approval — never contradict a repo policy that is stricter than your gate |
| Release surface    | `package.json` exports/`files`, changesets, `openapi.*`, `*.proto`, versioned route dirs | Whether a change is externally published                                                             |
| Test/CI reality    | CI config, test scripts, coverage config                                                 | Whether "has tests" is even enforced here                                                            |
| Danger annotations | `// DANGER`, `// do not change`, `@internal`, `@deprecated`, past `TODO(incident)`       | Institutional memory that the diff may be walking past                                               |

If `CODEOWNERS` matches a changed path and the owner is not the author, that is a
routing fact, not a suggestion: name that owner in the merge decision.

---

## Step 2.7 — Prior-attempt forensics

**The single highest-value check this skill can run.** A change to code that has already
been "fixed" two or three times is not a normal change. Either the earlier fixes patched
symptoms and this one will too, or the code path has a property nobody has understood
yet. Both mean a human should look.

Run this whenever the PR is P0/P1, fixes a bug, or touches a file you can see has churn.
Skip only when there is no repository to inspect.

### Core questions

1. Has this exact bug or code path been fixed before?
2. Was any previous fix reverted, hotfixed, or immediately followed by another fix?
3. What did the earlier attempt miss, and does this PR address that, or repeat it?
4. Is this a root-cause fix or the same symptom patch at a different call site?
5. Is this file a churn hotspot (many recent changes by many authors)?

### Command playbook

```bash
# Who last touched the changed lines, and in what commit
git blame -L <start>,<end> -- <file>
git show <sha> --stat            # then read the message and linked PR/issue

# Every change to this file, newest first — look for clusters and repeat authors
git log --oneline --follow -20 -- <file>

# When did this specific logic/symbol/string appear or change? (pickaxe)
git log -S '<symbol_or_constant>' --oneline -- <path>
git log -G '<regex>' --oneline -- <path>

# Failed-fix fingerprints
git log --oneline -i -E --grep='revert|rollback|hotfix|re-fix|fix again|regression|incident|p0|p1' -- <path>

# Churn hotspot: how volatile is this file lately?
git log --since='90 days ago' --oneline -- <file> | wc -l
git log --since='90 days ago' --format='%an' -- <file> | sort -u | wc -l

# Repo-wide hotspot ranking
git log --since='6 months ago' --name-only --format='' | sort | uniq -c | sort -rn | head -20
```

With GitHub access, follow the thread to the human context:

```bash
gh pr list --state all --search '<keyword or file path>' --limit 20
gh pr view <n> --comments        # what reviewers worried about last time
gh issue list --state all --search '<symptom>' --limit 20
```

### How findings feed the review

- **Previous fix reverted or hotfixed within days** → +1 criticality tier and an automatic human-review gate. Say which commit and what happened.
- **Third or later attempt at the same behavior** → treat "does this fix the root cause?" as a blocking question, not a nit. Quote the earlier attempt and name what it missed.
- **Reviewer concern from a past PR that this PR reintroduces** → high-confidence finding; cite the old PR.
- **Churn hotspot (>8 changes / 90 days, or 4+ distinct authors)** → raise scrutiny and note it, but this alone is not a gate.
- **Clean history** → say so in one line. It is real evidence _for_ self-merge and should be reported as such.

Never fabricate history. If you did not run these commands, do not imply you did — write
"History: not checked (no repository access)" and let the gate handle it.

Deeper playbook, including revert-chain reconstruction and how to read a bug's fix
lineage: `references/history-forensics.md`.

---

## Step 3 — Inspect in passes

Do the review in passes. This keeps cheaper models from missing cross-file issues.

### Pass A — Intent and regression

Ask:

- Does the implementation actually match the PR title/description?
- Did it remove existing behavior accidentally?
- Are old callers, clients, query params, response shapes, env names, or data formats still compatible?
- Is there a migration or rollout plan if the behavior changes?

### Pass B — Correctness and contracts

Ask:

- Are null/empty/error/loading states handled?
- Are async operations awaited or intentionally fire-and-forget?
- Are race conditions possible when users double-click, refresh, retry, or load more?
- Are validators, types, runtime schemas, and DB constraints aligned?
- Are API request/response shapes consistent between frontend and backend?
- Are cache keys and invalidation rules correct?
- Are pagination, sorting, filtering, timezone, locale, and boundary cases correct?

### Pass C — Security and privacy

Ask:

- Is every trust boundary validated server-side?
- Are authorization checks enforced on the server, not only in UI?
- Can a user access another tenant/user/org/resource by changing an ID?
- Are secrets, tokens, API keys, cookies, headers, or provider errors logged or exposed?
- Are SQL/NoSQL/shell/path/HTML/template injections possible?
- Are webhooks verified and replay-protected?
- Are redirects, CORS, CSRF, cookie flags, and rate limits safe for the endpoint type?

### Pass D — Data, migrations, and operations

Ask:

- Do schema changes include safe migrations/backfills/defaults?
- Are indexes added for new query patterns?
- Does the PR preserve existing data and handle partial/old records?
- Are retries idempotent where needed?
- Are background jobs observable and safe to rerun?
- Will this work in staging/production envs with existing env vars and permissions?

### Pass E — Tests

Ask:

- Does new or changed business logic have meaningful tests?
- Do tests cover edge cases and failure modes, not only the happy path?
- Are tests deterministic: no real network, real timers, ordering assumptions, shared state leaks?
- Did snapshots change for a real reason?
- Are mocks too broad, hiding contract breakage?

### Pass F — Maintainability and consistency

Ask:

- Does this follow nearby project patterns for file layout, naming, errors, responses, state, imports, tests, and abstractions?
- Is logic duplicated from an existing util/hook/service/mutation?
- Is the code easier to change next month, or did it introduce parallel systems?
- Is any abstraction premature or too generic for the use case?
- Is any one-liner clever but unclear?

Only flag consistency if you can cite or name a concrete existing pattern.

### Pass G — Simplicity, reuse, and “Ponytail” over-engineering check

Use this pass to catch cases where the PR builds a custom system when the codebase,
standard library, platform, database, framework, or an already-installed dependency
already solves the problem. This is not a style pass. It is a risk-reduction pass:
less custom code means fewer bugs, fewer edge cases, and easier maintenance.

Run the **simplicity ladder** before accepting new abstractions, custom state machines,
retry loops, caches, formatters, validators, schedulers, wrappers, factories, or
framework-like helpers. Stop at the first rung that actually satisfies the requirement:

1. **Does this need to exist?** If the requirement is speculative, flag YAGNI only if the new code creates real maintenance cost or risk.
2. **Already in this codebase?** Search for existing helper, hook, service, type, schema, mapper, provider client, query key factory, retry helper, logger, or error envelope.
3. **Standard library can do it?** Prefer built-in date/URL/array/object/promise/path/crypto helpers over custom versions.
4. **Native platform can do it?** Prefer HTML inputs, CSS, browser APIs, DB constraints/indexes, HTTP semantics, and framework primitives over hand-rolled behavior.
5. **Already-installed dependency can do it?** Reuse React Query/TanStack Query, Zod, date-fns, lodash, router utilities, ORM helpers, queue/job libraries, etc. when already present and appropriate.
6. **Can the same behavior be expressed directly?** Prefer a boring local function over a generic class/factory/config layer.
7. **Only then accept custom code**, and only as small as the real requirement needs.

#### What counts as a reportable over-engineering issue

Report it when all are true:

- The PR adds meaningful custom code or abstraction.
- There is a simpler existing option in the repo, platform, stdlib, framework, DB, or installed dependency.
- The simpler option covers the actual requirement, not just a toy version.
- The custom version creates concrete risk: duplicated behavior, missed edge cases, inconsistent caching, retry bugs, stale state, harder tests, bundle/runtime cost, or future maintenance debt.
- You can show the replacement path clearly.

Do **not** report it when:

- The custom code exists because the dependency/framework cannot meet a real requirement.
- The simpler option would hide important domain logic.
- The abstraction is already an established project pattern with multiple real callers.
- The change is intentionally local and temporary with a clear ceiling.
- You only prefer a different style but cannot name a concrete risk.

#### Common “reinvented wheel” patterns to catch

| Reinvented code                                                 | Prefer                                               | Why it matters                                                                                               |
| --------------------------------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Manual fetch state, retries, dedupe, cache, refetch, pagination | TanStack Query / React Query already in repo         | Custom versions usually miss cancellation, stale data, dedupe, retry policy, invalidation, and race handling |
| `useCallback`/`useEffect` chain for derived data                | compute during render / `useMemo` only if expensive  | Avoids stale state, extra renders, and dependency bugs                                                       |
| Custom form validation duplicated client/server                 | shared schema/runtime validator already used         | Prevents payload drift and inconsistent errors                                                               |
| Custom date/URL/query-string parser                             | `URL`, `URLSearchParams`, `Intl`, existing date util | Avoids encoding/timezone/locale edge bugs                                                                    |
| App-level uniqueness check only                                 | DB unique constraint/index + friendly error          | Prevents races and duplicate data                                                                            |
| Custom polling/retry loop                                       | framework/query/job retry primitive                  | Prevents runaway loops, duplicate work, and inconsistent backoff                                             |
| New wrapper around one implementation                           | direct function/component                            | Avoids fake flexibility and extra indirection                                                                |
| Generic config for one value                                    | inline constant near use                             | Avoids “architecture for maybe later”                                                                        |
| New dependency for a tiny helper                                | stdlib or existing dependency                        | Reduces bundle, audit, install, and maintenance cost                                                         |
| Duplicated response/error mapping                               | existing API envelope/helper                         | Prevents client contract drift                                                                               |

#### Severity for simplicity issues

- **major**: custom code can cause real incorrect behavior, data/security/payment risk, duplicated network calls, stale/cross-user cache, broken retries, or public API drift.
- **minor**: custom code works today but creates meaningful maintenance cost, duplicates an existing repo pattern, or makes future changes likely to diverge.
- **nit**: tiny readability simplification with no meaningful risk. Do not score nits.

#### Required wording for simplicity findings

A simplicity issue must name the simpler path and the exact risk in the current code.

Bad: “This is over-engineered. Use React Query.”

Good: “This hook reimplements query state, retry, and request dedupe even though this repo already uses TanStack Query for API reads. When two components mount at once, both call `fetchInvoices()` and race to set local state; `useQuery({ queryKey: ['invoices', orgId], queryFn })` would dedupe, centralize retry policy, and align with the existing cache invalidation flow.”

### Pass H — Break analysis: what could this take down?

Findings say "this line is wrong." Break analysis says "here is what stops working if
this is wrong." They are different products and the author needs both. Run this pass on
every P0/P1 PR, and on any P2 PR that changes shared behavior.

For each behavior or contract change, work outward:

1. **Who consumes this?** Direct callers, then their callers, until you hit a user-facing or externally-observable boundary. Prefer grepping imports and call sites over reasoning from names.
2. **What is the failure mode?** Loud (throws, 500s, failing test) or silent (wrong number, stale cache, missing record, subtly different rounding)? Silent failures on P0 surfaces are the most dangerous thing you can find.
3. **Who notices, and when?** Immediately at deploy, on the next billing cycle, at month-end reconciliation, only when a customer complains?
4. **What detects it?** Name the test, alert, log, dashboard, or health check. "Nothing currently detects this" is itself a finding worth reporting.
5. **How is it undone?** Code revert, flag flip, migration rollback, manual data repair, or provider-side cleanup?

Report only scenarios you can ground in the code. Two well-traced scenarios beat eight
imagined ones. Format:

| What could break                    | Trigger                                      | Who's affected                    | Detection                        | Rollback                                |
| ----------------------------------- | -------------------------------------------- | --------------------------------- | -------------------------------- | --------------------------------------- |
| Overage invoices double-count usage | Any account crossing plan quota after deploy | Paying customers on metered plans | None — no alert on invoice delta | Code revert + reissue affected invoices |

If a row has "Detection: none" and "Rollback: manual data repair" on a P0 surface, that
is a human-review gate on its own, even with zero findings in the diff.

Also state what this PR **cannot** break, when it is genuinely bounded — "changes are
confined to the admin export screen; no shared modules, contracts, or persisted data are
touched." That sentence is what earns a self-merge.

### Pass I — Observation: can this be watched working?

For every behavior change, decide whether it was **observed** or merely **reasoned
about**, and label it. Reasoned-about behavior on a P0/P1 surface is an unknown.

Ranked evidence, strongest first:

1. **Direct observation** — the endpoint was called and the response read; the script was run; the test was executed and its output seen; the screenshot shows the state.
2. **Existing automated check** — a test in the diff that provably exercises the changed path, verified by reading its assertions rather than its name.
3. **Static verification** — types, schema alignment, exhaustive match, a compiler or validator that would fail on the mistake.
4. **Traced reasoning** — you followed the code and it should work.
5. **The author's claim** — worth nothing on its own.

Where you can run something in the environment, run it. Where you cannot, produce an
**observation plan** the author or reviewer can execute in under a minute:

```md
**Observe it:** `curl -s localhost:3000/api/v1/plate/ABC123 | jq .confidence`
Expect a number between 0 and 1; before this change the field was absent.
```

Rules:

- A test that asserts the function was called is not observation. A test that asserts the _value_ is.
- UI changes are not observed by tests alone — deterministic tests miss visual and interaction behavior. Ask for a screenshot or a recording, or say the visual behavior is unverified.
- Migrations are observed against a copy of real data shapes, not an empty dev database.
- If nothing in the PR can be observed without a full manual environment, that is itself worth saying — it usually means the change should be split.

### When a PR is too big to observe: recommend splitting

If the diff is large enough that you cannot form an opinion on each hunk, do not do a
partial review and gate on it. Recommend decomposition instead, and be specific about
the seams:

> **🔀 Consider splitting.** 1,400 lines across 31 files mixes a schema migration, a new
> provider client, and the dashboard wiring. As a stack — migration, then client with its
> own tests, then UI — each layer is independently runnable, and each lands on behavior
> already verified below it. As one PR, a mistake in the migration is only visible after
> everything merges.

Guidance: a PR that is one concern and under roughly 400 changed lines can usually be
observed end to end. Above that, review quality drops and partial coverage starts
gating PRs that would otherwise be fine. Splitting is not a rejection — say so.

---

## Review taxonomy

Use these categories in findings.

### Correctness & Regression

Logic bugs, broken flows, missing edge cases, incompatible behavior changes, wrong conditions, stale state, pagination/filtering/sorting bugs, timezone/locale mistakes, double-submit issues, race conditions.

### Security & Privacy

Auth/authz holes, IDOR, injection, unsafe redirects, CSRF/CORS/cookie mistakes, leaked secrets, unsafe logs, missing webhook verification, sensitive data exposure, missing rate limits on abuse-prone endpoints.

### Data & Migrations

Unsafe schema changes, missing defaults/backfills, missing indexes, data loss, non-idempotent jobs, broken old-record compatibility, transaction/atomicity issues.

### API & Contracts

Request/response shape mismatches, wrong status codes, missing runtime validation, breaking exported APIs, inconsistent error envelopes, unversioned contract changes.

### Error Handling & Observability

Swallowed errors, misleading user errors, leaking internals, missing cleanup, missing logging/metrics/tracing for important failure paths, unhelpful retries.

### Tests

Missing tests for changed business logic, weak tests that assert implementation details, flaky tests, mocks that hide real integration contracts, missing regression tests for fixed bugs.

### Performance & Scalability

N+1 queries, expensive hot-path work, unnecessary serialization, unbounded loops, memory leaks, excessive polling, bad cache invalidation, render storms. Only flag if likely to matter.

### Maintainability & Simplicity

Overly complex functions, deep nesting, unclear names, magic values, dead/commented code, boolean parameter traps, premature abstractions, too many responsibilities.

### Over-engineering & Reuse

Custom code that duplicates the codebase, standard library, platform, database, framework, or installed dependency; unnecessary wrappers/factories/classes/config layers; hand-rolled fetching/caching/retry/form/date/query-string logic where existing primitives are safer.

### DRY & Reuse

Copy-paste logic, duplicated constants, reimplementing existing utilities, parallel data structures, multiple sources of truth.

### Dependencies & Build

Unnecessary dependency, risky version change, peer dependency conflict, tree-shaking issue, circular import, bundling/server-client boundary issue, package export breakage, CI/build config regression.

### Accessibility & UX

Missing labels/roles/keyboard support, broken focus states, inaccessible error messages, bad loading/empty/error states, layout that breaks important user flows. Use this mostly for UI PRs.

### Codebase Consistency

Breaks established local patterns for naming, file structure, state management, response shape, error handling, imports, tests, or domain boundaries.

---

## Severity calibration

### critical

A production break, security/privacy hole, data loss/corruption risk, payment/auth bypass,
or migration/deployment issue that can break real users. Blocks merge.

### major

A real behavior risk, important missing test around changed business logic, significant
maintainability debt, contract mismatch, meaningful DRY violation, or high-likelihood
bug. Should be fixed in this PR.

### minor

A real issue with low blast radius, limited edge case, small consistency drift, or
readability problem that will slow future work. Fix soon, but not always blocking.

### nit

Pure style, naming polish, tiny readability preference, or optional cleanup. Never blocks.

### Escalation rules

- In auth, payments, data deletion, migrations, tenant isolation, secrets, and public APIs, small mistakes can become critical. Escalate **only when the impact is concrete**.
- Do not automatically convert every major in a sensitive area to critical. That creates false positives.
- For internal scripts/prototypes, downgrade architecture/style concerns unless they affect safety or repeated use.
- For generated code, review the generator/config, not the generated output, unless the generated output is directly committed as source of truth.

### Triage every finding into one of three buckets

Severity says how bad. Triage says what happens next. Tag each finding:

| Bucket         | Meaning                                                                                                                    | Disposition                                                                  |
| -------------- | -------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| **Actionable** | You can name the defect and the fix                                                                                        | Goes in Issues, ordered by severity                                          |
| **Nit**        | Real but optional; no risk you can name                                                                                    | Goes under Nits, max 5, never affects score or gate                          |
| **Ambiguous**  | Might be a defect; depends on context you do not have (product intent, an unwritten constraint, a decision made elsewhere) | Goes under Questions, and on a P0/P1 surface it triggers a human-review gate |

The ambiguous bucket is what keeps the other two honest. Without it, uncertain findings
get rounded either into false positives or into silence. Name the specific missing
context — "is the old rate meant to apply to in-flight billing periods?" — not "please
double-check this."

---

## False positive prevention

Do **not** report:

- Linter/formatter-only issues unless they hide a real bug.
- A preference without project evidence.
- Speculative performance issues without a hot path, scale condition, or clear waste.
- Existing unrelated problems not caused by the PR.
- Missing tests for trivial glue, copy-only changes, or dead-simple UI wiring.
- "Could be cleaner" without explaining the maintenance cost.
- A new abstraction just because code appears twice; duplication can be acceptable until behavior stabilizes.
- Dependency concerns if the dependency is already installed and used similarly.
- Type nits that do not improve safety or readability.

When uncertain, write a question instead of a finding.

---

## Scoring rubric

Start at 5. Apply deductions, then apply hard caps.

### Deductions

| Deduction | Condition                                           |
| --------- | --------------------------------------------------- |
| −3        | Each critical issue                                 |
| −1        | Each major issue, capped at −2 total                |
| −0.5      | Three or more minor issues                          |
| −0.5      | Meaningful missing tests for changed business logic |
| −0.5      | Significant DRY/reuse or over-engineering issue     |
| −0.5      | Two or more codebase consistency issues             |

Nits do not affect score.

### Hard caps

- Any critical issue: max score **2/5**.
- Two or more critical issues: max score **1/5**.
- Any unprotected auth/admin/payment/data-deletion route: max score **1/5**.
- Any major issue that breaks the main purpose of the PR: max score **2/5**.
- No changed business logic tests in a high-risk PR: max score **3/5**, even if code looks correct.
- Only nits/minor style issues: minimum score **4/5**.
- No meaningful issues found: **5/5**.

Round down after deductions unless a hard cap applies. Minimum score is 1.

### Score meanings

| Score | Label      | Verdict                             |
| ----- | ---------- | ----------------------------------- |
| 5/5   | Excellent  | ✅ Ready to merge                   |
| 4/5   | Good       | ✅ Ready to merge, optional polish  |
| 3/5   | Acceptable | ❌ Merge after fixing listed issues |
| 2/5   | Needs work | ❌ Request changes                  |
| 1/5   | Not ready  | ❌ Request changes                  |

**The score is about code quality. It is not the merge decision.** A 5/5 pricing change
still needs a human. A 3/5 typo fix does not. Compute the score, then run the gate below
independently.

---

## Step 4 — Merge decision gate

Output exactly one of three verdicts. Decide by running the gates in order — first match
wins. Do not skip to a conclusion and reverse-engineer the reasoning.

| Verdict                      | Meaning                                                                                      |
| ---------------------------- | -------------------------------------------------------------------------------------------- |
| 🛑 **BLOCKED**               | Do not merge. Something in the diff is wrong or unverifiable.                                |
| 👥 **HUMAN REVIEW REQUIRED** | The code may be fine, but a second person must approve. Always name who and what to look at. |
| ✅ **SELF-MERGE OK**         | The author can merge without another reviewer, once CI is green.                             |

### Gate invariants

These hold no matter what the diff looks like or what the author says:

- **Fail closed.** A missing input — unavailable diff, unreadable history, unknown CI status, unknown consumers — escalates. It never passes by default.
- **Tighten, never loosen.** Your judgment can move a verdict toward more scrutiny. It can never move one toward less. If a deterministic condition says human review, no amount of "but the code is clearly fine" overrides it.
- **Deterministic checks run before judgment.** Tier, size, path deny-list, PR state, and history are mechanical. Only after they pass does your reading of the code matter, and then only to escalate.
- **Never recommend merging on someone's behalf.** The verdict is a recommendation to the author; approving, requesting changes, and merging are human actions.

### Gate 0 — Mechanical pre-checks (any failure → not eligible for self-merge)

Cheap, deterministic, and run first:

- [ ] PR has no merge conflicts and is up to date enough with the base branch to be meaningful.
- [ ] No existing "changes requested" review sitting unresolved.
- [ ] CI is green, or the verdict is explicitly conditional on it.
- [ ] Diff is within observable bounds: roughly **≤500 changed lines and ≤20 files**, or larger only when the change is mechanically repetitive and you verified the pattern.
- [ ] No changed path matches the P0 deny-list (money, auth, secrets, migrations, public contract, deploy config).
- [ ] The diff was fully available to read.

Size is not a proxy for risk — a one-line pricing change is P0 — but it _is_ a proxy for
review reliability. Above these bounds, recommend a split rather than issuing a
confident verdict on code you skimmed.

### Gate 1 — Blockers (any one → BLOCKED)

- Any unresolved **critical** finding.
- A **major** finding that defeats the PR's stated purpose.
- Auth, authorization, or tenant-isolation check missing on a path that reads or writes data.
- Secret, key, token, or credential committed or logged.
- Destructive migration or data-deleting code without a verified rollback or backup path.
- Money movement or price computation that you can show is wrong.
- The diff is materially unavailable — you were asked to approve code you could not read.

### Gate 2 — Human review required (any one → HUMAN REVIEW REQUIRED)

Effective tier and evidence, not intuition:

1. **Effective tier is P0.** No exceptions. Pricing, billing, quotas, auth, tenant isolation, secrets, data deletion, published SDK/API contract, and deploy config always get a second pair of eyes, even at 5/5 with no findings.
2. **Effective tier is P1 and any of:** a behavior or contract change, no test covering the changed behavior, a new external dependency, or review coverage below full.
3. **Prior-attempt history is bad** — the touched path has a revert, hotfix, or repeat-fix chain (Step 2.7).
4. **Break analysis produced a row with no detection and non-trivial rollback** on a P0/P1 surface.
5. **Irreversible change** — migration, backfill, deletion, published artifact, or external provider state that a `git revert` will not undo.
6. **Contract change with unknown or external consumers** — public API, SDK export, webhook payload, event schema, shared type consumed outside the repo.
7. **CODEOWNERS names an owner who is not the author** for a changed path.
8. **Your own confidence is medium or lower** on a P0/P1 area, or you had to assume something material you could not verify.
9. **Any unresolved major finding**, even if the author says they'll fix it after merge.
10. **Behavior changed with zero test delta** on anything above P2.
11. **Review coverage is partial** on a P0/P1 PR.
12. **Nothing about the change was observed** — behavior on a P0/P1 surface rests on reasoning alone, with no test, run, or output anyone has looked at.
13. **You authored this code earlier in the session** and the effective tier is above P2.
14. **A finding is ambiguous on a P0/P1 surface** — you cannot tell whether it is a real defect without context only a human has.

### Gate 3 — Self-merge (requires ALL to be true)

Every single one. One "unknown" disqualifies:

- [ ] Gate 0 mechanical pre-checks all pass.
- [ ] Effective tier is **P2 or P3**.
- [ ] No critical and no major findings. Minors and nits only.
- [ ] Review coverage is **full** — you read every changed hunk, not a sample.
- [ ] Every behavior change is covered by a test **whose assertions you read**, or was directly observed, or the change is provably non-behavioral (docs, copy, comments, formatting, test-only, generated output from an unchanged verified generator).
- [ ] **Reversible**: a plain code revert fully restores prior behavior. No migration, backfill, deleted data, published package, or external state.
- [ ] **No public contract change** — no changed export, endpoint shape, status code, event payload, or env var that anything outside this PR depends on.
- [ ] **Clean prior history** on the touched paths — no revert/hotfix/repeat-fix chain.
- [ ] No new production dependency.
- [ ] No CODEOWNERS owner other than the author on any changed path.
- [ ] Blast radius is bounded and you can state the boundary in one sentence.
- [ ] No ambiguous findings left unresolved.

If all pass, say so plainly and briefly. Do not manufacture a reason to hedge — an
over-cautious gate trains the author to ignore the gate.

### Writing the decision

Always include, in this order:

1. The verdict.
2. The effective tier and the one-line reason for it.
3. **Why** — the specific gate that fired, quoted concretely ("Gate 2.1: `packages/billing/src/plan-limits.ts` changes the overage multiplier").
4. **Who should review** — a named CODEOWNER if one exists; otherwise the engineer `git blame` and recent history show has actually worked in this code, named specifically; otherwise the role ("whoever owns billing", "someone with production DB access"). Never just "a senior engineer".
5. **What that reviewer should focus on** — 1–3 specific things, not "review the PR".
6. **How to observe it working** — the command to run and the output to expect, when the change is observable.
7. **How long it should take** — a rough estimate signals you understand the change ("~10 minutes, two files matter").
8. **What would downgrade the gate** — the concrete change that would make this self-mergeable next time ("add a test asserting the overage multiplier at the plan boundary, and this becomes self-merge at P1").

Point 8 matters: the gate should teach, not just block.

### Honesty constraints on the gate

- This verdict is **advisory**. It never overrides branch protection, required approvals, or org policy. If repo config is stricter, defer to it and say so.
- Never recommend self-merge to satisfy urgency. If the author says it's urgent and it's P0, the answer is "get a fast reviewer", not "ship it".
- Never soften a blocker because the author pushes back. Re-examine the evidence; if the evidence holds, the verdict holds.
- If you skipped history or repo signals, state it in the decision — do not let a silent skip look like a clean result.

Worked examples of gate calls, including tricky near-misses:
`references/merge-gate.md`.

---

## Follow-up reviews (re-review after fixes)

When the author returns with fixes, do **not** re-review from scratch and do not
re-litigate settled points. Run the delta loop:

1. Diff the new state against the state you reviewed (`git diff <old_sha>..<new_sha>`).
2. For each previous finding, mark: **Fixed** / **Partially fixed** / **Not addressed** / **Fixed but introduced something new**. Verify against code — never take "done" on faith.
3. Review only the new hunks with the full pass set.
4. Re-run criticality: fixes can raise the tier (a "small fix" that adds a migration is now P1+).
5. Re-run the merge gate from scratch. A previously blocked PR does not become self-mergeable just because the blocker was fixed — the new code has to pass the gate on its own.
6. Report only: resolution status, new findings, updated verdict. Keep it short.

Stop the loop when the gate returns SELF-MERGE OK or HUMAN REVIEW REQUIRED with no
blockers. Do not keep hunting for new nits to justify another round.

---

## Output format

Always write the review in this structure.

````md
## PR Review: [PR title, branch, or concise filename summary]

### Merge decision

**[✅ SELF-MERGE OK / 👥 HUMAN REVIEW REQUIRED / 🛑 BLOCKED]**

- **Criticality:** [P0/P1/P2/P3] — [surface], [change class][, +1 modifier: reason]
- **Why:** [the specific gate that fired, with the file or fact that triggered it]
- **Reviewer:** [named CODEOWNER, blame-familiar engineer, or role — omit if self-merge]
- **Focus on:** [1–3 concrete things — omit if self-merge]
- **Observe it:** [command to run + expected output — omit if not observable]
- **Effort:** [~N minutes, which files matter]
- **To self-merge next time:** [the concrete change that would clear the gate]

[If oversized: add a 🔀 **Consider splitting** line naming the seams.]

### Score

**[✅ for 4/5 or 5/5; ❌ for 1/5–3/5] [N]/5 — [Label]**

[One direct sentence explaining what drove the score. Score is code quality; the merge
decision above is separate.]

---

### Summary

[2–4 sentences. Say what the PR does, what is good, and the main concern.]

---

### What this could break

[Table of grounded scenarios: what breaks / trigger / who's affected / detection /
rollback. Omit the table for P3 and say instead: "Bounded — [one-sentence boundary]."]

---

### Prior attempts in this code path

[Only when history was checked AND is relevant. State findings with commit SHAs or PR
numbers: earlier fixes, reverts, hotfix chains, what the last attempt missed, and
whether this PR addresses it. If clean, one line: "No prior fix attempts or reverts on
these paths in the last 6 months." If not checked: "Not checked — no repository
access."]

---

### Issues

[If no issues: "No blocking or meaningful issues found."]

**[severity] [category] — path/to/file.ext:line_or_function**
**Confidence:** High/Medium

[Explain: When X happens, Y breaks because Z. Tie it to user/dev impact.]

```language
// ❌ Current
[short relevant snippet]

// ✅ Suggested
[short suggested fix]
```
````

[Repeat issues ordered critical → major → minor.]

#### Nits

- `path:line` — [one-line optional cleanup]

---

### Questions / assumptions

[Ambiguous findings and material assumptions. Name the missing context specifically.
Do not use this to avoid making a clear call on things you can determine yourself.]

---

### Verification

[What was observed vs. reasoned about. E.g. "Ran the plate-normalization test suite —
passes. The provider retry path was traced but not executed; no test covers it." Omit
for P3.]

---

### What's done well

- [Specific genuine praise tied to code. Omit this section if nothing specific.]

---

### Upgrade roadmap

**To reach 4/5**

- [Must-fix items. If already 4+ say "Already at or above 4/5."]

**To reach 5/5**

- [Polish/test/consistency items. If already 5 say "Already 5/5. Nothing required."]

---

### Stats

- Files changed: N
- Criticality: [tier] ([highest-tier file])
- Diff size: N lines / N files
- Behavior verified by: [observation / tests read / static checks / reasoning only]
- Merge decision: [verdict]
- Review coverage: [full / partial, and why if partial]
- History check: [done / not available]
- Score: N/5
- Issues: N total (critical: N, major: N, minor: N, nits: N)
- Highest risk area: [area]
- Categories flagged: [list]
- Not verified: [what you could not check — omit if nothing]

```

### Output rules

- Keep issues concise. One strong paragraph plus a fix is enough.
- Do not include giant snippets. Show only the relevant lines.
- If there are many findings, prioritize the top 10 by severity and impact. Put the rest under "Additional notes" only if useful.
- Never say "LGTM" if you did not review enough context. Say "No issues found in the provided diff" instead.
- Be direct: "This can create duplicate charges" is better than "This might possibly be problematic."
- **Lead with the merge decision.** It is the first thing the author reads and the only thing some authors read.
- **Nit budget: 5 maximum.** Nits never affect the score or the gate. If you have more than five, you are linting. Cut to the five that would actually annoy a reader.
- Do not repeat the gate reasoning in the summary. State it once, in the decision block.
- Never state a verdict the evidence does not support in order to sound decisive. "P1, human review required, and here is the one thing I could not verify" is a stronger answer than false certainty in either direction.
- The score icon is deterministic: use ✅ for 4/5 or 5/5 and ❌ for 1/5, 2/5, or 3/5.

---

## Verdict calibration

Read `references/merge-gate.md` when you are unsure about a verdict.

---

## Simplicity quick-reference checklist

Before finalizing, run this mini-check for every non-trivial new abstraction or helper:

1. Is this solving a real current requirement, not “maybe later”?
2. Did I search for an existing repo helper/pattern first?
3. Would stdlib/native/platform/database/framework solve this with fewer edge cases?
4. Is an already-installed dependency meant to do this exact job?
5. Does the custom code duplicate caching, retries, validation, parsing, formatting, state management, or authorization?
6. Can I name a concrete risk if this custom code stays?
7. Can I suggest a smaller replacement that preserves behavior?

If the answer to 6 or 7 is no, do not report it as an issue.

---

## Reviewer self-check before final answer

Before finalizing, ask yourself:

1. Did I only flag PR-introduced or PR-worsened issues?
2. Does every issue have a trigger, impact, cause, and fix?
3. Did I avoid linter/style noise?
4. Did I check contracts across files where relevant?
5. Would a senior engineer accept each finding as useful?
6. Could a cheaper model follow the output without guessing?

### Gate self-check

7. Did I assign the tier from what the changed lines actually govern, opening the hunks rather than reading folder names?
8. Did I take the **highest** hunk's tier, not an average, and apply the reversibility and bad-history modifiers?
9. Did I check prior attempts, or explicitly say I could not?
10. Is every break-analysis row grounded in traced code rather than imagined?
11. Did I run the gates in order, and can I quote the exact gate that fired?
12. If I said SELF-MERGE OK: does **every** Gate 3 condition genuinely pass, and would I still say it if this shipped to production tonight with no one watching?
13. If I said HUMAN REVIEW REQUIRED: did I name a specific reviewer or role, specific focus areas, and the concrete thing that would clear the gate next time?
14. Am I gating out of real evidence, or out of vagueness? Vagueness is my problem to resolve, not the author's to absorb.
15. Is the merge decision consistent with the findings, the tier, and the stated coverage?

If not, revise before sending.

A condensed tick-list version of every gate in this skill, for use while reviewing
rather than after: `references/checklist.md`.
```
