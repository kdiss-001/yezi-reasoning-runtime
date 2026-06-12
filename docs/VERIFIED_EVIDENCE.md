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

## Official Documentation Copies

- `references/official-docs/Writing-Extensions.md`
- `references/official-docs/reasoning.md`
- `references/official-docs/prompt-manager.md`

The official extension documentation describes prompt interceptors, lifecycle events, `generateQuietPrompt()`, `generateRaw()`, and structured outputs. Installed source remains authoritative for this machine when documentation and runtime differ.
