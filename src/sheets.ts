import { sheets } from "@googleapis/sheets";
import { checkbox } from "@inquirer/prompts";
import fs from "node:fs";

import { getAuthenticatedClient } from "./auth.js";

import { selectedSheetsPath, spreadsheetId } from "./config.js";
import type { SelectedSheet } from "./lca-types.js";
import { buildSheetRanges } from "./sheet-ranges.js";

export async function selectSheets() {
	// Create a new Sheets API client.
	const sheetsClient = sheets({
		version: "v4",
		auth: await getAuthenticatedClient(),
	});

	if (!spreadsheetId) {
		console.log("Please set SPREADSHEET_ID in .env");
		return;
	}

	// Get the values from the spreadsheet.
	const result = await sheetsClient.spreadsheets.get({ spreadsheetId });
	const sheetsList = result.data.sheets ?? [];
	const sheetIdList = Object.fromEntries(
		sheetsList.map((sheet) => [sheet.properties?.title, sheet.properties?.sheetId]),
	);
	console.log(sheetIdList);

	let selectedSheets;
	try {
		selectedSheets = await checkbox(
			{
				message: "Select sheets",
				choices: Object.entries(sheetIdList).map(([name, id]) => ({ name, value: { name, id } })),
			},
		);
	} catch (error) {
		// ExitPromptError = Ctrl+C
		if (error instanceof Error && (error.name === "ExitPromptError")) {
			console.log("Cancelled, nothing saved.");
			return;
		}
		throw error;
	}

	const selectedLength = selectedSheets.length;

	if (selectedLength === 0) {
		console.log("No sheets selected, cancelling.");
		return;
	} else {
		await fs.promises.writeFile(selectedSheetsPath, JSON.stringify(selectedSheets, null, 2));
		console.log(`Saved ${selectedLength} entries to ./selected-sheets.json`);
	}
}

export async function readSheets() {
	if (!spreadsheetId) {
		console.log("Please set SPREADSHEET_ID in .env");
		return;
	}

	const raw = await fs.promises.readFile(selectedSheetsPath, "utf8");
	const selected: SelectedSheet[] = JSON.parse(raw);
	if (selected.length === 0) {
		console.error("No sheets selected, please select at least one with `lca sheetselect`");
		return;
	}

	const sheetsClient = sheets({
		version: "v4",
		auth: await getAuthenticatedClient(),
	});

	let foundRanges = false;

	for (const sheet of selected) {
		// check if the range of the actual sheet is known as the spreadsheet is not
		// necessarily structured. if it is, create the query for it in A1 notation
		// see: https://developers.google.com/workspace/sheets/api/guides/concepts
		const { topLeft, rightEdge } = sheet;
		const range = !topLeft || !rightEdge ? "" : `!${topLeft}:${rightEdge}`;

		const result = await sheetsClient.spreadsheets.values.get({
			spreadsheetId,
			// A1 notation needs titles with spaces/symbols quoted; embedded ' is doubled
			range: `'${sheet.name.replaceAll("'", "''")}'${range}`,
		});

		if (range === "") {
			const bounds = buildSheetRanges(result.data.values ?? []);
			if (!bounds) continue;
			sheet.topLeft = bounds.topLeft;
			sheet.rightEdge = bounds.rightEdge;
			foundRanges = true;
		}
	}

	if (foundRanges) {
		await fs.promises.writeFile(selectedSheetsPath, JSON.stringify(selected, null, 2));
		console.log("Saved sheet ranges to cache/selected-sheets.json");
	}
}
