import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { parseArgs, validatePaperclipArtifacts } from "../paperclip-artifact-gate.mjs";

// AET-442 helpers: build a tmpdir whose docs/review/DEFERRED-ENHANCEMENTS.md
// contains the requested anchors. Pass a duplicate anchor in the array to
// produce a duplicate-anchor scenario. Pass an empty array for an empty doc.
function setupRepoWithAnchors(anchors) {
	const repoRoot = mkdtempSync(join(tmpdir(), "aet-442-gate-"));
	mkdirSync(join(repoRoot, "docs", "review"), { recursive: true });
	const docPath = join(repoRoot, "docs", "review", "DEFERRED-ENHANCEMENTS.md");
	const lines = ["# Deferred Enhancements", ""];
	for (const anchor of anchors) {
		lines.push(`<a id="${anchor}"></a>`);
		lines.push(`### 2026-04-28 — Source ticket: AET-442 — Test entry for ${anchor}`);
		lines.push("- **Finding:** Test finding.");
		lines.push("- **Why deferred:** Test reason.");
		lines.push("- **Surface:** test/file.ts");
		lines.push("- **Source review artifact:** docs/review/AET-442-test.json");
		lines.push("");
	}
	writeFileSync(docPath, lines.join("\n"));
	return repoRoot;
}

function setupEmptyRepo() {
	return mkdtempSync(join(tmpdir(), "aet-442-gate-empty-"));
}

function cleanupRepo(repoRoot) {
	rmSync(repoRoot, { recursive: true, force: true });
}

function git(repoRoot, args) {
	return execFileSync("git", args, {
		cwd: repoRoot,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "ignore"],
	}).trim();
}

function setupContainmentRepo() {
	const repoRoot = mkdtempSync(join(tmpdir(), "aet-453-paperclip-"));
	git(repoRoot, ["init"]);
	git(repoRoot, ["config", "user.email", "test@example.com"]);
	git(repoRoot, ["config", "user.name", "Aetherion Test"]);
	writeFileSync(join(repoRoot, "base.txt"), "base\n");
	git(repoRoot, ["add", "base.txt"]);
	git(repoRoot, ["commit", "-m", "trusted base"]);
	const baseSha = git(repoRoot, ["rev-parse", "HEAD"]);
	writeFileSync(join(repoRoot, "proof.txt"), "blocked\n");
	git(repoRoot, ["add", "proof.txt"]);
	git(repoRoot, ["commit", "-m", "blocked upstream"]);
	const blockedSha = git(repoRoot, ["rev-parse", "HEAD"]);
	writeFileSync(join(repoRoot, "follow-up.txt"), "follow-up\n");
	git(repoRoot, ["add", "follow-up.txt"]);
	git(repoRoot, ["commit", "-m", "autonomous follow-up"]);
	const headSha = git(repoRoot, ["rev-parse", "HEAD"]);
	return { repoRoot, baseSha, blockedSha, headSha };
}

function setupBaseAncestorRepo() {
	const repoRoot = mkdtempSync(join(tmpdir(), "aet-455-paperclip-base-ancestor-"));
	git(repoRoot, ["init"]);
	git(repoRoot, ["config", "user.email", "test@example.com"]);
	git(repoRoot, ["config", "user.name", "Aetherion Test"]);
	writeFileSync(join(repoRoot, "base.txt"), "already landed blocked work\n");
	git(repoRoot, ["add", "base.txt"]);
	git(repoRoot, ["commit", "-m", "older base ancestor"]);
	const blockedSha = git(repoRoot, ["rev-parse", "HEAD"]);
	writeFileSync(join(repoRoot, "base.txt"), "already landed blocked work\nnew main work\n");
	git(repoRoot, ["add", "base.txt"]);
	git(repoRoot, ["commit", "-m", "trusted base head"]);
	const baseSha = git(repoRoot, ["rev-parse", "HEAD"]);
	writeFileSync(join(repoRoot, "follow-up.txt"), "follow-up work\n");
	git(repoRoot, ["add", "follow-up.txt"]);
	git(repoRoot, ["commit", "-m", "follow-up head"]);
	const headSha = git(repoRoot, ["rev-parse", "HEAD"]);
	return { repoRoot, blockedSha, baseSha, headSha };
}

function setupRevertedAncestorRepo() {
	const repoRoot = mkdtempSync(join(tmpdir(), "aet-455-paperclip-revert-ancestor-"));
	git(repoRoot, ["init"]);
	git(repoRoot, ["config", "user.email", "test@example.com"]);
	git(repoRoot, ["config", "user.name", "Aetherion Test"]);
	writeFileSync(join(repoRoot, "proof.txt"), "base\n");
	git(repoRoot, ["add", "proof.txt"]);
	git(repoRoot, ["commit", "-m", "trusted base"]);
	const baseSha = git(repoRoot, ["rev-parse", "HEAD"]);
	writeFileSync(join(repoRoot, "proof.txt"), "base\nblocked fix\n");
	git(repoRoot, ["add", "proof.txt"]);
	git(repoRoot, ["commit", "-m", "blocked upstream"]);
	const blockedSha = git(repoRoot, ["rev-parse", "HEAD"]);
	git(repoRoot, ["revert", "--no-edit", blockedSha]);
	const headSha = git(repoRoot, ["rev-parse", "HEAD"]);
	return { repoRoot, baseSha, blockedSha, headSha };
}

function setupStaleCurrentHeadRepo() {
	const repoRoot = mkdtempSync(join(tmpdir(), "aet-455-paperclip-stale-head-"));
	git(repoRoot, ["init"]);
	git(repoRoot, ["config", "user.email", "test@example.com"]);
	git(repoRoot, ["config", "user.name", "Aetherion Test"]);
	writeFileSync(join(repoRoot, "base.txt"), "base\n");
	git(repoRoot, ["add", "base.txt"]);
	git(repoRoot, ["commit", "-m", "base"]);
	const baseSha = git(repoRoot, ["rev-parse", "HEAD"]);
	const baseBranch = git(repoRoot, ["branch", "--show-current"]);
	git(repoRoot, ["checkout", "-b", "old-follow-up"]);
	writeFileSync(join(repoRoot, "blocked.txt"), "blocked upstream\n");
	git(repoRoot, ["add", "blocked.txt"]);
	git(repoRoot, ["commit", "-m", "blocked upstream"]);
	const blockedSha = git(repoRoot, ["rev-parse", "HEAD"]);
	writeFileSync(join(repoRoot, "follow-up.txt"), "old follow-up contains blocked upstream\n");
	git(repoRoot, ["add", "follow-up.txt"]);
	git(repoRoot, ["commit", "-m", "old autonomous follow-up"]);
	const oldHeadSha = git(repoRoot, ["rev-parse", "HEAD"]);
	git(repoRoot, ["checkout", baseBranch]);
	writeFileSync(join(repoRoot, "follow-up.txt"), "rewritten follow-up without blocked upstream\n");
	git(repoRoot, ["add", "follow-up.txt"]);
	git(repoRoot, ["commit", "-m", "current rewritten follow-up"]);
	const currentHeadSha = git(repoRoot, ["rev-parse", "HEAD"]);
	return { repoRoot, baseSha, blockedSha, oldHeadSha, currentHeadSha };
}

function setupCherryPickContainmentRepo() {
	const repoRoot = mkdtempSync(join(tmpdir(), "aet-453-paperclip-cherry-"));
	git(repoRoot, ["init"]);
	git(repoRoot, ["config", "user.email", "test@example.com"]);
	git(repoRoot, ["config", "user.name", "Aetherion Test"]);
	writeFileSync(join(repoRoot, "base.txt"), "base\n");
	git(repoRoot, ["add", "base.txt"]);
	git(repoRoot, ["commit", "-m", "base"]);
	const baseSha = git(repoRoot, ["rev-parse", "HEAD"]);
	const baseBranch = git(repoRoot, ["branch", "--show-current"]);
	git(repoRoot, ["checkout", "-b", "blocked"]);
	writeFileSync(join(repoRoot, "blocked.txt"), "blocked\n");
	git(repoRoot, ["add", "blocked.txt"]);
	git(repoRoot, ["commit", "-m", "blocked upstream"]);
	const blockedSha = git(repoRoot, ["rev-parse", "HEAD"]);
	git(repoRoot, ["checkout", baseBranch]);
	git(repoRoot, ["cherry-pick", "-x", blockedSha]);
	const headSha = git(repoRoot, ["rev-parse", "HEAD"]);
	return { repoRoot, baseSha, blockedSha, headSha };
}

function setupPartialCherryPickContainmentRepo() {
	const repoRoot = mkdtempSync(join(tmpdir(), "aet-455-paperclip-partial-cherry-"));
	git(repoRoot, ["init"]);
	git(repoRoot, ["config", "user.email", "test@example.com"]);
	git(repoRoot, ["config", "user.name", "Aetherion Test"]);
	writeFileSync(join(repoRoot, "base.txt"), "base\n");
	git(repoRoot, ["add", "base.txt"]);
	git(repoRoot, ["commit", "-m", "base"]);
	const baseSha = git(repoRoot, ["rev-parse", "HEAD"]);
	const baseBranch = git(repoRoot, ["branch", "--show-current"]);
	git(repoRoot, ["checkout", "-b", "blocked"]);
	writeFileSync(join(repoRoot, "first.txt"), "first upstream commit\n");
	git(repoRoot, ["add", "first.txt"]);
	git(repoRoot, ["commit", "-m", "first blocked upstream commit"]);
	writeFileSync(join(repoRoot, "second.txt"), "second upstream commit\n");
	git(repoRoot, ["add", "second.txt"]);
	git(repoRoot, ["commit", "-m", "second blocked upstream commit"]);
	const blockedSha = git(repoRoot, ["rev-parse", "HEAD"]);
	git(repoRoot, ["checkout", baseBranch]);
	git(repoRoot, ["cherry-pick", "-x", blockedSha]);
	const headSha = git(repoRoot, ["rev-parse", "HEAD"]);
	return { repoRoot, baseSha, blockedSha, headSha };
}

function setupMarkerOnlyContainmentRepo() {
	const repoRoot = mkdtempSync(join(tmpdir(), "aet-453-paperclip-marker-"));
	git(repoRoot, ["init"]);
	git(repoRoot, ["config", "user.email", "test@example.com"]);
	git(repoRoot, ["config", "user.name", "Aetherion Test"]);
	writeFileSync(join(repoRoot, "base.txt"), "base\n");
	git(repoRoot, ["add", "base.txt"]);
	git(repoRoot, ["commit", "-m", "base"]);
	const baseSha = git(repoRoot, ["rev-parse", "HEAD"]);
	const baseBranch = git(repoRoot, ["branch", "--show-current"]);
	git(repoRoot, ["checkout", "-b", "blocked"]);
	writeFileSync(join(repoRoot, "blocked.txt"), "blocked\n");
	git(repoRoot, ["add", "blocked.txt"]);
	git(repoRoot, ["commit", "-m", "blocked upstream"]);
	const blockedSha = git(repoRoot, ["rev-parse", "HEAD"]);
	git(repoRoot, ["checkout", baseBranch]);
	writeFileSync(join(repoRoot, "marker-only.txt"), "marker-only\n");
	git(repoRoot, ["add", "marker-only.txt"]);
	git(repoRoot, ["commit", "-m", "marker-only follow-up", "-m", `(cherry picked from commit ${blockedSha})`]);
	const headSha = git(repoRoot, ["rev-parse", "HEAD"]);
	return { repoRoot, baseSha, blockedSha, headSha };
}

