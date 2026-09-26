import { sheets } from "@googleapis/sheets";
import { OAuth2Client } from "google-auth-library";
import fs from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import open from "open";
import enableDestroy from "server-destroy";
import { cache_dir } from "./config.js";

export class NotLoggedInError extends Error {}
export class SpreadsheetNotFoundError extends Error {}
export class NoAccessError extends Error {}

const credentials_path = path.join(process.cwd(), "credentials.json");
const token_path = path.join(cache_dir, "token.json");

async function getClient() {
	let data: string;
	try {
		data = await fs.promises.readFile(credentials_path, "utf8");
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code === "ENOENT") {
			throw new Error(`Missing Google OAuth credentials at ${credentials_path}`);
		}
		throw err;
	}
	const { client_id, client_secret } = JSON.parse(data).installed;
	return { client_id, client_secret };
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

function translate(error: unknown): never {
	const status = (error as { status?: number }).status;
	if (status === 401) throw new NotLoggedInError("Session expired, run `lca login`", { cause: error });
	if (status === 403) throw new NoAccessError("No access to this spreadsheet.", { cause: error });
	if (status === 404) throw new SpreadsheetNotFoundError("Spreadsheet not found.", { cause: error });
	throw error; // unknown: pass through unchanged
}

export async function createSheetsGateway(spreadsheetId: string) {
	const auth = await getAuthenticatedClient().catch((e) => {
		throw new NotLoggedInError("Not logged in.", { cause: e });
	});
	const sheetsClient = sheets({ version: "v4", auth });

	return {
		sheetIdList: async () => {
			const result = await sheetsClient.spreadsheets.get({ spreadsheetId }).catch(translate);
			const sheetsList = result.data.sheets ?? [];
			const sheetIdList: Record<string, number> = {};
			for (const { properties } of sheetsList) {
				if (properties?.title != null && properties.sheetId != null) {
					sheetIdList[properties.title] = properties.sheetId;
				}
			}
			return sheetIdList;
		},
	};
}

export async function login(): Promise<void> {
	if (await restoreSavedClient()) {
		console.log("You are already logged in.");
		return;
	}
	await authenticate(scopes);
}
