# Agent Starter

A Next.js starter for building an LLM agent quickly: a tool-calling loop that works against three
different providers, a chat interface that shows the agent's work, a component library, a
design-token system, and a code structure enforced by lint and tests rather than by convention.

**There is no product in it.** The only tool is a domain-free clock, `get_current_time`, which
exists so the wiring has something real to run. Add the product's tools beside it.

> **Reviewers and judges: start at [Verifying this project](#verifying-this-project).** It runs the
> main scenario with no API key and no database.

---

## Quick start

```bash
pnpm install
cp .env.example .env
pnpm dev                 # http://localhost:3000
```

That is the whole setup, and it works with **no API key and no database** — the example
environment ships with `LLM_PROVIDER=mock`, a scripted agent that drives the real tools. No Docker,
no migrations; the database stays dormant until you decide otherwise.

For a live model, set `LLM_PROVIDER=responses` and a real `LLM_API_KEY` in `.env`.

`/design` renders every component and token in both themes.

---

## Verifying this project

The main scenario runs with **no credentials of any kind**:

```bash
pnpm install
cp .env.example .env
echo "LLM_PROVIDER=mock" >> .env
pnpm dev
```

Open <http://localhost:3000> and send **“What time is it?”**. The agent calls a tool, the
right-hand panel shows which tool it chose, what it passed, what came back and how long it took,
and the answer is composed from that result.

`LLM_PROVIDER=mock` runs a scripted agent through the **real** tool dispatcher. It is the product
with the model removed, not a stub of it — a tool that would refuse still refuses.

To check the same flow against a live model, set `LLM_PROVIDER=responses` and a real `LLM_API_KEY`.

The automated checks:

```bash
pnpm check
```

One command: typecheck, lint at `--max-warnings 0`, and the unit suite, run in parallel. Warnings
are failures. It needs nothing running — no database, no API key, no network.

---

## Architecture

Two axes that meet only in `src/app/`.

**The interface** is Feature-Sliced Design — `app → views → widgets → features → entities → shared`,
importing strictly downward.

**The server** is `src/server/`, which is not an FSD layer. Its tiers are
`kernel`/`db` → `<domain>/model` → `<domain>/repo` → `<domain>/usecase` → `jobs`, also importing
only downward. A repo never reaches another domain's repo; cross-domain work lives in a usecase.

Both are enforced by `eslint-plugin-boundaries`, so a violation is a failed build rather than a
review comment. `docs/architecture.md` is the specification.

```
src/
  app/               Routes, layouts, the API route. Where the two axes meet.
  views/             Screens. The FSD "pages" layer, aliased @pages/* — never src/pages/.
  widgets/           AppShell: sidebar, header, theme toggle, toasts.
  shared/ui/         17 primitives built on Radix. Tokens only, no hard-coded colour.
  shared/lib/        Form helpers, theme script.
  server/kernel/     ctx, env validation, domain errors.
  server/db/         Prisma client, transactions, error mapping. Dormant by default.
  server/agent/      The agent domain. The product's domain goes here or beside it.
    model/           Zod schemas. *.schema.ts is the one thing the UI may import.
    data/            JSON fixtures. Empty in the starter.
    repo/            Readers and stores. Empty in the starter.
    usecase/         Tool registry, agent loop, structured output, prompt.
```

### The agent

| File | What it is |
| --- | --- |
| `server/agent/usecase/tools.ts` | The tool registry. Adding a tool is one object. |
| `server/agent/usecase/agent.ts` | The loop, in three adapters. |
| `server/agent/usecase/structured.ts` | `complete(schema, …)` — one call, typed object back. |
| `server/agent/usecase/prompt.ts` | The system prompt and its hard rules. |
| `server/agent/usecase/client.ts` | One client, one retry policy. |
| `app/api/chat/route.ts` | `POST /api/chat`. The only network call the UI makes. |

**Adding a tool** — one object in `TOOLS`, and nothing else changes. The JSON Schema shown to the
model is derived from the zod schema, so the contract and the validation cannot drift apart. The
activity panel picks up the new tool's label automatically.

```ts
defineTool({
  description: 'Written for the model: when to reach for this.',
  handler: (ctx, args) => lookUpSomething(ctx, args),
  label: 'Written for a human watching the panel',
  name: 'look_up_something',
  parameters: z.object({ id: z.string().describe('What this is') }),
})
```

**Structured output** — anything of the form "read this and give me fields back" is one call:

```ts
const review = await complete(
  z.object({ score: z.number(), summary: z.string(), tags: z.array(z.string()) }),
  { prompt: submission, instructions: 'Score this against the rubric.' },
);
```

Use `.nullable()` rather than `.optional()`: strict structured output requires every property to be
present. Pass `fallback` for anything on the demo path, so `LLM_PROVIDER=mock` still runs.

### Providers

`LLM_PROVIDER` chooses how the agent talks to a model. The tools and the loop are identical in all
three; only the wire format changes.

| Value | Dialect | Hosted tools | Use it for |
| --- | --- | --- | --- |
| `responses` | OpenAI Responses API | `web_search`, `file_search` | The default. |
| `chat` | Chat Completions | — | NVIDIA NIM, Groq, Together, vLLM. The fallback. |
| `mock` | none | — | No key, no network. Demos and reviews. |

Switching is a `.env` edit:

```bash
# OpenAI
LLM_PROVIDER=responses   LLM_BASE_URL=                                    LLM_MODEL=gpt-5
# NVIDIA
LLM_PROVIDER=chat        LLM_BASE_URL=https://integrate.api.nvidia.com/v1 LLM_MODEL=…
# Groq
LLM_PROVIDER=chat        LLM_BASE_URL=https://api.groq.com/openai/v1      LLM_MODEL=openai/gpt-oss-120b
```

**Retrieval without infrastructure.** Point the script at a folder, paste the id it prints into
`.env`, and the agent gains a `file_search` tool over those documents — no vector database, no
embedding pipeline, no chunking:

```bash
pnpm tsx scripts/upload-files.ts ./path/to/documents
```

---

## The database, if you need one

It is wired and dormant. Nothing requires it and `DATABASE_URL` is unset by default, because every
service a reviewer has to stand up is another way for a review to end early.

When something genuinely has to survive a restart:

```bash
pnpm db:up          # PostgreSQL in Docker on :5433, two roles, three databases
pnpm db:migrate
pnpm db:seed
pnpm test:all       # unit + integration
```

Two roles on purpose: `app_migrator` owns the schema, `app_user` owns nothing, so a mistake in
application code cannot drop a table. All database access goes through `src/server/db` — never
import the Prisma client anywhere else.

---

## Structural guards

Tests that fail on mistakes which pass code review:

- `src/app/globals.spec.ts` builds the stylesheet and asserts it is not empty. Tailwind's source
  detection has silently emitted zero bytes in this project — clean log, 200 response, unstyled
  page. It also enforces the token rules from `docs/design-system.md`.
- `src/shared/ui/rawControls.spec.ts` fails on a raw `<input>`, `<select>` or `<textarea>` in a
  screen layer.
- `src/server/db/transaction.spec.ts` fails on `Promise.all` inside a transaction, which queues
  instead of parallelising and is visible only with a stopwatch.
- `src/server/agent/usecase/tools.spec.ts` asserts the dispatcher never throws, because a throw
  there blanks the activity panel at the worst possible moment.

Add to them rather than around them, and watch each new one fail on purpose before trusting it.

---

## Scripts

| | |
| --- | --- |
| `pnpm dev` | Next dev server |
| `pnpm build` / `pnpm start` | Production build and serve |
| `pnpm verify` | typecheck + lint (warnings are failures) |
| `pnpm test` | Unit tests. Needs nothing running. |
| `pnpm test:all` / `test:integration` | Adds the database tests |
| `pnpm format` | Prettier |
| `pnpm tsx scripts/upload-files.ts <dir>` | Build a hosted vector store for `file_search` |
| `pnpm db:up` / `db:down` / `db:reset` / `db:migrate` / `db:seed` | The optional database |

## Docs

- `AGENTS.md` — how to work in this repository. Read it first; Codex and Claude Code both use it.
- `docs/architecture.md` — the two axes, server tiers, transactions, migrations, testing
- `docs/design-system.md` — tokens, palette, type, space, motion, accessibility
- `docs/ui-patterns.md` — which control a task gets, how forms and tables behave
- `docs/plan.md` — the scenario, the contract, and how the work was split between the team

## Third-party components and prior work

*Required disclosure. Keep this section accurate — competition rules require third-party and
pre-existing components to be declared, and permit a prepared template only while it contains no
functionality specific to the task.*

**Pre-existing template.** This project was started from a general-purpose starter prepared before
the competition: the Next.js application shell, the UI component library, the design-token system,
the lint-enforced architecture, and a provider-agnostic LLM agent loop with one domain-free clock
tool. It contained no functionality specific to the task. Everything addressing the task was
built during the competitive part and is visible in this repository's commit history from the
initial commit onward.

**Libraries.** Next.js, React, Tailwind CSS, Radix UI, Heroicons, Prisma, Zod, React Hook Form,
date-fns, the OpenAI SDK, Vitest and ESLint, each under its own licence. The full dependency list
is `package.json`.

**Models and data.** The agent calls a hosted language model; which one is a `.env` setting (see
*Providers*). No model was trained or fine-tuned for this project.

- **OpenAI `gpt-5`**, through the OpenAI Responses API (`LLM_PROVIDER=responses`). Proprietary,
  used under OpenAI's API terms.
- **`openai/gpt-oss-120b`**, an open-weight model released by OpenAI under Apache 2.0, served by
  Groq through its OpenAI-compatible Chat Completions API (`LLM_PROVIDER=chat`).
- **`LLM_PROVIDER=mock`** uses no model at all: a scripted adapter in this repository that calls
  the real tools with no key and no network.

No external datasets are used. Fixture data under `src/server/*/data/` is written by hand.