function artifact(type, minute, extra = {}) {
	const entry = {
		type,
		createdAt: `2026-04-20T10:${String(minute).padStart(2, "0")}:00Z`,
		...extra,
	};
	if (
		["adversarial_review", "code_review"].includes(type) &&
		Array.isArray(entry.findings) &&
		entry.findings.length === 0 &&
		!Object.prototype.hasOwnProperty.call(entry, "dispositionSummary")
	) {
		entry.dispositionSummary = {
			merge_blocker: 0,
			follow_up_debt: 0,
			non_blocking_polish: 0,
		};
	}
	return entry;
}

function sameTimeArtifact(type, extra = {}) {
	const entry = {
		type,
		createdAt: "2026-04-20T10:00:00Z",
		...extra,
	};
	if (
		["adversarial_review", "code_review"].includes(type) &&
		Array.isArray(entry.findings) &&
		entry.findings.length === 0 &&
		!Object.prototype.hasOwnProperty.call(entry, "dispositionSummary")
	) {
		entry.dispositionSummary = {
			merge_blocker: 0,
			follow_up_debt: 0,
			non_blocking_polish: 0,
		};
	}
	return entry;
}

function happyPathArtifacts() {
	return [
		artifact("plan_audit", 1, { verdict: "APPROVED" }),
		artifact("plan_gate", 2, { verdict: "APPROVED" }),
		artifact("execution_report", 3),
		artifact("adversarial_review", 4, { verdict: "CLEAR", findings: [] }),
		artifact("code_review", 5, { verdict: "CLEAR", findings: [] }),
		artifact("verification", 6, { verdict: "COMPLETE" }),
	];
}

function autonomousPrBody(fields = {}) {
	const values = {
		enabled: true,
		blockedUpstreamTicket: "AET-452",
		blockedUpstreamHeadSha: "1111111111111111111111111111111111111111",
		upstreamDisposition: "follow_up_split",
		containmentProof: "ancestor",
		...fields,
	};
	return `## Aetherion Merge Contract
AUTONOMOUS_FOLLOW_UP: ${values.enabled}
BLOCKED_UPSTREAM_TICKET: ${values.blockedUpstreamTicket}
BLOCKED_UPSTREAM_HEAD_SHA: ${values.blockedUpstreamHeadSha}
UPSTREAM_DISPOSITION: ${values.upstreamDisposition}
CONTAINMENT_PROOF: ${values.containmentProof}
`;
}

function trustedBlockedUpstream(headSha, ticket = "AET-452") {
	return {
		blockedUpstream: {
			ticket,
			headSha,
			source: "test_trusted_upstream_metadata",
		},
	};
}

function trustedOptions(headSha, extra = {}) {
	return {
		trustedBlockedUpstreamTicket: "AET-452",
		trustedBlockedUpstreamHeadSha: headSha,
		...extra,
	};
}

function structuredFinding(extra = {}) {
	return {
		severity: "medium",
		title: "structured finding",
		body: "details",
		file: "src/foo.ts",
		line_start: 1,
		line_end: 1,
		confidence: 0.8,
		recommendation: "fix it",
		blocker_class: "contract_or_evidence",
		merge_impact: "merge_blocker",
		...extra,
	};
}

test("AET-453: non-autonomous issue ledgers do not require containment metadata", () => {
	const issue = {
		autonomousFollowUp: {
			enabled: false,
			blockedUpstreamTicket: "N/A",
			blockedUpstreamHeadSha: "N/A",
			upstreamDisposition: "N/A",
			containmentProof: "N/A",
		},
		artifacts: happyPathArtifacts(),
	};

	const result = validatePaperclipArtifacts(issue, "merge-gate");

	assert.equal(result.ok, true, `unexpected failures: ${result.failures.join("; ")}`);
});

test("AET-455: trusted follow-up metadata rejects non-autonomous issue ledgers", () => {
	const issue = {
		autonomousFollowUp: {
			enabled: false,
			blockedUpstreamTicket: "N/A",
			blockedUpstreamHeadSha: "N/A",
			upstreamDisposition: "N/A",
			containmentProof: "N/A",
		},
		artifacts: happyPathArtifacts(),
	};

	const result = validatePaperclipArtifacts(issue, "merge-gate", undefined, {
		trustedBlockedUpstreamTicket: "AET-452",
		trustedBlockedUpstreamHeadSha: "1111111111111111111111111111111111111111",
	});

	assert.equal(result.ok, false);
	assert.match(result.failures.join("\n"), /autonomous_follow_up\.AUTONOMOUS_FOLLOW_UP/);
});

test("AET-453: autonomous issue ledgers reject missing or N/A containment metadata", () => {
	const issue = {
		autonomousFollowUp: {
			enabled: true,
			blockedUpstreamTicket: "N/A",
			blockedUpstreamHeadSha: "N/A",
			upstreamDisposition: "N/A",
			containmentProof: "N/A",
		},
		artifacts: happyPathArtifacts(),
	};

	const result = validatePaperclipArtifacts(issue, "merge-gate");

	assert.equal(result.ok, false);
	assert.match(result.failures.join("\n"), /autonomous_follow_up\.BLOCKED_UPSTREAM_TICKET/);
	assert.match(result.failures.join("\n"), /autonomous_follow_up\.BLOCKED_UPSTREAM_HEAD_SHA/);
	assert.match(result.failures.join("\n"), /autonomous_follow_up\.UPSTREAM_DISPOSITION/);
	assert.match(result.failures.join("\n"), /autonomous_follow_up\.CONTAINMENT_PROOF/);
});

test("AET-453: autonomous issue ledgers accept valid ancestor containment proof", (t) => {
	const { repoRoot, baseSha, blockedSha, headSha } = setupContainmentRepo();
	t.after(() => cleanupRepo(repoRoot));
	const issue = {
		...trustedBlockedUpstream(blockedSha),
		pr: {
			body: autonomousPrBody({ blockedUpstreamHeadSha: blockedSha }),
			headSha,
		},
		autonomousFollowUp: {
			enabled: true,
			blockedUpstreamTicket: "AET-452",
			blockedUpstreamHeadSha: blockedSha,
			upstreamDisposition: "follow_up_split",
			containmentProof: "ancestor",
		},
		artifacts: happyPathArtifacts(),
	};

	const result = validatePaperclipArtifacts(
		issue,
		"merge-gate",
		repoRoot,
		trustedOptions(blockedSha, { trustedBaseSha: baseSha }),
	);

	assert.equal(result.ok, true, `unexpected failures: ${result.failures.join("; ")}`);
});

test("AET-455: autonomous PR body-only evidence is rejected", (t) => {
	const { repoRoot, blockedSha, headSha } = setupContainmentRepo();
	t.after(() => cleanupRepo(repoRoot));
	const issue = {
		pr: {
			body: autonomousPrBody({ blockedUpstreamHeadSha: blockedSha }),
			headSha,
		},
		autonomousFollowUp: {
			enabled: false,
			blockedUpstreamTicket: "N/A",
			blockedUpstreamHeadSha: "N/A",
			upstreamDisposition: "N/A",
			containmentProof: "N/A",
		},
		artifacts: happyPathArtifacts(),
	};

	const result = validatePaperclipArtifacts(issue, "merge-gate", repoRoot, trustedOptions(blockedSha));

	assert.equal(result.ok, false);
	assert.match(result.failures.join("\n"), /autonomous_follow_up_consistency\.AUTONOMOUS_FOLLOW_UP/);
});

test("AET-455: autonomous issue-ledger-only evidence is rejected", (t) => {
	const { repoRoot, baseSha, blockedSha, headSha } = setupContainmentRepo();
	t.after(() => cleanupRepo(repoRoot));
	const issue = {
		...trustedBlockedUpstream(blockedSha),
		pr: { headSha },
		autonomousFollowUp: {
			enabled: true,
			blockedUpstreamTicket: "AET-452",
			blockedUpstreamHeadSha: blockedSha,
			upstreamDisposition: "follow_up_split",
			containmentProof: "ancestor",
		},
		artifacts: happyPathArtifacts(),
	};

	const result = validatePaperclipArtifacts(
		issue,
		"merge-gate",
		repoRoot,
		trustedOptions(blockedSha, { trustedBaseSha: baseSha }),
	);

	assert.equal(result.ok, false);
	assert.match(result.failures.join("\n"), /autonomous_follow_up_consistency\.AUTONOMOUS_FOLLOW_UP/);
});

test("AET-455: autonomous evidence requires trusted upstream metadata", (t) => {
	const { repoRoot, blockedSha, headSha } = setupContainmentRepo();
	t.after(() => cleanupRepo(repoRoot));
	const issue = {
		pr: {
			body: autonomousPrBody({ blockedUpstreamHeadSha: blockedSha }),
			headSha,
		},
		autonomousFollowUp: {
			enabled: true,
			blockedUpstreamTicket: "AET-452",
			blockedUpstreamHeadSha: blockedSha,
			upstreamDisposition: "follow_up_split",
			containmentProof: "ancestor",
		},
		artifacts: happyPathArtifacts(),
	};

	const result = validatePaperclipArtifacts(issue, "merge-gate", repoRoot);

	assert.equal(result.ok, false);
	assert.match(result.failures.join("\n"), /trusted upstream metadata/);
});

test("AET-455: trusted upstream SHA without trusted ticket is rejected", (t) => {
	const { repoRoot, blockedSha, headSha } = setupContainmentRepo();
	t.after(() => cleanupRepo(repoRoot));
	const issue = {
		...trustedBlockedUpstream(blockedSha),
		pr: {
			body: autonomousPrBody({ blockedUpstreamHeadSha: blockedSha }),
			headSha,
		},
		autonomousFollowUp: {
			enabled: true,
			blockedUpstreamTicket: "AET-452",
			blockedUpstreamHeadSha: blockedSha,
			upstreamDisposition: "follow_up_split",
			containmentProof: "ancestor",
		},
		artifacts: happyPathArtifacts(),
	};

	const result = validatePaperclipArtifacts(issue, "merge-gate", repoRoot, {
		trustedBlockedUpstreamHeadSha: blockedSha,
	});

	assert.equal(result.ok, false);
	assert.match(result.failures.join("\n"), /autonomous_follow_up\.BLOCKED_UPSTREAM_TICKET/);
	assert.match(result.failures.join("\n"), /trusted upstream metadata/);
});

test("AET-455: autonomous containment requires trusted base metadata", (t) => {
	const { repoRoot, blockedSha, headSha } = setupContainmentRepo();
	t.after(() => cleanupRepo(repoRoot));
	const issue = {
		...trustedBlockedUpstream(blockedSha),
		pr: {
			body: autonomousPrBody({ blockedUpstreamHeadSha: blockedSha }),
			headSha,
		},
		autonomousFollowUp: {
			enabled: true,
			blockedUpstreamTicket: "AET-452",
			blockedUpstreamHeadSha: blockedSha,
			upstreamDisposition: "follow_up_split",
			containmentProof: "ancestor",
		},
		artifacts: happyPathArtifacts(),
	};

	const result = validatePaperclipArtifacts(issue, "merge-gate", repoRoot, trustedOptions(blockedSha));

	assert.equal(result.ok, false);
	assert.match(result.failures.join("\n"), /autonomous_follow_up\.BASE_SHA/);
});

