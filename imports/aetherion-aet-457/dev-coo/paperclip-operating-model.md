# Aetherion Paperclip Operating Model

Paperclip is Aetherion's quality-first execution desk. Linear remains the system of record for ticket state, ownership, PR links, and closure notes.

The operating model has exactly three agents:

- `Aetherion CEO`
- `Auditor`
- `Software Engineer`

Design review, design direction, browser QA, adversarial review, code review, and fix loop are artifact types or review modes. They are not agents, lanes, or permission to create extra default owners.

## Agent Roles

- `Aetherion CEO` owns intake, product framing, plan drafting, execution handoff, status clarity, merge gate, closeout, and Daniel escalation.
- `Auditor` owns plan audit, `plan_gate` verdicts, adversarial review, code review, evidence challenge, browser/design review artifacts, and merge-readiness recommendations.
- `Software Engineer` executes approved scoped work from `surgeon_brief`, runs authorized fix loops, and returns evidence without self-approving readiness.

Daniel is not part of routine execution. Escalate to Daniel only for scope changes, a new user-trust decision or unresolved trust risk that cannot be resolved inside the approved scope, production risk, external blocked dependencies, weak evidence that cannot be resolved by the funnel, or explicit Daniel-requested intervention.

## Paperclip-Routed Flow

Paperclip is an optional program-specific layer (see [`HARNESS.md`](../../HARNESS.md) § 2 and § 6). This flow applies only to tickets explicitly routed into the Paperclip execution desk via `scripts/paperclip-find-or-create-mirror.sh`; the canonical default workflow for any other ticket is owned by [`.dev/coo/agent-operating-standard.md`](agent-operating-standard.md).

1. Linear issue exists and is complete.
2. Aetherion CEO mirrors the ticket into Paperclip and writes `linear_intake`.
3. Aetherion CEO drafts `plan`.
4. Auditor reviews the plan in `plan_audit`.
4a. If the ticket modifies Core agent code, state, prompts, or runtime paths: Auditor verifies architecture fit against `RUNTIME_NORTH_STAR.md` before `plan_gate` or execution handoff. If the plan bypasses any rule, the deviation must be documented as a hotfix exception or the plan must be redesigned.
5. Auditor returns a `plan_gate` verdict: `APPROVED`, `REVISE`, or `BLOCKED`.
6. Aetherion CEO prepares the worktree, writes `surgeon_brief`, and assigns Software Engineer only after `plan_gate` is `APPROVED`.
7. Software Engineer executes only the approved scope and returns an `execution_report`.
8. Auditor adversarial review evaluates the diff, evidence, and scope fit.
9. If needed, Software Engineer runs exactly one bounded fix loop from accepted same-scope review findings and updates evidence.
10. Auditor reruns adversarial review after the bounded fix loop, then performs the distinct code review.
11. Aetherion CEO normalizes evidence into `verification`, obtains `merge_gate` approval, and confirms the PR link is in Linear.
12. PR merges, Aetherion CEO records the merge SHA, completes post-merge worktree cleanup evidence, writes `closeout`, and only then updates Linear to `Done`.

Review modes can be inserted only when the plan or evidence names the reason. They do not create extra agents and do not replace plan audit, `plan_gate`, adversarial review, bounded fix loop control, code review, merge gate, or closeout.

Before opening or approving `merge_gate`, run the artifact-order guard:

```bash
node scripts/paperclip-artifact-gate.mjs --action merge-gate --issue-file <paperclip-issue.json>
```

When the `adversarial_review` artifact carries non-empty `findings`, it MUST also carry a `dispositionSummary` object with integer counts for `merge_blocker`, `follow_up_debt`, and `non_blocking_polish`, and those counts MUST sum exactly to `findings.length`. `follow_up_debt` findings must carry either a Linear follow-up ticket (`AET-<number>`) or, **when permitted by the Non-deferrable Findings Guardrail**, a pointer to `docs/review/DEFERRED-ENHANCEMENTS.md` PLUS a `deferred_enhancements_anchor` (kebab-case token matching `^[a-z0-9][a-z0-9-]{0,38}[a-z0-9]$`) that resolves to an existing `<a id="<token>"></a>` anchor in that doc. Findings whose `blocker_class` is `runtime_or_behavioral_regression`, `trust_or_safety`, or `contract_or_evidence` MUST use the Linear-ticket form; only `architecture_or_scope` findings may use the deferred-doc form. The wrapper and the Paperclip gate independently verify the anchor resolves to exactly one matching entry; missing or duplicate anchors are rejected with named errors (`Deferred Enhancements Anchor Missing` / `Deferred Enhancements Anchor Duplicate`). The Auditor authors `dispositionSummary` in the `adversarial_review` JSON, mirroring the Disposition Summary section in [`.dev/coo/pre-merge-review-template.md`](pre-merge-review-template.md). The completeness rule is owned by [`.dev/coo/agent-operating-standard.md`](agent-operating-standard.md) § Adversarial Review Disposition Contract; the artifact-gate command above mechanically enforces it. The wrapper-level Codex result contract is local to Aetherion in [`.dev/coo/adversarial-review-result.schema.json`](adversarial-review-result.schema.json); the producer-side translation contract is in [`.dev/coo/adversarial-review-producer-contract.md`](adversarial-review-producer-contract.md); upstream Codex plugin schema changes are not part of this merge gate.

