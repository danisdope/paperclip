#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
	compareAutonomousFollowUpEvidence,
	validateAutonomousFollowUpIssue,
} from "./shared/autonomous-followup-contract.mjs";
import {
	DEFERRED_ENHANCEMENTS_ANCHOR_PATTERN,
	DISPOSITION_CONTRACT_REF,
	DISPOSITION_KEYS,
	deriveReviewDispositionCounts,
} from "./shared/review-result-contract.mjs";

// AET-442: anchor the default repo root to the gate script's location so
// `validatePaperclipArtifacts` (and the Linear Done helper that imports it)
// always read docs/review/DEFERRED-ENHANCEMENTS.md from the actual repo, not
// from a caller-supplied cwd. There is intentionally no CLI override (see
// parseArgs); tests pass a different `repoRoot` directly to the function.
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const DEFAULT_REPO_ROOT = resolve(SCRIPT_DIR, "..");

const REQUIRED_CLOSEOUT_FIELDS = ["whatChanged", "whatPassed", "followUp"];
const PLACEHOLDER_EVIDENCE = /^(TBD|TODO|N\/A|NA|-)$/i;
const CLEAN_VERDICTS = new Set([
	"approved",
	"clear",
	"clean",
	"complete",
	"go",
	"pass",
	"passed",
	"ready",
	"ready_for_merge_gate",
	"ready_for_review",
]);
const BLOCKING_VERDICTS = new Set(["blocked", "block", "revise", "issues_found", "weak", "no-go", "nogo"]);
const HARD_BLOCKING_ADVERSARIAL_VERDICTS = new Set(["blocked", "block", "no-go", "nogo"]);
const TYPE_ALIASES = new Map([
	["qa_fix_report", "bounded_fix_loop"],
]);

function usage() {
	return `Usage:
  node scripts/paperclip-artifact-gate.mjs --action merge-gate --issue-file issue.json
  node scripts/paperclip-artifact-gate.mjs --action done --issue-file issue.json
  cat issue.json | node scripts/paperclip-artifact-gate.mjs --action merge-gate

Actions:
  merge-gate  Validate required artifacts before opening or approving merge gate.
  done        Validate closeout evidence before moving Linear/Paperclip to Done.

Autonomous follow-up merge-gate checks require the trusted PR base SHA and
trusted upstream head SHA out of band via PAPERCLIP_TRUSTED_PR_BASE_SHA plus
PAPERCLIP_TRUSTED_BLOCKED_UPSTREAM_HEAD_SHA, or the test-only
validatePaperclipArtifacts() options object. The PR body and issue ledger may
only echo those values; they are not authoritative sources for them.

The repo root used to locate docs/review/DEFERRED-ENHANCEMENTS.md is fixed to
the directory containing this script's parent. There is intentionally no CLI
option to override it (AET-442): a caller-supplied --repo-root could redirect
anchor verification to a planted doc and bypass the deferred-doc proof.
Tests inject repoRoot directly into validatePaperclipArtifacts().

Expected issue JSON:
  {
    "artifacts": [
      {"type":"plan_audit","createdAt":"...","verdict":"APPROVED"},
      {"type":"plan_gate","createdAt":"...","verdict":"APPROVED"},
      {"type":"execution_report","createdAt":"..."},
      {"type":"adversarial_review","createdAt":"...","verdict":"CLEAR"},
      {"type":"code_review","createdAt":"...","verdict":"CLEAR"},
      {"type":"verification","createdAt":"...","verdict":"COMPLETE"},
      {"type":"merge_gate","createdAt":"...","verdict":"GO"},
      {"type":"closeout","createdAt":"...","whatChanged":"...","whatPassed":"...","followUp":"..."}
    ]
  }`;
}