test("AET-455: blocked upstream SHA cannot equal the PR head", (t) => {
	const { repoRoot, baseSha, headSha } = setupContainmentRepo();
	t.after(() => cleanupRepo(repoRoot));
	const issue = {
		...trustedBlockedUpstream(headSha),
		pr: {
			body: autonomousPrBody({ blockedUpstreamHeadSha: headSha }),
			headSha,
		},
		autonomousFollowUp: {
			enabled: true,
			blockedUpstreamTicket: "AET-452",
			blockedUpstreamHeadSha: headSha,
			upstreamDisposition: "follow_up_split",
			containmentProof: "ancestor",
		},
		artifacts: happyPathArtifacts(),
	};

	const result = validatePaperclipArtifacts(
		issue,
		"merge-gate",
		repoRoot,
		trustedOptions(headSha, { trustedBaseSha: baseSha }),
	);

	assert.equal(result.ok, false);
	assert.match(result.failures.join("\n"), /must not point at the current PR head/);
});

test("AET-455: blocked upstream SHA cannot equal the trusted base head", (t) => {
	const { repoRoot, headSha } = setupContainmentRepo();
	t.after(() => cleanupRepo(repoRoot));
	const baseSha = git(repoRoot, ["rev-list", "--max-parents=0", "HEAD"]);
	const issue = {
		...trustedBlockedUpstream(baseSha),
		pr: {
			body: autonomousPrBody({ blockedUpstreamHeadSha: baseSha }),
			headSha,
		},
		autonomousFollowUp: {
			enabled: true,
			blockedUpstreamTicket: "AET-452",
			blockedUpstreamHeadSha: baseSha,
			upstreamDisposition: "follow_up_split",
			containmentProof: "ancestor",
		},
		artifacts: happyPathArtifacts(),
	};

	const result = validatePaperclipArtifacts(issue, "merge-gate", repoRoot, trustedOptions(baseSha, { trustedBaseSha: baseSha }));

	assert.equal(result.ok, false);
	assert.match(result.failures.join("\n"), /must not point at the base branch head/);
});

test("AET-455: blocked upstream SHA cannot already be contained in the trusted base branch", (t) => {
	const { repoRoot, blockedSha, baseSha, headSha } = setupBaseAncestorRepo();
	t.after(() => cleanupRepo(repoRoot));
	const issue = {
		...trustedBlockedUpstream(blockedSha),
		pr: {
			body: autonomousPrBody({ blockedUpstreamHeadSha: blockedSha }),
			headSha,
		},
		autonomousFollowUp: {
			enabled: true,
			blockedUpstreamTicket: "AET-452",
			blockedUpstreamHeadSha: blockedSha,
			upstreamDisposition: "follow_up_split",
			containmentProof: "ancestor",
		},
		artifacts: happyPathArtifacts(),
	};

	const result = validatePaperclipArtifacts(
		issue,
		"merge-gate",
		repoRoot,
		trustedOptions(blockedSha, { trustedBaseSha: baseSha }),
	);

	assert.equal(result.ok, false);
	assert.match(result.failures.join("\n"), /must not already be contained in the trusted base branch head/);
});

test("AET-455: containment proof rejects blocked upstream work reverted before HEAD", (t) => {
	const { repoRoot, blockedSha, baseSha, headSha } = setupRevertedAncestorRepo();
	t.after(() => cleanupRepo(repoRoot));
	const issue = {
		...trustedBlockedUpstream(blockedSha),
		pr: {
			body: autonomousPrBody({ blockedUpstreamHeadSha: blockedSha }),
			headSha,
		},
		autonomousFollowUp: {
			enabled: true,
			blockedUpstreamTicket: "AET-452",
			blockedUpstreamHeadSha: blockedSha,
			upstreamDisposition: "follow_up_split",
			containmentProof: "ancestor",
		},
		artifacts: happyPathArtifacts(),
	};

	const result = validatePaperclipArtifacts(
		issue,
		"merge-gate",
		repoRoot,
		trustedOptions(blockedSha, { trustedBaseSha: baseSha }),
	);

	assert.equal(result.ok, false);
	assert.match(result.failures.join("\n"), /final PR head still contains the blocked upstream diff/);
});

test("AET-455: autonomous PR body and issue ledger reject mismatched upstream SHA", (t) => {
	const { repoRoot, baseSha, blockedSha, headSha } = setupContainmentRepo();
	t.after(() => cleanupRepo(repoRoot));
	const issue = {
		...trustedBlockedUpstream(blockedSha),
		pr: {
			body: autonomousPrBody({
				blockedUpstreamHeadSha: "2222222222222222222222222222222222222222",
			}),
			headSha,
		},
		autonomousFollowUp: {
			enabled: true,
			blockedUpstreamTicket: "AET-452",
			blockedUpstreamHeadSha: blockedSha,
			upstreamDisposition: "follow_up_split",
			containmentProof: "ancestor",
		},
		artifacts: happyPathArtifacts(),
	};

	const result = validatePaperclipArtifacts(
		issue,
		"merge-gate",
		repoRoot,
		trustedOptions(blockedSha, { trustedBaseSha: baseSha }),
	);

	assert.equal(result.ok, false);
	assert.match(result.failures.join("\n"), /autonomous_follow_up_consistency\.BLOCKED_UPSTREAM_HEAD_SHA/);
});

test("AET-453: autonomous issue ledgers reject wrong-base containment proof", (t) => {
	const { repoRoot, baseSha, headSha } = setupContainmentRepo();
	t.after(() => cleanupRepo(repoRoot));
	const issue = {
		...trustedBlockedUpstream("1111111111111111111111111111111111111111"),
		pr: { headSha },
		autonomousFollowUp: {
			enabled: true,
			blockedUpstreamTicket: "AET-452",
			blockedUpstreamHeadSha: "1111111111111111111111111111111111111111",
			upstreamDisposition: "follow_up_split",
			containmentProof: "ancestor",
		},
		artifacts: happyPathArtifacts(),
	};

	const result = validatePaperclipArtifacts(
		issue,
		"merge-gate",
		repoRoot,
		trustedOptions("1111111111111111111111111111111111111111", { trustedBaseSha: baseSha }),
	);

	assert.equal(result.ok, false);
	assert.match(result.failures.join("\n"), /autonomous_follow_up\.CONTAINMENT_PROOF/);
});

test("AET-453: autonomous issue ledgers accept recorded cherry-pick proof", (t) => {
	const { repoRoot, baseSha, blockedSha, headSha } = setupCherryPickContainmentRepo();
	t.after(() => cleanupRepo(repoRoot));
	const issue = {
		...trustedBlockedUpstream(blockedSha),
		pr: {
			body: autonomousPrBody({
				blockedUpstreamHeadSha: blockedSha,
				containmentProof: `cherry_pick:${blockedSha}`,
			}),
			headSha,
		},
		autonomousFollowUp: {
			enabled: true,
			blockedUpstreamTicket: "AET-452",
			blockedUpstreamHeadSha: blockedSha,
			upstreamDisposition: "follow_up_split",
			containmentProof: `cherry_pick:${blockedSha}`,
		},
		artifacts: happyPathArtifacts(),
	};

	const result = validatePaperclipArtifacts(
		issue,
		"merge-gate",
		repoRoot,
		trustedOptions(blockedSha, { trustedBaseSha: baseSha }),
	);

	assert.equal(result.ok, true, `unexpected failures: ${result.failures.join("; ")}`);
});

test("AET-455: cherry-pick proof rejects omitted upstream commits", (t) => {
	const { repoRoot, baseSha, blockedSha, headSha } = setupPartialCherryPickContainmentRepo();
	t.after(() => cleanupRepo(repoRoot));
	const issue = {
		...trustedBlockedUpstream(blockedSha),
		pr: {
			body: autonomousPrBody({
				blockedUpstreamHeadSha: blockedSha,
				containmentProof: `cherry_pick:${blockedSha}`,
			}),
			headSha,
		},
		autonomousFollowUp: {
			enabled: true,
			blockedUpstreamTicket: "AET-452",
			blockedUpstreamHeadSha: blockedSha,
			upstreamDisposition: "follow_up_split",
			containmentProof: `cherry_pick:${blockedSha}`,
		},
		artifacts: happyPathArtifacts(),
	};

	const result = validatePaperclipArtifacts(
		issue,
		"merge-gate",
		repoRoot,
		trustedOptions(blockedSha, { trustedBaseSha: baseSha }),
	);

	assert.equal(result.ok, false);
	assert.match(result.failures.join("\n"), /autonomous_follow_up\.CONTAINMENT_PROOF/);
});

test("AET-453: autonomous issue ledgers reject marker-only cherry-pick proof", (t) => {
	const { repoRoot, baseSha, blockedSha, headSha } = setupMarkerOnlyContainmentRepo();
	t.after(() => cleanupRepo(repoRoot));
	const issue = {
		...trustedBlockedUpstream(blockedSha),
		pr: { headSha },
		autonomousFollowUp: {
			enabled: true,
			blockedUpstreamTicket: "AET-452",
			blockedUpstreamHeadSha: blockedSha,
			upstreamDisposition: "follow_up_split",
			containmentProof: `cherry_pick:${blockedSha}`,
		},
		artifacts: happyPathArtifacts(),
	};

	const result = validatePaperclipArtifacts(
		issue,
		"merge-gate",
		repoRoot,
		trustedOptions(blockedSha, { trustedBaseSha: baseSha }),
	);

	assert.equal(result.ok, false);
	assert.match(result.failures.join("\n"), /autonomous_follow_up\.CONTAINMENT_PROOF/);
});

test("AET-455: autonomous issue ledgers reject stale recorded PR heads", (t) => {
	const { repoRoot, baseSha, blockedSha, headSha } = setupCherryPickContainmentRepo();
	t.after(() => cleanupRepo(repoRoot));
	const staleHead = git(repoRoot, ["rev-list", "--max-parents=0", "HEAD"]);
	assert.notEqual(staleHead, headSha);
	const issue = {
		...trustedBlockedUpstream(blockedSha),
		pr: {
			body: `${autonomousPrBody({
				blockedUpstreamHeadSha: blockedSha,
				containmentProof: `cherry_pick:${blockedSha}`,
			})}HEAD_SHA: ${staleHead}\n`,
			headSha: staleHead,
		},
		autonomousFollowUp: {
			enabled: true,
			blockedUpstreamTicket: "AET-452",
			blockedUpstreamHeadSha: blockedSha,
			upstreamDisposition: "follow_up_split",
			containmentProof: `cherry_pick:${blockedSha}`,
		},
		artifacts: happyPathArtifacts(),
	};

	const result = validatePaperclipArtifacts(
		issue,
		"merge-gate",
		repoRoot,
		trustedOptions(blockedSha, { trustedBaseSha: baseSha }),
	);

	assert.equal(result.ok, false);
	const joined = result.failures.join("\n");
	assert.match(joined, /pr\.HEAD_SHA: recorded PR head does not match trusted current PR head/);
	assert.match(joined, /pr_body\.HEAD_SHA: PR body HEAD_SHA does not match trusted current PR head/);
	assert.doesNotMatch(joined, /autonomous_follow_up\.CONTAINMENT_PROOF/);
});

