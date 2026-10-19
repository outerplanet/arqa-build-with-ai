# Plan

Written at the start by the lead, from the task. Changed only by the lead; anyone may add to
**Requests**. Every agent reads this before starting work and again after every pull. The rules
for writing it are in `AGENTS.md`, under **Every plan is split into lanes**.

---

## Task

*(Which task, and the one line of it that the evaluation turns on.)*

## Scenario

*(One sentence: who types what, and what they get back. The demo shows exactly this.)*

## Contract — frozen early

Schema: `src/server/<domain>/model/<domain>.schema.ts`

| Tool | Arguments | Returns | Writes data? | Owner |
| --- | --- | --- | --- | --- |
| | | | | |

| Repo function | Signature | Owner |
| --- | --- | --- |
| | | |

## Lanes

### Lead — contract, interface, README

- **Paths:** the schema file, `src/views/**`, `src/app/page.tsx`, `README.md`, this file
- **Tasks, in order:**
  - [ ]
- **Depends on:**
- **Stubs while waiting:**
- **Done when:**

### Agent lane — tools, prompt, agent loop

- **Paths:** `src/server/<domain>/usecase/**`, `src/app/api/**`
- **Tasks, in order:**
  - [ ]
- **Depends on:**
- **Stubs while waiting:**
- **Done when:**

### Data lane — data, repo, algorithm

- **Paths:** `src/server/<domain>/data/**`, `src/server/<domain>/repo/**`
- **Tasks, in order:**
  - [ ]
- **Depends on:**
- **Stubs while waiting:**
- **Done when:**

## Integration points

| What meets what | In which file | By |
| --- | --- | --- |
| | | |

## Checkpoints

What each lane commits by each checkpoint.

| By | Lead | Agent lane | Data lane |
| --- | --- | --- | --- |
| | | | |
| | README frozen | | |
| | Demo rehearsed | | |

## Requests

A change someone needs in a path they do not own. Newest last.

- *(time — from → to: …, in `…`)*
