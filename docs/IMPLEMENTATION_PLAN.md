# Implementation Plan

## Phase 1: Request Interception MVP

- Scaffold a third-party frontend extension and a server plugin.
- Add independent OpenAI-compatible API settings and secure secret handling.
- Listen to `CHAT_COMPLETION_SETTINGS_READY`.
- Clone `generate_data.messages` and send a minimal planner request.
- Inject a fixed validated planner result into the live request.
- Add recursion guard, cancellation, timeout, and unchanged-request fallback.

Success criterion: one normal generation performs exactly one hidden planner call and one main call; the hidden call does not appear in chat or native reasoning display.

## Phase 2: Current Preset COT Adapter

- Inspect the copied preset fixture.
- Define stable markers for the current global COT payload.
- Split mixed entries and assign protocol-v2 categories through explicit adapter rules.
- Route planner/main/context modules without LLM classification.
- Validate sourced evidence, constraint strength, coverage, request identity, and context hash.
- Convert planner state into a compact main-model instruction.
- Atomically remove only successfully externalized planner module ranges.

Success criterion: every enabled module is routed and covered, only planner modules are removed, and
the main request retains writer-facing instructions without carrying the externalized global COT.

## Phase 3: Context And Memory Compatibility

- Verify built-in Summarize, vectors, Data Bank vectors, World Info, and Author's Note are present in the cloned request.
- Add a provider registry.
- Implement MVU/local/global variable providers after identifying the installed variable API.
- Add per-provider permission and size controls.

Success criterion: planner decisions reflect both recalled memory text and selected hidden state without plugin-specific hardcoding in the core runtime.

## Phase 4: Reliability And UX

- Add planner schema diagnostics without exposing private reasoning.
- Add optional execution-summary panel.
- Add request fingerprinting and safe cache invalidation for swipe/regenerate.
- Add provider/model capability checks and graceful non-schema fallback.
- Test streaming, cancellation, group chats, impersonation, continue, swipe, regenerate, and quiet generations.

## Phase 5: Optional Deep Mode

- Add targeted post-draft validation/repair as an optional third stage.
- Repair only named output-contract failures; do not regenerate blindly.
- Keep default mode as one planner call plus one main call.

## Test Matrix

- planner enabled/disabled;
- planner success/timeout/HTTP error/invalid JSON;
- normal, swipe, regenerate, continue, impersonate, quiet;
- streaming and non-streaming main generation;
- Summarize memory on/off;
- chat vectors and Data Bank vectors on/off;
- World Info activation;
- MVU provider on/off;
- native reasoning returned/not returned by the main model;
- planner model same as/different from main provider;
- user cancellation during planner call.
