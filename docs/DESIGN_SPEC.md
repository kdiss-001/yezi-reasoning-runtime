# Design Specification

## 1. Problem

The current preset combines heterogeneous COT requirements into one large textual reasoning block. Those requirements include character knowledge boundaries, agency, relationship logic, scene physics, style planning, anti-repetition, output ordering, and validation. As the module set grows, the main model is asked to parse, execute, and often display all of it through one `<thinking>` channel.

The project will change the execution model rather than manage module quantity.

## 2. Target Architecture

```text
User generation
  -> SillyTavern prompt assembly
  -> memory/vector/world-info/extension injection
  -> finalized Chat Completion request
  -> Reasoning Runtime interception
       -> clone context
       -> collect COT specification
       -> collect MVU/hidden state providers
       -> independent planner API
       -> validate structured result
  -> inject compact execution result into original request
  -> main API generation
  -> native SillyTavern reasoning display + visible正文
```

The planner and main model may use different providers, endpoints, models, token limits, and sampling settings.
The planner is a subordinate COT runtime. The main model retains final authority over plot progression,
character performance, visible正文, and the local reasoning needed to realize them.

## 3. Components

### Frontend Extension

- Settings UI and connection status.
- Listens to `CHAT_COMPLETION_SETTINGS_READY` for Chat Completion requests.
- Ignores planner-internal requests by an explicit guard/marker.
- Clones finalized messages before mutation.
- Collects COT source and registered state providers.
- Sends a planner job to the server plugin.
- Validates the returned envelope again on the client.
- Injects one ephemeral system/developer-style message into the main request.
- Optionally shows a separate planner summary/debug panel.

### Server Plugin

- Stores or resolves the independent API secret server-side.
- Exposes a narrow planner endpoint to the frontend extension.
- Supports OpenAI-compatible providers first; provider adapters can follow.
- Applies timeout, cancellation, retry, response-size, and schema validation rules.
- Never logs API keys or full private prompts by default.

Direct browser calls are not the preferred full implementation because of CORS and secret exposure.

### COT Source Adapter

Initial adapter for the current preset:

- read the expanded COT value or a marked COT envelope from the finalized prompt;
- split mixed legacy entries into stable single-responsibility modules;
- route global memory, continuity, knowledge, and state reasoning to the planner;
- preserve style, format, language, POV, length, output-template, and local-RP instructions for the
  main API;
- treat descriptive context as evidence rather than executable COT;
- after successful planning, remove only planner-routed source ranges that were located safely.

Routing is deterministic adapter metadata. Unknown or mixed modules fail closed instead of being
classified by the planner at runtime. Full protocol: `docs/MODULE_ROUTING_PROTOCOL.md`.

### State Provider Registry

Providers return additional structured state that is absent from the finalized prompt. Example providers:

- `mvu.variables`
- `st.localVariables`
- `st.globalVariables`
- `extension.customState`
- memory-plugin-specific prefetch adapters

Each provider must declare whether its data may be sent to the planner API. Providers should be opt-in and size-limited.

## 4. Planner Input

```json
{
  "requestId": "uuid",
  "generationType": "normal",
  "context": {
    "messages": [],
    "modelHints": {},
    "tokenBudget": 0
  },
  "cot": {
    "source": "yezi-preset-v1",
    "modules": []
  },
  "state": {
    "providers": {}
  }
}
```

The planner receives a context clone, not a reference that can mutate the live request.

## 5. Planner Output

The packet must stay compact and operational. It supplies evidence, boundaries, and viable dramatic
space; it must not prewrite the scene or take final plot authority from the main model:

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

Every substantive item includes validated source references. Evidence carries certainty and
constraints carry hard/soft strength. The packet contains no正文, dialogue, plot suggestions,
planned actions, style rewriting, output template, or assistant prefill.

## 6. Main-Request Injection

On planner success:

1. Convert the validated state into a compact instruction block.
2. Insert it late enough to guide the response but before any assistant prefill.
3. Mark it with a private runtime identifier for inspection and replacement.
4. Do not save it into the chat message array or conversation history.
5. Atomically remove only safely located planner-routed modules; preserve main/context routes.

The main model retains its native reasoning mechanism for RP realization: immediate character
reaction, dialogue, movement, pacing, description, and natural transitions. It must not receive or
re-execute successfully externalized planner modules, while writer-facing modules remain present.
SillyTavern displays only reasoning returned by the main generation.

## 7. Memory And Context Rules

### Already Injected Memory

If a memory extension inserts recalled text into the prompt before final request assembly, the planner sees it automatically through the cloned messages. The runtime should not need to know that plugin's internal database format.

### User-Selected Memory Modes

- Summary mode: the existing long summary and recent context remain in the finalized request and are
  shared by planner and main API.
- SP Database mode: SP runs its existing storage, plot-task, AM selection, worldbook expansion, and
  update flow unchanged. The runtime intercepts after the expanded AM memory has entered the finalized
  request, so planner and main API share the same recalled memory.

The runtime does not patch SP, rerun its workflow for the planner, or call its mutating APIs. A
dedicated planner server route prevents the hidden call from emitting SillyTavern generation events.

### Hidden Variable State

If data exists only as a variable and is never inserted into the prompt, the planner cannot infer it. A state provider must explicitly read and attach it.

### Tool-Time Retrieval

If the main model obtains memory through a tool call after generation begins, pre-send interception cannot see the result. Options are:

- provide the same memory tool to the planner;
- prefetch through a plugin adapter;
- run a later planning continuation after retrieval, if the provider supports it.

This is an adapter problem, not a COT conflict problem.

## 8. API Settings

- enable/disable runtime;
- provider type;
- base URL;
- model;
- secret reference, never plaintext export;
- response token limit;
- timeout and retry count;
- structured-output mode;
- context inclusion policy;
- state-provider permissions;
- fallback behavior;
- optional debug summary.

## 9. Failure Policy

- Planner timeout, network failure, invalid JSON, or schema failure: restore/send the untouched original request.
- Never leave a partially modified prompt.
- Prevent recursive interception with both an in-memory guard and a request marker.
- Deduplicate planner execution for retries/swipes by request identity only when behavior is semantically identical.
- Respect user cancellation by aborting the planner request.

## 10. Non-Goals

- Counting COT entries and warning above a threshold.
- Declaring entries incompatible and disabling them.
- Replacing one conflict matrix with an automatic conflict matrix.
- Displaying the planner's hidden state as fake native chain of thought.
- Disabling the main model's RP reasoning.
- Letting the planner write正文 or take final control of plot progression.
- Modifying SP Database source, tables, settings, worldbooks, or recall workflow.
- Editing SillyTavern core before extension/plugin feasibility is exhausted.

## 11. Open Design Questions

- Exact legacy COT envelope markers for reliable extraction and removal.
- Which MVU variable API is available in the user's installed extension set.
- Whether the first release supports only Chat Completion APIs or also text completion.
- Whether structured output is guaranteed by the chosen planner model or must be enforced with repair parsing.
- Whether planner output should persist for swipe/regenerate caching, and what invalidates that cache.
