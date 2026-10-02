import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const postsDir = path.join(root, "posts");
const partner = JSON.parse(
  await readFile(path.join(root, "partner.json"), "utf8")
);

const requiredPartner = ["id", "name", "tagline", "description"];
for (const key of requiredPartner) {
  if (!partner[key]) throw new Error(`partner.json: missing ${key}`);
}

const names = (await readdir(postsDir))
  .filter((name) => name.endsWith(".json"))
  .sort();

const posts = [];
const ids = new Set();

for (const name of names) {
  const file = path.join(postsDir, name);
  const post = JSON.parse(await readFile(file, "utf8"));

  for (const key of ["id", "title", "text", "publishedAt"]) {
    if (!post[key]) throw new Error(`${name}: missing ${key}`);
  }

  if (ids.has(post.id)) throw new Error(`duplicate post id: ${post.id}`);
  ids.add(post.id);

  if (!/^\d{4}-\d{2}-\d{2}$/.test(post.publishedAt)) {
    throw new Error(`${name}: publishedAt must be YYYY-MM-DD`);
  }

  posts.push({
    id: String(post.id),
    title: String(post.title),
    text: String(post.text),
    category: String(post.category || "Публикации"),
    publishedAt: post.publishedAt,
    media: Array.isArray(post.media) ? post.media : [],
    links: Array.isArray(post.links) ? post.links : [],
  });
}

posts.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));

await writeFile(
  path.join(root, "feed.json"),
  JSON.stringify(posts, null, 2) + "\n",
  "utf8"
);

console.log(`Validated partner.json and built ${posts.length} posts.`);
