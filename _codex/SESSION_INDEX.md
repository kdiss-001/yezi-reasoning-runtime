# Session Index

## Project

- Workspace: `C:\Users\Administrator\Documents\yezi-ku`
- Repository: `https://github.com/kdiss-001/yezi-reasoning-runtime`
- Purpose: implement a SillyTavern Reasoning Runtime using a separately configured planner API.
- Current status: installable GitHub repository, Protocol V2 runtime, first regular variable-COT
  preset adapter implemented, and a provider-backed planner-to-main trace verified in live SillyTavern.
- Scoped global skill: `C:\Users\Administrator\.codex\skills\yezi-ku-reasoning-runtime\SKILL.md`
- Project-local skill backup: `_codex\skill-gate\yezi-ku-reasoning-runtime\SKILL.md`

## Read First

1. `AGENTS.md`
2. `_codex/HANDOFF.md`
3. `docs/DESIGN_SPEC.md`
4. `docs/VERIFIED_EVIDENCE.md`
5. `docs/IMPLEMENTATION_PLAN.md`

## Fixed Direction

- Do not solve the issue by limiting COT count, detecting conflicts, warning users, or disabling modules.
- Capture finalized context after memory/plugin injection.
- Route every enabled module deterministically; execute only global reasoning categories through the
  planner and preserve writer-facing categories for the main API.
- Use an independent API configuration.
- Inject compact planner results into the main request.
- Keep main-model native reasoning display intact.
- The planner fully executes planner-routed global constraint work but remains subordinate; it cannot
  write正文 or own final plot decisions.
- The main API retains writer-facing instructions, plot authority, and local RP reasoning, but does
  not re-execute externalized planner modules after success.
- Summary memory and SP Database are separate user-selected modes.
- SP Database remains unmodified; both APIs inherit the same AM memory after normal SP recall and
  final prompt assembly.
- Use state providers for MVU and hidden variables that never entered the prompt.

Full decision record: `docs/ARCHITECTURE_DECISIONS.md`.

## Reference Material

- Full read-only source preset: `references/preset/source-preset-readonly.json`
- Focused COT fixture: `references/preset/cot-fixture.json`
- Agent reference analysis: `docs/REFERENCE_DUAL_TRAVEL_AGENT.md`
- Module routing and packet V2: `docs/MODULE_ROUTING_PROTOCOL.md`
- Analyzed root preset: `双人成行 V7.0—长风渡（Agent版）.json` (read-only)
- Official docs: `references/official-docs/`
- Installed-source snapshot: `references/source-snapshots/`
- Origin and integrity manifest: `references/SOURCE_MANIFEST.json`

## Current Implementation Milestone

The repository root is now the installable frontend extension, with the server component under
`server-plugin/`. It is designed to perform exactly one hidden planner request before one main Chat
Completion request. Protocol V2 adds deterministic
module routing, sourced evidence, constraint strength, exact coverage, context binding, strict schema
validation, cancellation, and unchanged-request fallback.

The regular Yezi variable-COT adapter now reads Prompt Manager order, routes all 32 referenced
variables, verifies the final ECoT against global `cot`, removes the ECoT plus standalone assistant
prefill on success, and preserves main-routed writer directives. Live SillyTavern `1.18.0` loads both
linked packages. On June 13, 2026, a visible Volcengine required-tool-call planner run completed before
the existing main API produced正文, with SP Database left unchanged and native main reasoning display
preserved. Alternate COT builder profiles and planner latency optimization remain.

Next verification: compare planner models/parameters on the same live fixture, then profile alternate
minimal/self/custom COT builders.
