# Yezi Reasoning Runtime

SillyTavern extension that pauses a finalized Chat Completion request, runs one independently
configured subordinate planning pass, validates a sourced support packet, and then lets the main API
retain control of roleplay reasoning and visible prose.

Repository: https://github.com/kdiss-001/yezi-reasoning-runtime

## Status

This is an active development build. Protocol V2, request interception, planner proxying, validation,
cancellation, unchanged-request fallback, and the first variable-COT preset adapter are implemented
and tested. The adapter currently targets the verified regular COT builder used by the transferred
Yezi preset; alternate COT builders and live SillyTavern execution still require verification.

## Install Frontend Extension

In SillyTavern, open **Extensions**, choose **Install Extension**, and enter:

```text
https://github.com/kdiss-001/yezi-reasoning-runtime
```

The repository root is the extension root and contains `manifest.json`.

## Install Server Plugin

The planner API key is intentionally handled by a SillyTavern server plugin. The frontend extension
installer cannot install server plugins automatically.

From the SillyTavern directory, clone this repository temporarily and copy `server-plugin/` to:

```text
SillyTavern/plugins/yezi-reasoning-runtime
```

Enable plugins in `config.yaml`:

```yaml
enableServerPlugins: true
```

Set the planner key only in the process environment before starting SillyTavern:

```powershell
$env:SILLYTAVERN_REASONING_RUNTIME_API_KEY = '<planner-api-key>'
npm start
```

Do not place API keys in extension settings, tracked files, logs, or exported presets.

## Architecture

```text
SillyTavern + memory/SP prompt assembly
  -> finalized request interception
  -> deterministic module routing
  -> independent planner API
  -> sourced Support Packet V2 validation
  -> preserve writer-facing instructions
  -> main API local RP reasoning and visible response
```

The planner may compile global memory, continuity, knowledge boundaries, character/relationship
state, scene state, and cross-module consistency. It may not write dialogue, exact actions, plot
beats, drafts, or final prose.

For the verified Yezi variable-COT preset, the adapter reads the active Prompt Manager order, traces
each `getvar` module to its last enabled setter, verifies the expanded ECoT against the runtime global
`cot` value, removes the ECoT and dedicated assistant prefill on success, and reinjects writer-routed
requirements separately.

Start with:

- [`_codex/HANDOFF.md`](_codex/HANDOFF.md)
- [`docs/DESIGN_SPEC.md`](docs/DESIGN_SPEC.md)
- [`docs/MODULE_ROUTING_PROTOCOL.md`](docs/MODULE_ROUTING_PROTOCOL.md)
- [`docs/IMPLEMENTATION_PLAN.md`](docs/IMPLEMENTATION_PLAN.md)
- [`docs/VERIFIED_EVIDENCE.md`](docs/VERIFIED_EVIDENCE.md)

## Development

Requires Node.js 20 or newer.

```powershell
npm test
npm run check
```

The public repository intentionally excludes copied third-party presets, SillyTavern source
snapshots, and local research fixtures. Their conclusions are preserved in the tracked design and
evidence documents.