test("AET-455: containment proof is checked against the trusted current PR head", (t) => {
	const { repoRoot, baseSha, blockedSha, oldHeadSha } = setupStaleCurrentHeadRepo();
	t.after(() => cleanupRepo(repoRoot));
	const issue = {
		...trustedBlockedUpstream(blockedSha),
		pr: {
			body: `${autonomousPrBody({ blockedUpstreamHeadSha: blockedSha })}HEAD_SHA: ${oldHeadSha}\n`,
			headSha: oldHeadSha,
		},
		autonomousFollowUp: {
			enabled: true,
			blockedUpstreamTicket: "AET-452",
			blockedUpstreamHeadSha: blockedSha,
			upstreamDisposition: "follow_up_split",
			containmentProof: "ancestor",
		},
		artifacts: happyPathArtifacts(),
	};

	const result = validatePaperclipArtifacts(
		issue,
		"merge-gate",
		repoRoot,
		trustedOptions(blockedSha, { trustedBaseSha: baseSha }),
	);

	assert.equal(result.ok, false);
	const joined = result.failures.join("\n");
	assert.match(joined, /pr\.HEAD_SHA: recorded PR head does not match trusted current PR head/);
	assert.match(joined, /pr_body\.HEAD_SHA: PR body HEAD_SHA does not match trusted current PR head/);
	assert.match(joined, /autonomous_follow_up\.CONTAINMENT_PROOF/);
});

test("AET-453: autonomous issue ledgers require a recorded PR head", () => {
	const issue = {
		...trustedBlockedUpstream("1111111111111111111111111111111111111111"),
		autonomousFollowUp: {
			enabled: true,
			blockedUpstreamTicket: "AET-452",
			blockedUpstreamHeadSha: "1111111111111111111111111111111111111111",
			upstreamDisposition: "follow_up_split",
			containmentProof: "ancestor",
		},
		artifacts: happyPathArtifacts(),
	};

	const result = validatePaperclipArtifacts(issue, "merge-gate", undefined, trustedOptions("1111111111111111111111111111111111111111"));

	assert.equal(result.ok, false);
	assert.match(result.failures.join("\n"), /pr\.HEAD_SHA: issue ledger must record the PR head SHA/);
});

test("merge gate blocks the AET-357 failure mode: no distinct code review", () => {
	const issue = {
		artifacts: [
			artifact("plan_audit", 1, { verdict: "APPROVED" }),
			artifact("plan_gate", 2, { verdict: "APPROVED" }),
			artifact("execution_report", 3),
			artifact("adversarial_review", 4, { verdict: "CLEAR", findings: [] }),
			artifact("verification", 5, { verdict: "COMPLETE" }),
		],
	};

	const result = validatePaperclipArtifacts(issue, "merge-gate");

	assert.equal(result.ok, false);
	assert.match(result.failures.join("\n"), /distinct code_review artifact is missing/);
});

test("merge gate requires plan_gate after plan audit", () => {
	const issue = {
		artifacts: [
			artifact("plan_gate", 1, { verdict: "APPROVED" }),
			artifact("plan_audit", 2, { verdict: "APPROVED" }),
			artifact("execution_report", 3),
			artifact("adversarial_review", 4, { verdict: "CLEAR", findings: [] }),
			artifact("code_review", 5, { verdict: "CLEAR", findings: [] }),
			artifact("verification", 6, { verdict: "COMPLETE" }),
		],
	};

	const result = validatePaperclipArtifacts(issue, "merge-gate");

	assert.equal(result.ok, false);
	assert.match(result.failures.join("\n"), /plan_gate must be created after plan_audit/);
});

test("merge gate requires code review after the latest clean adversarial review", () => {
	const issue = {
		artifacts: [
			artifact("plan_audit", 1, { verdict: "APPROVED" }),
			artifact("plan_gate", 2, { verdict: "APPROVED" }),
			artifact("execution_report", 3),
			artifact("code_review", 4, { verdict: "CLEAR", findings: [] }),
			artifact("adversarial_review", 5, { verdict: "CLEAR", findings: [] }),
			artifact("verification", 6, { verdict: "COMPLETE" }),
		],
	};

	const result = validatePaperclipArtifacts(issue, "merge-gate");

	assert.equal(result.ok, false);
	assert.match(result.failures.join("\n"), /code_review must be created after the latest merge-ready adversarial_review/);
});

test("merge gate blocks when execution report is updated after adversarial review", () => {
	const issue = {
		artifacts: [
			artifact("plan_audit", 1, { verdict: "APPROVED" }),
			artifact("plan_gate", 2, { verdict: "APPROVED" }),
			{
				...artifact("execution_report", 3),
				updatedAt: "2026-04-20T10:07:00Z",
			},
			artifact("adversarial_review", 4, { verdict: "CLEAR", findings: [] }),
			artifact("code_review", 5, { verdict: "CLEAR", findings: [] }),
			artifact("verification", 6, { verdict: "COMPLETE" }),
		],
	};

	const result = validatePaperclipArtifacts(issue, "merge-gate");

	assert.equal(result.ok, false);
	assert.match(result.failures.join("\n"), /adversarial_review must be newer than execution_report/);
});

test("merge gate blocks when adversarial review is updated after code review", () => {
	const issue = {
		artifacts: [
			artifact("plan_audit", 1, { verdict: "APPROVED" }),
			artifact("plan_gate", 2, { verdict: "APPROVED" }),
			artifact("execution_report", 3),
			{
				...artifact("adversarial_review", 4, { verdict: "CLEAR", findings: [] }),
				updatedAt: "2026-04-20T10:07:00Z",
			},
			artifact("code_review", 5, { verdict: "CLEAR", findings: [] }),
			artifact("verification", 6, { verdict: "COMPLETE" }),
		],
	};

	const result = validatePaperclipArtifacts(issue, "merge-gate");

	assert.equal(result.ok, false);
	assert.match(result.failures.join("\n"), /code_review must be created after the latest merge-ready adversarial_review/);
});

test("later merge-ready adversarial review supersedes prior blocker review without requiring a fix loop artifact", () => {
	const issue = {
		artifacts: [
			artifact("plan_audit", 1, { verdict: "APPROVED" }),
			artifact("plan_gate", 2, { verdict: "APPROVED" }),
			artifact("execution_report", 3),
			artifact("adversarial_review", 4, { verdict: "REVISE", findings: ["legacy finding without dispositionSummary"] }),
			artifact("adversarial_review", 5, { verdict: "CLEAR", findings: [] }),
			artifact("code_review", 6, { verdict: "CLEAR", findings: [] }),
			artifact("verification", 7, { verdict: "COMPLETE" }),
		],
	};

	const result = validatePaperclipArtifacts(issue, "merge-gate");

	assert.equal(result.ok, true);
});

test("review_findings does not count as the code review artifact", () => {
	const issue = {
		artifacts: [
			artifact("plan_audit", 1, { verdict: "APPROVED" }),
			artifact("plan_gate", 2, { verdict: "APPROVED" }),
			artifact("execution_report", 3),
			artifact("adversarial_review", 4, { verdict: "CLEAR", findings: [] }),
			artifact("review_findings", 5, { verdict: "CLEAR", findings: [] }),
			artifact("verification", 6, { verdict: "COMPLETE" }),
		],
	};

	const result = validatePaperclipArtifacts(issue, "merge-gate");

	assert.equal(result.ok, false);
	assert.match(result.failures.join("\n"), /distinct code_review artifact is missing/);
});

test("artifact list order breaks ties when timestamps match", () => {
	const issue = {
		artifacts: [
			sameTimeArtifact("plan_audit", { verdict: "APPROVED" }),
			sameTimeArtifact("plan_gate", { verdict: "APPROVED" }),
			sameTimeArtifact("execution_report"),
			sameTimeArtifact("adversarial_review", { verdict: "CLEAR", findings: [] }),
			sameTimeArtifact("code_review", { verdict: "CLEAR", findings: [] }),
			sameTimeArtifact("verification", { verdict: "COMPLETE" }),
		],
	};

	const result = validatePaperclipArtifacts(issue, "merge-gate");

	assert.equal(result.ok, true);
});

test("artifact list order still blocks reversed same-timestamp gates", () => {
	const issue = {
		artifacts: [
			sameTimeArtifact("plan_gate", { verdict: "APPROVED" }),
			sameTimeArtifact("plan_audit", { verdict: "APPROVED" }),
			sameTimeArtifact("execution_report"),
			sameTimeArtifact("adversarial_review", { verdict: "CLEAR", findings: [] }),
			sameTimeArtifact("code_review", { verdict: "CLEAR", findings: [] }),
			sameTimeArtifact("verification", { verdict: "COMPLETE" }),
		],
	};

	const result = validatePaperclipArtifacts(issue, "merge-gate");

	assert.equal(result.ok, false);
	assert.match(result.failures.join("\n"), /plan_gate must be created after plan_audit/);
});

test("plan audit must be approving", () => {
	const issue = {
		artifacts: [
			artifact("plan_audit", 1, { verdict: "BLOCKED" }),
			artifact("plan_gate", 2, { verdict: "APPROVED" }),
			artifact("execution_report", 3),
			artifact("adversarial_review", 4, { verdict: "CLEAR", findings: [] }),
			artifact("code_review", 5, { verdict: "CLEAR", findings: [] }),
			artifact("verification", 6, { verdict: "COMPLETE" }),
		],
	};

	const result = validatePaperclipArtifacts(issue, "merge-gate");

	assert.equal(result.ok, false);
	assert.match(result.failures.join("\n"), /plan_audit must have an approving verdict/);
});

test("one bounded fix loop requires a fresh clean adversarial review before code review", () => {
	const issue = {
		artifacts: [
			artifact("plan_audit", 1, { verdict: "APPROVED" }),
			artifact("plan_gate", 2, { verdict: "APPROVED" }),
			artifact("execution_report", 3),
			artifact("adversarial_review", 4, {
				verdict: "REVISE",
				findings: [structuredFinding({ merge_impact: "merge_blocker", blocker_class: "runtime_or_behavioral_regression" })],
				dispositionSummary: { merge_blocker: 1, follow_up_debt: 0, non_blocking_polish: 0 },
			}),
			artifact("bounded_fix_loop", 5, { verdict: "READY_FOR_REVIEW" }),
			artifact("adversarial_review", 6, { verdict: "CLEAR", findings: [] }),
			artifact("code_review", 7, { verdict: "CLEAR", findings: [] }),
			artifact("verification", 8, { verdict: "COMPLETE" }),
		],
	};

	const result = validatePaperclipArtifacts(issue, "merge-gate");

	assert.equal(result.ok, true);
});

test("second bounded fix loop blocks merge gate", () => {
	const issue = {
		artifacts: [
			...happyPathArtifacts(),
			artifact("bounded_fix_loop", 7, { verdict: "READY_FOR_REVIEW" }),
			artifact("bounded_fix_loop", 8, { verdict: "READY_FOR_REVIEW" }),
			artifact("adversarial_review", 9, { verdict: "CLEAR", findings: [] }),
			artifact("code_review", 10, { verdict: "CLEAR", findings: [] }),
			artifact("verification", 11, { verdict: "COMPLETE" }),
		],
	};

	const result = validatePaperclipArtifacts(issue, "merge-gate");

	assert.equal(result.ok, false);
	assert.match(result.failures.join("\n"), /Only one bounded fix loop is allowed/);
});

