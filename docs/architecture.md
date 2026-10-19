# Technical Architecture

> **This product has no database.** The starter's PostgreSQL/Prisma layer was removed: the places
> are a static, committed file (`data/poi.json`, rebuilt by `pnpm collect`) read by
> `src/server/places/repo`, and nothing about the user is stored. The sections below on database
> access, transactions, roles, migrations and integration tests describe the starter and **do not
> apply** — the tiers, the axes, validation, errors, dates and the gate still do.

## Decision summary

One Next.js application. No separate backend, no microservices, no GraphQL, no message broker,
no cache tier, no database.

| Concern      | Choice                                                     |
| ------------ | ---------------------------------------------------------- |
| Application  | Next.js (App Router) + React + TypeScript                  |
| Styling      | Tailwind CSS, semantic tokens only                         |
| Components   | Radix UI primitives, styled here — no copied component kit |
| Icons        | Heroicons                                                  |
| Data         | `data/poi.json` from OpenStreetMap + Wikidata; vectors in `data/poi.vectors.json` |
| Retrieval    | In-memory cosine over local multilingual 384-d embeddings; optional OpenAI 256-d; lexical fallback, geo and hours filters |
| Map          | MapLibre GL with OpenFreeMap tiles                         |
| Validation   | Zod, one schema shared by client and server                |
| Mutations    | None; Route Handler for the chat                           |
| Tests        | Vitest unit tests                                          |
| Local dev    | Native; nothing to start besides `pnpm dev`                |

Do not add a second backend framework, a monorepo, Kubernetes, Redis or Kafka unless a written
requirement makes it necessary. A starter's job is to be outgrown deliberately, not by accident.

## Current POI retrieval and document exports

The application reads the committed 1,091-place `data/poi.json` through `places/repo/places.ts`.
`usecase/dependencies.ts` connects the real repositories and pure lexical, ranking and route
algorithms. Landmark aliases reference dataset IDs rather than embedding their own coordinates.
The historical Nur Alem alias points to Alem.ai (`osm:way/454857501`), supported by OSM history;
the EXPO building and EXPO quarter remain separate, ambiguous objects.

`scripts/embed.py` builds the static `data/poi.vectors.json` with
`sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2`: 1,091 normalized 384-dimensional
vectors. `data/vector_summary.json` records the source fingerprint and indexing time.
There is no vector database or Python web server. A request spawns the configured Python
interpreter, sends query text on stdin, loads cached model weights offline and returns a query
vector. No query text or coordinates are persisted or logged. This works with mock chat and
requires neither an API key nor a network connection after model setup.

`kernel/embeddingConfig.ts` reads provider, model, interpreter and cache settings; the repository
reads the configured index path and verifies its SHA-256 against the real application dataset.
`semantic.ts` computes exact cosine similarity in memory. Raw similarity is in [-1, 1]; ranking
clips negative semantic scores to zero. `vectorSearch.ts` validates query/topK and returns source
texts, metadata and raw similarity. Missing, stale or invalid vectors and inference errors produce
an explicit lexical-fallback note instead of failing the chat. The optional OpenAI backend uses
`text-embedding-3-small` with 256 dimensions and requires direct Responses credentials; mock chat
does not send queries to that backend. Indices from different models are never mixed.

Python CLI `scripts/vector_search.py` also exposes `vector_search(query, top_k=5)` and rejects
stale indices. Only explicit indexing may download model weights; query execution is offline.
The model cache and virtual environments are ignored by git. Regenerate vectors after collection
and restart the application to reload cached repositories.

`scripts/export_pdf.py` reads the actual Markdown sources through Pandoc's JSON AST and renders
them with ReportLab. Presentation H1 headings delimit slides; speaker comments are omitted.
Scenarios render on A4. Unsupported structures and slide overflow fail explicitly. Outputs are
staged before publication to `output/pdf/`, with compatibility copies under `docs/`. Export
dependencies live in `scripts/pdf-requirements.txt`, separate from the application runtime.
The README documents setup, environment variables and export/test commands.

