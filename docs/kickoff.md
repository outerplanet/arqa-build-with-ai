# Kickoff runbook

Written from the organiser's documents before the first commit: the dates, what is submitted, the
judging criteria, and every rule that carries disqualification. Until then this file is a
checklist of what to fill in.

---

## The event

- **Dates and deadlines:**
- **What is submitted, and where:**
- **Judging criteria:**
- **Rules that carry disqualification:**

## Before the deadline

- [ ] A teammate clones into a **fresh directory** and follows the README literally.
- [ ] `.env.example` is current and copying it is enough to start.
- [ ] The main scenario runs **without anybody's personal keys** — `LLM_PROVIDER=mock`.
- [ ] The third-party disclosure section is present and names this starter.
- [ ] `git shortlog -sne --all` shows every member with sane commit counts. **Keep the `--all`**:
      without a revision argument it reads from standard input and, run from a script or an agent,
      silently prints nothing.

---

## When something breaks

| Symptom | Do this |
| --- | --- |
| Rate limits, 429s | Already retried automatically. If it persists, switch `LLM_PROVIDER=chat` to another OpenAI-compatible endpoint. |
| Credits exhausted | `LLM_PROVIDER=chat` with another provider's endpoint. |
| No network at all | `LLM_PROVIDER=mock`. Update the scripted branches to match your tools — it calls the real dispatcher, so it stays honest. |
| Model ignores a tool | Rewrite the tool `description` for *when to use it*, not what it returns. That is usually the whole fix. |
| Browser disagrees with the source | Stop the dev server, delete `.next`, restart. Never delete it while running. |
| Lint explodes with `␍` warnings | Something wrote CRLF. `pnpm format`. Use the file tools, not shell heredocs. |
| The build works but the page is unstyled | `pnpm test` — `globals.spec.ts` catches Tailwind emitting an empty stylesheet. |
| A commit went in under the wrong identity | `git commit --amend --author="Name <email>"` on the last one, if unpushed. Never rewrite pushed history. |

## The demo itself

Ninety seconds. One person types one sentence. The agent picks its own tools, the panel fills with
real calls, and it finishes with a concrete result.

Show a refusal if you have time — an agent that declines to do something it is not allowed to do is
a far stronger argument for the engineering than one that always says yes.
