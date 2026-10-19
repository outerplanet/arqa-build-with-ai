# Working in this repository

This is the rulebook for anyone working here, human or agent. **Codex and Claude Code both read
this file** — `CLAUDE.md` is a pointer to it — so that two agents editing the same repository at
speed are following one set of rules rather than two.

Read this before writing code. Then read the doc that covers what you are touching:

- `docs/architecture.md` — the two axes, the server tiers, transactions, migrations, testing
- `docs/design-system.md` — tokens, palette, type, space, motion
- `docs/ui-patterns.md` — which control a task gets, how forms and tables behave
- `docs/plan.md` — the scenario, the contract, which lane you are in, and a ready prompt for each
  lane. Re-read it after every pull.
- `docs/team-guide.md` — how the non-developer teammates work with their orchestrator. Keep your
  behaviour consistent with it.
- `docs/case.md` — the task, word for word in substance. `docs/kickoff.md` — deadlines, what is
  submitted, the judging criteria and the submission checklist.

If the implementation conflicts with these documents, **stop and name the conflict** rather than
silently inventing behaviour.

---

## What this repository is

**«Прогулки по Астане»** — a RAG city-walk assistant for the Build with AI 2026 hackathon (AI for
Smart City section). A user says where they are and what they want; the agent searches a dataset
of Astana places collected from OpenStreetMap and Wikidata, and answers with 1–3 places, each with
why, how long, what to do there, its source and an honest opening-hours status. The places appear
on a map.

It is built on a pre-existing starter (disclosed in the README): an agent loop, a tool registry, a
chat interface that shows the agent's work, a component library and a design system. **The
product's tools go beside `get_current_time` in `TOOLS`**, and the scripted branches of the mock
adapter drive the six scenarios in `docs/scenarios.md`.

---

## The gate

```bash
pnpm check
```

One command, three tasks in parallel — typecheck, lint at `--max-warnings 0`, and the unit suite.
**Warnings are failures.** A change is not finished until this passes. Output is buffered per task
and printed in a fixed order, because three processes writing to one terminal interleave into
something nobody can read. `pnpm verify && pnpm test` still works and does the same thing serially.

Measured: about 6.1s parallel against 7.1s serial on a warm cache. Lint is roughly three quarters
of that and the processes contend for CPU, so parallelising is worth a second, not a revolution.

**The real lever is not running the whole gate every time.** While iterating, run the one spec that
covers what you are changing — `pnpm vitest run src/server/agent/usecase/tools.spec.ts` — and run
`pnpm check` once, at the end of a batch of related edits, before you commit. A vitest process
costs about 1.5s to start before it asserts anything, so the cost of a check is dominated by how
often you run it, not by how long it takes.

### Spend round trips, not caution

The full gate takes seconds. **The cost is round trips**, so cut those and never cut a check.

- Batch independent commands into one call. Read the set of files, not one at a time.
- Write files with the file tools. Editing source through a heredoc stacks two more layers of
  escaping on top of the language's own — and on Windows it will silently write CRLF and light up
  three hundred lint warnings.
- When the browser disagrees with the source, suspect the build. Stop the dev server, delete
  `.next`, start it again. Never delete `.next` while it is running.
- Verify CSS by computed style, not by screenshot. A screenshot of a stale stylesheet looks fine.

### Lessons from the previous hackathon — each one cost real time

- **Never write or edit a file through PowerShell `Set-Content`, `Out-File`, `>` or a heredoc.**
  On this machine it turned Cyrillic into mojibake (`â€”`) in three files. Only the agent's file
  tools. If it happened: restore the file from git and redo the edit with the file tools, then grep
  the repository for `â€`.
- **A finished agent worktree is removed** — `git worktree remove <path>`. A worktree left under
  `.claude/worktrees` is picked up by `eslint .` and turns everybody's gate red.
- **Before submitting, clone into a fresh directory and follow the README literally** — install,
  data, check, build. Things that work on the author's laptop fail on a clean one.
- **Remove what the product does not use** — packages, scripts, config. Dead weight shows up in
  the disclosure table and in the questions.
- **Every teammate's commit is reviewed by a subagent** before the lead builds on it: correctness
  against the contract, the case's hard requirements, tests that actually assert.
- **Interface text is Russian, everywhere**: buttons, aria labels, empty states, errors, the
  activity panel. English left in a corner of the screen is the thing the jury notices.

---

## What you learn goes in the repository, not in your memory

