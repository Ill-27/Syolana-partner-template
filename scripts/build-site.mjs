import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const dist = path.resolve(root, process.env.DIST_DIR || ".dist");

const integration = JSON.parse(
  await readFile(path.join(root, "integration.json"), "utf8"),
);

const mode = process.env.SYOLANA_FORCE_MODE || integration.mode || "off";
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

if (active) {
  // The partner artifact receives only the neutral integration loader/config.
  // Premium themes, player code, fonts and audio are NEVER mirrored here.
  await copy(
    path.join(root, "integration.json"),
    path.join(dist, "integration.json"),
  );
  await copy(
    path.join(root, "platform-loader.js"),
    path.join(dist, "platform-loader.js"),
  );

  try {
    await copy(path.join(root, "studio"), path.join(dist, "studio"));
  } catch {}
} else {
  // A detached/off build must boot instantly without requesting a missing
  // optional loader and without retaining a platform-specific script tag.
  const indexPath = path.join(dist, "index.html");
  let html = await readFile(indexPath, "utf8");
  html = html.replace(
    /\s*<script\s+type=["']module["']\s+src=["']\.\/platform-loader\.js["']><\/script>\s*/i,
    "\n  <script>window.__partnerBootDone?.(\"platform\");</script>\n",
  );
  await writeFile(indexPath, html, "utf8");
}

console.log(
  active
    ? "Built neutral partner shell. Premium platform assets remain remote."
    : "Built standalone partner shell without the optional platform layer.",
);
