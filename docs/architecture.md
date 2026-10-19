# Technical Architecture

One Next.js application. No separate backend, no microservices, no GraphQL, no message broker,
no cache tier and **no database**: the places, their vectors and the pedestrian graph are static,
committed files, and nothing about the user is stored. The starter's PostgreSQL/Prisma/Docker
layer was removed at the start of the event.

## Decision summary

| Concern      | Choice                                                                                   |
| ------------ | ---------------------------------------------------------------------------------------- |
| Application  | Next.js (App Router) + React + TypeScript                                                |
| Styling      | Tailwind CSS, semantic tokens only (`docs/design-system.md`)                             |
| Components   | Radix UI primitives, styled here — no copied component kit                               |
| Icons        | Heroicons                                                                                |
| Model        | OpenAI Responses API (`gpt-6-luna`) or Chat Completions; `mock` without a key            |
| Data         | `data/poi.json` (OpenStreetMap + Wikidata + Wikimedia Commons photos), `pnpm collect`    |
| Vectors      | `data/poi.vectors.json`, OpenAI `text-embedding-3-small`, 256 dims, `pnpm embed`         |
| Walking      | `data/walking-graph.json`, OSM pedestrian graph from `scripts/collectWalking.ts`, A*     |
| Retrieval    | In-memory cosine + lexical, then geo/hours/popularity/tag ranking; lexical-only fallback |
| Map          | MapLibre GL with OpenFreeMap tiles                                                       |
| Validation   | Zod; one schema shared by client and server                                              |
| Mutations    | None; one Route Handler, `POST /api/chat`                                                |
| Tests        | Vitest unit tests; `pnpm check` runs typecheck, lint and tests in parallel               |

Do not add a second backend framework, a monorepo, a vector database, Kubernetes, Redis or Kafka.

## Request flow

```
browser ──POST /api/chat {messages, location?}──▶ src/app/api/chat/route.ts
                                                     │  chatRequestSchema: validates, rounds location to 3 decimals
                                                     ▼
                                           server/agent/usecase/agent.ts
                       LLM_PROVIDER = responses | chat | mock (scripted, same dispatcher)
                                                     │  up to 10 turns of tool calls
                                                     ▼
                         server/agent/usecase/tools.ts — TOOLS registry, executeTool never throws
       resolve_location · find_places · get_place · plan_walk · get_current_time
                                                     │
                                                     ▼
                         server/places/usecase/*  (findPlaces, planWalk, resolveLocation, getPlace)
                     ┌───────────────┬───────────────┼────────────────────┐
                     ▼               ▼               ▼                    ▼
              repo/places.ts   repo/vectors.ts  usecase/semantic.ts   repo/walkingGraph.ts
              data/poi.json    poi.vectors.json  OpenAI embeddings    walking-graph.json
                                                     │
                     model/{geo,hours,lexical,rank,route,walkingGraph}.ts — pure algorithms
                                                     ▼
                         server/agent/usecase/reply.ts + formatReply.ts
          the answer text and the structured `recommendations` are rendered by code from the
          Zod-validated tool results; the model's own final text is not a source of facts
                                                     ▼
                { reply, toolCalls, recommendedPlaceIds, recommendations }
                                                     ▼
                  views/chat (cards, activity panel) · widgets/placesMap (markers, route)
```

The model chooses tools and arguments. What the user reads — places, distances, minutes, hours
status, sources and the «сгенерированная идея» markers — is built from tool results by
`formatReply.ts`. The map and cards render only places whose ids came back in a validated tool
result; the browser never reads the dataset.

## Retrieval

1. `resolve_location` maps a landmark phrase from the user's own message to a dataset place
   (`usecase/landmarks.ts` holds aliases only, never coordinates). A browser location, already
   rounded, takes precedence.
2. `find_places` embeds the query with `text-embedding-3-small` (256 dims) through the shared
   OpenAI client — only when `LLM_PROVIDER=responses`, `LLM_API_KEY` is set and `LLM_BASE_URL` is
   empty — and computes exact cosine similarity against `data/poi.vectors.json` in memory. In
   `mock`, with a third-party endpoint, stale vectors (the file carries the SHA-256 of `poi.json`)
   or an API error, it uses lexical scores instead and says so in `note`.
