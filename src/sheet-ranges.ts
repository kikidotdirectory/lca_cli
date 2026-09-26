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
export function buildSheetRanges(values: string[][]) {
	const searchLimit = 50; // arbitrary limit to search

	for (const [i, row] of values.slice(0, searchLimit).entries()) {
		const hasSKU = row.includes("SKU");
		const hasStatus = row.includes("Status");
		const statusIndex = row.indexOf("Status");

		if (hasSKU && hasStatus) {
			const firstCol = row.findIndex((cell) => cell.trim() !== "");
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
