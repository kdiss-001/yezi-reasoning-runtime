# Handoff: SillyTavern Reasoning Runtime

## User Intent

The user observed that enabling many COT entries, often more than roughly ten, can make reasoning display or behavior abnormal. They rejected designs based on counting entries, warning about conflicts, or automatically deciding which entries should be disabled. The desired direction is a deeper execution-model improvement.

The accepted concept is a separate reasoning runtime:

1. SillyTavern and other extensions assemble the normal final context.
2. This extension captures a clone of that finalized request.
3. A trusted adapter routes enabled modules, then an independently configured planner API executes
   global reasoning categories and returns sourced structured state.
4. The structured result is injected into the original main request as an ephemeral instruction.
5. The main API writes the visible response and may still return its own native reasoning for SillyTavern to display.

## Confirmed Decisions

- Use a separate API configuration, similar in spirit to MVU-style independent model settings.
- Do not call one API request per COT entry. Route the active module set and execute planner-owned
  categories in one structured planning pass by default.
- The planner must inherit chat context and memory injections.
- Capture the finalized main request instead of trying to recognize and reconstruct every memory plugin independently.
- Add state providers for information that is not present in the finalized request, especially MVU/local/global variables.
- Keep planner output hidden from chat history and native reasoning display.
- Native reasoning display belongs to the final main-model call. Planner state may have an optional separate debug/summary panel.
- On planner failure, default to sending the original request unchanged.
- "Externalized reasoning" means the planner fully executes planner-routed global constraint work.
  It does not absorb style, formatting, local RP reasoning, or the main model's plot decisions.
- The main API is primary: it controls actual plot progression, character performance, visible正文,
  and local scene reasoning.
- The planner API is subordinate: it provides facts, memory evidence, state, boundaries, risks, and
  viable development space. It may not write正文, dialogue, exact actions, or mandatory plot beats.
- After planner success, the main API must not receive or re-execute externalized planner modules;
  writer-facing modules remain present.
- Summary memory mode and SP Database mode are separate user-selected modes.
- SP Database remains unmodified. It completes its normal AM selection and expansion before the
  runtime intercepts; planner and main API see the same recalled AM context, and the main request
  waits for the hidden planner call.
- The dedicated planner endpoint must not re-enter SillyTavern generation events or trigger SP a
  second time.
- The detailed decision record is `docs/ARCHITECTURE_DECISIONS.md`.
- Every enabled module is deterministically routed. The planner executes global reasoning categories;
  style, format, language, POV, length, local RP, and output-template instructions remain with the
  main API. Full protocol: `docs/MODULE_ROUTING_PROTOCOL.md`.

## Important Technical Finding

For the installed SillyTavern version, `CHAT_COMPLETION_SETTINGS_READY` is awaited immediately before the OpenAI-compatible backend request is sent. At that point, `generate_data.messages` contains the assembled request. Built-in vector retrieval and extension prompt injection happen earlier.

This makes the event a strong interception point for a Chat Completion MVP. The extension should clone the request, call its own backend endpoint, then mutate only the original request's message array by adding the compact planner result.

Do not use ordinary `generateRaw()` for the planner without a recursion guard: raw chat generation also emits `CHAT_COMPLETION_PROMPT_READY` and `CHAT_COMPLETION_SETTINGS_READY`. The preferred full design is a frontend extension plus a server plugin/proxy endpoint for the independent API and secret handling.

## Memory Compatibility

Usually inherited automatically from the final request snapshot:

- current chat history;
- character/persona/context prompts;
- World Info already activated;
- Author's Note and extension prompts;
- Summarize memory injected as `1_memory`;
- chat vectors injected as `3_vectors`;
- Data Bank vectors injected as `4_vectors_data_bank`;
- other third-party memory text already placed in the outgoing prompt.

Needs an explicit provider/adapter:

- MVU or other state that exists only in local/global variables;
- hidden extension state that is never injected into the outgoing request;
- memory retrieved later through model tool calls, because that data does not exist at pre-send interception time.

## Implemented In This Session

- The repository root contains the SillyTavern third-party extension manifest, settings UI, finalized
  Chat Completion interception, request cloning, cancellation, response validation, and late
  ephemeral plan injection before an assistant prefill.
- `server-plugin/` contains a server plugin for an independently configured
  OpenAI-compatible planner endpoint. The API key is read only from
  `SILLYTAVERN_REASONING_RUNTIME_API_KEY`.
- Planner and client now implement Support Packet V2: exact module coverage, request/context binding,
  sourced evidence with certainty, sourced constraints with hard/soft strength, conflicts, and
  uncertainties. Unknown fields such as `plannedActions` are rejected.