For PRs that change the Paperclip workflow contract or artifact gate, the PR body must also record:

```text
PAPERCLIP_MERGE_GATE_STATUS: passed
PAPERCLIP_MERGE_GATE_EVIDENCE: PASS paperclip artifact gate (merge-gate)
```

Before moving Linear or Paperclip to `Done`, run:

```bash
node scripts/paperclip-artifact-gate.mjs --action done --issue-file <paperclip-issue.json>
```

For Paperclip-routed tickets, use the Linear helper for Done transitions so the Paperclip Done gate is not skipped:

```bash
node scripts/linear-helper.mjs status AET-XXX Done --paperclip --paperclip-issue-file <paperclip-issue.json> --yes
```

The `--paperclip` positive signal asserts the ticket is Paperclip-routed; when it is set, `--paperclip-issue-file` is required and the artifact-gate validation runs. For tickets that are not Paperclip-routed, no Paperclip flag is required:

```bash
node scripts/linear-helper.mjs status AET-XXX Done --yes
```

The guard blocks when `plan_gate` is missing, when code review is missing or older than the latest merge-ready adversarial review (`clean` or `dispositionSummary.merge_blocker = 0`), when `verification` is missing or older than code review, when more than one bounded fix loop exists, or when closeout lacks what changed, what passed, and follow-up evidence.

## Post-Merge Worktree Cleanup

The same-day finish rule in `.dev/coo/HYGIENE_POLICY.md` remains canonical. Paperclip closeout makes that rule visible before `Done`.

After every ticket PR merges, closeout is not complete until Auditor reports the worktree cleanup state.

Required closeout order:
1. PR merged and merge SHA recorded.
2. `bash scripts/ticket-worktree.sh finish AET-XXX` run from `/Users/macbook/Developer/Project-Aetherion`, or an explicit deferral reason recorded.
3. `bash scripts/ticket-worktree.sh audit` passes after cleanup.
4. `git rev-parse --is-shallow-repository` returns `false`.
5. Any remaining dirty launcher files are listed as expected or flagged as follow-up.
6. Linear closure comment is posted with cleanup evidence.
7. Linear ticket is moved to `Done`.

If the worktree cannot be removed because it is dirty, ambiguous, or still active, Codex must not force-remove it. `--force` requires Daniel's explicit approval for that exact ticket/worktree.

Instead, Codex must recommend the next best action:
- preserve/archive
- create a follow-up ticket
- leave in place with a time-boxed reason
- manually approve cleanup

## Review Modes, Not Extra Agents

The following modes are bounded artifacts owned by the three agents. Do not create or route to any agent outside the three-agent list above.

## User-Facing Review Mode

Use Auditor user-facing review when the ticket changes what the user sees, reads, clicks, submits, or must emotionally trust. Typical triggers:

- Dashboard UI changes
- New or revised forms
- Onboarding or booking steps
- CS or booking message copy that users must interpret
- Mobile/responsive behavior changes
- Flow or interaction patterns that could confuse, pressure, or mislead users

The Auditor returns:

- `design_review` document using `.dev/coo/design-review-template.md`
- verdict comment: `APPROVED`, `REVISE`, or `BLOCKED`

Aetherion CEO folds accepted changes into the parent `plan` or escalates to Daniel for a product decision.

## Design Direction Mode

Use Auditor design direction when the issue needs more than critique. Typical triggers:

- a net-new dashboard or product surface
- design-system extension or consolidation
- interaction model is still being invented, not just refined
- user-trust or information-architecture risk needs a clear recommendation

The Auditor returns:

- `design_direction` document using `.dev/coo/design-direction-template.md`
- verdict comment: `READY`, `REVISE`, or `BLOCKED`

Aetherion CEO folds the accepted direction back into the parent `plan` and keeps ownership of approval timing.

## Formal Code Review Mode

Use Auditor code review after the latest merge-ready adversarial review (`clean` or `dispositionSummary.merge_blocker = 0`) and before merge gate. It is always distinct from adversarial review. Codex-lane packets remain bound to the artifact shape accepted by Codex-lane packet tooling; do not treat Paperclip merge-readiness as expanding Codex-lane tooling support. Typical triggers:

- every ticketed code PR
- docs-only PRs that change workflow contracts, review gates, or merge evidence
- any `PARTIAL` verification verdict
- a PR that feels close to merge but could still hide production risk

The Auditor returns:

- `code_review` document using `.dev/coo/pre-merge-review-template.md`
- verdict comment: `CLEAR`, `REVISE`, or `BLOCKED`

Aetherion CEO decides whether to send changes back to Software Engineer, proceed to merge gate, or escalate to Daniel. Auditor code review does not replace adversarial review. `review_findings` is escalation-only supporting evidence and must not satisfy routine `code_review`.

## Browser QA Mode

Use Auditor browser QA when the ticket needs browser-grounded bug reporting without code changes. Typical triggers:

- preview validation before merge
- trust-sensitive flows that need manual repro and screenshots
- uncertainty about what is actually broken in a user flow

The Auditor returns:

- `qa_report` document using `.dev/coo/qa-report-template.md`
- verdict comment: `CLEAR`, `ISSUES_FOUND`, or `BLOCKED`

Aetherion CEO decides whether the result should go to Software Engineer for the one bounded fix loop, to merge gate, or to Daniel for a scope decision.

## Bounded Fix Loop Mode

Use Software Engineer bounded fix loop when Auditor found concrete issues and the one allowed fix loop has not been used. Accepted same-scope adversarial `merge_blocker` findings are automatically fixable in this loop without Daniel per-step approval. Typical triggers:

- adversarial review found fixable findings
- browser evidence exists and a quick fix-and-retest pass is appropriate
- the work can stay inside the approved scope

Software Engineer returns:

- updated `execution_report`
- `qa_fix_report` when browser QA drove the fix
- verdict comment: `READY_FOR_REVIEW`, `BLOCKED`, or `SCOPE_CHANGE_NEEDED`

If the fix loop uncovers deeper feature or architecture work, leaves trust risk unresolved, requires a new product/user-trust decision, or otherwise exceeds the approved scope, Software Engineer returns `SCOPE_CHANGE_NEEDED`; control returns to Aetherion CEO and usually becomes a follow-up ticket.

## Autonomous Adversarial Follow-up Authorization

Canonical rule: `.dev/coo/agent-operating-standard.md` § Autonomous Adversarial Follow-up Authorization. Paperclip-routed tickets follow that rule unchanged; this section only names how the rule lands inside the three-agent model.

When the Auditor's adversarial-review rerun finds a real merge-safety, trust, evidence, stale-head, spoofing, or fail-open finding inside the upstream's already-authorized scope after the one bounded fix loop is exhausted, Aetherion CEO may open a fresh same-scope follow-up Linear ticket and matching Paperclip mirror — at most one open at a time per upstream chain — without Daniel per-step approval. Trust-class and fail-open findings explicitly remain in the autonomy class. The follow-up runs the full Paperclip flow on its own — `linear_intake` → `plan` → `plan_audit` → `plan_gate` → `surgeon_brief` → `execution_report` → `adversarial_review` → `code_review` → `verification` → `merge_gate` → `closeout` — and consumes its own one bounded fix loop.

Daniel escalation per the Daniel Escalation Rule still applies and takes precedence. The trigger is what the **fix** requires, not the class of the finding: escalate before opening or merging the follow-up when the fix requires a new product or user-trust decision (not just remediating a trust-class finding inside the authorized scope), materially changes user-facing safety posture, affects PII handling, changes contract semantics or policy wording, introduces material external-dependency / cost / time-budget risk, repeats a same-class pattern that points to architectural redesign, or touches anything Daniel has explicitly retained.

`AET-424` through `AET-436` are the positive example: a chain of fresh same-scope follow-ups inside the Codex-lane evidence-trust scope, each running its own Paperclip-routed flow, each open one-at-a-time. That is the shape the rule authorizes; it is not the shape of process churn.

## Document Keys

Parent issue:

- `linear_intake`
- `plan`
- `plan_audit`
- `plan_gate`
- `surgeon_brief`
- `execution_report`
- `adversarial_review`
- `code_review`
- `verification`
- `merge_gate`
- `closeout`

Review artifacts:

- `design_review` for Auditor user-facing review
- `design_direction` for Auditor design direction
- `review_findings` for Staff Engineer escalation findings only
- `qa_report` for Auditor browser QA
- `qa_fix_report` for Software Engineer bounded fix loop

## Operating Principles

- Linear stays authoritative.
- Paperclip makes the quality funnel visible.
- Review modes are bounded artifacts, not extra agents or routine lanes.
- No execution starts before the plan is approved and `surgeon_brief` exists.
- No merge moves forward on weak evidence or skipped review gates.
- All Core changes must comply with `RUNTIME_NORTH_STAR.md` before plan approval.