export function parseArgs(argv) {
	const options = {
		action: null,
		issueFile: null,
		json: false,
		repoRoot: null,
	};

	for (let i = 0; i < argv.length; i += 1) {
		const arg = argv[i];
		switch (arg) {
			case "--action":
				options.action = argv[i + 1] ?? null;
				i += 1;
				break;
			case "--issue-file":
				options.issueFile = argv[i + 1] ?? null;
				i += 1;
				break;
			case "--json":
				options.json = true;
				break;
			case "--help":
			case "-h":
				options.action = "help";
				break;
			default:
				throw new Error(`Unknown option: ${arg}`);
		}
	}

	if (options.action === "help") return options;
	if (!["merge-gate", "done"].includes(options.action ?? "")) {
		throw new Error("Missing or invalid --action. Use merge-gate or done.");
	}
	if (options.issueFile === null) options.issueFile = "-";
	// AET-442: production CLI always uses the script's own repo root.
	// `--repo-root` is intentionally NOT a CLI option (a merge-gate caller
	// could otherwise point the gate at a tree containing a planted
	// docs/review/DEFERRED-ENHANCEMENTS.md anchor). Tests pass `repoRoot`
	// directly to validatePaperclipArtifacts() instead.
	options.repoRoot = DEFAULT_REPO_ROOT;
	return options;
}

function readIssueJson(issueFile) {
	const raw = issueFile === "-" ? readFileSync(0, "utf8") : readFileSync(issueFile, "utf8");
	return JSON.parse(raw);
}

function normalizeType(type) {
	const normalized = String(type ?? "")
		.trim()
		.toLowerCase()
		.replaceAll("-", "_")
		.replaceAll(" ", "_");
	return TYPE_ALIASES.get(normalized) ?? normalized;
}

function parseTime(value) {
	const parsed = Date.parse(String(value ?? ""));
	return Number.isNaN(parsed) ? null : parsed;
}

function normalizeArtifacts(issue) {
	const rawArtifacts = Array.isArray(issue?.artifacts)
		? issue.artifacts
		: Array.isArray(issue?.documents)
			? issue.documents
			: [];

	return rawArtifacts
		.map((artifact, index) => {
			const type = normalizeType(artifact.type ?? artifact.key ?? artifact.name ?? artifact.title);
			return {
				...artifact,
				_index: index,
				_type: type,
				_time: parseTime(artifact.updatedAt ?? artifact.updated_at ?? artifact.createdAt ?? artifact.created_at),
			};
		})
		.filter((artifact) => artifact._type);
}

function artifactsOfType(artifacts, type) {
	return artifacts.filter((artifact) => artifact._type === type);
}

function latest(artifacts) {
	return [...artifacts].sort((a, b) => {
		const aTime = a._time ?? -1;
		const bTime = b._time ?? -1;
		if (aTime !== bTime) return bTime - aTime;
		return b._index - a._index;
	})[0];
}

function isCleanArtifact(artifact) {
	if (!artifact) return false;
	const verdict = String(artifact.verdict ?? artifact.status ?? "").trim().toLowerCase();
	if (BLOCKING_VERDICTS.has(verdict)) return false;
	if (Array.isArray(artifact.findings) && artifact.findings.length > 0) return false;
	if (Array.isArray(artifact.blockers) && artifact.blockers.length > 0) return false;
	if (artifact.clean === true || artifact.passed === true) return true;
	if (artifact.clear === true || artifact.approved === true) return true;
	return CLEAN_VERDICTS.has(verdict);
}

const DEFERRED_ENHANCEMENTS_DOC_FILENAME = "docs/review/DEFERRED-ENHANCEMENTS.md";
const FULL_SHA_PATTERN = /^[a-f0-9]{40}$/i;

function deriveDispositionCounts(artifact) {
	const findings = Array.isArray(artifact?.findings) ? artifact.findings : [];
	return deriveReviewDispositionCounts(findings, {
		label: "adversarial_review",
		contractRef: DISPOSITION_CONTRACT_REF,
	});
}