- Planner timeout, cancellation, HTTP failure, invalid JSON, or invalid schema leaves the original
  main request untouched.
- Unit tests cover cloning, schema validation, injection position, provider request construction,
  response parsing, and retry behavior.
- `preset-adapter.js` implements the first regular variable-COT profile. It reads active Prompt
  Manager order, selects the final enabled global-COT builder, traces all 32 referenced variables to
  enabled setter prompts, validates the expanded ECoT against global `cot`, and prepares atomic ECoT
  plus assistant-prefill removal with separate writer-directive preservation.
- The planner provider adapter supports prompt-only JSON, JSON-object response format, and a required
  function-tool call. It also forwards optional provider reasoning effort and normalizes unknown
  provider-defined constraint category labels to protocol `other` while retaining strict source,
  strength, field, and plot-control validation.

## Deliberately Not Claimed Yet

- Alternate minimal/self/custom COT builders have not been profiled.
- MVU and hidden-variable state providers are still Phase 3.
- Endpoint allowlisting/secret-to-origin binding and per-request concurrency hardening remain.
- One successful trace proves ordering and protocol flow, but does not yet establish acceptable
  latency or broad provider/model reliability.

## Verification Completed

- `npm test`: 31 tests passed.
- `npm run check`: all frontend and server entry files passed Node syntax checks.
- Live SillyTavern `1.18.0` integration was exercised on June 12, 2026 using directory junctions:
  the repository root is linked under `public/scripts/extensions/third-party/yezi-reasoning-runtime`
  and `server-plugin/` is linked under `plugins/yezi-reasoning-runtime`.
- `enableServerPlugins` is enabled in the local SillyTavern configuration. The server plugin loaded
  as version `0.2.0`, and its status endpoint returned HTTP 200 with `configured: false`.
- The frontend manifest was served by SillyTavern, the extension script executed, and the visible
  settings status reported `Server plugin loaded; set SILLYTAVERN_REASONING_RUNTIME_API_KEY`.
- Browser console inspection found no error emitted by this extension.
- Frontend relative imports resolve to the installed SillyTavern `public/script.js` and
  `public/scripts/extensions.js` locations when installed under the documented third-party path.
- The CommonJS server plugin export is visible through SillyTavern's dynamic-import loading shape.
- JSON manifests parse successfully and the workspace contains no key-like `sk-...` token.
- On June 13, 2026, a visible live test used Volcengine Ark as the independent planner and the
  existing custom main API without changing SP Database. SP completed its normal preprocessing,
  the runtime entered `Planning`, and the main request waited. A schema-label failure preserved and
  sent the original request unchanged; after provider-label normalization, a second run reached
  `Planner completed` before the main assistant response appeared. The main response retained its
  native reasoning display (`gemini-3.1-pro-preview`, `思考了 2 分钟`).
- The successful planner configuration used a required function-tool call, 8192 output tokens,
  zero retries, `reasoning_effort: low`, and a 120-second timeout. The secret was supplied only via
  `SILLYTAVERN_REASONING_RUNTIME_API_KEY`; it was not stored in extension settings or repository files.
- Volcengine's tested model rejected both `json_object` and `json_schema` response formats but did
  return a valid required function call. Planner latency remained roughly 90 seconds in the live
  context, so model and parameter performance comparison is the next practical optimization.
- Public repository: `https://github.com/kdiss-001/yezi-reasoning-runtime`. The root layout is
  directly installable as a SillyTavern frontend extension. Third-party presets and `references/`
  research copies remain local and ignored.

## Reference Agent Preset Analysis

The root preset `双人成行 V7.0—长风渡（Agent版）.json` has been structurally analyzed and remains
read-only. Full findings are in `docs/REFERENCE_DUAL_TRAVEL_AGENT.md`.

Key conclusion: TauriTavern Agent captures a finalized prompt snapshot and offers useful workspace,
retrieval, memory-tier, and artifact-contract patterns, but this preset makes one Agent the planner,
drafter, reviewer, memory writer, and final response owner. It is a replacement generation path, not
a subordinate planner followed by the original main API.

Borrow finalized-context capture, ephemeral/durable state separation, bounded retrieval, staged
execution, and stable output contracts. Do not copy Agent ownership of正文, same-model snapshots,
autonomous memory mutation, high-round tool loops, or the runbook instruction to execute tool-call
directions found in World Info.

## Next Integration Task

Benchmark alternative Volcengine planner models or lower-cost settings against the same fixture,
while keeping the now-verified function-call protocol. Then add explicit profiles for any alternate
COT builder the user expects to enable before making broad compatibility claims.
