# PR Review Quick Checklist

Use this checklist privately. Do not output every item.

## Before anything else

- [ ] Did I assign an effective criticality tier (P0–P3) from the actual changed lines?
- [ ] Did I take the highest hunk's tier rather than an average?
- [ ] Did I apply the reversibility and prior-failed-fix modifiers?
- [ ] Did I check CODEOWNERS and any repo rules files?

## Evidence gate for each issue

- [ ] Is this introduced or worsened by the PR?
- [ ] Do I have an exact file/line/function?
- [ ] Can I describe the trigger condition?
- [ ] Can I describe concrete impact?
- [ ] Can I explain why the code causes it?
- [ ] Do I have a better fix?
- [ ] Is confidence high or medium?

## High-signal checks

- [ ] Main PR intent is actually satisfied.
- [ ] Existing behavior is not accidentally removed.
- [ ] Request/response/schema/types/runtime validators align.
- [ ] Auth and tenant/org ownership are enforced server-side.
- [ ] New query patterns have indexes or bounded scans.
- [ ] Errors are not swallowed or mapped to success.
- [ ] Async paths handle retries/double-submit/races.
- [ ] Caches/query keys invalidate correctly.
- [ ] New business logic has meaningful tests.
- [ ] New dependency/config/env changes are safe in CI/staging/prod.

## False-positive filters

- [ ] Am I just expressing preference?
- [ ] Would a linter already handle this?
- [ ] Is this performance issue actually on a hot path?
- [ ] Is this pre-existing unrelated code?
- [ ] Is the suggested abstraction premature?
- [ ] Am I forcing a category to be non-empty?

## Large PR / codebase understanding checklist

- [ ] Did I identify entry points before judging implementation details?
- [ ] Did I classify changed files by role: source of truth, adapter, orchestrator, presentation, utility, test/support?
- [ ] Did I trace changed exports to callers?
- [ ] Did I trace changed routes/actions/jobs/webhooks to clients, schemas, tests, and docs?
- [ ] Did I inspect shared utilities differently from feature-local code?
- [ ] Did I check existing local patterns before flagging consistency?
- [ ] Did I prioritize public contracts, auth, writes, migrations, webhooks, and shared packages first?
- [ ] If coverage is partial, did I say exactly what was and was not reviewed?

## Shared utility checklist

- [ ] Is this utility public API, internal helper, or single-feature helper?
- [ ] Did the change alter sync/async behavior, throwing behavior, mutation behavior, ordering, or null handling?
- [ ] Did I check representative call sites?
- [ ] Did I connect any finding to a real caller or public contract?
- [ ] Did I avoid speculating about broad impact without evidence?

## Prior-attempt forensics

- [ ] Did I blame the changed lines and read the previous commit?
- [ ] Did I look for reverts, hotfixes, and repeat-fix chains on these paths?
- [ ] If this is a repeat fix, did I say what the earlier attempt missed?
- [ ] Is this a root-cause fix or the same symptom patch at a new call site?
- [ ] If I could not check history, did I say so explicitly?

## Break analysis

- [ ] Did I trace consumers outward to a user-facing or external boundary?
- [ ] Is each failure mode marked loud or silent?
- [ ] Did I name what detects each scenario — or that nothing does?
- [ ] Did I state how each scenario is rolled back?
- [ ] For P3/bounded changes, did I state the boundary in one sentence?

## Observation

- [ ] Did I label each behavior change observed vs. reasoned about?
- [ ] Did I read the assertions of any test I'm counting as coverage, not just its name?
- [ ] For UI changes, is there a screenshot or observed run, not just passing tests?
- [ ] Did I give a runnable observation command with expected output where possible?
- [ ] Is the PR small enough to observe end to end — or did I recommend splitting?

## Merge gate

- [ ] Did I run Gate 0 mechanical pre-checks before forming a judgment?
- [ ] Did I fail closed on every missing input rather than assuming it passed?
- [ ] Did my judgment only tighten the verdict, never loosen it?
- [ ] Did I disclose it if I wrote this code earlier in the session?
- [ ] Did I run the gates in order and can I quote the one that fired?
- [ ] SELF-MERGE: does every Gate 3 condition pass, with no unknowns?
- [ ] SELF-MERGE: would I still say this if it shipped tonight unwatched?
- [ ] HUMAN REVIEW: did I name a specific reviewer or role?
- [ ] HUMAN REVIEW: did I give 1–3 focus items and an effort estimate?
- [ ] HUMAN REVIEW: did I say what would clear the gate next time?
- [ ] Am I gating on evidence, or on my own vagueness?
- [ ] Is the verdict consistent with the tier, findings, and stated coverage?
- [ ] Did I keep nits to 5 or fewer, and out of the gate entirely?

## Severity quick reference

| Severity | Use when                                                                | Action        |
| -------- | ----------------------------------------------------------------------- | ------------- |
| critical | production break, security/privacy hole, data loss, auth/payment bypass | block merge   |
| major    | real bug/risk/contract mismatch/significant missing test                | fix in PR     |
| minor    | real but limited blast radius                                           | fix soon      |
| nit      | optional polish                                                         | take or leave |

## Merge verdict quick reference

| Verdict               | Use when                                                                                                                                      | Must include                                                  |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| 🛑 BLOCKED            | Critical finding, missing authz, leaked secret, wrong money, unreadable diff                                                                  | The defect + the fix                                          |
| 👥 HUMAN REVIEW       | P0 anything; P1 with behavior change / no test / new dep / partial coverage; bad history; irreversible; unknown consumers; CODEOWNER ≠ author | Reviewer, focus items, effort, what clears it next time       |
| 🔀 CONSIDER SPLITTING | Too large or mixed to review reliably (>~500 lines / 20 files / multiple concerns)                                                            | The seams, the suggested stack, and that it isn't a rejection |
| ✅ SELF-MERGE OK      | Gate 0 clean, P2/P3, no major findings, full coverage, observed or non-behavioral, reversible, no contract change, clean history              | The blast-radius boundary in one sentence                     |
