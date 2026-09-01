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

## Available skills

| Skill | Description |
| --- | --- |
| [`pr-review`](.agents/skills/pr-review/SKILL.md) | Reviews pull requests, classifies criticality, and determines whether self-merge or human review is appropriate. |

## Local validation

```bash
npx skills add . --list
```
