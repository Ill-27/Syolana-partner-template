import { readFile, writeFile } from "node:fs/promises";

const next = process.argv[2];
if (!["preview", "active", "inactive"].includes(next)) {
  throw new Error("Usage: node scripts/set-integration-mode.mjs preview|active|inactive");
}

const file = new URL("../syolana.json", import.meta.url);
const data = JSON.parse(await readFile(file, "utf8"));
data.mode = next;
await writeFile(file, JSON.stringify(data, null, 2) + "\n", "utf8");
console.log("Integration mode:", next);
