import { readFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();

const partner = JSON.parse(
  await readFile(path.join(root, "partner.json"), "utf8"),
);
const feed = JSON.parse(
  await readFile(path.join(root, "feed.json"), "utf8"),
);

for (const key of ["id", "name", "tagline", "description"]) {
  if (!partner[key]) throw new Error(`partner.json: missing ${key}`);
}

if (!Array.isArray(feed)) throw new Error("feed.json must be an array");

const ids = new Set();

for (const [index, post] of feed.entries()) {
  const prefix = `feed.json[${index}]`;

  for (const key of ["id", "title", "publishedAt"]) {
    if (!post?.[key]) throw new Error(`${prefix}: missing ${key}`);
  }

  if (ids.has(post.id)) throw new Error(`duplicate post id: ${post.id}`);
  ids.add(post.id);

  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(post.publishedAt))) {
    throw new Error(`${prefix}: publishedAt must be YYYY-MM-DD`);
  }

  if (String(post.title).length > 140)
    throw new Error(`${prefix}: title is too long`);

  if (String(post.text || "").length > 12000)
    throw new Error(`${prefix}: text is too long`);

  if (post.source?.type && post.source.type !== "vk") {
    throw new Error(`${prefix}: only VK-derived public posts are allowed`);
  }

  for (const item of Array.isArray(post.media) ? post.media : []) {
    if ((item?.type || "image") !== "image") continue;
    if (item?.src && !/^https:\/\//i.test(String(item.src))) {
      throw new Error(`${prefix}: remote media must use HTTPS`);
    }
  }

  for (const item of Array.isArray(post.links) ? post.links : []) {
    if (item?.href && !/^https:\/\//i.test(String(item.href))) {
      throw new Error(`${prefix}: links must use HTTPS`);
    }
  }
}

console.log(
  `Validated partner.json and VK-derived feed.json (${feed.length} posts).`,
);
