import { readFile, writeFile, rm } from "node:fs/promises";

const indexPath = new URL("../index.html", import.meta.url);
let html = await readFile(indexPath, "utf8");

html = html.replace(
  /\n\s*<script type="module" src="\.\/platform-loader\.js"><\/script>/,
  "",
);

await writeFile(indexPath, html, "utf8");

for (const name of ["../platform-loader.js", "../integration.json"]) {
  try {
    await rm(new URL(name, import.meta.url));
  } catch {}
}

console.log("Optional platform layer removed. The standalone partner site remains.");
