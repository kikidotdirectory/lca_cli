import { OAuth2Client } from "google-auth-library";
import fs from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import open from "open";
import enableDestroy from "server-destroy";

const credentials_path = path.join(process.cwd(), "credentials.json");
const token_path = path.join(process.cwd(), "token.json");

async function getClient() {
	try {
		const data = await fs.promises.readFile(credentials_path, "utf8");
		const parsed = JSON.parse(data);
		const { client_id, client_secret } = parsed.installed;
		return { client_id, client_secret };
	} catch (err) {
		console.error(err);
		return { client_id: undefined, client_secret: undefined };
	}
}

const scopes = ["https://www.googleapis.com/auth/spreadsheets"];
const { client_id, client_secret } = await getClient();
const oauth2Client = new OAuth2Client(
	client_id,
	client_secret,
	"http://localhost:3000",
);

oauth2Client.on("tokens", (tokens) => {
	// Refreshes usually omit refresh_token, so merge over the existing credentials
	saveTokens({ ...oauth2Client.credentials, ...tokens }).catch((err) =>
		console.error("Failed to save token.json:", err)
	);
});

async function saveTokens(tokens: Parameters<typeof oauth2Client.setCredentials>[0]) {
	await fs.promises.writeFile(
		token_path,
		JSON.stringify(tokens, null, 2),
		{ mode: 0o600 }, // make file readable & writeable
	);
}

async function authenticate(scopes: string[]): Promise<OAuth2Client> {
	return new Promise<OAuth2Client>((resolve, reject) => {
		const authUrl = oauth2Client.generateAuthUrl({
			access_type: "offline",
			scope: scopes.join(" "),
		});

		const server = createServer(async (req, res) => {
			try {
				const url = new URL(req.url ?? "", "http://localhost:3000");
				const code = url.searchParams.get("code");
				const error = url.searchParams.get("error");

				if (error) {
					throw new Error(`Authorization failed: ${error}`);
				}
				if (!code) {
					res.statusCode = 404;
					res.end();
					return;
				}

				const { tokens } = await oauth2Client.getToken(code);
				res.end("Authentication successful! You may close this tab.");
				console.log("Successfully authenticated");
				server.destroy();

				oauth2Client.setCredentials(tokens);
				resolve(oauth2Client);
			} catch (err) {
				res.end("Authentication failed. Check the console for details.");
				server.destroy();
				reject(err);
			}
		});

		enableDestroy(server);

		server.listen(3000, () => {
			open(authUrl);
		});
	});
}

async function loadSavedTokens() {
	try {
		const data = await fs.promises.readFile(token_path, "utf8");
		return JSON.parse(data);
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code === "ENOENT") {
			return undefined;
		}
		throw err;
	}
}

function isInvalidGrantError(err: unknown): boolean {
	if (!(err instanceof Error)) {
		return false;
	}
	const responseError = (err as { response?: { data?: { error?: string } } }).response?.data?.error;
	return responseError === "invalid_grant" || err.message.includes("invalid_grant");
}

async function restoreSavedClient(): Promise<OAuth2Client | null> {
	const tokens = await loadSavedTokens();
	if (!tokens) {
		return null;
	}

	oauth2Client.setCredentials(tokens);
	try {
		// Forces a refresh if the access token is expired, surfacing a dead refresh token now.
		await oauth2Client.getAccessToken();
		return oauth2Client;
	} catch (err) {
		if (!isInvalidGrantError(err)) {
			throw err;
		}
		console.error("Saved credentials are no longer valid, re-authenticating...");
		return null;
	}
}

export async function getAuthenticatedClient(): Promise<OAuth2Client> {
	return (await restoreSavedClient()) ?? authenticate(scopes);
}

export async function authenticateClient(): Promise<void> {
	if (await restoreSavedClient()) {
		console.log("You are already logged in.");
		return;
	}
	await authenticate(scopes);
}