function deriveReviewArtifactDispositionCounts(artifact, label) {
	return deriveReviewDispositionCounts(artifact?.findings, {
		label,
		contractRef: DISPOSITION_CONTRACT_REF,
	});
}

function hasZeroDispositionSummary(artifact) {
	const summary = artifact?.dispositionSummary;
	if (!summary || typeof summary !== "object" || Array.isArray(summary)) return false;
	return DISPOSITION_KEYS.every((key) => summary[key] === 0);
}

function isCleanReviewArtifact(artifact) {
	if (!isCleanArtifact(artifact)) return false;
	if (!Array.isArray(artifact.findings) || artifact.findings.length !== 0) return false;
	return hasZeroDispositionSummary(artifact);
}

function countOccurrences(haystack, needle) {
	if (!haystack || !needle) return 0;
	let count = 0;
	let pos = 0;
	while (true) {
		const next = haystack.indexOf(needle, pos);
		if (next === -1) break;
		count += 1;
		pos = next + needle.length;
	}
	return count;
}

function verifyDeferredDocAnchors(artifact, repoRoot, failures) {
	const findings = Array.isArray(artifact?.findings) ? artifact.findings : [];
	const findingsToCheck = [];
	for (let i = 0; i < findings.length; i += 1) {
		const finding = findings[i];
		if (!finding || typeof finding !== "object" || Array.isArray(finding)) continue;
		const anchor = finding.deferred_enhancements_anchor;
		if (typeof anchor === "string" && anchor.length > 0 && DEFERRED_ENHANCEMENTS_ANCHOR_PATTERN.test(anchor)) {
			findingsToCheck.push({ index: i, anchor });
		}
	}
	if (findingsToCheck.length === 0) return;

	const docPath = resolve(repoRoot, DEFERRED_ENHANCEMENTS_DOC_FILENAME);
	if (!existsSync(docPath)) {
		failures.push(
			`adversarial_review.findings carry deferred_enhancements_anchor values but ${DEFERRED_ENHANCEMENTS_DOC_FILENAME} was not found at ${docPath} (see ${DISPOSITION_CONTRACT_REF}).`,
		);
		return;
	}
	let docContent;
	try {
		docContent = readFileSync(docPath, "utf8");
	} catch (error) {
		failures.push(
			`adversarial_review.findings carry deferred_enhancements_anchor values but ${DEFERRED_ENHANCEMENTS_DOC_FILENAME} could not be read at ${docPath}: ${error instanceof Error ? error.message : String(error)} (see ${DISPOSITION_CONTRACT_REF}).`,
		);
		return;
	}

	for (const { index, anchor } of findingsToCheck) {
		const needle = `<a id="${anchor}"></a>`;
		const count = countOccurrences(docContent, needle);
		if (count === 0) {
			failures.push(
				`adversarial_review.findings[${index}].deferred_enhancements_anchor "${anchor}" has no matching <a id="${anchor}"></a> entry in ${DEFERRED_ENHANCEMENTS_DOC_FILENAME} (Deferred Enhancements Anchor Missing; see ${DISPOSITION_CONTRACT_REF}). Add the entry or use a Linear ticket via follow_up_ticket instead.`,
			);
		} else if (count > 1) {
			failures.push(
				`adversarial_review.findings[${index}].deferred_enhancements_anchor "${anchor}" matches ${count} <a id="${anchor}"></a> entries in ${DEFERRED_ENHANCEMENTS_DOC_FILENAME} (Deferred Enhancements Anchor Duplicate; see ${DISPOSITION_CONTRACT_REF}). Anchors must be unique within the doc.`,
			);
		}
	}
}

