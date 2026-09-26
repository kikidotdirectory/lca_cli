import fs from "node:fs";
import path from "node:path";

export const cache_dir = path.join(process.cwd(), "cache");
await fs.promises.mkdir(cache_dir, { recursive: true });

export const spreadsheetId = process.env.SPREADSHEET_ID;
export const selectedSheetsPath = path.join(process.cwd(), cache_dir, "selected-sheets.json");
