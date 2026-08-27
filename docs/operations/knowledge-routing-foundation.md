---
title: "Knowledge Routing Foundation"
summary: "Generated route metadata layer for finding OpenClaw sources of truth without copying their contents."
---

# Knowledge Routing Foundation

The knowledge-routing foundation answers one question: where should an agent look
for the smallest authoritative source needed by the current task?

It is not a knowledge warehouse. Source code remains in Git worktrees, runtime
truth remains in live services and config, durable state remains in state
stores, document bodies remain in documents and indexes, and evidence remains in
its owning evidence system.

## Runtime Entry Points

- Public summary: `GET /api/knowledge-routing/summary`
- Protected route resolver: `GET /api/knowledge-routing/route?query=<need>`
- Protected graph metadata: `GET /api/knowledge-routing/graph`
- Protected generated maps: `GET /api/knowledge-routing/maps`
- Operator refresh: `POST /api/knowledge-routing/refresh`
- CLI refresh: `npm run knowledge-routing:refresh --prefix orchestrator`

The resolver returns recommended route nodes, authoritative source locators,
relationship edges, freshness requirements, retrieval methods and verification
sources. It does not return full documents, source bodies, logs or transcripts.

## Canonical Model

The schema lives in `orchestrator/src/knowledge-routing/types.ts`.

Nodes represent stable routing targets such as repositories, services, agents,
skills, plugins, APIs, document indexes, databases, cron registries and memory
indexes. Edges represent navigation relationships such as `configured_by`,
`implemented_by`, `stores_state_in`, `documented_by`, `observed_by` and
`retrieved_by`.

Each node records:

- source locator and resolver
- authority class and priority
- freshness mode
- load policy
- verification target
- deterministic provenance
- generated/stale/review metadata

## Discovery Adapters

Deterministic adapters live in `orchestrator/src/knowledge-routing/discovery.ts`.
They currently enumerate:

- Git repositories and worktrees
- OpenClaw and operator configuration
- configured agents and plugins
- skill roots
- documentation indexes and configured document roots
- SQLite state stores and schemas
- systemd services
- OpenAPI route metadata
- memory index files
- cron registry files

The adapters produce normalized route candidates. They do not ask an LLM whether
a file, service or database exists.

## Semantic Stage

`orchestrator/src/knowledge-routing/semantic.ts` supports AI-assisted
classification or relationship proposals, but proposals are accepted only when:

- both endpoint nodes exist
- the relationship is allowed by the canonical schema
- source evidence is provided
- the confidence/review policy is explicit

Unvalidated proposals are rejected rather than persisted.

## Authority And Freshness

Authority is stored per node, not as one global ranking. Current/live sources
are preferred for current-state questions:

- systemd/live runtime for service status
- current config for model, agent, plugin and path configuration
- Git worktrees for implementation source
- SQLite schemas/state stores for durable state ownership
- OpenAPI/source route metadata for API navigation
- document indexes for document navigation, not runtime proof
- memory for historical decisions and context, not present-state truth

If route metadata conflicts with the authoritative source it points to, the
source wins and the route should be refreshed or marked stale.

## Stale Route Detection

`orchestrator/src/knowledge-routing/graph.ts` marks nodes stale when file,
directory or Git locators disappear or change type. It marks edges stale when
their source or target node is missing.

Generated nodes can be repaired by deterministic rediscovery. Semantic or
authority changes require the owning review policy rather than silent invention.

## Generated Views

`orchestrator/src/knowledge-routing/views.ts` generates Mermaid projections from
the canonical graph:

- system map
- runtime map
- knowledge-source map
- repository map
- agent-capability map
- skill map
- plugin map
- state-store map
- verification map

These are views, not independently maintained maps.

## Growth Path

The routing runtime refreshes on startup and periodically every 15 minutes
outside fast-start mode. It can also refresh on demand through the protected API
or CLI.

When a new deterministic source appears, the corresponding adapter should add a
small route node and validated edges. Add or extend adapters in
`orchestrator/src/knowledge-routing/discovery.ts`, then cover the source and
stale-route behavior in `orchestrator/test/knowledge-routing.test.ts`.

Do not create nodes for every log line, transcript message, metric sample,
source-code symbol, test assertion or database row unless a routing requirement
proves that granularity is needed.