function validateReviewDispositionSummary(artifact, label, repoRoot, failures) {
	const findings = Array.isArray(artifact?.findings) ? artifact.findings : [];
	const derived = deriveReviewArtifactDispositionCounts(artifact, label);
	for (const error of derived.errors) failures.push(error);
	if (!derived.ok) return;
	if (label === "adversarial_review") verifyDeferredDocAnchors(artifact, repoRoot, failures);
	const summary = artifact.dispositionSummary;
	if (!summary || typeof summary !== "object" || Array.isArray(summary)) {
		failures.push(
			`${label} is missing dispositionSummary (see ${DISPOSITION_CONTRACT_REF}).`,
		);
		return;
	}
	let summaryTotal = 0;
	let invalidSummary = false;
	for (const key of DISPOSITION_KEYS) {
		const value = summary[key];
		if (!Number.isInteger(value) || value < 0) {
			failures.push(
				`${label}.dispositionSummary.${key} must be a non-negative integer (see ${DISPOSITION_CONTRACT_REF}).`,
			);
			invalidSummary = true;
		} else {
			summaryTotal += value;
		}
	}
	if (invalidSummary) return;
	for (const key of DISPOSITION_KEYS) {
		if (summary[key] !== derived.counts[key]) {
			failures.push(
				`${label}.dispositionSummary.${key}=${summary[key]} does not match the derived count ${derived.counts[key]} from findings (see ${DISPOSITION_CONTRACT_REF}).`,
			);
		}
	}
	if (summaryTotal !== findings.length) {
		failures.push(
			`${label}.dispositionSummary count mismatch: merge_blocker + follow_up_debt + non_blocking_polish = ${summaryTotal} but findings.length = ${findings.length} (see ${DISPOSITION_CONTRACT_REF}).`,
		);
	}
}

function isMergeReadyAdversarialReview(artifact) {
	if (!artifact) return false;
	const verdict = String(artifact.verdict ?? artifact.status ?? "").trim().toLowerCase();
	if (HARD_BLOCKING_ADVERSARIAL_VERDICTS.has(verdict)) return false;
	const findings = Array.isArray(artifact.findings) ? artifact.findings : [];
	if (findings.length === 0) return isCleanReviewArtifact(artifact);
	const derived = deriveDispositionCounts(artifact);
	if (!derived.ok) return false;
	return derived.counts.merge_blocker === 0;
}

function hasMeaningfulEvidenceField(artifact, field) {
	return isMeaningfulEvidenceValue(artifact?.[field]);
}

function isMeaningfulEvidenceValue(value) {
	if (Array.isArray(value)) return value.some((item) => isMeaningfulEvidenceValue(item));
	if (typeof value !== "string") return false;
	const normalized = value.trim();
	return normalized.length > 0 && !PLACEHOLDER_EVIDENCE.test(normalized);
}

function requireArtifact({ artifacts, type, label, failures }) {
	const artifact = latest(artifactsOfType(artifacts, type));
	if (!artifact) failures.push(`${label} artifact is missing.`);
	return artifact;
}

function isAfter(later, earlier) {
	if (!later || !earlier) return false;
	if (later._time !== null && earlier._time !== null && later._time !== earlier._time) {
		return later._time > earlier._time;
	}
	return later._index > earlier._index;
}

function isSameTimeOrAfter(later, earlier) {
	if (!later || !earlier) return false;
	if (later._time !== null && earlier._time !== null) {
		return later._time >= earlier._time;
	}
	return later._index >= earlier._index;
}