**Anything worth knowing tomorrow is written into a file and committed.** An agent's own memory —
Claude Code's `~/.claude` store, Codex's equivalent — is on one laptop, for one tool, for one
person. Four people and two different agents are working here. Knowledge that lives in a private
store is knowledge the other participants do not have, and it is invisible to the jury who read
this repository afterwards.

So when you discover something durable, write it down here and commit it:

| What you learned | Where it goes |
| --- | --- |
| A rule about how we work | this file |
| A decision and why it was taken | `docs/decisions.md`, newest entry last |
| How the product is shaped | `docs/architecture.md` |
| Something a reviewer must know to run it | `README.md` |
| Something that will trip up the next change to a file | a comment in that file |

`docs/decisions.md` is the one to reach for when nothing else fits — a timed line saying what was
chosen and what it was chosen over is worth more near the deadline than a perfect memory of the
reasoning that nobody else can read. A written decision is also a demonstrable result.

---

## Architecture rules

1. The code has two axes. **Feature-Sliced Design for the interface** — `src/{app,views,widgets,
   features,entities,shared}`, importing strictly downward. **Tiered domain modules for the
   server** — `src/server/`, which is not an FSD layer.
2. Inside `src/server/` the tiers are `kernel` → `<domain>/model` → `<domain>/repo` →
   `<domain>/usecase` → `jobs`. Imports go only downward. A `repo` never imports another domain's
   `repo`; cross-domain work belongs in a `usecase`. A usecase lives in the domain of the data it
   primarily writes.
3. `src/pages/` must never be created: Next.js would treat it as the Pages Router. The FSD "pages"
   layer is `src/views/`, reached through the `@pages/*` alias.
4. Every file in `src/server/` starts with `import 'server-only'` — except `*.schema.ts`, which the
   interface is allowed to import and which may therefore depend on nothing but zod. No barrels in
   `src/server/`: deep imports only, because a barrel re-exporting siblings generates cycles.
5. The FSD layers never import `src/server/*/repo`. `src/server/**` never imports React, Next, or
   anything from the FSD layers. Only `src/app/**` and `features/*/api` may import a usecase.
   Components never read the data files.
6. Domain operations are plain functions with the signature `(ctx, input)`. `ctx` is always first.
   `ctx.now` is injected; `createCtx()` in `src/server/kernel/ctx.ts` is the only place allowed to
   call `new Date()`.
7. Validate all external input on the server. **Tool arguments are external input** — they are a
   language model's free text. `defineTool` validates them for you; do not bypass it.
8. Never store a number that summarises a history — a remaining balance, a count, a derived expiry.
   Compute it from the rows. A stored summary is a future migration plus a backfill, and in the
   meantime a number that disagrees with the events beneath it.
9. Never expose provider tokens or database credentials to the browser. A provider's error message
   can carry an endpoint, a model name or part of a key: log it, never return it.
10. **There is no database.** The places are a static, committed file (`data/poi.json`, rebuilt by
    `pnpm collect`) read synchronously and cached by `src/server/places/repo`. Nothing about the
    user is stored: their coordinates are rounded to 3 decimals (~100 m) in the browser and again
    on the server, and never logged or written anywhere.
11. Avoid adding dependencies — `package.json` belongs to the lead; ask. Do not optimise for
    theoretical scale before the product works for one user.

Duplication in the interface is tolerated — extract to `widgets/` or `features/` only when a second
consumer genuinely exists. Duplication in `src/server/` is not: two implementations of the same
rule means two different answers to the same question.

### Stack

Next.js (App Router) + React + TypeScript · Tailwind · Radix UI primitives · Heroicons · Zod · the
OpenAI SDK (Responses API, embeddings) · MapLibre GL with OpenFreeMap tiles · data from
OpenStreetMap (Overpass API) and Wikidata. Route Handlers for the chat.

**Data sources are OpenStreetMap and Wikidata only.** Never scrape Google Maps, 2GIS, Yandex or
any service whose terms forbid it. OSM data is ODbL: the attribution «© участники OpenStreetMap»
is visible on the map and in the README.

Do not introduce a second backend framework, microservices, GraphQL, Kubernetes, Redis, Kafka, a
monorepo, a vector database or a separate frontend application. Do not use shadcn/ui or any kit
that copies component source into the repository — build on Radix with Tailwind classes.

**`tsconfig.json`, `eslint.config.js` and `.prettierrc` are owned by the repository owner.** Do not
create, overwrite or "fix" them. If a config file is missing, say so and stop.

