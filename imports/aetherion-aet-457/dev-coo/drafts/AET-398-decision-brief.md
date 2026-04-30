# AET-398 Decision Brief

Execution note: the repo-grounded policy analysis below is complete. Remote Paperclip mirror bootstrap is currently blocked in this session because the configured `PAPERCLIP_API_URL` is unreachable, so the brief is delivered first while that environment issue is resolved separately.

## 1. Current state

### `HARNESS.md`

- `HARNESS.md:37-43` says Paperclip is an optional program layer, not part of Aetherion's default operating model, and applies only when a ticket is explicitly routed into the desk.
- `HARNESS.md:54` names GREPTILE as the current static PR reviewer.
- `HARNESS.md:64-90` frames the default workflow as a pointer map owned by `.dev/coo/agent-operating-standard.md`, but still lists a step 11 static PR review that has "no canonical contract yet."
- `HARNESS.md:132-148` repeats that Paperclip applies only when a ticket is explicitly routed into the desk and is "not a declaration that Paperclip is Aetherion's default operating model."

### `.dev/coo/agent-operating-standard.md`

- `.dev/coo/agent-operating-standard.md:158-220` defines the canonical default workflow: one ticket / one worktree / one PR, plan audit, adversarial review, code review, bounded fix loop, and closeout.
- `.dev/coo/agent-operating-standard.md:210-213` requires code review before merge.
- The default workflow section contains no static PR review step or canonical static-review contract.

### `.dev/coo/audit-checklist.md`

- `.dev/coo/audit-checklist.md:5` currently says: "Paperclip default path: Linear intake -> plan -> plan audit -> plan_gate -> Software Engineer execution -> Auditor adversarial review -> one bounded fix loop if needed -> Auditor code review -> merge gate -> closeout."

### `.dev/coo/paperclip-operating-model.md`

- `.dev/coo/paperclip-operating-model.md:21-35` labels its 12-step sequence "Default Flow."
- `.dev/coo/paperclip-operating-model.md:58-68` requires the Linear helper Done transition to use `--paperclip-issue-file` and, for non-Paperclip tickets, an explicit `--no-paperclip-gate-reason` bypass.

### `scripts/linear-helper.mjs`

- `scripts/linear-helper.mjs:11-35` documents the Done contract as `status ... Done --paperclip-issue-file issue.json` with `--no-paperclip-gate-reason` as the bypass path.
- `scripts/linear-helper.mjs:121-131` parses both `paperclipIssueFile` and `noPaperclipGateReason`.
- `scripts/linear-helper.mjs:205-217` enforces XOR semantics for Done: either `--paperclip-issue-file` or `--no-paperclip-gate-reason`, and rejects missing or placeholder reasons.

### `scripts/tests/linear-helper.test.mjs`

- `scripts/tests/linear-helper.test.mjs:84-142` codifies the same Done-gate contract in tests: Done requires a gate file or explicit non-Paperclip reason, rejects both at once, and rejects placeholder bypass text.

### Paperclip guard config

- `scripts/policy-engine/config.ts:153-165` defines `PAPERCLIP_ARTIFACT_GATE_REQUIRED_PATHS`; it includes `.dev/coo/audit-checklist.md`, `.dev/coo/paperclip-operating-model.md`, `scripts/linear-helper.mjs`, `scripts/tests/linear-helper.test.mjs`, `.github/pull_request_template.md`, and `scripts/policy-engine/`, but not `HARNESS.md`.
- `scripts/scoped-checks/lib.mjs:177-194` duplicates the same required-path list and explicitly says it must stay in sync with `config.ts`.
- `scripts/policy-engine/config.ts:252-260` defines `TOP_LEVEL_INSTRUCTION_BASENAMES` as `CLAUDE`, `AGENTS`, `SURGEON`, `ARCHITECT`, `README`, `CHANGELOG`, and `RUNTIME_NORTH_STAR`; it does not include `HARNESS`.

### PR template

- `.github/pull_request_template.md:60-62` exposes `PAPERCLIP_MERGE_GATE_STATUS` and `PAPERCLIP_MERGE_GATE_EVIDENCE`, both defaulting to `not_required`.

### Caller inventory

- Pre-flight grep of shell / CI / hook callers for `paperclip-issue-file` and `no-paperclip-gate-reason` found only the helper and its tests in executable surfaces. That means the CLI contract can change without a shell, hook, or CI migration shim. The remaining references are documentation.