export function validatePaperclipArtifacts(issue, action, repoRoot = DEFAULT_REPO_ROOT, options = {}) {
	const artifacts = normalizeArtifacts(issue);
	const failures = [];
	const recordedPrHeadSha = issue?.pr?.headSha ?? issue?.harnessTicketSpine?.pr?.headSha ?? "";
	const prBody = resolvePrBody(issue, repoRoot, options);
	const trustedPrHeadSha = resolveTrustedPrHeadSha(repoRoot, options);
	const prBodyHeadSha = extractPrField(prBody, "HEAD_SHA");
	if (autonomousFollowUpEnabled(issue) && !String(recordedPrHeadSha).trim()) {
		failures.push("pr.HEAD_SHA: issue ledger must record the PR head SHA for autonomous follow-up evidence.");
	}
	if (trustedPrHeadSha && recordedPrHeadSha && !shaMatchesTrusted(recordedPrHeadSha, trustedPrHeadSha)) {
		failures.push("pr.HEAD_SHA: recorded PR head does not match trusted current PR head.");
	}
	if (trustedPrHeadSha && prBodyHeadSha && !shaMatchesTrusted(prBodyHeadSha, trustedPrHeadSha)) {
		failures.push("pr_body.HEAD_SHA: PR body HEAD_SHA does not match trusted current PR head.");
	}
	const trustedBaseSha = resolveTrustedBaseSha(options);
	const trustedBlockedUpstreamHeadSha = resolveTrustedBlockedUpstreamHeadSha(issue, options);
	const trustedBlockedUpstreamTicket = resolveTrustedBlockedUpstreamTicket(issue, options);
	for (const failure of validateAutonomousFollowUpIssue(issue, {
		repoRoot,
		trustedHeadSha: trustedPrHeadSha,
		trustedBaseSha,
		trustedAutonomousFollowUp:
			options.trustedAutonomousFollowUp === true ||
			Boolean(trustedBlockedUpstreamHeadSha || trustedBlockedUpstreamTicket),
		trustedBlockedUpstreamTicket,
		trustedBlockedUpstreamHeadSha,
		requireTrustedHeadSha: true,
		requireTrustedBlockedUpstreamTicket: true,
		requireTrustedBlockedUpstreamHeadSha: true,
	})) {
		failures.push(`autonomous_follow_up.${failure.field}: ${failure.message}`);
	}
	for (const failure of compareAutonomousFollowUpEvidence(prBody, issue)) {
		failures.push(`autonomous_follow_up_consistency.${failure.field}: ${failure.message}`);
	}

	const planAudit = requireArtifact({
		artifacts,
		type: "plan_audit",
		label: "plan_audit",
		failures,
	});
	const planGate = requireArtifact({
		artifacts,
		type: "plan_gate",
		label: "plan_gate",
		failures,
	});
	const executionReport = requireArtifact({
		artifacts,
		type: "execution_report",
		label: "execution_report",
		failures,
	});
	const adversarialReviews = artifactsOfType(artifacts, "adversarial_review");
	const codeReviews = artifactsOfType(artifacts, "code_review");
	const verification = requireArtifact({
		artifacts,
		type: "verification",
		label: "verification",
		failures,
	});
	const fixLoops = artifactsOfType(artifacts, "bounded_fix_loop").concat(artifactsOfType(artifacts, "fix_loop"));

	if (planAudit && !isCleanArtifact(planAudit)) failures.push("plan_audit must have an approving verdict.");
	if (planGate && !isCleanArtifact(planGate)) failures.push("plan_gate must have an approving verdict.");
	if (planAudit && planGate && !isAfter(planGate, planAudit)) {
		failures.push("plan_gate must be created after plan_audit.");
	}
	if (planGate && executionReport && !isAfter(executionReport, planGate)) {
		failures.push("execution_report must be created after plan_gate.");
	}

	if (adversarialReviews.length === 0) failures.push("adversarial_review artifact is missing.");
	if (fixLoops.length > 1) failures.push("Only one bounded fix loop is allowed.");

	const latestAdversarialReview = latest(adversarialReviews);
	const mergeReadyAdversarialReview = latest(adversarialReviews.filter(isMergeReadyAdversarialReview));
	const latestActiveBlockerReview = latest(
		adversarialReviews.filter((artifact) => !isMergeReadyAdversarialReview(artifact)),
	);
	if (latestAdversarialReview) {
		validateReviewDispositionSummary(latestAdversarialReview, "adversarial_review", repoRoot, failures);
	}
	const blockerSupersededByMergeReady =
		latestActiveBlockerReview &&
		mergeReadyAdversarialReview &&
		isAfter(mergeReadyAdversarialReview, latestActiveBlockerReview);
	if (latestActiveBlockerReview && !blockerSupersededByMergeReady) {
		if (fixLoops.length === 0) {
			failures.push("adversarial_review findings require one bounded fix loop.");
		} else {
			const latestFixLoop = latest(fixLoops);
			if (!isAfter(latestFixLoop, latestActiveBlockerReview)) {
				failures.push("bounded fix loop must be created after the adversarial findings.");
			}
			if (!mergeReadyAdversarialReview || !isAfter(mergeReadyAdversarialReview, latestFixLoop)) {
				failures.push("a merge-ready adversarial_review (clean verdict or merge_blocker=0) is required after the bounded fix loop.");
			}
		}
	} else if (latestAdversarialReview && !isMergeReadyAdversarialReview(latestAdversarialReview)) {
		failures.push("a merge-ready adversarial_review artifact (clean verdict or merge_blocker=0) is required.");
	}

	if (!mergeReadyAdversarialReview) failures.push("a merge-ready adversarial_review artifact (clean verdict or merge_blocker=0) is required.");
	if (mergeReadyAdversarialReview && executionReport && !isAfter(mergeReadyAdversarialReview, executionReport)) {
		failures.push("adversarial_review must be newer than execution_report.");
	}

	const codeReview = latest(codeReviews);
	if (!codeReview) {
		failures.push("distinct code_review artifact is missing.");
	} else {
		validateReviewDispositionSummary(codeReview, "code_review", repoRoot, failures);
		if (!isCleanReviewArtifact(codeReview)) {
			failures.push("code_review must have a clean verdict with findings: [] and zeroed dispositionSummary.");
		}
		if (mergeReadyAdversarialReview && !isAfter(codeReview, mergeReadyAdversarialReview)) {
			failures.push("code_review must be created after the latest merge-ready adversarial_review.");
		}
	}

	if (verification) {
		if (!isCleanArtifact(verification)) failures.push("verification must have a complete verdict.");
		if (codeReview && !isSameTimeOrAfter(verification, codeReview)) {
			failures.push("verification must be created at or after code_review.");
		}
	}

	if (action === "done") {
		const mergeGate = requireArtifact({
			artifacts,
			type: "merge_gate",
			label: "merge_gate",
			failures,
		});
		if (mergeGate && !isCleanArtifact(mergeGate)) failures.push("merge_gate must have an approving verdict.");
		if (mergeGate && codeReview && !isAfter(mergeGate, codeReview)) {
			failures.push("merge_gate must be created after code_review.");
		}
		if (mergeGate && verification && !isAfter(mergeGate, verification)) {
			failures.push("merge_gate must be created after verification.");
		}

		const closeout = requireArtifact({
			artifacts,
			type: "closeout",
			label: "closeout",
			failures,
		});
		if (closeout && mergeGate && !isAfter(closeout, mergeGate)) {
			failures.push("closeout must be created after merge_gate.");
		}
		for (const field of REQUIRED_CLOSEOUT_FIELDS) {
			if (closeout && !hasMeaningfulEvidenceField(closeout, field)) {
				failures.push(`closeout.${field} is required before Done.`);
			}
		}
	}

	return {
		ok: failures.length === 0,
		action,
		failures,
	};
}

