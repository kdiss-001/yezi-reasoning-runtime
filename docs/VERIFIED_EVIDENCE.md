# Verified SillyTavern Evidence

Verified on June 12, 2026 against the installed source at:

`C:\Users\Administrator\Documents\yezi\SillyTavern`

The copied official documentation repository was at commit:

`9f6ec89e7fae338bd7cabe0c8c4f631e82299319`

## Generation Order

- `public/script.js:4505` runs extension generation interceptors before World Info and final prompt assembly.
- `public/script.js:4576` builds World Info after interceptors.
- `public/script.js:5226` calls `prepareOpenAIMessages()` with World Info, extension prompts, chat messages, and examples.
- `public/scripts/openai.js:1610` emits `CHAT_COMPLETION_PROMPT_READY` after the Chat Completion message array has been assembled.
- `public/scripts/openai.js:3052` emits and awaits `CHAT_COMPLETION_SETTINGS_READY` immediately before the backend fetch.

Inference: for an OpenAI-compatible main API, `CHAT_COMPLETION_SETTINGS_READY` is the latest practical frontend extension point for pausing and mutating the outgoing request.

## Memory Injection

- `public/scripts/extensions/vectors/manifest.json` registers `vectors_rearrangeChat` as a `generate_interceptor`.
- `public/scripts/extensions/vectors/index.js:776` performs retrieval during that interceptor.
- `public/scripts/extensions/vectors/index.js:854` writes recalled chat text with `setExtensionPrompt`.
- `public/scripts/extensions/vectors/index.js:696` writes recalled Data Bank text with `setExtensionPrompt`.
- `public/scripts/extensions/memory/index.js:965` writes Summarize memory with `setExtensionPrompt`.
- `public/script.js:5287-5291` identifies extension prompt values for Summarize (`1_memory`), vectors (`3_vectors`), and Data Bank vectors (`4_vectors_data_bank`).

Inference: memory text injected through normal extension prompts is included in the finalized request snapshot. The runtime does not need direct database access merely to read that recalled text.

## Raw Generation Recursion Risk

- `public/script.js:3941` defines `generateRawData()`.
- `public/script.js:3978` emits `CHAT_COMPLETION_PROMPT_READY` for raw Chat Completion prompts.
- the raw OpenAI path calls the same request-building/sending machinery, which later emits `CHAT_COMPLETION_SETTINGS_READY`.

Inference: implementing the planner by casually calling `generateRaw()` inside a request event can re-enter runtime listeners. Use a dedicated server endpoint or a strict guard/marker.

## Prompt And Variable Adapter APIs

- `public/scripts/openai.js:85-97` exports `oai_settings` and the Chat Completion classes; the module
  also exports the live `promptManager` binding at `public/scripts/openai.js:526`.
- `public/scripts/PromptManager.js:1207-1209` exposes the active character prompt order.
- `public/scripts/PromptManager.js:1257-1259` resolves a prompt by stable identifier.
- `public/scripts/PromptManager.js:1516-1540` shows that enabled prompt order drives the collection
  used for generation.
- `public/scripts/variables.js:22` and `public/scripts/variables.js:83` export local/global variable
  getters.
- `public/scripts/variables.js:241-259` confirms legacy `setvar`, `getvar`, `setglobalvar`, and
  `getglobalvar` semantics.

Inference: the variable-COT adapter can use Prompt Manager identifiers and runtime variable values
instead of guessing module identity from expanded Chinese text alone. The final ECoT body remains a
second independent check before any request mutation.

## Live Extension And Plugin Loading

Verified on June 12, 2026 against live SillyTavern `1.18.0` (`release`, commit `51ad27fb8`):

- The repository root was linked to
  `public/scripts/extensions/third-party/yezi-reasoning-runtime`.
- `server-plugin/` was linked to `plugins/yezi-reasoning-runtime` and server plugins were enabled in
  the local SillyTavern configuration.
- `GET /api/plugins/yezi-reasoning-runtime/status` returned HTTP 200, version `0.2.0`, and
  `configured: false` because no planner key was supplied.
- SillyTavern served the frontend manifest from the third-party extension path.
- In the initialized browser UI, `#yrr_settings` and `#yrr_status` existed; the visible status text
  was `Server plugin loaded; set SILLYTAVERN_REASONING_RUNTIME_API_KEY`.
- Browser console inspection showed no error attributable to Yezi Reasoning Runtime.

Inference at this June 12 stage: installation paths, frontend imports, extension initialization,
server-plugin discovery, and frontend-to-plugin status communication were working, but a planner
request and the one-planner-plus-one-main invariant had not yet been tested.

## Live Planner And Main Generation

Verified on June 13, 2026 in the visible in-app browser against live SillyTavern `1.18.0`:

- The independent planner used Volcengine Ark's OpenAI-compatible coding endpoint and model
  `doubao-seed-2-0-pro-260215`; the existing main API remained `gemini-3.1-pro-preview`.
- The planner secret was supplied only through `SILLYTAVERN_REASONING_RUNTIME_API_KEY`. Extension
  settings stored endpoint, model, limits, and mode but no key or secret value.
- Direct capability probes returned HTTP 400 for `json_object` and `json_schema` response formats,
  while a required function-tool call returned HTTP 200 with parseable JSON arguments.
- In the first visible full-context run, the status stayed at `Planning` and the main request waited.
  The planner produced an unsupported category label, the runtime reported planner failure, preserved
  the original request, and only then allowed the main response to run.
- After normalizing unknown provider-defined constraint categories to protocol `other`, a second
  visible run reached `Planner completed` before the assistant message finished.
- The final assistant message was produced by the unchanged main model and retained SillyTavern's
  native reasoning display (`思考了 2 分钟`). Planner output did not appear as a chat message.
- SP Database and Prompt Template processing remained active and unmodified during both tests.
- The successful planner call used required function-tool mode, `reasoning_effort: low`, 8192 output
  tokens, no retry, and a 120-second timeout. Observed planner latency was roughly 90 seconds.

Inference: the one-hidden-planner-before-one-main ordering, failure fallback, SP compatibility, and
native main reasoning preservation are now proven for one real normal-generation path. Latency and
reliability across other models, generation modes, and alternate COT builders remain unproven.

## Official Documentation Copies

- `references/official-docs/Writing-Extensions.md`
- `references/official-docs/reasoning.md`
- `references/official-docs/prompt-manager.md`

The official extension documentation describes prompt interceptors, lifecycle events, `generateQuietPrompt()`, `generateRaw()`, and structured outputs. Installed source remains authoritative for this machine when documentation and runtime differ.