## 2. Contradictions

| Contradiction | Files spanned | Exact conflict |
|---|---|---|
| Paperclip is optional in the harness map but default-with-bypass in the docs and tooling | `HARNESS.md:37-43,132-148`; `.dev/coo/audit-checklist.md:5`; `.dev/coo/paperclip-operating-model.md:21-35,58-68`; `scripts/linear-helper.mjs:205-217`; `scripts/tests/linear-helper.test.mjs:84-142` | `HARNESS.md` says Paperclip "is not Aetherion's default operating model," while the checklist says "Paperclip default path," the Paperclip doc says "Default Flow," and the helper requires Paperclip proof or a bypass reason for every Done transition. |
| `HARNESS.md` introduces a workflow step that its own canonical owner does not define | `HARNESS.md:64-90`; `.dev/coo/agent-operating-standard.md:158-220` | `HARNESS.md` step 11 lists "Static PR review" in the default sequence while admitting "no canonical contract yet"; the canonical default workflow owner contains no such step. |
| `HARNESS.md` says it must reference, not restate, but it currently carries policy-shaping workflow meaning | `HARNESS.md:43,64-90,145-150` | The map says "This file must reference, not restate" and "Not a place to smuggle ... new canonical rules," yet step 11 currently changes how readers interpret the default workflow. |
| `HARNESS.md` can still drift without guard coverage | `scripts/policy-engine/config.ts:153-165,252-260`; `scripts/scoped-checks/lib.mjs:177-243`; `HARNESS.md:64-90` | `HARNESS.md` contains workflow-adjacent content but is neither in the Paperclip artifact-gate path list nor the top-level instruction-doc basename allowlist. |

## 3. Decision points

### D1 — Paperclip scope

#### D1.a Optional Paperclip routing

Recommended. Align canonical docs and tooling to the current HARNESS framing.

Blast radius:

- Rewrite `.dev/coo/audit-checklist.md:5` from "Paperclip default path" to "Paperclip-routed path."
- Rename `.dev/coo/paperclip-operating-model.md` section heading from "Default Flow" to "Paperclip-Routed Flow."
- Change `scripts/linear-helper.mjs` so Paperclip evidence is required only when the caller positively signals Paperclip routing.
- Rewrite `scripts/tests/linear-helper.test.mjs` around the new positive-signal contract.

#### D1.b Paperclip as the default workflow

Not recommended. This inverts the HARNESS framing rather than aligning docs and tooling to it.

Blast radius:

- Rewrite `HARNESS.md:37-43,132-148` to remove the "optional program layer" framing.
- Add a canonical Paperclip-default section to `.dev/coo/agent-operating-standard.md`.
- Keep the current helper contract or strengthen it further.
- Accept that the repo's default workflow is now Paperclip-first, not agent-operating-standard-first.

### D2 — Static PR review contract

#### D2.a Codify static PR review now in `.dev/coo/agent-operating-standard.md`

Blast radius:

- Add a canonical static-review section with inputs, evidence, and pass/fail semantics.
- Rewrite `HARNESS.md:78-88` so it only points to that owner.
- Potentially update any downstream review templates if the contract needs evidence fields.

#### D2.b Trim static PR review out of the canonical default workflow and keep it as current practice

Recommended. This matches the repo's current state without inventing a new canonical rule in `HARNESS.md`.

Blast radius:

- Rewrite `HARNESS.md:78` to say the static review is current practice only, not part of Aetherion's canonical default workflow.
- Keep `HARNESS.md:54` as a role-holder row, but explicitly visibility-only until a real owner exists.
- Leave `.dev/coo/agent-operating-standard.md` unchanged.

#### D2.c Defer static PR review codification to AET-399

Blast radius:

- Leave the current ambiguity in place temporarily.
- Accept a scope mismatch because AET-399 is the adversarial-review spine ticket, not a static-review contract ticket.
- Daniel would need to expand AET-399 or knowingly use it as an imperfect home.

#### D2.d Open a new follow-on ticket for static PR review

Blast radius:

- Cleanest separation of concerns.
- Leaves AET-398 to trim the unsupported pointer while a new ticket owns the contract work.

### D3 — `HARNESS.md` guard coverage

#### D3.a Add `HARNESS.md` to both `PAPERCLIP_ARTIFACT_GATE_REQUIRED_PATHS` arrays

Blast radius:

