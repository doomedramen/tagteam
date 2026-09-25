// Usage: node scripts/smoke.mjs <baseUrl>
// Checks a running TagTeam server whose BASE_URL equals <baseUrl>.
const base = process.argv[2] ?? "http://localhost:3000";

const fail = (message) => {
	console.error(`smoke: ${message}`);
	process.exit(1);
};

const health = await fetch(`${base}/api/health`);
if (health.status !== 200) fail(`health returned ${health.status}`);

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
