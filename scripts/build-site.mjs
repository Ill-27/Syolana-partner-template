import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const dist = path.resolve(root, process.env.DIST_DIR || ".dist");
const integration = JSON.parse(
  await readFile(path.join(root, "syolana.json"), "utf8"),
);
const mode = process.env.SYOLANA_FORCE_MODE || integration.mode || "inactive";
const active = mode === "preview" || mode === "active";

const copy = async (from, to) => {
  await mkdir(path.dirname(to), { recursive: true });
  await cp(from, to, { recursive: true });
};

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

for (const file of [
  "index.html",
  "app.js",
  "styles.css",
  "partner.json",
  "feed.json",
  "robots.txt",
]) {
  await copy(path.join(root, file), path.join(dist, file));
}

try {
  await copy(path.join(root, "media"), path.join(dist, "media"));
} catch {}

let html = await readFile(path.join(dist, "index.html"), "utf8");

if (active) {
  const source =
    String(integration.coreSource || "").replace(/\/+$/, "") + "/";
  const coreUrl = String(integration.coreUrl || "").trim();

  if (!/^https:\/\//.test(source) || !/^https:\/\//.test(coreUrl)) {
    throw new Error(
      "Active integration requires HTTPS coreSource and coreUrl",
    );
  }

  // The neutral source never contains platform branding. The active build
  // receives one mount point and one loader only while access is enabled.
  html = html.replace(
    '<main id="top">',
    '<div id="platform-banner-slot"></div>\n\n      <main id="top">',
  );
  html = html.replace(
    "</body>",
    '  <script type="module" src="./platform-active.js"></script>\n</body>',
  );

  const loader = `const partner = await fetch("./partner.json", { cache: "no-store" }).then((r) => r.json());
try {
  const core = await import(${JSON.stringify(coreUrl)});
  await core.mountPartnerCore({
    partnerName: partner.name,
    partnerId: ${JSON.stringify(integration.partnerId || "")},
    features: ${JSON.stringify(integration.features || {})},
  });
} catch (error) {
  console.warn("Optional immersive layer unavailable", error);
}`;

  await writeFile(
    path.join(dist, "platform-active.js"),
    loader + "\n",
    "utf8",
  );

  // The theme runtime itself stays central. Only theme manifests/modules that
  // ThemeEngine resolves against the partner origin are mirrored at build time.
  const manifestResponse = await fetch(source + "themes/manifest.json", {
    redirect: "follow",
  });
  if (!manifestResponse.ok) {
    throw new Error(
      `Theme manifest sync failed (${manifestResponse.status})`,
    );
  }
  const manifestText = await manifestResponse.text();
  const manifest = JSON.parse(manifestText);
  await mkdir(path.join(dist, "themes"), { recursive: true });
  await writeFile(
    path.join(dist, "themes", "manifest.json"),
    manifestText,
    "utf8",
  );

  for (const item of manifest) {
    const moduleName = String(item?.module || "")
      .replace(/^\.\//, "")
      .replace(/^\/+/, "");

    if (!/^[a-z0-9._-]+\.js$/i.test(moduleName)) {
      throw new Error("Unsafe theme module name: " + moduleName);
    }

    const response = await fetch(source + "themes/" + moduleName, {
      redirect: "follow",
    });
    if (!response.ok) {
      throw new Error(
        `Theme sync failed: ${moduleName} (${response.status})`,
      );
    }

    await writeFile(
      path.join(dist, "themes", moduleName),
      await response.text(),
      "utf8",
    );
  }

  // Current visual themes use these optional ambient files. Keeping them in
  // the active artifact makes the theme self-contained on the partner origin.
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
    if (!response.ok) {
      throw new Error(
        `Asset sync failed: ${relative} (${response.status})`,
      );
    }

    const target = path.join(dist, relative);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(
      target,
      new Uint8Array(await response.arrayBuffer()),
    );
  }
}

await writeFile(path.join(dist, "index.html"), html, "utf8");

async function collectFiles(dir) {
  const result = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) result.push(...(await collectFiles(full)));
    else result.push(full);
  }
  return result;
}

if (!active) {
  const textExtensions = new Set([
    ".html",
    ".js",
    ".css",
    ".json",
    ".txt",
    ".xml",
    ".svg",
  ]);
  const leaks = [];

  for (const file of await collectFiles(dist)) {
    if (!textExtensions.has(path.extname(file).toLowerCase())) continue;
    const body = await readFile(file, "utf8");
    if (/syolana/i.test(body)) leaks.push(path.relative(dist, file));
  }

  if (leaks.length) {
    throw new Error(
      "Clean offboarding failed; platform brand references remain in: " +
        leaks.join(", "),
    );
  }
}

console.log(
  active
    ? "Built active partner site with centrally supplied immersive themes."
    : "Built clean independent partner site with no platform brand references.",
);