## Why two axes

The interface and the domain change for different reasons and at different rates. A screen is
reorganised when a person's job changes; a rule is changed when the business changes. Filing both
under one hierarchy means every domain rule ends up living next to the first screen that happened
to need it, and the second screen imports it from there.

So there are two structures, and they meet at exactly one place.

- **Feature-Sliced Design for the interface** — `src/{app,views,widgets,features,entities,shared}`.
- **Tiered domain modules for the server** — `src/server/`, which is not an FSD layer.

## Directory structure

```
src/
  app/          Next.js routes, layouts, Server Actions. The only place both axes meet.
  views/        The FSD "pages" layer: whole screens. Aliased @pages/*.
  widgets/      Composite blocks reused by more than one screen.
  features/     User-facing capabilities: a form, an action, its client state.
  entities/     Business nouns as the interface sees them.
  shared/       ui/, lib/, api/, config/ — no domain knowledge at all.

  server/       Not an FSD layer. See below.
    kernel/     Context, environment, errors. Depends on nothing.
    db/         The Prisma client, transactions, error translation.
    <domain>/
      model/    Types, Zod schemas, pure rules. No I/O.
      repo/     Database reads and writes. Receives a `tx`. Never calls another domain's repo.
      usecase/  One business operation. Owns the transaction. Composes repos.
    jobs/       Scheduled and background work.
```

`src/pages/` must never exist — Next.js would activate the Pages Router for it. The FSD "pages"
layer is `src/views/`, reached through the `@pages/*` alias.

## The FSD axis

Imports go strictly downward: `app → views → widgets → features → entities → shared`. A layer
never imports a sibling slice at the same level; if two slices need the same thing, it moves down.

A slice's `index.ts` is its public API. Inside the slice, import files directly. There is no
`index.ts` inside a segment (`ui/`, `api/`, `model/`) — a lint rule enforces this, because a
barrel re-exporting siblings is how import cycles are born.

## The server directory

### Tiers

```
kernel / db  →  <domain>/model  →  <domain>/repo  →  <domain>/usecase  →  jobs
```

Imports go only downward. The rules that matter:

- A **repo** never imports another domain's repo. Cross-domain work belongs in a usecase.
- A **usecase** lives in the domain of the table it primarily writes.
- Only a **usecase** opens a transaction. A repo always receives a `tx`.
- Every file starts with `import 'server-only'`.
- No barrels. Deep imports only.

### Shape

Domain operations are plain functions with the signature `(ctx, input)`.

```ts
export async function createThing(ctx: RequestContext, input: CreateThingInput) {
	// A permission check, when there is one, is the first line.
	const parsed = createThingSchema.parse(input);

	return withTransaction(async (tx) => thingsRepo.insert({ tx }, { ...parsed, at: ctx.now }));
}
```

`ctx` is always first. `ctx.now` is injected and domain logic never calls `new Date()`: a rule
decided against the clock cannot be tested without faking timers, and a rule decided against
`ctx.now` is tested by passing a different context.

### Transactions

`withTransaction` is the only place a transaction is opened, and it is owned by a usecase.
Without a single owner you get nested transactions, partial commits, and a side effect that
outlives the change it announced.

**Never run two queries concurrently inside one transaction.** An interactive transaction holds
one connection, so `Promise.all` inside a `tx` does not parallelise — it queues, and it queues
catastrophically. `transaction.spec.ts` enforces this by reading the source, because nothing
errors and nothing warns: the only symptom is a stopwatch.

### The boundary between the axes

- The FSD layers never import Prisma, a `repo`, or `src/server/db`.
- `src/server/**` never imports React, Next, or anything from the FSD layers.
- Only `src/app/**` and `features/*/api` may import a usecase.
- Components never touch the database.

A Zod schema under `src/server/*/model/*.schema.ts` is the one exception: both sides read it, so
one definition validates the form and the Server Action. Those files carry no `server-only` and
import nothing but Zod and their own domain's siblings.

