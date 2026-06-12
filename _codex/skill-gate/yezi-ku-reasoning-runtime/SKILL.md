---
name: yezi-ku-reasoning-runtime
description: Use only in C:\Users\Administrator\Documents\yezi-ku for designing, implementing, testing, or handing off the SillyTavern Reasoning Runtime extension and server plugin, including independent planner API configuration, finalized prompt interception, COT execution, memory/vector injection compatibility, MVU state providers, and native reasoning display behavior.
---

# Yezi-Ku Reasoning Runtime Gate

## Scope

Use this skill only when the workspace is exactly `C:\Users\Administrator\Documents\yezi-ku` or the user explicitly names that project. Do not apply the old `yeziysuhe` preset-maintenance workflow here.

## Startup

Read, in order:

1. `C:\Users\Administrator\Documents\yezi-ku\_codex\SESSION_INDEX.md`
2. `C:\Users\Administrator\Documents\yezi-ku\_codex\HANDOFF.md`
3. `C:\Users\Administrator\Documents\yezi-ku\docs\DESIGN_SPEC.md`

Read `docs\VERIFIED_EVIDENCE.md` before relying on SillyTavern event ordering. Read `docs\IMPLEMENTATION_PLAN.md` before writing extension code.

## Architecture Invariants

- This is not a COT count limiter, conflict detector, warning system, or automatic module disabler.
- All enabled COT modules participate in a structured planning pass by default.
- The planner uses an independently configured API.
- Capture finalized main-request context after ordinary memory/plugin injection.
- Use state providers for MVU or hidden state absent from the request.
- Inject compact planner output ephemerally into the main request.
- Preserve native reasoning display for the main model; do not present planner state as native chain of thought.
- On planner failure, leave/send the original request unchanged.
- Prevent recursive interception.

## Sources

- Treat `references\` as read-only.
- Use copied official docs for intended behavior.
- Use copied source snapshots to reproduce the original evidence.
- Use the live install at `C:\Users\Administrator\Documents\yezi\SillyTavern` for current runtime truth.

## Security

Never store API keys in tracked files, logs, extension settings exports, fixtures, or handoff documents. Prefer a server plugin/proxy for provider calls and secret handling.