test("merge gate blocks without verification evidence", () => {
	const issue = {
		artifacts: [
			artifact("plan_audit", 1, { verdict: "APPROVED" }),
			artifact("plan_gate", 2, { verdict: "APPROVED" }),
			artifact("execution_report", 3),
			artifact("adversarial_review", 4, { verdict: "CLEAR", findings: [] }),
			artifact("code_review", 5, { verdict: "CLEAR", findings: [] }),
		],
	};

	const result = validatePaperclipArtifacts(issue, "merge-gate");

	assert.equal(result.ok, false);
	assert.match(result.failures.join("\n"), /verification artifact is missing/);
});

test("merge gate requires verification at or after code review", () => {
	const issue = {
		artifacts: [
			artifact("plan_audit", 1, { verdict: "APPROVED" }),
			artifact("plan_gate", 2, { verdict: "APPROVED" }),
			artifact("execution_report", 3),
			artifact("adversarial_review", 4, { verdict: "CLEAR", findings: [] }),
			artifact("verification", 5, { verdict: "COMPLETE" }),
			artifact("code_review", 6, { verdict: "CLEAR", findings: [] }),
		],
	};

	const result = validatePaperclipArtifacts(issue, "merge-gate");

	assert.equal(result.ok, false);
	assert.match(result.failures.join("\n"), /verification must be created at or after code_review/);
});

test("merge gate allows verification at the same timestamp as code review", () => {
	const issue = {
		artifacts: [
			artifact("plan_audit", 1, { verdict: "APPROVED" }),
			artifact("plan_gate", 2, { verdict: "APPROVED" }),
			artifact("execution_report", 3),
			artifact("adversarial_review", 4, { verdict: "CLEAR", findings: [] }),
			artifact("code_review", 5, { verdict: "CLEAR", findings: [] }),
			artifact("verification", 5, { verdict: "COMPLETE" }),
		],
	};

	const result = validatePaperclipArtifacts(issue, "merge-gate");

	assert.equal(result.ok, true);
});

test("merge gate ignores extra codex-lane metadata when artifact order is valid", () => {
	const issue = {
		ticket: "AET-373",
		reviewPackets: {
			adversarial: { packetHash: "hash-a" },
			codeReview: { packetHash: "hash-b" },
		},
		artifacts: [
			artifact("plan_audit", 1, { verdict: "APPROVED", path: ".planning/codex-lane/AET-373/plan_audit.md" }),
			artifact("plan_gate", 2, { verdict: "APPROVED", path: ".planning/codex-lane/AET-373/plan_gate.md" }),
			artifact("execution_report", 3, { path: ".planning/codex-lane/AET-373/execution_report.md" }),
			artifact("adversarial_review", 4, {
				verdict: "CLEAR",
				findings: [],
				path: ".planning/codex-lane/AET-373/adversarial_review.md",
				packetHash: "hash-a",
				reviewerAgentId: "codex-reviewer-a",
				cleanRoom: true,
				forkContext: false,
			}),
			artifact("code_review", 5, {
				verdict: "CLEAR",
				findings: [],
				path: ".planning/codex-lane/AET-373/code_review.md",
				packetHash: "hash-b",
				reviewerAgentId: "codex-reviewer-b",
				cleanRoom: true,
				forkContext: false,
			}),
			artifact("verification", 6, { verdict: "COMPLETE", path: ".planning/codex-lane/AET-373/verification.md" }),
		],
	};

	const result = validatePaperclipArtifacts(issue, "merge-gate");

	assert.equal(result.ok, true);
});

test("done blocks without closeout evidence", () => {
	const issue = {
		artifacts: [...happyPathArtifacts(), artifact("merge_gate", 7, { verdict: "GO" })],
	};

	const result = validatePaperclipArtifacts(issue, "done");

	assert.equal(result.ok, false);
	assert.match(result.failures.join("\n"), /closeout artifact is missing/);
});

test("done requires merge gate after verification", () => {
	const issue = {
		artifacts: [
			artifact("plan_audit", 1, { verdict: "APPROVED" }),
			artifact("plan_gate", 2, { verdict: "APPROVED" }),
			artifact("execution_report", 3),
			artifact("adversarial_review", 4, { verdict: "CLEAR", findings: [] }),
			artifact("code_review", 5, { verdict: "CLEAR", findings: [] }),
			artifact("merge_gate", 6, { verdict: "GO" }),
			artifact("verification", 7, { verdict: "COMPLETE" }),
			artifact("closeout", 8, {
				whatChanged: "Added Paperclip artifact guard.",
				whatPassed: "Regression tests passed.",
				followUp: "None.",
			}),
		],
	};

	const result = validatePaperclipArtifacts(issue, "done");

	assert.equal(result.ok, false);
	assert.match(result.failures.join("\n"), /merge_gate must be created after verification/);
});

test("done rejects placeholder or non-text closeout evidence", () => {
	const issue = {
		artifacts: [
			...happyPathArtifacts(),
			artifact("merge_gate", 7, { verdict: "GO" }),
			artifact("closeout", 8, {
				whatChanged: "TBD",
				whatPassed: {},
				followUp: [" "],
			}),
		],
	};

	const result = validatePaperclipArtifacts(issue, "done");

	assert.equal(result.ok, false);
	assert.match(result.failures.join("\n"), /closeout.whatChanged is required before Done/);
	assert.match(result.failures.join("\n"), /closeout.whatPassed is required before Done/);
	assert.match(result.failures.join("\n"), /closeout.followUp is required before Done/);
});

test("done requires what changed, what passed, and follow-up closeout fields", () => {
	const issue = {
		artifacts: [
			...happyPathArtifacts(),
			artifact("merge_gate", 7, { verdict: "GO" }),
			artifact("closeout", 8, {
				whatChanged: "Added Paperclip artifact guard.",
				whatPassed: "Regression tests passed.",
				followUp: "None.",
			}),
		],
	};

	const result = validatePaperclipArtifacts(issue, "done");

	assert.equal(result.ok, true);
});

test("clean adversarial review with no findings requires zeroed dispositionSummary", () => {
	const issue = {
		artifacts: [
			artifact("plan_audit", 1, { verdict: "APPROVED" }),
			artifact("plan_gate", 2, { verdict: "APPROVED" }),
			artifact("execution_report", 3),
			artifact("adversarial_review", 4, { verdict: "CLEAR", findings: [], dispositionSummary: undefined }),
			artifact("code_review", 5, { verdict: "CLEAR", findings: [] }),
			artifact("verification", 6, { verdict: "COMPLETE" }),
		],
	};

	const result = validatePaperclipArtifacts(issue, "merge-gate");

	assert.equal(result.ok, false);
	assert.match(result.failures.join("\n"), /adversarial_review is missing dispositionSummary/);
});

test("clean code review with no findings requires zeroed dispositionSummary", () => {
	const issue = {
		artifacts: [
			artifact("plan_audit", 1, { verdict: "APPROVED" }),
			artifact("plan_gate", 2, { verdict: "APPROVED" }),
			artifact("execution_report", 3),
			artifact("adversarial_review", 4, { verdict: "CLEAR", findings: [] }),
			artifact("code_review", 5, { verdict: "CLEAR", findings: [], dispositionSummary: undefined }),
			artifact("verification", 6, { verdict: "COMPLETE" }),
		],
	};

	const result = validatePaperclipArtifacts(issue, "merge-gate");

	assert.equal(result.ok, false);
	assert.match(result.failures.join("\n"), /code_review is missing dispositionSummary/);
	assert.match(
		result.failures.join("\n"),
		/code_review must have a clean verdict with findings: \[\] and zeroed dispositionSummary/,
	);
});

test("active adversarial review with structured findings is rejected when dispositionSummary is missing", () => {
	const issue = {
		artifacts: [
			artifact("plan_audit", 1, { verdict: "APPROVED" }),
			artifact("plan_gate", 2, { verdict: "APPROVED" }),
			artifact("execution_report", 3),
			artifact("adversarial_review", 4, {
				verdict: "REVISE",
				findings: [structuredFinding({ merge_impact: "merge_blocker", blocker_class: "runtime_or_behavioral_regression" })],
			}),
			artifact("code_review", 5, { verdict: "CLEAR", findings: [] }),
			artifact("verification", 6, { verdict: "COMPLETE" }),
		],
	};

	const result = validatePaperclipArtifacts(issue, "merge-gate");

	assert.equal(result.ok, false);
	assert.match(
		result.failures.join("\n"),
		/adversarial_review is missing dispositionSummary/,
	);
});

test("active adversarial review is rejected when dispositionSummary counts do not match per-finding derived counts", () => {
	const issue = {
		artifacts: [
			artifact("plan_audit", 1, { verdict: "APPROVED" }),
			artifact("plan_gate", 2, { verdict: "APPROVED" }),
			artifact("execution_report", 3),
			artifact("adversarial_review", 4, {
				verdict: "REVISE",
				findings: [structuredFinding({ merge_impact: "merge_blocker", blocker_class: "runtime_or_behavioral_regression" })],
				dispositionSummary: { merge_blocker: 0, follow_up_debt: 2, non_blocking_polish: 0 },
			}),
			artifact("code_review", 5, { verdict: "CLEAR", findings: [] }),
			artifact("verification", 6, { verdict: "COMPLETE" }),
		],
	};

	const result = validatePaperclipArtifacts(issue, "merge-gate");

	assert.equal(result.ok, false);
	const joined = result.failures.join("\n");
	assert.match(joined, /dispositionSummary\.merge_blocker=0 does not match the derived count 1/);
	assert.match(joined, /dispositionSummary\.follow_up_debt=2 does not match the derived count 0/);
	assert.match(joined, /dispositionSummary count mismatch/);
});

test("legacy pre-contract findings artifact superseded by clean rerun does not block merge", () => {
	const issue = {
		artifacts: [
			artifact("plan_audit", 1, { verdict: "APPROVED" }),
			artifact("plan_gate", 2, { verdict: "APPROVED" }),
			artifact("execution_report", 3),
			artifact("adversarial_review", 4, { verdict: "REVISE", findings: ["legacy finding without dispositionSummary"] }),
			artifact("bounded_fix_loop", 5, { verdict: "READY_FOR_REVIEW" }),
			artifact("adversarial_review", 6, { verdict: "CLEAR", findings: [] }),
			artifact("code_review", 7, { verdict: "CLEAR", findings: [] }),
			artifact("verification", 8, { verdict: "COMPLETE" }),
		],
	};

	const result = validatePaperclipArtifacts(issue, "merge-gate");

	assert.equal(result.ok, true);
});