## Database access

All access goes through `src/server/db`. Nothing outside that directory imports the Prisma client
directly; a repo takes a `Tx` and uses it. The exceptions live outside `src/`: `prisma/seed.ts`
and migrations.

### Two database roles, and why it is not optional

`docker/postgres/init/` creates two non-superuser roles:

- `app_migrator` owns the schema and runs migrations.
- `app_user` connects at runtime and owns nothing.

The immediate payoff is that application code cannot drop a table. The larger one arrives if you
add Row Level Security: a policy is **not** enforced against a table's owner unless the table also
has `FORCE ROW LEVEL SECURITY`. An application connecting as the role that created the tables
would make every policy silently inert — the worst kind of failure, because every isolation test
would pass while isolating nothing.

### If you add multi-tenancy

The starter is single-tenant. If tenants arrive, do both layers, not one:

1. Every tenant-owned row carries `organization_id`, and the data layer scopes every query by it.
2. RLS enforces the same thing in the database, as a backstop, driven by a per-transaction
   setting (`SELECT set_config('app.org_id', …, true)`) applied on the transaction's connection.

Explicit scoping is what makes queries correct; RLS is what makes a forgotten `where` clause fail
closed instead of leaking. Write tests that assert isolation, and make one of them fail on purpose
before believing any of them.

## Migrations

```
pnpm db:migrate        # prisma migrate dev
# hand-edit migration.sql for anything Prisma has no syntax for:
#   RLS policies, exclusion constraints, extensions, partial indexes, triggers
pnpm db:seed
```

All schema changes go through migrations. Hand-written SQL is asserted by an integration test
rather than trusted — Prisma will not tell you that a policy stopped applying.

## Validation

Validate all external input on the server, in the usecase, with the same Zod schema the form uses.
A Server Action is a public endpoint whether or not a form is in front of it: the browser can be
old, the script can fail, and the request can be forged.

## Errors

`DomainError` carries a `kind` (`conflict`, `duplicate`, `forbidden`, `validation`) rather than
being a class hierarchy — a Server Action's result crosses a serialisation boundary, where
`instanceof` has stopped being true and a string still is.

The application never presents a raw database error. Prisma messages embed the failing call, an
absolute file path and a snippet of surrounding code. `src/server/db/errors.ts` maps SQLSTATEs to
kinds; anything unmapped is rethrown untouched, so an unexpected failure stays unexpected.

## Dates and time

Every stored instant is UTC, in `timestamptz`. A timezone is a display concern. A calendar date
with no time — a date of birth, a due date — is a `date` and is compared as three numbers, never
converted to an instant: `new Date('2015-09-18')` is UTC midnight, which is the previous day west
of Greenwich, and the bug appears for exactly one day a year.

## Testing

Two projects, one command.

- **unit** — pure functions, schemas, and the structural guards that read the source tree.
  Fast, no database.
- **integration** — a real PostgreSQL. `vitest.globalSetup.ts` refuses to run against a database
  whose name does not contain `_test`, then applies migrations. One worker, because these tests
  share a database and concurrency turns a real failure into an intermittent one.

The structural guards (`rawControls.spec.ts`, `transaction.spec.ts`, `globals.spec.ts`) exist
because the failures they catch pass code review: an unstyled build that returns 200, a raw
`<input>` that looks fine, a transaction that is merely slow.

**Any rule, check or hook you add must be watched failing.** Break it on purpose, see it go red,
then fix it back. A check that was never seen failing is a check that tests nothing, and it will
be called done.

## The gate

```
pnpm check                   # typecheck, lint --max-warnings 0, tests — in parallel
```

Warnings count as failures. A change is not finished until it passes.

## Avoid

- Storing a number that summarises a history. A count, a remaining balance, a derived expiry —
  each is computed from rows. A stored summary is a future migration plus a backfill, and in the
  meantime it is a number that disagrees with the events beneath it.
- Optimising for scale the product has not reached.
- Adding a dependency that solves a problem you do not yet have.