function resolvePrBody(issue, repoRoot, options = {}) {
	if (typeof options.prBody === "string") return options.prBody;
	const inlineBody =
		issue?.pr?.body ?? issue?.prBody ?? issue?.pullRequest?.body ?? issue?.harnessTicketSpine?.pr?.body ?? "";
	if (typeof inlineBody === "string" && inlineBody.trim()) return inlineBody;

	const bodyPath = issue?.pr?.bodyPath ?? issue?.harnessTicketSpine?.pr?.bodyPath ?? "";
	if (!bodyPath) return "";
	const resolvedPath = resolve(repoRoot, bodyPath);
	if (!existsSync(resolvedPath)) return "";
	return readFileSync(resolvedPath, "utf8");
}

function resolveTrustedBlockedUpstreamHeadSha(issue, options = {}) {
	if (typeof options.trustedBlockedUpstreamHeadSha === "string") return options.trustedBlockedUpstreamHeadSha;
	return process.env.PAPERCLIP_TRUSTED_BLOCKED_UPSTREAM_HEAD_SHA ?? "";
}

function resolveTrustedBlockedUpstreamTicket(issue, options = {}) {
	if (typeof options.trustedBlockedUpstreamTicket === "string") return options.trustedBlockedUpstreamTicket;
	return process.env.PAPERCLIP_TRUSTED_BLOCKED_UPSTREAM_TICKET ?? "";
}

