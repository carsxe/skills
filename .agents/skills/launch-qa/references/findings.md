# Findings, merging, and ranking

## Contents

- [Run directory layout](#run-directory-layout)
- [findings.json (one per persona per round)](#findingsjson-one-per-persona-per-round)
- [Merging into issues](#merging-into-issues)
- [issues.json](#issuesjson)
- [Ranking](#ranking)
- [Verification (round 2+)](#verification-round-2)

---

## Run directory layout

```
.launch-qa/20261020-1400/
  run.json                    app, url, firstSuccess, environment, backend, date, identities
  round-1/
    impatient/  findings.json  journey.md  01-landing.png  02-…png
    skeptic/    …
    mobile/     …
    nonnative/  …
    breaker/    …
  issues.json                 merged + ranked by the lead
  round-2/<persona>/          rerun, with "verifies"
  round-3/<persona>/          optional targeted re-verify (affected personas only)
  report.md  report.html      rendered by scripts/report.mjs
```

## findings.json (one per persona per round)

```json
{
  "persona": "mobile",
  "round": 1,
  "reachedSuccess": false,
  "stoppedAt": "Step 3 of signup: 'Continue' hidden behind cookie banner",
  "device": "375x812, slow3g, cpu 4x",
  "findings": [
    {
      "id": "mobile-03",
      "step": 7,
      "url": "https://app.example.com/signup?step=3",
      "kind": "stuck",
      "severity": "blocker",
      "title": "Cookie banner covers the Continue button on signup step 3",
      "whatHappened": "The fixed cookie banner covers the bottom 180px. Continue sits under it, and 'Accept' is the only way out.",
      "expected": "Continue visible, or the banner dismissible without accepting.",
      "quote": "I can't press Continue and I don't want to accept tracking just to sign up.",
      "screenshot": "07-continue-under-cookie-banner.png",
      "evidence": {
        "console": [],
        "failedRequests": [],
        "measurements": { "scrollWidth": 375, "tapTarget": "Continue 343x0 visible" }
      }
    }
  ],
  "verifies": []
}
```

Field rules:

- `id`: `<persona>-<NN>`, unique within the persona and round.
- `step`: the journey.md step number where it first happened. Used to order by funnel position.
- `kind`: `stuck` | `confused` | `annoyed` | `error` | `trust`.
- `severity`: `blocker` | `major` | `minor`, as defined in personas.md.
- `screenshot`: a file name in the persona's output directory, taken at the moment of the problem. Required.
- `quote`: one line in the persona's voice. It's what goes in the report.
- `evidence`: whatever supports the finding: console errors, failed requests with status, probe results, timings in ms.

`scripts/report.mjs collect` validates all of this and exits non-zero on problems.

## Merging into issues

You merge 5 reports into one list. This is the step where judgment matters most.

1. **Cluster by root cause, not by symptom text.** The impatient user's "clicked Sign up, nothing happened", the mobile user's "Sign up spinner forever", and the breaker's "double-click created two accounts" may all be one missing loading/disabled state on the submit button. Confirm that from the evidence (same request, same component) before merging.
2. **Don't merge different causes that look alike.** "Error message is jargon" on signup and on billing are two issues if they come from two code paths. They're one issue if both come from one shared error formatter.
3. **A persona counts once per issue**, however many times they hit it.
4. **Severity is the worst any persona experienced**, provided the screenshot supports it.
5. **Drop findings the screenshot doesn't support** (the persona misread, or it was an agent-tool glitch, not a product problem). Mention dropped findings in one line in the report. Keep findings that only one persona would notice (skeptic's legal links, mobile's tap targets). They rank lower, but they're real.
6. **Tool glitches are not product bugs.** If a click failed because the agent targeted the wrong element, and the persona's own next attempt worked, drop it.
7. **Key it** with a short stable kebab-case `key` (`signup-submit-no-feedback`). Round-2 verifies refer to this key.

## issues.json

An array, written by the lead:

```json
[
  {
    "key": "signup-submit-no-feedback",
    "title": "Sign up button gives no feedback and allows double submit",
    "severity": "blocker",
    "personas": ["impatient", "mobile", "breaker"],
    "findingIds": ["impatient-02", "mobile-04", "breaker-05"],
    "funnelStep": 2,
    "where": "/signup — submit",
    "rootCause": "SignupForm submits without pending state; button stays enabled during the 2–9s request",
    "fix": {
      "summary": "Disable the button and show a spinner while pending; make the endpoint idempotent on email",
      "files": ["src/components/SignupForm.tsx:48", "api/auth/signup.ts:22"]
    },
    "status": "fixed"
  }
]
```

`status`: `open` → `fixed` (after Phase 3) | `needs-owner` (needs business content or a decision; say why in `fix.summary`) | `wontfix` (only with a stated reason, such as working as intended per the user).

`funnelStep` is the rough stage of the journey where the issue appears (1 landing, 2 signup, 3 verification, 4 onboarding, 5 first core action, …). Keep it consistent within a run.

## Ranking

`node scripts/report.mjs rank $RUN` sorts by:

1. **Users hit**, the number of distinct personas, descending. This is the primary order because the user asked for it, and an issue five very different users hit is the most certain to cost real signups.
2. **Severity**: blocker > major > minor.
3. **Funnel position**: earlier first, because issues at the top of the funnel lose everyone downstream.

It writes `rank` and `usersHit` back into issues.json and prints the table.

## Verification (round 2+)

Each rerun persona adds `verifies` to its findings.json:

```json
"verifies": [
  { "issue": "signup-submit-no-feedback", "status": "fixed", "screenshot": "09-verify-signup-spinner.png", "note": "Spinner appears, button disabled, one account created after double-click" },
  { "issue": "cookie-banner-covers-cta", "status": "still-broken", "screenshot": "10-verify-cookie.png", "note": "Banner now dismissible, but still covers Continue at 375px until dismissed" }
]
```

- `fixed` needs a screenshot of the after state at the same step.
- `still-broken` needs a screenshot and a note on what's still wrong.
- New problems found during the blind journey go in `findings` as usual. If one is caused by a fix, set `"regression": "<issue key>"` on it.

`report.mjs render` shows each issue as **fixed** only when every persona that verified it says `fixed`. Any `still-broken` makes it **still broken**, and a fix nobody re-checked shows as **fixed (unverified)**.
