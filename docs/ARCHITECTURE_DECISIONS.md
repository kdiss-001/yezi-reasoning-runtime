# Architecture Decisions

## 2026-06-12: Main/Planner Responsibility Boundary

### Product Goal

The runtime reduces attention pressure on the main API by moving preset COT interpretation and
coordination into an independent planner API. It does not disable model reasoning and does not
replace the main API as the RP author.

### Fixed Responsibility Split

The planner API is subordinate to the main API.

Planner responsibilities:

- cover every enabled module through deterministic routing;
- execute and reconcile planner-routed global memory, continuity, knowledge-boundary, state, and
  cross-module consistency work;
- organize established facts, memory evidence, knowledge boundaries, character state, and
  continuity constraints;
- compile those results into a compact support packet;
- identify sourced conflicts and uncertainties;
- remain hidden from chat history and native reasoning display.

Planner prohibitions:

- do not write RP正文, dialogue, narration, or assistant prefill;
- do not decide the final plot progression, ending, or exact character actions;
- do not prescribe sentence-level realization;
- do not treat suggestions as mandatory plot commands;
- do not impersonate the main API or expose its private planning as native reasoning.

Main API responsibilities:

- retain final authority over plot progression and character performance;
- perform the local reasoning needed for RP: immediate reactions, dialogue, movement, pacing,
  description, and natural scene transitions;
- realize the response from the support packet and the shared context;
- return the visible正文 and, when supported, its own native reasoning.

Main API prohibitions:

- do not receive or re-execute planner-routed COT after planner success;
- do not audit modules one by one or repeat the planner's rule-coordination work;
- do not expose the planner packet as正文 or explain that it is following an external plan.

### Meaning Of Externalized Reasoning

Externalized reasoning means that the planner fully handles the modules explicitly routed to global
constraint compilation. It does not mean moving style, formatting, local dramatic reasoning, or all
model thought outside the main API. The main API continues local RP reasoning while retaining plot
authority.

### Runtime Order

```text
User input
  -> normal SillyTavern and memory-extension processing
  -> finalized main-request context
  -> runtime pauses the main request
  -> clone the finalized context for the planner API
  -> adapter routes every enabled module
  -> planner executes planner-routed global reasoning modules
  -> runtime validates a subordinate support packet
  -> runtime removes only successfully externalized planner module ranges
  -> runtime preserves writer-facing and context modules
  -> runtime injects the support packet
  -> main API performs RP reasoning and writes the actual response
```

The awaited `CHAT_COMPLETION_SETTINGS_READY` event allows the main request to wait for the planner
without changing SillyTavern core.

### Memory Modes

The first product design exposes two user-selected modes. They are normally mutually exclusive.

#### Summary Memory Mode

- The user's manual or extension-generated long summary remains in the normal final context.
- Both planner and main API see the same summary and post-summary recent context.
- The runtime does not invent a second memory database.

#### SP Database Mode

- SP Database remains unmodified and follows its normal storage, plot-task, AM selection, worldbook
  expansion, and post-response table-update flow.
- SP Database does not need to know whether the response path uses one API or two.
- The runtime intercepts only after SP and SillyTavern have assembled the finalized request.
- Both planner and main API therefore see the same AM memory already expanded into that request.
- The planner call uses the dedicated server-plugin route and must not emit SillyTavern generation
  events, create chat floors, rerun SP, update tables, or trigger another AM recall.
- Existing SP plot guidance is treated as upstream context. The planner may organize and reconcile
  it with preset COT, but may not silently replace SP's workflow or mutate its data.

No SP source patch, settings rewrite, table mutation, worldbook mutation, or arbitrary SQL access is
part of the compatibility design.

### Support Packet Contract

The packet conveys evidence and boundaries, not a prewritten scene:

```json
{
  "protocolVersion": 2,
  "requestId": "uuid",
  "contextHash": "hash",
  "packet": {
    "moduleCoverage": [],
    "evidence": [],
    "constraints": [],
    "conflicts": [],
    "uncertainties": []
  }
}
```

Contract semantics:

- every evidence or constraint record cites valid message, module, or provider-state sources;
- evidence declares `confirmed`, `inferred`, or `uncertain` certainty;
- constraints declare `hard` or `soft` strength;
- there is no planner-authored正文, dialogue, plot-development, or planned-action field;
- the main API chooses what actually occurs within established facts and hard boundaries;
- `moduleCoverage` proves that enabled COT modules participated without forwarding their full text
  to the main API;
- `contextHash` prevents reuse against a different finalized context.

### Failure And Atomicity

- The live request is not modified until the complete planner response passes validation.
- On timeout, cancellation, provider failure, invalid JSON, schema failure, incomplete module
  coverage, or unsafe COT extraction, the original request is sent unchanged.
- Original COT removal and support-packet injection are one atomic transformation.
- A partial result must never leave the main API without either the original COT or a valid packet.

### New Preset Research Rule

Agent-based presets are read-only architectural references. Analysis must separate:

1. prompt/module inventory;
2. agent roles and authority;
3. call graph and call count;
4. context and memory passed to each call;
5. intermediate output contracts;
6. how information reaches the final正文 call;
7. recursion, failure, and cancellation behavior;
8. mechanisms worth adapting versus mechanisms that would steal plot authority from the main API.

High call count is evidence about decomposition, not a default implementation target. The runtime
still prefers one planner call plus one main call unless the reference demonstrates a necessary
capability that cannot be represented in the support packet.

## 2026-06-12: Deterministic Module Routing And Packet V2

The earlier phrase "externalize all COT" was too broad. Every enabled module participates in routing,
but only global memory, continuity, knowledge-boundary, state, and cross-module consistency work is
executed by the planner. Style, format, language, POV, length, local RP, and output-template
instructions remain direct main-model inputs.

Mixed legacy entries must be split by a trusted adapter. The planner cannot choose its own authority.
Unknown categories fail closed.

Support Packet V2 replaces free-form string arrays with sourced records. Evidence carries certainty;
constraints carry strength; all items cite valid message, module, or state-provider references. The
packet has no plot-development or planned-action field. Protocol version, request ID, context hash,
module coverage, exact fields, and source references are validated on both sides.

See `docs/MODULE_ROUTING_PROTOCOL.md`.
