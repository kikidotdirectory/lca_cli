import "dotenv/config";
import { sheets } from "@googleapis/sheets";
import { checkbox } from "@inquirer/prompts";
import fs from "node:fs";
import path from "node:path";
import { getAuthenticatedClient } from "./auth.js";
import { cache_dir } from "./config.js";
import type { SelectedSheet } from "./lca-types.js";

const spreadsheetId = process.env.SPREADSHEET_ID;
const selectedSheetsPath = path.join(process.cwd(), cache_dir, "selected-sheets.json");

// todo: relocate this
// 0-based column index -> A1 column letters (0 -> A, 25 -> Z, 26 -> AA)
function toColumn(index: number) {
	let column = "";
	for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) {
		column = String.fromCharCode(65 + ((n - 1) % 26)) + column;
	}
	return column;
}

// find the header row (the one with both "SKU" and "Status") and return the
// table bounds in A1 notation. rightEdge is a bare column so the range stays
// open-ended downward, e.g. "B9:AX" covers every row from 9 to the end.
function buildSheetRanges(values: string[][]) {
	const searchLimit = 50; // arbitrary limit to search

	for (const [i, row] of values.slice(0, searchLimit).entries()) {
		const hasSKU = row.includes("SKU");
		const hasStatus = row.includes("Status");
		const statusIndex = row.indexOf("Status");

		if (hasSKU && hasStatus) {
			const firstCol = row.findIndex((cell) => cell.trim() !== "");
			const lastCol = row.findLastIndex((cell) => cell.trim() !== "");
			return {
				topLeft: `${toColumn(firstCol)}${i + 1}`,
				rightEdge: toColumn(statusIndex),
			};
		}

		// JS xor (https://www.howtocreate.co.uk/xor.html)
		if (hasSKU ? !hasStatus : hasStatus) {
			console.warn(`row ${i + 1} has only one of "SKU"/"Status", skipping.`);
		}
	}

	console.log(`could not find header row in ${searchLimit} rows.`);
	return undefined;
}

export async function sheetName() {
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

		// get index of header row by trying to find the row with 'Status' or 'SKU'
		// get column of status, filter all the rows that have "Complete"
	}

	if (foundRanges) {
		await fs.promises.writeFile(selectedSheetsPath, JSON.stringify(selected, null, 2));
		console.log("Saved sheet ranges to cache/selected-sheets.json");
	}
}
