import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import http from "node:http";
import test from "node:test";
import { promisify } from "node:util";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const repoRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const scriptPath = join(repoRoot, "scripts", "paperclip-find-or-create-mirror.sh");

function issue(overrides = {}) {
	return {
		id: "issue-1",
		identifier: "PC-1",
		parentId: null,
		hiddenAt: null,
		status: "todo",
		title: "AET-339 | Existing mirror",
		...overrides,
	};
}

async function withPaperclipApi(issues, callback) {
	const posts = [];
	const server = http.createServer((request, response) => {
		if (request.method === "GET" && request.url?.startsWith("/api/companies/company-1/issues")) {
			response.setHeader("Content-Type", "application/json");
			response.end(JSON.stringify(issues));
			return;
		}

		if (request.method === "POST" && request.url === "/api/companies/company-1/issues") {
			const chunks = [];
			request.on("data", (chunk) => chunks.push(chunk));
			request.on("end", () => {
				const payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
				posts.push(payload);
				response.setHeader("Content-Type", "application/json");
				response.end(
					JSON.stringify({
						id: "created-1",
						identifier: "PC-2",
						status: payload.status,
						title: payload.title,
					}),
				);
			});
			return;
		}

		response.statusCode = 404;
		response.end(JSON.stringify({ error: `unexpected ${request.method} ${request.url}` }));
	});

	await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
	const address = server.address();
	const apiUrl = `http://127.0.0.1:${address.port}/api`;

	try {
		return await callback({ apiUrl, posts });
	} finally {
		await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
	}
}

async function runMirrorScript(issues, shortTitle = "Mirror drift fix") {
	return withPaperclipApi(issues, async ({ apiUrl, posts }) => {
		const env = {
			...process.env,
			PAPERCLIP_API_URL: apiUrl,
			PAPERCLIP_API_KEY: "",
			PAPERCLIP_RUN_ID: "",
		};

		try {
			const result = await execFileAsync(
				"bash",
				[scriptPath, "AET-339", shortTitle, "--company-id", "company-1"],
				{ cwd: repoRoot, env },
			);
			return { exitCode: 0, posts, stderr: result.stderr, stdout: result.stdout };
		} catch (error) {
			return {
				exitCode: error.code,
				posts,
				stderr: error.stderr,
				stdout: error.stdout,
			};
		}
	});
}

test("reuses an existing canonical pipe-titled parent mirror", async () => {
	const result = await runMirrorScript([issue({ title: "AET-339 | Existing canonical parent" })]);

	assert.equal(result.exitCode, 0);
	assert.deepEqual(result.posts, []);
	assert.equal(JSON.parse(result.stdout).created, false);
	assert.equal(JSON.parse(result.stdout).title, "AET-339 | Existing canonical parent");
});

test("reuses an existing legacy dash-titled parent mirror", async () => {
	const result = await runMirrorScript([issue({ title: "AET-339 — Existing legacy parent" })]);

	assert.equal(result.exitCode, 0);
	assert.deepEqual(result.posts, []);
	assert.equal(JSON.parse(result.stdout).created, false);
	assert.equal(JSON.parse(result.stdout).title, "AET-339 — Existing legacy parent");
});

test("creates new mirrors with canonical pipe titles", async () => {
	const result = await runMirrorScript([], "Fresh mirror");

	assert.equal(result.exitCode, 0);
	assert.equal(result.posts.length, 1);
	assert.equal(result.posts[0].title, "AET-339 | Fresh mirror");
	assert.equal(JSON.parse(result.stdout).created, true);
	assert.equal(JSON.parse(result.stdout).title, "AET-339 | Fresh mirror");
});

test("fails closed when multiple live parent mirrors match the same Linear id", async () => {
	const result = await runMirrorScript([
		issue({ id: "issue-1", identifier: "PC-1", title: "AET-339 | Existing canonical parent" }),
		issue({ id: "issue-2", identifier: "PC-2", title: "AET-339 — Existing legacy parent" }),
	]);

	assert.notEqual(result.exitCode, 0);
	assert.deepEqual(result.posts, []);
	assert.match(result.stderr, /refusing to create a second open parent/);
});