function resolveTrustedBaseSha(options = {}) {
	const supplied = String(options.trustedBaseSha ?? "").trim().toLowerCase();
	if (FULL_SHA_PATTERN.test(supplied)) return supplied;
	const envValue = String(process.env.PAPERCLIP_TRUSTED_PR_BASE_SHA || process.env.PR_BASE_SHA || "")
		.trim()
		.toLowerCase();
	if (FULL_SHA_PATTERN.test(envValue)) return envValue;
	return "";
}

function resolveTrustedPrHeadSha(repoRoot, options = {}) {
	const supplied = String(options.trustedHeadSha ?? "").trim().toLowerCase();
	if (FULL_SHA_PATTERN.test(supplied)) return supplied;
	const envValue = String(process.env.PAPERCLIP_TRUSTED_PR_HEAD_SHA ?? "").trim().toLowerCase();
	if (FULL_SHA_PATTERN.test(envValue)) return envValue;
	try {
		return execFileSync("git", ["rev-parse", "HEAD"], {
			cwd: repoRoot,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "ignore"],
		}).trim().toLowerCase();
	} catch {
		return "";
	}
}

function shaMatchesTrusted(recorded, trusted) {
	const recordedValue = String(recorded ?? "").trim().toLowerCase();
	const trustedValue = String(trusted ?? "").trim().toLowerCase();
	if (!recordedValue || !FULL_SHA_PATTERN.test(trustedValue)) return false;
	if (FULL_SHA_PATTERN.test(recordedValue)) return recordedValue === trustedValue;
	return /^[a-f0-9]{7,39}$/i.test(recordedValue) && trustedValue.startsWith(recordedValue);
}

function extractPrField(body, field) {
	const regex = new RegExp(`^${escapeRegex(field)}:[ \\t]*(.*)$`, "im");
	const match = String(body ?? "").match(regex);
	return match ? match[1].trim() : "";
}

function escapeRegex(value) {
	return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function autonomousFollowUpEnabled(issue) {
	const value = issue?.autonomousFollowUp?.enabled ?? issue?.autonomous_follow_up?.enabled;
	if (value === true) return true;
	if (value === false || value === undefined || value === null) return false;
	return ["true", "yes", "1"].includes(String(value).trim().toLowerCase());
}

function main() {
	let options;
	try {
		options = parseArgs(process.argv.slice(2));
		if (options.action === "help") {
			console.log(usage());
			return;
		}
		const issue = readIssueJson(options.issueFile);
		const result = validatePaperclipArtifacts(issue, options.action, options.repoRoot);
		if (options.json) {
			console.log(JSON.stringify(result, null, 2));
		} else if (result.ok) {
			console.log(`PASS paperclip artifact gate (${options.action})`);
		} else {
			console.error(`FAIL paperclip artifact gate (${options.action})`);
			for (const failure of result.failures) console.error(`- ${failure}`);
		}
		process.exitCode = result.ok ? 0 : 1;
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		console.error(usage());
		process.exitCode = 2;
	}
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
	main();
}
