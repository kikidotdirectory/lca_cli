import fs from "node:fs";
import path from "node:path";

export const cache_dir = path.join(process.cwd(), "cache");
await fs.promises.mkdir(cache_dir, { recursive: true });