---

## Design rules

Follow `docs/design-system.md` and `docs/ui-patterns.md`. The ones that are easy to break:

- Semantic tokens only (`bg-surface`, `text-fg-muted`, `bg-accent`). Never a raw palette value,
  never a hard-coded colour.
- The dark theme is defined once, in `src/app/globals.css`. No component contains a dark-mode
  colour. Every colour has its light definition on bare `:root`.
- No web fonts from a foreign CDN. Fonts come through `next/font`.
- Prefer a border to a shadow in the light theme.
- Every list surface ships loading, empty and error states, and the skeleton matches the real
  layout including its width.
- Status is never colour alone.
- No raw `<input>`, `<select>` or `<textarea>` in the screen layers — every control comes from
  `src/shared/ui/`, and a test enforces it.
- Nothing writes on `change`. A control edits a draft; a button writes it.
- A form is never a modal. A modal is for confirming something that takes away.

---

## Agent rules

These are about the product being an agent, and they are the ones a reviewer will try to break.

1. **Never claim an action happened unless a tool returned a result saying so.** Enforce it in the
   prompt *and* in the code. A rule that exists only in the prompt is a rule the model can talk
   itself out of.
2. **Never call a destructive tool without an explicit confirmation in a separate user message.**
   Showing what you are about to do is not confirmation.
3. **A tool handler re-checks its own preconditions.** The model is not the authority on whether an
   action is allowed; the rules are. A refusal is a successful tool call reporting a refusal.
4. **`executeTool` never throws.** A throw kills the turn and blanks the activity panel — the one
   thing an audience is looking at. A failing tool is a row that says "failed".
5. **Keep `LLM_PROVIDER=mock` working.** It is how the product is demonstrated with no network, and
   how a reviewer verifies it without being handed a key. When you change the tools, update the
   scripted branches. It runs the real dispatcher, so it stays honest by construction.
6. **The activity panel shows what the server reported it did**, never what the interface guessed it
   would do. The same holds for the map: markers and routes come from tool results only.

The case adds rules of its own — the jury checks them in every answer:

7. **Every recommendation names its source**: OpenStreetMap, Wikidata, or «сгенерированная идея».
   Anything the model says that is not in a tool result is marked as generated.
8. **Never say a place is open unless `open.status` is `'open'`.** Unknown hours are said out loud:
   «часы работы неизвестны — уточните перед выходом». The model never infers hours from a category.