test("blocker review superseded by later merge-ready debt-only rerun does not force a fix loop", () => {
	const issue = {
		artifacts: [
			artifact("plan_audit", 1, { verdict: "APPROVED" }),
			artifact("plan_gate", 2, { verdict: "APPROVED" }),
			artifact("execution_report", 3),
			artifact("adversarial_review", 4, {
				verdict: "REVISE",
				findings: ["unresolved blocker from first pass"],
				dispositionSummary: { merge_blocker: 1, follow_up_debt: 0, non_blocking_polish: 0 },
			}),
			artifact("adversarial_review", 5, {
				verdict: "needs-attention",
				findings: [
					structuredFinding({
						merge_impact: "follow_up_debt",
						blocker_class: "contract_or_evidence",
						follow_up_ticket: "AET-413",
					}),
				],
				dispositionSummary: { merge_blocker: 0, follow_up_debt: 1, non_blocking_polish: 0 },
			}),
			artifact("code_review", 6, { verdict: "CLEAR", findings: [] }),
			artifact("verification", 7, { verdict: "COMPLETE" }),
		],
	};

	const result = validatePaperclipArtifacts(issue, "merge-gate");

	assert.equal(result.ok, true);
});

test("debt-only adversarial review with merge_blocker=0 proceeds to merge without fix loop or clean rerun", () => {
	const issue = {
		artifacts: [
			artifact("plan_audit", 1, { verdict: "APPROVED" }),
			artifact("plan_gate", 2, { verdict: "APPROVED" }),
			artifact("execution_report", 3),
			artifact("adversarial_review", 4, {
				verdict: "needs-attention",
				findings: [
					structuredFinding({
						merge_impact: "follow_up_debt",
						blocker_class: "contract_or_evidence",
						follow_up_ticket: "AET-500",
					}),
					structuredFinding({
						merge_impact: "follow_up_debt",
						blocker_class: "architecture_or_scope",
						follow_up_ticket: "AET-501",
					}),
					structuredFinding({
						merge_impact: "non_blocking_polish",
						blocker_class: "contract_or_evidence",
					}),
				],
				dispositionSummary: { merge_blocker: 0, follow_up_debt: 2, non_blocking_polish: 1 },
			}),
			artifact("code_review", 5, { verdict: "CLEAR", findings: [] }),
			artifact("verification", 6, { verdict: "COMPLETE" }),
		],
	};

	const result = validatePaperclipArtifacts(issue, "merge-gate");

	assert.equal(result.ok, true);
});

test("BLOCKED adversarial review never counts as merge-ready even with zero merge blockers", () => {
	const issue = {
		artifacts: [
			artifact("plan_audit", 1, { verdict: "APPROVED" }),
			artifact("plan_gate", 2, { verdict: "APPROVED" }),
			artifact("execution_report", 3),
			artifact("adversarial_review", 4, {
				verdict: "BLOCKED",
				findings: [
					structuredFinding({
						merge_impact: "follow_up_debt",
						blocker_class: "architecture_or_scope",
						follow_up_ticket: "AET-501",
					}),
				],
				dispositionSummary: { merge_blocker: 0, follow_up_debt: 1, non_blocking_polish: 0 },
			}),
			artifact("code_review", 5, { verdict: "CLEAR", findings: [] }),
			artifact("verification", 6, { verdict: "COMPLETE" }),
		],
	};

	const result = validatePaperclipArtifacts(issue, "merge-gate");

	assert.equal(result.ok, false);
	assert.match(result.failures.join("\n"), /adversarial_review findings require one bounded fix loop/);
});

test("active adversarial review with structured findings and matching dispositionSummary does not raise schema failures", () => {
	const issue = {
		artifacts: [
			artifact("plan_audit", 1, { verdict: "APPROVED" }),
			artifact("plan_gate", 2, { verdict: "APPROVED" }),
			artifact("execution_report", 3),
			artifact("adversarial_review", 4, {
				verdict: "REVISE",
				findings: [structuredFinding({ merge_impact: "merge_blocker", blocker_class: "runtime_or_behavioral_regression" })],
				dispositionSummary: { merge_blocker: 1, follow_up_debt: 0, non_blocking_polish: 0 },
			}),
			artifact("code_review", 5, { verdict: "CLEAR", findings: [] }),
			artifact("verification", 6, { verdict: "COMPLETE" }),
		],
	};

	const result = validatePaperclipArtifacts(issue, "merge-gate");

	assert.doesNotMatch(result.failures.join("\n"), /missing dispositionSummary/);
	assert.doesNotMatch(result.failures.join("\n"), /dispositionSummary count mismatch/);
	assert.doesNotMatch(result.failures.join("\n"), /must be an object with blocker_class and merge_impact/);
});

test("latest active adversarial review with legacy string findings is rejected (cannot derive merge-readiness)", () => {
	const issue = {
		artifacts: [
			artifact("plan_audit", 1, { verdict: "APPROVED" }),
			artifact("plan_gate", 2, { verdict: "APPROVED" }),
			artifact("execution_report", 3),
			artifact("adversarial_review", 4, {
				verdict: "needs-attention",
				findings: ["legacy string finding"],
				dispositionSummary: { merge_blocker: 0, follow_up_debt: 1, non_blocking_polish: 0 },
			}),
			artifact("code_review", 5, { verdict: "CLEAR", findings: [] }),
			artifact("verification", 6, { verdict: "COMPLETE" }),
		],
	};

	const result = validatePaperclipArtifacts(issue, "merge-gate");

	assert.equal(result.ok, false);
	assert.match(
		result.failures.join("\n"),
		/adversarial_review\.findings\[0\] must be an object with the required review-result fields/,
	);
});

test("finding missing blocker_class is rejected", () => {
	const finding = structuredFinding({ merge_impact: "merge_blocker", blocker_class: "runtime_or_behavioral_regression" });
	delete finding.blocker_class;
	const issue = {
		artifacts: [
			artifact("plan_audit", 1, { verdict: "APPROVED" }),
			artifact("plan_gate", 2, { verdict: "APPROVED" }),
			artifact("execution_report", 3),
			artifact("adversarial_review", 4, {
				verdict: "REVISE",
				findings: [finding],
				dispositionSummary: { merge_blocker: 1, follow_up_debt: 0, non_blocking_polish: 0 },
			}),
			artifact("code_review", 5, { verdict: "CLEAR", findings: [] }),
			artifact("verification", 6, { verdict: "COMPLETE" }),
		],
	};

	const result = validatePaperclipArtifacts(issue, "merge-gate");

	assert.equal(result.ok, false);
	assert.match(
		result.failures.join("\n"),
		/findings\[0\]\.blocker_class must be one of: runtime_or_behavioral_regression/,
	);
});

test("finding missing file anchor is rejected", () => {
	const finding = structuredFinding({ merge_impact: "merge_blocker", blocker_class: "runtime_or_behavioral_regression" });
	delete finding.file;
	const issue = {
		artifacts: [
			artifact("plan_audit", 1, { verdict: "APPROVED" }),
			artifact("plan_gate", 2, { verdict: "APPROVED" }),
			artifact("execution_report", 3),
			artifact("adversarial_review", 4, {
				verdict: "REVISE",
				findings: [finding],
				dispositionSummary: { merge_blocker: 1, follow_up_debt: 0, non_blocking_polish: 0 },
			}),
			artifact("code_review", 5, { verdict: "CLEAR", findings: [] }),
			artifact("verification", 6, { verdict: "COMPLETE" }),
		],
	};

	const result = validatePaperclipArtifacts(issue, "merge-gate");

	assert.equal(result.ok, false);
	assert.match(result.failures.join("\n"), /findings\[0\]\.file must be a non-empty string/);
});

test("finding missing merge_impact is rejected", () => {
	const finding = structuredFinding({ merge_impact: "merge_blocker", blocker_class: "runtime_or_behavioral_regression" });
	delete finding.merge_impact;
	const issue = {
		artifacts: [
			artifact("plan_audit", 1, { verdict: "APPROVED" }),
			artifact("plan_gate", 2, { verdict: "APPROVED" }),
			artifact("execution_report", 3),
			artifact("adversarial_review", 4, {
				verdict: "REVISE",
				findings: [finding],
				dispositionSummary: { merge_blocker: 1, follow_up_debt: 0, non_blocking_polish: 0 },
			}),
			artifact("code_review", 5, { verdict: "CLEAR", findings: [] }),
			artifact("verification", 6, { verdict: "COMPLETE" }),
		],
	};

	const result = validatePaperclipArtifacts(issue, "merge-gate");

	assert.equal(result.ok, false);
	assert.match(
		result.failures.join("\n"),
		/findings\[0\]\.merge_impact must be one of: merge_blocker, follow_up_debt, non_blocking_polish/,
	);
});

test("finding with merge_impact=follow_up_debt requires either a ticket or a deferred-enhancements doc pointer", () => {
	const issue = {
		artifacts: [
			artifact("plan_audit", 1, { verdict: "APPROVED" }),
			artifact("plan_gate", 2, { verdict: "APPROVED" }),
			artifact("execution_report", 3),
			artifact("adversarial_review", 4, {
				verdict: "needs-attention",
				findings: [
					structuredFinding({
						merge_impact: "follow_up_debt",
						blocker_class: "contract_or_evidence",
					}),
				],
				dispositionSummary: { merge_blocker: 0, follow_up_debt: 1, non_blocking_polish: 0 },
			}),
			artifact("code_review", 5, { verdict: "CLEAR", findings: [] }),
			artifact("verification", 6, { verdict: "COMPLETE" }),
		],
	};

	const result = validatePaperclipArtifacts(issue, "merge-gate");

	assert.equal(result.ok, false);
	assert.match(
		result.failures.join("\n"),
		/findings\[0\] must carry exactly one of follow_up_ticket .+ or deferred_enhancements_doc/,
	);
});

test("finding with malformed follow_up_ticket id is rejected", () => {
	const issue = {
		artifacts: [
			artifact("plan_audit", 1, { verdict: "APPROVED" }),
			artifact("plan_gate", 2, { verdict: "APPROVED" }),
			artifact("execution_report", 3),
			artifact("adversarial_review", 4, {
				verdict: "needs-attention",
				findings: [
					structuredFinding({
						merge_impact: "follow_up_debt",
						blocker_class: "contract_or_evidence",
						follow_up_ticket: "AET-",
					}),
				],
				dispositionSummary: { merge_blocker: 0, follow_up_debt: 1, non_blocking_polish: 0 },
			}),
			artifact("code_review", 5, { verdict: "CLEAR", findings: [] }),
			artifact("verification", 6, { verdict: "COMPLETE" }),
		],
	};

	const result = validatePaperclipArtifacts(issue, "merge-gate");

	assert.equal(result.ok, false);
	assert.match(
		result.failures.join("\n"),
		/findings\[0\]\.follow_up_ticket must match AET-<number>/,
	);
});

test("follow_up_debt finding with valid deferred-doc + anchor and non-strict class is accepted (C2 + AET-442)", (t) => {
	const repoRoot = setupRepoWithAnchors(["aet-442-test"]);
	t.after(() => cleanupRepo(repoRoot));

	const issue = {
		artifacts: [
			artifact("plan_audit", 1, { verdict: "APPROVED" }),
			artifact("plan_gate", 2, { verdict: "APPROVED" }),
			artifact("execution_report", 3),
			artifact("adversarial_review", 4, {
				verdict: "needs-attention",
				findings: [
					structuredFinding({
						merge_impact: "follow_up_debt",
						blocker_class: "architecture_or_scope",
						deferred_enhancements_doc: "docs/review/DEFERRED-ENHANCEMENTS.md",
						deferred_enhancements_anchor: "aet-442-test",
					}),
				],
				dispositionSummary: { merge_blocker: 0, follow_up_debt: 1, non_blocking_polish: 0 },
			}),
			artifact("code_review", 5, { verdict: "CLEAR", findings: [] }),
			artifact("verification", 6, { verdict: "COMPLETE" }),
		],
	};

	const result = validatePaperclipArtifacts(issue, "merge-gate", repoRoot);

	assert.equal(result.ok, true, `unexpected failures: ${result.failures.join("; ")}`);
});