## Daniel Escalation Rule

Daniel is escalation-only. Routine execution must stay inside Aetherion CEO, Auditor, Software Engineer, bounded fix loop, merge gate, and closeout.

Escalate to Daniel only when one of these conditions is true:

- Scope needs to change beyond the approved plan or `surgeon_brief`.
- A same-scope trust-class fix cannot resolve the trust risk inside the approved scope, or the fix requires a new user-trust decision.
- Production risk is material and cannot be reduced with available evidence.
- An external dependency blocks progress and requires a business decision.
- Evidence remains weak after the bounded fix loop and review gates.
- Daniel explicitly requests intervention.

## Escalation Matrix

When something goes wrong mid-plan, Aetherion CEO chooses one of these paths:

| Situation | Action | Owner |
|-----------|--------|-------|
| Software Engineer discovers scope is wrong or blocking dependency isn't ready | Create child issue with findings, return to Aetherion CEO | Software Engineer -> Aetherion CEO |
| Auditor review feedback exceeds the one bounded fix loop | Aetherion CEO may stop, document risk, or escalate to Daniel | Aetherion CEO |
| External service blocker (API quota, platform down) | Mark issue blocked with external reason, do not redesign workflow | Aetherion CEO |
| Disagreement between Aetherion CEO and Auditor verdict | Either escalate to Daniel for decision, or document the override as a risk acknowledgment in the parent issue | Aetherion CEO |
| Hygiene red state discovered mid-execution | Software Engineer stops, reports to Aetherion CEO, Aetherion CEO remediates or registers time-boxed exception | Software Engineer -> Aetherion CEO |

Do not silently reassign lanes. Every lane change must have a comment explaining why.

## Verification Verdicts

The `verification` artifact includes a verdict that determines the merge path:

| Verdict | Meaning | Next Step |
|---------|---------|-----------|
| `COMPLETE` | All evidence collected, tests pass, traces clean, manual verification done | Proceed to merge gate |
| `PARTIAL` | Most evidence collected, but one category is weak (e.g., Langfuse unreachable, staging down) | Auditor formal code review must decide whether the gap blocks merge gate |
| `WEAK` | Multiple evidence gaps, cannot fully confirm safety | Do not merge. Return to Software Engineer for additional work, or escalate to Daniel |

Aetherion CEO must declare the verdict explicitly. "Looks good" is not a verdict.

## Intake Bridge: Linear-to-Paperclip Mirror

Every Linear ticket that enters the Paperclip execution desk must have a corresponding Paperclip parent issue. Always create or reuse the mirror through the standard helper, never with an unguarded raw create call:

```bash
bash scripts/paperclip-find-or-create-mirror.sh <linear-id> <title> [options]
```

Behavior:

- Fetches all company issues and filters for parent issues whose title starts with `{LINEAR_ID} |`.
- If a matching live (non-cancelled, non-hidden) parent exists, it is reused.
- If no match exists, a new issue is created with title `{LINEAR_ID} | {short-title}`.
- If multiple live matches exist, the script refuses to create and exits with an error.

Required environment:

- `PAPERCLIP_COMPANY_ID` must be set or passed via `--company-id`.
- `PAPERCLIP_API_URL` defaults to `http://127.0.0.1:3100/api`. The script normalizes the URL to always end with `/api`.

## Ops Heads-Up Path

When drift, debt, or a decision-blocker is detected during work, use the webhook-based helper to post to `#ops-decisions`:

```bash
bash scripts/post-ops-headsup.sh <ticket-id> [message-file|-]
```

Behavior:

- Loads `ALERT_SLACK_WEBHOOK_URL` from `.env` as primary, `SLACK_WEBHOOK_URL` as fallback.
- Posts via webhook only. It never uses `SLACK_BOT_TOKEN` or the Slack Web API.
- Reads message body from a file path or stdin (pass `-` for stdin).

Do not use the Slack Web API or Slack MCP for ops heads-up notices. The webhook path is the canonical transport.

## Reopened Issue Protocol

When a `Done` issue must be reopened (regression, customer report, missed edge case):

1. If the original branch still exists and the worktree can be restored, reuse it.
2. If the branch was deleted or the worktree was cleaned up, create a new Linear issue referencing the original, and a new Paperclip mirror.
3. The reopened issue goes through the full default flow again (plan -> plan audit -> plan_gate -> execution -> adversarial review -> code review -> merge gate -> closeout).
4. Do not reuse the original `verification` or `closeout` artifacts. Fresh evidence is required.

Reopening is not a shortcut. It is a new cycle with full accountability.