9. **Say what was used**: the location and where it came from (browser or the user's words), and
   the filters applied. If there is no location at all, ask for it instead of guessing.
10. **The answer shape is the case's**: 1–3 places, each with distance and minutes on foot, why,
    time to spend, and what to do there. Short and concrete beats long.

Adding a tool is one object in `TOOLS` — see the README. The JSON Schema is derived from the zod
schema; never write it twice.

---

## Definition of done

Not when the screen looks correct. When:

- the behaviour is correct and validated on the server,
- loading, error and empty states exist,
- important edge cases are covered by tests,
- typecheck, lint and tests pass,
- **any rule, check or hook the change adds has been watched failing.** Break it on purpose first,
  then fix it back. A check that was never seen failing is a check that tests nothing.

When fixing a bug, first reproduce it and identify the violated invariant. Do not patch symptoms
with UI-only state.

---

# Competition rules — Build with AI 2026, AI for Smart City

The details — deadlines, what is submitted, the criteria, the checklist — are in
`docs/kickoff.md`; the task is in `docs/case.md`. Where they and the organiser's documents
disagree, the documents win.

**The shape of it:** the solution is uploaded to the organiser's form by **19 October, 23:59**
(we submit by 23:30). The top 10 per section are selected on 20–21 October and pitch in person at
AITU on 22 October. What is submitted: a public repository, a 5–7 minute presentation as PDF, a
document of test scenarios and limitations, and a demo video on YouTube (unlisted). The jury
mostly sees the video and the documents, so **the six scenarios in `docs/scenarios.md` answering
well is worth more than anything else in this repository.**

The section has no tool restriction (the Google-only rule belongs to the other section). Teams of
up to four.

What holds regardless:

1. **This starter is a pre-existing template and is disclosed as one.** It contains no task
   functionality. The disclosure section in the README is not optional.
2. **The product functionality is built during the event.** Do not paste a previously built
   solution to the task.
3. **Disclose every third-party component** — open source, models, datasets, templates.
4. **The main scenario is verifiable without anybody's personal keys.** That is what
   `LLM_PROVIDER=mock` is for.
5. **The README lets a stranger run it**: what it does, architecture, technologies, install, run,
   environment variables, how the data is collected, and how to check the scenarios. Keep it true
   as you go.
6. **The dataset is collected by our own automated script** (`pnpm collect`) — the case requires
   it. Never hand-edit `data/poi.json`; fix the script and re-run it.
7. **No keys in the repository.** The OpenAI key lives in `.env` only and is handed to teammates in
   person.

**Every member commits their own lane under their own git identity.** Distinct commit authors are
the easiest evidence of who did what; the other evidence is each person being able to explain and
demonstrate their own work. Pair work takes a `Co-authored-by:` trailer.

**Do not gold-plate.** Juries score the scenario and the demo, not the architecture. The activity
panel is worth real points under presentation: it makes "agentic" visible in a way a chat bubble
cannot.

---

## Working in parallel

Several agents and several people in one repository against a deadline collide unless paths have
owners. One owner per path; if you need a file you do not own, say so rather than editing it. The
full lanes, with tasks and ready prompts, are in `docs/plan.md`.

| Path | Owner | Why them |
| --- | --- | --- |
| `src/server/places/model/places.schema.ts` | **Саян, first, then frozen** | The contract everyone builds against; written once, by the lead, before anything else. |
| `src/server/places/usecase/**`, `src/server/agent/**`, `src/app/api/**` | Саян | Tools, prompt, mock and the loop belong together, with the person who integrates. |
| `package.json`, `pnpm-lock.yaml`, `README.md`, `docs/plan.md`, `docs/decisions.md` | Саян | One owner for files everybody would otherwise conflict on. |
| `src/server/places/model/{geo,hours,lexical,rank,route}.ts` | Абылай | Distances, opening-hours parsing, ranking and the walk planner are pure algorithms with tests — a competitive programmer's ground. |
| `scripts/collect.ts`, `scripts/embed.ts`, `data/**`, `src/server/places/repo/**` | Адиль | He knows datasets: collection, cleaning, quality and the vectors. |
| `docs/scenarios.md`, `docs/presentation*` | Адиль | He knows what the data can and cannot answer, so he writes the scenarios and limitations. |
| `src/views/**`, `src/widgets/**`, `src/app/page.tsx`, `src/app/layout.tsx`, `src/app/globals.css` | Ораз if he takes part; otherwise a separate orchestrator on a fourth laptop that Саян starts with the «Экран» prompt | The screen: chat, map, cards. |

Nobody types code by hand: **each laptop runs one Claude Code orchestrator** started with the
lane's prompt from `docs/plan.md`; it splits the work across subagents in worktrees, merges,
reviews, commits and — when asked — pushes. See **One orchestrator per laptop** below. The person
directs, checks the result in the browser, and decides.

The schema file is the contract. Write it first, then everyone works against it in parallel. If it
has to change, change it once, in one place, and say so — two people quietly adapting to each
other's drift is how an hour disappears.

### Every plan is split into lanes

Several people, several laptops, an agent on each. The agents share nothing but this repository, so
**the plan lives in `docs/plan.md`**, and every agent reads it before starting work and again after
every pull. It is written once at the start by the lead's agent from the task, and changed only by
the lead.

When you are asked to design the architecture or make a plan, write it into `docs/plan.md` in the
shape that file already has, and hold it to these rules:

1. **One lane per person**, taken from the ownership table above. A lane lists the paths it owns,
   its tasks in order, what it depends on, and what "done" looks like.
2. **No path appears in two lanes.** If two lanes need the same file, the plan is wrong — split
   the file or give it one owner and make the other lane a request.
3. **The contract comes first and is small.** The schema, the tool names with their arguments and
   return shapes, and the repo function signatures. It is frozen early.
4. **Every lane can start immediately.** Anything a lane depends on that does not exist yet gets a
   stub with the real signature — a repo function returning fixture data, a tool returning a
   hard-coded result, a screen rendering the schema's example. Nobody waits on anybody.
5. **Integration points are named**: which lane's output meets which lane's input, in which file,
   and by what hour.
6. **Each lane has something committable at every checkpoint.** The checkpoint table in the plan
   says what.
7. **Features are cut across lanes, not within them.** A feature that needs three lanes is
   three tasks, one per lane, against the same contract — not one task that one person carries
   through three layers.

When you are working inside a lane, you work only in that lane's paths. If you need a change in a
path you do not own, add a line under **Requests** in `docs/plan.md` and tell your person; do not
make the edit.

### Git, with four people and several agents

- **Everyone commits to `main`.** No feature branches between people: paths are disjoint, and a
  branch is merge time a hackathon does not have.
- **`git pull --rebase` before every push. Push at least every thirty minutes**, small commits.
  A push that waits two hours is a conflict that waits two hours.
- **Stage your own paths by name** — `git add src/server/<domain>/repo` — not `git add -A`, which
  sweeps up whatever another agent on the same laptop left half-written.
- **The orchestrator pushes only when its person asks** («синхронизируй»): `git pull --rebase`,
  `pnpm check`, then `git push`. Commits carry the person's git identity, so authorship stays
  theirs. **Never force-push, never amend or rebase anything already pushed**, never push with a
  red gate. Subagents never touch git remotes.
- **A conflict in a path you do not own: take theirs.** In your own path: keep yours and re-run
  `pnpm check`.
- **`package.json` and `pnpm-lock.yaml` belong to the lead.** A lockfile conflict is unreadable.
  Need a dependency — ask; do not add it.
- **Pull before you start a task, and have your agent re-read `docs/plan.md` after the pull.**
- **Set your git identity once per laptop** before the first commit — `git config user.name` and
  `git config user.email` with the address on your GitHub account. A commit under somebody else's
  name is evidence of the wrong person's work.

### One orchestrator per laptop, subagents in worktrees

**The teammates are not developers.** Each of them talks to exactly one Claude Code session — the
**orchestrator** — and never runs git, worktrees or merges by hand. The orchestrator does all of it:

1. **Split the lane** into 2–3 independent tasks with disjoint files, taken from the lane in
   `docs/plan.md`.
2. **Run each task as a subagent with `isolation: "worktree"`**, in parallel. A subagent works only
   in its task's files, runs the relevant specs, and commits on its worktree branch. It never
   pushes and never touches another lane's paths.
3. **Merge each finished worktree** into `main` in the main working copy, then **remove the
   worktree** (`git worktree remove`, and delete its branch). A worktree left under
   `.claude/worktrees` is picked up by `eslint .` and turns the gate red for everyone.
4. **Review before trusting it**: a separate review subagent checks the merged work against the
   contract in `docs/plan.md`, the case's hard requirements (`AGENTS.md`, agent rules 7–10) and
   whether the tests actually assert. Fix what it finds.
5. **`pnpm check` green, then commit** the lane's paths by name.
6. **Report to the person in plain Russian**, without jargon: what now works, what to open in the
   browser or which command to run to see it, and what comes next. If the person must decide
   something, ask one clear question with a recommended answer.

Two agents working directly in one working copy see each other's half-written files and commit
each other's changes — that is why every parallel task goes through a worktree. If a worktree
needs `.env`, the orchestrator copies it there; `.env` is never committed.

When the person says «синхронизируй», the orchestrator pulls with rebase, resolves conflicts in its
own lane's paths (in another lane's path it takes theirs), runs `pnpm check`, and pushes. When the
person pastes an error, the orchestrator diagnoses it before changing anything.

**Someone new to the stack gets the bounded, well-specified, testable tier** — not less work. A repo
function with a frozen signature and a spec is the safest thing to hand anybody working in an
unfamiliar stack under time pressure. Write those signatures into the schema early so nobody is
blocked on someone else's file.

---

## Language

**Prompt your agents in whatever language you think fastest in.** Russian is fine — Claude and
Codex both follow Russian instructions without measurable loss, and most of the technical nouns are
English loanwords anyway. Do not translate your thinking into English before prompting; that is
wasted time and it loses nuance.

**Code stays in English.** Code, identifiers, comments, commit messages, and the technical docs
(this file, `docs/architecture.md`, `docs/design-system.md`, `docs/ui-patterns.md`). A codebase
that is half Russian and half English is one an agent follows inconsistently — it mirrors whatever
language the surrounding lines are in.

**Everything people and the jury read is in Russian**, decided deliberately:

- `README.md`, `docs/case.md`, `docs/kickoff.md`, `docs/plan.md`, `docs/decisions.md`,
  `docs/scenarios.md` and the presentation. The jury is in Astana and two teammates are new to the
  codebase.
- **The interface** — every visible string and every aria label. Product text the model writes
  (answers, notes in tool results meant for the user) is Russian too.
