import { type sheets_v4 } from "@googleapis/sheets";
import { checkbox } from "@inquirer/prompts";
import fs from "node:fs";

import { type SheetsGateway } from "./auth.js";

import { selectedSheetsPath } from "./config.js";
import type { SelectedSheet } from "./lca-types.js";
import { buildSheetRanges } from "./sheet-ranges.js";

export async function selectSheets(sheetsList: sheets_v4.Schema$Sheet[]) {
	// build sheetslist into `name: id` pairs
	const sheetIdList: Record<string, number> = {};
	for (const { properties } of sheetsList) {
		if (properties?.title != null && properties.sheetId != null) {
			sheetIdList[properties.title] = properties.sheetId;
		}
	}

	// Get the values from the spreadsheet.
	let selectedSheets: SelectedSheet[];
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

export class NoSheetsSelectedError extends Error {}

export async function readSheets(gateway: Pick<SheetsGateway, "sheetValues">) {
	let raw: string;
	try {
		raw = await fs.promises.readFile(selectedSheetsPath, "utf8");
	} catch (error) {
		// ENOENT = `lca sheetselect` has never been run
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			throw new NoSheetsSelectedError("No sheets selected.");
		}
		throw error;
	}

	const selected: SelectedSheet[] = JSON.parse(raw);
	if (selected.length === 0) {
		throw new NoSheetsSelectedError("No sheets selected.");
	}

	let foundRanges = false;

	for (const sheet of selected) {
		// check if the range of the actual sheet is known as the spreadsheet is not
		// necessarily structured. if it is, create the query for it in A1 notation
		// see: https://developers.google.com/workspace/sheets/api/guides/concepts
		const { topLeft, rightEdge } = sheet;
		const range = !topLeft || !rightEdge ? "" : `!${topLeft}:${rightEdge}`;

		const values = await gateway.sheetValues(sheet.name, range);

		if (range === "") {
			const bounds = buildSheetRanges(sheet.name, values);
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