3. `rankPlaces` filters by walking radius, categories and accessibility and scores
   `0.40·semantic + 0.25·distance + 0.15·open + 0.10·popularity + 0.10·tags`, with small
   adjustments for notable places and diversity. Opening hours come from `hours.ts`, which parses
   OSM `opening_hours` in fixed UTC+5 and returns `unknown` rather than guessing.
4. `plan_walk` picks 1–3 stops within the total budget (walking plus visits) and measures each leg
   with A* over the committed OSM pedestrian graph. Snaps reach a path within 75 m; disconnected
   legs never fall back to a straight line, and a missing graph yields an explicit preliminary
   estimate with no navigation line. Steps are allowed: this is not wheelchair routing.

`places/repo/vectors.ts` reads the vector file from a fixed path — a path computed from an
environment variable makes the Next.js file tracer pull the whole project into the server bundle.

## Why two axes

The interface and the domain change for different reasons and at different rates, so there are
two structures and they meet at exactly one place, `src/app`.

- **Feature-Sliced Design for the interface** — `src/{app,views,widgets,features,entities,shared}`.
- **Tiered domain modules for the server** — `src/server/`, which is not an FSD layer.

## Directory structure

```
src/
  app/          Next.js routes and layouts; api/chat/route.ts. The only place both axes meet.
  views/        The FSD "pages" layer: the chat screen. Aliased @pages/*.
  widgets/      appShell, placesMap (MapLibre).
  entities/     place category groups shared by cards and map pins.
  shared/       ui/ (Radix-based controls), lib/ — no domain knowledge.

  server/       Not an FSD layer.
    kernel/     Context (ctx.now), environment, errors. Depends on nothing.
    agent/      model/agent.schema.ts (chat contract); usecase/ — loop, tools, prompt, mock, reply.
    places/
      model/    places.schema.ts (frozen contract), walking schemas, pure algorithms. No I/O.
      repo/     Read and validate data/*.json, cached per process.
      usecase/  findPlaces, planWalk, resolveLocation, getPlace, semantic search, landmarks.

scripts/        collect.ts, collectWalking.ts, embed.ts, scenarios.ts, check.mjs, standalone prep.
data/           poi.json, poi.vectors.json, walking-graph.json and their summaries.
```

`src/pages/` must never exist — Next.js would activate the Pages Router for it.

## The FSD axis

Imports go strictly downward: `app → views → widgets → features → entities → shared`. A slice's
`index.ts` is its public API; there is no `index.ts` inside a segment (`ui/`, `api/`, `model/`).

## The server tiers

```
kernel  →  <domain>/model  →  <domain>/repo  →  <domain>/usecase
```

- A **repo** never imports another domain's repo. Cross-domain work belongs in a usecase.
- Every file starts with `import 'server-only'`, except `*.schema.ts`, which the interface imports
  and which therefore depends on nothing but Zod.
- No barrels. Deep imports only.
- Operations are plain functions `(ctx, input)`. `ctx.now` is injected; `createCtx()` is the only
  place that calls `new Date()`, so every rule decided against the clock is testable.
- The FSD layers never import a `repo`; `src/server/**` never imports React, Next or the FSD layers.

## Validation and errors

All external input is validated on the server: the chat request, and every tool's arguments —
they are a language model's free text — through `defineTool`. `DomainError` carries a `kind`
rather than a class hierarchy. Provider and tool error messages are logged as a category only and
never returned to the browser: they can carry an endpoint, a model name or part of a key.

## Privacy

Coordinates are rounded to 3 decimals (~100 m) in the browser and again in `chatRequestSchema`.
They are not logged, cached or written anywhere. In a live mode the rounded point and the user's
text go to the configured model provider; in `mock` nothing leaves the machine.

## Testing and the gate

```
pnpm check                   # typecheck, lint --max-warnings 0, unit tests — in parallel
```

Warnings count as failures. The structural guards (`rawControls.spec.ts`, `globals.spec.ts`) read
the source tree, because the failures they catch pass code review. **Any rule, check or hook you
add must be watched failing** before it is trusted. `pnpm scenarios` replays the case scenarios
over HTTP against a running app and fails on a contract violation.

## Avoid

- Storing a number that summarises a history; compute it from the rows.
- Optimising for scale the product has not reached.
- Adding a dependency that solves a problem you do not yet have.
