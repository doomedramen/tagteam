// Usage: node scripts/smoke.mjs <baseUrl> [--web]
// Checks a running TagTeam server whose BASE_URL equals <baseUrl>.
const args = process.argv.slice(2);
const base =
	args.find((arg) => !arg.startsWith("--")) ?? "http://localhost:3000";
const checkWeb = args.includes("--web");

const fail = (message) => {
	console.error(`smoke: ${message}`);
	process.exit(1);
};

const health = await fetch(`${base}/api/health`);
if (health.status !== 200) fail(`health returned ${health.status}`);

if (checkWeb) {
	const web = await fetch(`${base}/`);
	if (web.status !== 200) fail(`web app returned ${web.status}`);
	if (!(await web.text()).includes('<div id="root">'))
		fail("web app response is missing #root");
}

const email = `smoke-${Date.now()}@example.com`;
const signUp = (origin) =>
	fetch(`${base}/api/auth/sign-up/email`, {
		method: "POST",
		headers: { "content-type": "application/json", origin },
		body: JSON.stringify({
			email,
			password: "correct-horse-battery",
			name: "Smoke",
		}),
	});

const untrusted = await signUp("https://evil.example.com");
if (untrusted.status !== 403)
	fail(`untrusted origin returned ${untrusted.status}`);

const trusted = await signUp(new URL(base).origin);
if (trusted.status !== 200)
	fail(`sign-up returned ${trusted.status}: ${await trusted.text()}`);

console.log("smoke: ok");
