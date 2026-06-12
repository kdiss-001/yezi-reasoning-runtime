# Module Routing And Support Packet Protocol

## Purpose

The runtime does not send every enabled preset module to the planner as an undifferentiated COT
block. Every module participates in deterministic routing, but only global reasoning modules are
executed by the planner. Writer-facing instructions remain available to the main API.

This avoids two failure modes:

- asking the main API to execute the same global COT a second time;
- letting the planner take control of prose, immediate actions, or plot progression.

## Routing Categories

### Planner Route

These categories compile cross-context state and constraints:

- `global-memory`
- `continuity`
- `knowledge-boundary`
- `character-state`
- `relationship-state`
- `scene-state`
- `cross-module-consistency`

Only safely located planner-routed modules may be removed from the final main request after a valid
packet is returned.

### Main Route

These categories remain direct instructions for the main writer API:

- `style`
- `format`
- `language`
- `pov`
- `length`
- `local-rp`
- `output-template`

The planner records these modules as preserved but does not execute, summarize, replace, or remove
them.

### Context Route

`context-evidence` is descriptive input rather than an executable instruction. It may inform sourced
planner findings but is never removed as completed COT.

## Adapter Rule

Routing is determined by adapter metadata, not by an LLM guessing from a prompt name. A legacy entry
that mixes continuity analysis, prose style, and output formatting must be split into multiple stable
module records before execution. Unknown categories fail closed.

Each normalized module has:

```json
{
  "id": "continuity-1",
  "label": "Continuity check",
  "category": "continuity",
  "route": "planner",
  "instruction": "Compile established continuity constraints.",
  "sourceRef": "preset:continuity-1",
  "removable": true
}
```

The runtime derives `route` from `category` on both client and server. A client cannot relabel a style
instruction as planner-owned or mark a main-routed module removable.

## Support Packet V2

The planner returns only:

```json
{
  "moduleCoverage": [],
  "evidence": [],
  "constraints": [],
  "conflicts": [],
  "uncertainties": []
}
```

`moduleCoverage` must contain every routed module exactly once:

- planner route: `compiled`
- main route: `preserved`
- context route: `observed`

Evidence records contain `id`, `kind`, `text`, `sourceRefs`, and `certainty`. Certainty is one of
`confirmed`, `inferred`, or `uncertain`.

Constraint records contain `id`, `kind`, `text`, `sourceRefs`, and `strength`. Strength is `hard` or
`soft`.

Conflicts and uncertainties contain an ID, concise text, and source references. The protocol has no
field for planned actions, plot beats, dialogue, draft prose, style rewriting, or assistant prefill.
Unknown fields are rejected.

## Source Binding

Every substantive packet item must cite one or more sources already present in the planner job:

- `message:<index>`
- `module:<id>`
- `state:<provider-id>`

References that do not exist in the finalized context, routed module set, or provider registry fail
validation. Source binding cannot prove that a model interpreted evidence correctly, but it prevents
unsupported statements from arriving without an auditable origin.

## Request Binding

The frontend fingerprints context, modules, and provider state. The server recomputes that fingerprint
before calling the provider and returns it with the packet. The frontend rejects envelopes whose
protocol version, request ID, context hash, module coverage, sources, or schema do not match the
paused main request.

## Main Injection

Only evidence, constraints, conflicts, and uncertainties are injected. Coverage metadata is retained
for validation and diagnostics but omitted from the main prompt. The injection explicitly preserves
main-model authority over plot, immediate reactions, pacing, dialogue, and prose.

The legacy adapter must eventually perform one atomic operation:

1. remove only successfully externalized planner modules;
2. preserve all main and context modules;
3. insert the validated packet.

Until the adapter can identify exact source ranges safely, the runtime must not claim that duplicate
COT execution has been eliminated.

