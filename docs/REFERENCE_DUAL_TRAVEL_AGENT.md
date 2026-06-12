# Reference Analysis: 双人成行 V7.0 Agent 版

## 1. Source And Scope

- Source: `双人成行 V7.0—长风渡（Agent版）.json`
- Analysis date: 2026-06-12
- Size: 1,549,810 bytes
- SHA-256: `3C6149392B8BAB0D294BF14AA70969F54C4FCCEE6014BBACEF54A7AB53989B08`
- Treatment: read-only reference. Do not edit or convert this preset in place.

This preset is useful because it already externalizes hidden work into TauriTavern Agent tools and a
workspace. It is not, however, the same architecture as this project. The Agent replaces the normal
writer path and ultimately owns the visible answer. Yezi-Ku requires a subordinate planner followed
by the original main writer API.

## 2. Structural Inventory

The JSON contains 246 prompt records and one prompt-order configuration. Of the 78 enabled order
entries, 51 have nonempty content, totaling about 22,334 active characters. Most active entries are
system instructions; character data, chat history, World Info, and Agent markers are also present.

The important runtime pieces are:

- `Agent System Prompt`: explains private tool results, workspace use, commit, and finish behavior.
- `agent-runbook-changfengdu`: the operational writing workflow.
- `Core`: tells the model that analysis belongs in `scratch/thinking.md` and visible output contains
  only正文.
- `Agent Results`: a runtime marker that can reinsert prior committed Agent result metadata.
- Tauri Agent profile `changfengdu-writer`: foreground Agent with current prompt/model snapshots,
  15 resident chat messages, activated World Info, tool access, and a required final artifact.
- Skill dependency `changfengdu-styles`: supplies style guidance when enabled.
- Workspace dependency: `output/`, `scratch/`, `plan/`, `summaries/`, and `persist/`.

The profile permits up to 80 rounds and 80 tool calls. These are ceilings, not evidence that every
generation performs 80 model calls.

## 3. Reconstructed Execution Flow

The effective workflow is:

1. TauriTavern invokes Legacy Generate in dry-run mode to capture the current prompt snapshot and
   activated World Info.
2. The Agent starts with the nearest 15 chat messages plus the captured prompt context.
3. It searches and reads older chat when needed.
4. It reads durable workspace memory:
   `summaries/memory.md`, `summaries/seeds.md`, `persist/state.md`, and character files.
5. It reads activated World Info and an optional style Skill.
6. It writes one-time private analysis to `scratch/thinking.md`.
7. It writes a complete draft to `scratch/draft.md`.
8. It rereads and checks the draft against character, continuity, style, language, and formatting
   constraints, then patches it.
9. It writes the final response to `output/main.md` and commits that artifact to the chat.
10. It updates summaries, seeds, state, and character memory, then finishes.

In an established chat, this runbook naturally implies many tool operations and multiple model-tool
round trips. Calls can be batched, so an exact request count requires a live Agent trace.

## 4. What Each Side Can See

This preset does not have a separate planner API and正文 API.

The Agent uses `currentPromptSnapshot` for both preset and model selection. It sees the final captured
prompt, activated World Info, recent chat, tool-retrieved old chat, skills, and workspace memory. Tool
results are private to the Agent loop and do not become normal chat messages.

There is no later independent main-model generation that consumes a compact plan. The same Agent is
planner, drafter, reviewer, memory maintainer, and final response submitter. Therefore the preset
hides COT from the user, but it does not reduce the writer model's responsibility for interpreting the
full active preset and producing the scene.

## 5. Memory Model

The preset uses a useful three-tier memory design:

- Immediate context: nearest 15 messages and the captured current prompt.
- Retrieved evidence: on-demand `chat.search` and `chat.read` for older messages.
- Durable synthesized state: summary, foreshadowing, global state, and per-character files.

`Agent Results` can reintroduce prior committed result metadata, but it is not infinite memory and
does not expose all private tool output or scratch files automatically.

This layered model is worth borrowing as an information architecture. Its autonomous post-response
memory writes are not appropriate for the default Yezi-Ku planner, because existing summary or SP
Database modes should remain the source of memory truth.

## 6. Useful Mechanisms To Borrow