- Update both `scripts/policy-engine/config.ts` and `scripts/scoped-checks/lib.mjs`.
- Every future `HARNESS.md` workflow-adjacent edit triggers the full Paperclip artifact gate.

#### D3.b Keep `HARNESS.md` pointer-only and do not add a Paperclip guard

Recommended with D2.b. If `HARNESS.md` stops carrying policy, the heavier policy gate is no longer necessary.

Blast radius:

- No config changes.
- Residual risk remains: a future edit could silently reintroduce workflow meaning unless reviewers keep the file pointer-only.

#### D3.c Add `HARNESS` to `TOP_LEVEL_INSTRUCTION_BASENAMES`

Blast radius:

- Update `scripts/policy-engine/config.ts` and the matching scoped-checks logic.
- Gives `HARNESS.md` the lighter instruction-doc treatment instead of the full Paperclip gate.

## 4. Recommendation

Recommend **`D1.a + D2.b + D3.b`**.

Why:

- It aligns the repo to `HARNESS.md`'s own existing statement that Paperclip is optional, instead of flipping the repo into a Paperclip-default model without a parent decision.
- It removes the unsupported static-review step from the canonical default workflow without pretending a contract exists where none does.
- It keeps `HARNESS.md` as a true pointer map instead of turning it into a stealth policy owner.
- The pre-flight grep found no executable callers outside the helper and its tests, so the Done-gate contract can be simplified without shell, hook, or CI migration fallout.

## 5. Per-option file-change inventory and residual risk

| Option set | Files touched | Artifact-gate impact | Tests / checks | Rollback cost | Residual risk |
|---|---|---|---|---|---|
| `D1.a + D2.b + D3.b` (recommended) | `HARNESS.md`, `.dev/coo/audit-checklist.md`, `.dev/coo/paperclip-operating-model.md`, `scripts/linear-helper.mjs`, `scripts/tests/linear-helper.test.mjs` | Gate already fires because the audit checklist, Paperclip operating model, helper, and helper tests are already in the guarded path set. | `node --test scripts/tests/linear-helper.test.mjs`; `node --test scripts/tests/paperclip-artifact-gate.test.mjs`; `npx tsx scripts/policy-engine/index.ts --mode pre-push --range origin/main..HEAD`; manual prose reread. | Low to medium: one contained revert PR across the touched files. | `HARNESS.md` remains unguarded, so future reviewers must preserve the pointer-only discipline. |
| `D1.a + D2.a + D3.a` | Recommended set plus `.dev/coo/agent-operating-standard.md`, `scripts/policy-engine/config.ts`, `scripts/scoped-checks/lib.mjs` | Gate still fires, and `HARNESS.md` becomes explicitly guarded. | Recommended checks plus any static-review contract validation Daniel wants. | Medium: more canonical-owner edits and duplicated config maintenance. | Lower future drift risk, but higher current blast radius. |
| `D1.a + D2.b + D3.c` | Recommended set plus `scripts/policy-engine/config.ts` and matching scoped-checks instruction-doc logic | Gate fires for the contract files already in scope; `HARNESS.md` gets lighter instruction-doc treatment. | Recommended checks plus policy-engine/scoped-checks validation. | Medium. | Less drift risk than `D3.b`, less operational weight than `D3.a`. |
| `D1.b + D2.a + D3.a` | `HARNESS.md`, `.dev/coo/agent-operating-standard.md`, `.dev/coo/audit-checklist.md`, `.dev/coo/paperclip-operating-model.md`, `scripts/linear-helper.mjs`, `scripts/tests/linear-helper.test.mjs`, `scripts/policy-engine/config.ts`, `scripts/scoped-checks/lib.mjs` | Heavy contract churn; guard definitely fires. | Full recommended checks plus extra prose reread across multiple canonical owners. | Highest. | Recasts Aetherion's default workflow around Paperclip, which is a much larger decision than this ticket needs to make. |

## 6. Decision requested from Daniel

Please choose one option for each:

- `D1` — Paperclip scope: `D1.a` or `D1.b`
- `D2` — Static PR review contract: `D2.a`, `D2.b`, `D2.c`, or `D2.d`
- `D3` — `HARNESS.md` guard coverage: `D3.a`, `D3.b`, or `D3.c`

If Daniel accepts the recommendation, the implementation path is:

- `D1.a`
- `D2.b`
- `D3.b`

Implementation stays paused until that explicit choice is recorded in the AET-398 Linear thread.