test("follow_up_debt finding with both follow_up_ticket and deferred_enhancements_doc is rejected (C2)", () => {
	const issue = {
		artifacts: [
			artifact("plan_audit", 1, { verdict: "APPROVED" }),
			artifact("plan_gate", 2, { verdict: "APPROVED" }),
			artifact("execution_report", 3),
			artifact("adversarial_review", 4, {
				verdict: "needs-attention",
				findings: [
					structuredFinding({
						merge_impact: "follow_up_debt",
						blocker_class: "architecture_or_scope",
						follow_up_ticket: "AET-500",
						deferred_enhancements_doc: "docs/review/DEFERRED-ENHANCEMENTS.md",
					}),
				],
				dispositionSummary: { merge_blocker: 0, follow_up_debt: 1, non_blocking_polish: 0 },
			}),
			artifact("code_review", 5, { verdict: "CLEAR", findings: [] }),
			artifact("verification", 6, { verdict: "COMPLETE" }),
		],
	};

	const result = validatePaperclipArtifacts(issue, "merge-gate");

	assert.equal(result.ok, false);
	assert.match(
		result.failures.join("\n"),
		/findings\[0\] must carry exactly one of follow_up_ticket or \(deferred_enhancements_doc \+ deferred_enhancements_anchor\).+both forms are present/,
	);
});

test("follow_up_debt finding with non-canonical deferred_enhancements_doc path is rejected (C2)", () => {
	const issue = {
		artifacts: [
			artifact("plan_audit", 1, { verdict: "APPROVED" }),
			artifact("plan_gate", 2, { verdict: "APPROVED" }),
			artifact("execution_report", 3),
			artifact("adversarial_review", 4, {
				verdict: "needs-attention",
				findings: [
					structuredFinding({
						merge_impact: "follow_up_debt",
						blocker_class: "architecture_or_scope",
						deferred_enhancements_doc: "docs/review/SOMETHING-ELSE.md",
					}),
				],
				dispositionSummary: { merge_blocker: 0, follow_up_debt: 1, non_blocking_polish: 0 },
			}),
			artifact("code_review", 5, { verdict: "CLEAR", findings: [] }),
			artifact("verification", 6, { verdict: "COMPLETE" }),
		],
	};

	const result = validatePaperclipArtifacts(issue, "merge-gate");

	assert.equal(result.ok, false);
	assert.match(
		result.failures.join("\n"),
		/findings\[0\]\.deferred_enhancements_doc must be exactly "docs\/review\/DEFERRED-ENHANCEMENTS\.md"/,
	);
});

test("Non-deferrable Findings Guardrail rejects deferred_enhancements_doc for trust_or_safety (C3)", () => {
	const issue = {
		artifacts: [
			artifact("plan_audit", 1, { verdict: "APPROVED" }),
			artifact("plan_gate", 2, { verdict: "APPROVED" }),
			artifact("execution_report", 3),
			artifact("adversarial_review", 4, {
				verdict: "needs-attention",
				findings: [
					structuredFinding({
						merge_impact: "follow_up_debt",
						blocker_class: "trust_or_safety",
						deferred_enhancements_doc: "docs/review/DEFERRED-ENHANCEMENTS.md",
					}),
				],
				dispositionSummary: { merge_blocker: 0, follow_up_debt: 1, non_blocking_polish: 0 },
			}),
			artifact("code_review", 5, { verdict: "CLEAR", findings: [] }),
			artifact("verification", 6, { verdict: "COMPLETE" }),
		],
	};

	const result = validatePaperclipArtifacts(issue, "merge-gate");

	assert.equal(result.ok, false);
	assert.match(result.failures.join("\n"), /Non-deferrable Findings Guardrail/);
	assert.match(result.failures.join("\n"), /blocker_class=trust_or_safety/);
});

test("Non-deferrable Findings Guardrail rejects deferred_enhancements_doc for runtime_or_behavioral_regression (C3)", () => {
	const issue = {
		artifacts: [
			artifact("plan_audit", 1, { verdict: "APPROVED" }),
			artifact("plan_gate", 2, { verdict: "APPROVED" }),
			artifact("execution_report", 3),
			artifact("adversarial_review", 4, {
				verdict: "needs-attention",
				findings: [
					structuredFinding({
						merge_impact: "follow_up_debt",
						blocker_class: "runtime_or_behavioral_regression",
						deferred_enhancements_doc: "docs/review/DEFERRED-ENHANCEMENTS.md",
					}),
				],
				dispositionSummary: { merge_blocker: 0, follow_up_debt: 1, non_blocking_polish: 0 },
			}),
			artifact("code_review", 5, { verdict: "CLEAR", findings: [] }),
			artifact("verification", 6, { verdict: "COMPLETE" }),
		],
	};

	const result = validatePaperclipArtifacts(issue, "merge-gate");

	assert.equal(result.ok, false);
	assert.match(result.failures.join("\n"), /Non-deferrable Findings Guardrail/);
	assert.match(result.failures.join("\n"), /blocker_class=runtime_or_behavioral_regression/);
});

test("Guardrail allows ticket form for safety-strict trust_or_safety class (C3 positive)", () => {
	const issue = {
		artifacts: [
			artifact("plan_audit", 1, { verdict: "APPROVED" }),
			artifact("plan_gate", 2, { verdict: "APPROVED" }),
			artifact("execution_report", 3),
			artifact("adversarial_review", 4, {
				verdict: "needs-attention",
				findings: [
					structuredFinding({
						merge_impact: "follow_up_debt",
						blocker_class: "trust_or_safety",
						follow_up_ticket: "AET-600",
					}),
				],
				dispositionSummary: { merge_blocker: 0, follow_up_debt: 1, non_blocking_polish: 0 },
			}),
			artifact("code_review", 5, { verdict: "CLEAR", findings: [] }),
			artifact("verification", 6, { verdict: "COMPLETE" }),
		],
	};

	const result = validatePaperclipArtifacts(issue, "merge-gate");

	assert.equal(result.ok, true, `unexpected failures: ${result.failures.join("; ")}`);
});

test("Guardrail allows ticket form for safety-strict runtime_or_behavioral_regression class (C3 positive)", () => {
	const issue = {
		artifacts: [
			artifact("plan_audit", 1, { verdict: "APPROVED" }),
			artifact("plan_gate", 2, { verdict: "APPROVED" }),
			artifact("execution_report", 3),
			artifact("adversarial_review", 4, {
				verdict: "needs-attention",
				findings: [
					structuredFinding({
						merge_impact: "follow_up_debt",
						blocker_class: "runtime_or_behavioral_regression",
						follow_up_ticket: "AET-601",
					}),
				],
				dispositionSummary: { merge_blocker: 0, follow_up_debt: 1, non_blocking_polish: 0 },
			}),
			artifact("code_review", 5, { verdict: "CLEAR", findings: [] }),
			artifact("verification", 6, { verdict: "COMPLETE" }),
		],
	};

	const result = validatePaperclipArtifacts(issue, "merge-gate");

	assert.equal(result.ok, true, `unexpected failures: ${result.failures.join("; ")}`);
});

test("Non-deferrable Findings Guardrail rejects deferred_enhancements_doc for contract_or_evidence (C3 fix loop)", () => {
	const issue = {
		artifacts: [
			artifact("plan_audit", 1, { verdict: "APPROVED" }),
			artifact("plan_gate", 2, { verdict: "APPROVED" }),
			artifact("execution_report", 3),
			artifact("adversarial_review", 4, {
				verdict: "needs-attention",
				findings: [
					structuredFinding({
						merge_impact: "follow_up_debt",
						blocker_class: "contract_or_evidence",
						deferred_enhancements_doc: "docs/review/DEFERRED-ENHANCEMENTS.md",
					}),
				],
				dispositionSummary: { merge_blocker: 0, follow_up_debt: 1, non_blocking_polish: 0 },
			}),
			artifact("code_review", 5, { verdict: "CLEAR", findings: [] }),
			artifact("verification", 6, { verdict: "COMPLETE" }),
		],
	};

	const result = validatePaperclipArtifacts(issue, "merge-gate");

	assert.equal(result.ok, false);
	assert.match(result.failures.join("\n"), /Non-deferrable Findings Guardrail/);
	assert.match(result.failures.join("\n"), /blocker_class=contract_or_evidence/);
});

test("Guardrail allows ticket form for contract_or_evidence (C3 fix loop positive)", () => {
	const issue = {
		artifacts: [
			artifact("plan_audit", 1, { verdict: "APPROVED" }),
			artifact("plan_gate", 2, { verdict: "APPROVED" }),
			artifact("execution_report", 3),
			artifact("adversarial_review", 4, {
				verdict: "needs-attention",
				findings: [
					structuredFinding({
						merge_impact: "follow_up_debt",
						blocker_class: "contract_or_evidence",
						follow_up_ticket: "AET-602",
					}),
				],
				dispositionSummary: { merge_blocker: 0, follow_up_debt: 1, non_blocking_polish: 0 },
			}),
			artifact("code_review", 5, { verdict: "CLEAR", findings: [] }),
			artifact("verification", 6, { verdict: "COMPLETE" }),
		],
	};

	const result = validatePaperclipArtifacts(issue, "merge-gate");

	assert.equal(result.ok, true, `unexpected failures: ${result.failures.join("; ")}`);
});

test("merge-readiness derives from per-finding merge_impact, not from caller-supplied dispositionSummary", () => {
	const issue = {
		artifacts: [
			artifact("plan_audit", 1, { verdict: "APPROVED" }),
			artifact("plan_gate", 2, { verdict: "APPROVED" }),
			artifact("execution_report", 3),
			artifact("adversarial_review", 4, {
				verdict: "needs-attention",
				findings: [structuredFinding({ merge_impact: "merge_blocker", blocker_class: "runtime_or_behavioral_regression" })],
				dispositionSummary: { merge_blocker: 0, follow_up_debt: 0, non_blocking_polish: 1 },
			}),
			artifact("code_review", 5, { verdict: "CLEAR", findings: [] }),
			artifact("verification", 6, { verdict: "COMPLETE" }),
		],
	};

	const result = validatePaperclipArtifacts(issue, "merge-gate");

	assert.equal(result.ok, false);
	const joined = result.failures.join("\n");
	assert.match(joined, /merge_blocker=0 does not match the derived count 1/);
});

// -----------------------------------------------------------------------------
// AET-442: deferred_enhancements_anchor structural + filesystem verification
// -----------------------------------------------------------------------------

