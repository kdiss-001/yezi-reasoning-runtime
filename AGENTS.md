# Yezi-Ku Reasoning Runtime Workspace

This workspace is dedicated to designing and implementing a SillyTavern COT/reasoning runtime extension.

## Startup

1. Read `_codex/HANDOFF.md`.
2. Read `docs/DESIGN_SPEC.md`.
3. Read `docs/VERIFIED_EVIDENCE.md` before making claims about SillyTavern internals.
4. Check the installed SillyTavern source at `C:\Users\Administrator\Documents\yezi\SillyTavern` when behavior is version-specific.
5. Use the copied official documentation under `references/official-docs/` for intended extension and reasoning behavior.

## Scope

- Build a real execution layer for many enabled COT modules.
- Do not reduce the problem to entry counts, conflict warnings, automatic disabling, or compatibility detection.
- All enabled COT modules should participate in a structured planning pass.
- The planner uses an independently configured API and guides the main API's final response.
- Preserve SillyTavern's native reasoning display for the main generation.

## Safety

- Treat everything under `references/` as read-only research material.
- Do not edit the source preset in `C:\Users\Administrator\Documents\yeziysuhe` unless the user explicitly requests it in that workspace.
- Do not edit the installed SillyTavern core unless a later decision explicitly chooses a core patch over an extension/plugin.
- Never store API keys in tracked files, extension settings exports, logs, or handoff documents.
- Prefer PowerShell 7 at `C:\Program Files\PowerShell\7\pwsh.exe`.

## Current State

A Phase 1 frontend extension exists at the repository root, with its server plugin under
`server-plugin/`. It still requires live SillyTavern integration testing and the Phase 2 adapter that
extracts and routes every enabled legacy COT module.
