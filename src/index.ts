#!/usr/bin/env node
import "dotenv/config";
import { Command } from "commander";
import { createSheetsGateway, login } from "./auth.js";
import { NoAccessError, NotLoggedInError, SpreadsheetNotFoundError } from "./auth.js";
import { readSheets, selectSheets } from "./sheets.js";

const program: Command = new Command();

program
	.name("lca")
	.description("lingchen-art CLI")
	.version("1.0.0");

function getSpreadsheetId(): string {
	const id = process.env.SPREADSHEET_ID;
	if (!id) program.error("Please set SPREADSHEET_ID in .env"); // exits
	return id;
}

program
	.command("login")
	.action(login);

program
	.command("sheetselect")
	.action(async () => {
		const id = getSpreadsheetId();
		const gateway = await createSheetsGateway(id);
		await selectSheets(await gateway.sheetIdList());
	});

program
	.command("buildsheets")
	.action(readSheets);

try {
	await program.parseAsync();
} catch (error) {
	if (error instanceof NotLoggedInError) {
		program.error(`${error.message} Run \`lca login\`.`);
	}
	if (error instanceof NoAccessError || error instanceof SpreadsheetNotFoundError) {
		program.error(`${error.message} Check SPREADSHEET_ID in .env.`);
	}
	throw error; // unexpected: show the full stack
}
