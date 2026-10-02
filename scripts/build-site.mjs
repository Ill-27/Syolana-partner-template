import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const dist = path.resolve(root, process.env.DIST_DIR || ".dist");
const integration = JSON.parse(await readFile(path.join(root, "syolana.json"), "utf8"));
const mode = process.env.SYOLANA_FORCE_MODE || integration.mode || "inactive";
const active = mode === "preview" || mode === "active";

const copy = async (from, to) => {
  await mkdir(path.dirname(to), { recursive: true });
  await cp(from, to, { recursive: true });
};

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

for (const file of ["index.html", "app.js", "styles.css", "partner.json", "feed.json", "robots.txt"]) {
  await copy(path.join(root, file), path.join(dist, file));
}

try {
  await copy(path.join(root, "media"), path.join(dist, "media"));
} catch {}

let html = await readFile(path.join(dist, "index.html"), "utf8");

if (active) {
  const source = String(integration.coreSource || "").replace(/\/+$/, "") + "/";
  const platformUrl = String(integration.platformUrl || "").replace(/\/+$/, "") + "/";

  if (!/^https:\/\//.test(source) || !/^https:\/\//.test(platformUrl)) {
    throw new Error("Active integration requires HTTPS coreSource and platformUrl");
  }

  html = html.replace(
    "</head>",
    '  <link rel="stylesheet" href="./syolana-active.css" />\n</head>'
  );
  html = html.replace(
    "</body>",
    '  <script type="module" src="./syolana-active.js"></script>\n</body>'
  );

  await copy(
    path.join(root, "integration", "syolana-active.css"),
    path.join(dist, "syolana-active.css")
  );
  await copy(
    path.join(root, "integration", "syolana-active.js"),
    path.join(dist, "syolana-active.js")
  );

  const textAssets = [
    "themes.js",
    "utils.js",
    "themes/manifest.json",
    "themes/aurora.js",
    "themes/golden.js",
    "themes/moon.js",
    "themes/white-ocean-city.js",
    "assets/logo.svg",
    "config.json",
  ];

  for (const relative of textAssets) {
    const response = await fetch(source + relative, { redirect: "follow" });
    if (!response.ok) throw new Error(`Core sync failed: ${relative} (${response.status})`);
    const body = await response.text();

    if (relative === "config.json") {
      const config = JSON.parse(body);
      const songs = (Array.isArray(config.songs) ? config.songs : []).map((song) => ({
        ...song,
        src: new URL(song.src, platformUrl).href,
        sourceUrl: song.sourceUrl ? new URL(song.sourceUrl, platformUrl).href : "",
      }));
      const runtime = {
        platformUrl,
        banner: config.banner || {},
        songs,
        syncedAt: new Date().toISOString(),
      };
      await mkdir(path.join(dist, "_syolana"), { recursive: true });
      await writeFile(
        path.join(dist, "_syolana", "runtime.json"),
        JSON.stringify(runtime, null, 2) + "\n",
        "utf8"
      );
      continue;
    }

    const target = path.join(dist, relative);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, body, "utf8");
  }

  // Only the audio used directly by the current theme package is mirrored.
  const binaryAssets = [
    "audio-library/nature/ocean_waves.ogg",
    "audio-library/nature/wind_soft.ogg",
    "audio-library/compatible/nature/wind_soft.m4a",
    "audio-library/ambience/night_air.ogg",
    "audio-library/compatible/ambience/night_air.m4a",
    "audio-library/nature/bird_wings_flutter.ogg",
    "audio-library/compatible/nature/bird_wings_flutter.m4a",
  ];

  for (const relative of binaryAssets) {
    const response = await fetch(source + relative, { redirect: "follow" });
    if (!response.ok) throw new Error(`Asset sync failed: ${relative} (${response.status})`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    const target = path.join(dist, relative);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, bytes);
  }
}

await writeFile(path.join(dist, "index.html"), html, "utf8");

async function collectFiles(dir) {
  const result = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) result.push(...await collectFiles(full));
    else result.push(full);
  }
  return result;
}

if (!active) {
  const textExtensions = new Set([".html", ".js", ".css", ".json", ".txt", ".xml", ".svg"]);
  const leaks = [];
  for (const file of await collectFiles(dist)) {
    if (!textExtensions.has(path.extname(file).toLowerCase())) continue;
    const body = await readFile(file, "utf8");
    if (/syolana/i.test(body)) leaks.push(path.relative(dist, file));
  }
  if (leaks.length) {
    throw new Error("Clean offboarding failed; brand references remain in: " + leaks.join(", "));
  }
}

console.log(
  active
    ? "Built active partner site with freshly synced platform assets."
    : "Built clean independent partner site with no platform brand references."
);