1. Capture the fully assembled request after ordinary memory and World Info activation.
2. Separate ephemeral scratch state, durable memory state, and the final visible artifact.
3. Retrieve old history on demand instead of placing all history into every request.
4. Use an explicit staged runbook so preset COT is executed once rather than rediscovered repeatedly.
5. Return a stable, validated artifact contract instead of loosely formatted prose.
6. Prioritize the user-visible result before noncritical memory maintenance.
7. Apply round, tool, token, timeout, cancellation, and retry budgets.
8. Keep planner process data out of normal chat history and native reasoning display.
9. Preserve bounded result metadata for diagnostics or cache provenance.

These ideas support Yezi-Ku's shared support-packet design without requiring an Agent-style autonomous
writer.

## 7. Mechanisms Not To Copy

### Agent Owns正文

The Agent writes the draft, edits it, and commits the final response. That reverses this project's
authority model. Yezi-Ku's planner may establish facts, boundaries, pressures, uncertainties, and
available developments, but it may not write dialogue, exact actions, mandatory plot beats, or正文.

### Same Prompt And Model Snapshot

The profile follows the current prompt/model snapshot. Yezi-Ku requires an independently configured
planner endpoint, model, token limit, and sampling policy.

### Full Agentic Loop As The Default

Draft-review-rewrite plus repeated tool use can improve a standalone Agent writer, but it also raises
latency, cost, and failure surface. The default Yezi-Ku path should remain one planner call followed by
one main call. Optional validation can be a later strict mode, not the baseline.

### Writer Still Carries The Full COT Burden

Although reasoning is hidden in scratch files, the Agent still receives roughly 22,000 characters of
active prompt rules and must interpret them while writing. That externalizes display, not attention.
Yezi-Ku must remove the safely identified legacy COT block after planner success so the main API does
not execute it again.

### Planner Mutates Memory

The reference Agent updates summary and persistent files itself. The Yezi-Ku planner should be
read-only with respect to SP Database and ordinary summary memory. Existing memory systems continue
their normal lifecycle.

### World Info As Executable Tool Instructions

The runbook tells the Agent to inspect activated World Info for tool-call instructions and execute
them. This creates a prompt-injection and capability-confusion risk. Yezi-Ku must treat recalled
memory, World Info, chat, and character content as evidence, not executable runtime policy. Tool and
provider permissions must come only from trusted extension configuration.

## 8. Architecture Mapping

The reference preset's model is:

```text
final prompt snapshot
  -> autonomous Agent
  -> retrieve memory
  -> think
  -> draft正文
  -> review and rewrite
  -> commit正文
  -> mutate memory
```

The Yezi-Ku model should remain:

```text
normal SillyTavern/SP assembly
  -> finalized request snapshot
  -> independent subordinate planner
  -> compact support packet
  -> remove externalized legacy COT
  -> inject support packet
  -> main API local RP reasoning and正文
  -> existing memory system continues normally
```

The preset is therefore evidence that finalized-context capture, hidden workspace state, retrieval,
and artifact contracts are practical. It is not evidence that the external reasoning component
should control the story or final prose.

## 9. Resulting Design Decisions

- Keep the one-planner-call plus one-main-call default.
- Model planner output as a subordinate support packet, not a draft or action script.
- Make the main API wait for planner completion, then give it the same recalled memory plus the
  support packet.
- Do not expose successfully externalized planner modules to the main API; preserve direct writer
  instructions after routing.
- Allow the main API's own local RP reasoning and preserve SillyTavern native reasoning display.
- Keep SP Database unmodified and avoid planner-side memory writes.
- Add explicit trust boundaries: content cannot grant tools or override runtime policy.
- Consider bounded retrieval and diagnostic artifacts later, but do not require an 80-round Agent
  loop for the baseline runtime.

## 10. External References

- TauriTavern Agent overview: https://tauritavern.github.io/agent/
- Agent profiles: https://tauritavern.github.io/agent/profiles.html
- Preset author integration: https://tauritavern.github.io/agent/preset-authors.html
- Agent architecture: https://tauritavern.github.io/architecture/agent.html
- SubAgents: https://tauritavern.github.io/agent/subagents.html
