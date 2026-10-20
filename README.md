# CarsXE Skills

Reusable agent skills for CarsXE projects. Compatible with Codex, Claude Code,
Cursor, and other agents supported by the [skills CLI](https://skills.sh).

## Install

Install the PR review skill:

```bash
npx skills add carsxe/skills --skill pr-review
```

Install it for every supported agent:

```bash
npx skills add carsxe/skills --skill pr-review --agent '*' -y
```

Install the vehicle intelligence skill:

```bash
npx skills add carsxe/skills --skill carsxe-vehicle-intelligence
```

Install the launch QA skill:

```bash
npx skills add carsxe/skills --skill launch-qa
```

## Available skills

| Skill | Description |
| --- | --- |
| [`pr-review`](.agents/skills/pr-review/SKILL.md) | Reviews pull requests, classifies criticality, checks the diff against the ClickUp ticket when the title has `[CU-<id>]`, and determines whether self-merge or human review is appropriate. |
| [`launch-qa`](.agents/skills/launch-qa/SKILL.md) | Five simulated first-time users (impatient, skeptic, mobile on slow 3G, non-native English, breaker) each drive a real browser from landing page to first success, screenshot every confusing moment, then the lead ranks issues by users hit, fixes them in one pass, and reruns all five to prove it. |
| [`break-ui`](.agents/skills/break-ui/SKILL.md) | Feeds a component worst-case realistic data behind a demo/worst-case toggle and reports what broke. |
| [`carsxe-vehicle-intelligence`](.agents/skills/carsxe-vehicle-intelligence/SKILL.md) | Production vehicle data from a VIN, plate, or image — decode, recalls, market value, OCR. |

## Local validation

```bash
npx skills add . --list
```