function dispositionIssue(finding, { adversarialMinute = 4 } = {}) {
	return {
		artifacts: [
			artifact("plan_audit", 1, { verdict: "APPROVED" }),
			artifact("plan_gate", 2, { verdict: "APPROVED" }),
			artifact("execution_report", 3),
			artifact("adversarial_review", adversarialMinute, {
				verdict: "needs-attention",
				findings: [finding],
				dispositionSummary: { merge_blocker: 0, follow_up_debt: 1, non_blocking_polish: 0 },
			}),
			artifact("code_review", adversarialMinute + 1, { verdict: "CLEAR", findings: [] }),
			artifact("verification", adversarialMinute + 2, { verdict: "COMPLETE" }),
		],
	};
}

test("AET-442: doc set without anchor is rejected (anchor field is required)", (t) => {
	const repoRoot = setupRepoWithAnchors(["aet-442-test"]);
	t.after(() => cleanupRepo(repoRoot));

	const issue = dispositionIssue(
		structuredFinding({
			merge_impact: "follow_up_debt",
			blocker_class: "architecture_or_scope",
			deferred_enhancements_doc: "docs/review/DEFERRED-ENHANCEMENTS.md",
		}),
	);

	const result = validatePaperclipArtifacts(issue, "merge-gate", repoRoot);

	assert.equal(result.ok, false);
	assert.match(
		result.failures.join("\n"),
		/findings\[0\]\.deferred_enhancements_doc is set but deferred_enhancements_anchor is missing/,
	);
});

test("AET-442: anchor set without doc is rejected (doc field is required)", (t) => {
	const repoRoot = setupRepoWithAnchors(["aet-442-test"]);
	t.after(() => cleanupRepo(repoRoot));

	const issue = dispositionIssue(
		structuredFinding({
			merge_impact: "follow_up_debt",
			blocker_class: "architecture_or_scope",
			deferred_enhancements_anchor: "aet-442-test",
		}),
	);

	const result = validatePaperclipArtifacts(issue, "merge-gate", repoRoot);

	assert.equal(result.ok, false);
	assert.match(
		result.failures.join("\n"),
		/findings\[0\]\.deferred_enhancements_anchor is set but deferred_enhancements_doc is missing/,
	);
});

test("AET-442: anchor with malformed format (uppercase) is rejected", (t) => {
	const repoRoot = setupRepoWithAnchors(["aet-442-test"]);
	t.after(() => cleanupRepo(repoRoot));

	const issue = dispositionIssue(
		structuredFinding({
			merge_impact: "follow_up_debt",
			blocker_class: "architecture_or_scope",
			deferred_enhancements_doc: "docs/review/DEFERRED-ENHANCEMENTS.md",
			deferred_enhancements_anchor: "AET-442-TEST",
		}),
	);

	const result = validatePaperclipArtifacts(issue, "merge-gate", repoRoot);

	assert.equal(result.ok, false);
	assert.match(
		result.failures.join("\n"),
		/findings\[0\]\.deferred_enhancements_anchor must be a kebab-case token/,
	);
});

test("AET-442: anchor with malformed format (underscore) is rejected", (t) => {
	const repoRoot = setupRepoWithAnchors(["aet-442-test"]);
	t.after(() => cleanupRepo(repoRoot));

	const issue = dispositionIssue(
		structuredFinding({
			merge_impact: "follow_up_debt",
			blocker_class: "architecture_or_scope",
			deferred_enhancements_doc: "docs/review/DEFERRED-ENHANCEMENTS.md",
			deferred_enhancements_anchor: "aet_442_test",
		}),
	);

	const result = validatePaperclipArtifacts(issue, "merge-gate", repoRoot);

	assert.equal(result.ok, false);
	assert.match(
		result.failures.join("\n"),
		/findings\[0\]\.deferred_enhancements_anchor must be a kebab-case token/,
	);
});

test("AET-442: anchor present in doc exactly once is accepted", (t) => {
	const repoRoot = setupRepoWithAnchors(["aet-442-bootstrap", "aet-442-other"]);
	t.after(() => cleanupRepo(repoRoot));

	const issue = dispositionIssue(
		structuredFinding({
			merge_impact: "follow_up_debt",
			blocker_class: "architecture_or_scope",
			deferred_enhancements_doc: "docs/review/DEFERRED-ENHANCEMENTS.md",
			deferred_enhancements_anchor: "aet-442-bootstrap",
		}),
	);

	const result = validatePaperclipArtifacts(issue, "merge-gate", repoRoot);

	assert.equal(result.ok, true, `unexpected failures: ${result.failures.join("; ")}`);
});

test("AET-442: anchor missing from doc is rejected with Deferred Enhancements Anchor Missing", (t) => {
	const repoRoot = setupRepoWithAnchors(["some-other-anchor"]);
	t.after(() => cleanupRepo(repoRoot));

	const issue = dispositionIssue(
		structuredFinding({
			merge_impact: "follow_up_debt",
			blocker_class: "architecture_or_scope",
			deferred_enhancements_doc: "docs/review/DEFERRED-ENHANCEMENTS.md",
			deferred_enhancements_anchor: "missing-anchor",
		}),
	);

	const result = validatePaperclipArtifacts(issue, "merge-gate", repoRoot);

	assert.equal(result.ok, false);
	assert.match(result.failures.join("\n"), /Deferred Enhancements Anchor Missing/);
	assert.match(result.failures.join("\n"), /missing-anchor/);
});

test("AET-442: anchor duplicated in doc is rejected with Deferred Enhancements Anchor Duplicate", (t) => {
	const repoRoot = setupRepoWithAnchors(["dup-anchor", "dup-anchor"]);
	t.after(() => cleanupRepo(repoRoot));

	const issue = dispositionIssue(
		structuredFinding({
			merge_impact: "follow_up_debt",
			blocker_class: "architecture_or_scope",
			deferred_enhancements_doc: "docs/review/DEFERRED-ENHANCEMENTS.md",
			deferred_enhancements_anchor: "dup-anchor",
		}),
	);

	const result = validatePaperclipArtifacts(issue, "merge-gate", repoRoot);

	assert.equal(result.ok, false);
	assert.match(result.failures.join("\n"), /Deferred Enhancements Anchor Duplicate/);
	assert.match(result.failures.join("\n"), /dup-anchor/);
	assert.match(result.failures.join("\n"), /matches 2/);
});

test("AET-442: same-line duplicate anchors are also rejected (occurrence-based, not line-based)", (t) => {
	// Codex's bypass: a doc line containing two identical anchor tags should
	// count as 2, not 1. The Paperclip JS counter uses indexOf and counts
	// occurrences across the whole file — verify here that a same-line
	// duplicate cannot smuggle a credit. The wrapper has the same regression
	// test in scripts/run-adversarial-review.test.sh.
	const repoRoot = mkdtempSync(join(tmpdir(), "aet-442-gate-sameline-"));
	mkdirSync(join(repoRoot, "docs", "review"), { recursive: true });
	writeFileSync(
		join(repoRoot, "docs", "review", "DEFERRED-ENHANCEMENTS.md"),
		[
			"# Deferred Enhancements",
			"",
			'<a id="sameline-dup"></a><a id="sameline-dup"></a>',
			"### entry",
			"- both anchor tags are on the SAME line",
			"",
		].join("\n"),
	);
	t.after(() => cleanupRepo(repoRoot));

	const issue = dispositionIssue(
		structuredFinding({
			merge_impact: "follow_up_debt",
			blocker_class: "architecture_or_scope",
			deferred_enhancements_doc: "docs/review/DEFERRED-ENHANCEMENTS.md",
			deferred_enhancements_anchor: "sameline-dup",
		}),
	);

	const result = validatePaperclipArtifacts(issue, "merge-gate", repoRoot);

	assert.equal(result.ok, false);
	assert.match(result.failures.join("\n"), /Deferred Enhancements Anchor Duplicate/);
	assert.match(result.failures.join("\n"), /sameline-dup/);
	assert.match(result.failures.join("\n"), /matches 2/);
});

test("AET-442: docs/review/DEFERRED-ENHANCEMENTS.md missing entirely is rejected (named path)", (t) => {
	const repoRoot = setupEmptyRepo();
	t.after(() => cleanupRepo(repoRoot));

	const issue = dispositionIssue(
		structuredFinding({
			merge_impact: "follow_up_debt",
			blocker_class: "architecture_or_scope",
			deferred_enhancements_doc: "docs/review/DEFERRED-ENHANCEMENTS.md",
			deferred_enhancements_anchor: "any-anchor",
		}),
	);

	const result = validatePaperclipArtifacts(issue, "merge-gate", repoRoot);

	assert.equal(result.ok, false);
	assert.match(
		result.failures.join("\n"),
		/docs\/review\/DEFERRED-ENHANCEMENTS\.md was not found/,
	);
});

test("AET-442: parseArgs rejects --repo-root (CLI cannot redirect anchor verification)", () => {
	// AET-442: production CLI must NOT expose a --repo-root override. A
	// merge-gate caller could otherwise point the gate at a planted doc
	// containing fabricated anchors. Tests inject repoRoot via the function
	// parameter instead.
	assert.throws(
		() => parseArgs(["--action", "merge-gate", "--repo-root", "/tmp/spoofed"]),
		/Unknown option: --repo-root/,
	);
});

test("AET-442: gate default repo root is anchored to its own script, not process.cwd() (cwd-spoof regression)", async (t) => {
	// A caller running the gate from a different cwd MUST NOT be able to redirect
	// the deferred-doc anchor verification to a caller-controlled doc. The gate
	// defaults `repoRoot` to the directory containing scripts/paperclip-artifact-
	// gate.mjs's parent (the real repo root), NOT process.cwd(). This regression
	// test verifies that default by:
	//   1. Building a fake "spoofed repo" with a doc that contains a planted
	//      anchor (e.g., "fake-anchor").
	//   2. Setting process.cwd() to that spoofed repo.
	//   3. Calling validatePaperclipArtifacts WITHOUT passing repoRoot.
	//   4. Asserting the gate did NOT credit the disposition against the
	//      spoofed doc — the default repo root must point at the actual repo
	//      (which doesn't have "fake-anchor"), so the gate emits a Missing
	//      error, NOT a pass against the spoofed doc.
	const spoofedRepo = setupRepoWithAnchors(["fake-anchor"]);
	t.after(() => cleanupRepo(spoofedRepo));
	const originalCwd = process.cwd();
	process.chdir(spoofedRepo);
	t.after(() => process.chdir(originalCwd));

	const issue = dispositionIssue(
		structuredFinding({
			merge_impact: "follow_up_debt",
			blocker_class: "architecture_or_scope",
			deferred_enhancements_doc: "docs/review/DEFERRED-ENHANCEMENTS.md",
			deferred_enhancements_anchor: "fake-anchor",
		}),
	);

	const result = validatePaperclipArtifacts(issue, "merge-gate"); // no repoRoot

	// The actual repo's docs/review/DEFERRED-ENHANCEMENTS.md does not contain
	// "fake-anchor", so the gate must reject. If the gate had defaulted to
	// process.cwd() (the spoofed repo, where fake-anchor IS present), it would
	// have incorrectly credited the disposition.
	assert.equal(
		result.ok,
		false,
		"AET-442 cwd-spoof regression: gate must NOT default repoRoot to process.cwd(); " +
			`a caller-controlled cwd containing a planted anchor would otherwise pass. ` +
			`failures=${JSON.stringify(result.failures)}`,
	);
	assert.match(result.failures.join("\n"), /Deferred Enhancements Anchor Missing/);
	assert.match(result.failures.join("\n"), /fake-anchor/);
});
