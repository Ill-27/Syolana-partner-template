import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const ownerId = String(process.env.VK_OWNER_ID || "").trim();
const token = String(process.env.VK_ACCESS_TOKEN || "").trim();
const version = String(process.env.VK_API_VERSION || "5.199").trim();
const count = Math.min(50, Math.max(1, Number(process.env.VK_POST_COUNT || 20)));

if (!/^-?\d+$/.test(ownerId)) throw new Error("VK_OWNER_ID is required");
if (!token) throw new Error("VK_ACCESS_TOKEN is required");

const params = new URLSearchParams({
  owner_id: ownerId,
  count: String(count),
  filter: "owner",
  access_token: token,
  v: version,
});

const response = await fetch("https://api.vk.com/method/wall.get?" + params, {
  headers: { "User-Agent": "PartnerSite-VK-Sync/2.0" },
});

if (!response.ok) throw new Error("VK HTTP " + response.status);

const payload = await response.json();
if (payload.error) {
  throw new Error(
    "VK API error " +
      payload.error.error_code +
      ": " +
      payload.error.error_msg,
  );
}

const items = Array.isArray(payload?.response?.items)
  ? payload.response.items
  : [];

const cleanText = (value) =>
  String(value || "")
    .replace(/\r\n?/g, "\n")
    .replace(/\u0000/g, "")
    .trim()
    .slice(0, 12000);

const chooseTitle = (text) => {
  const first = text
    .split(/\n+/)
    .map((line) => line.trim())
    .find(Boolean);
  return (first || "Публикация во ВКонтакте").slice(0, 140);
};

const posts = [];

for (const item of items) {
  // Only content authored by the configured public page/community is mirrored.
  // Visitor posts from third parties are deliberately excluded.
  if (String(item.from_id) !== ownerId) continue;

  const text = cleanText(item.text);
  const attachments = Array.isArray(item.attachments) ? item.attachments : [];
  if (!text && !attachments.length) continue;

  const media = [];
  for (const attachment of attachments) {
    if (attachment?.type !== "photo" || !attachment.photo) continue;

    const sizes = Array.isArray(attachment.photo.sizes)
      ? attachment.photo.sizes
      : [];

    const largest = [...sizes].sort(
      (a, b) =>
        Number(b.width || 0) * Number(b.height || 0) -
        Number(a.width || 0) * Number(a.height || 0),
    )[0];

    if (!largest?.url || !/^https:\/\//i.test(largest.url)) continue;

    media.push({
      type: "image",
      src: largest.url,
      alt: "",
      remote: true,
    });

    if (media.length >= 4) break;
  }

  const date = new Date(Number(item.date || 0) * 1000);
  const publishedAt = Number.isFinite(date.getTime())
    ? date.toISOString().slice(0, 10)
    : new Date().toISOString().slice(0, 10);

  const postId = String(item.id);
  const sourceUrl = `https://vk.com/wall${ownerId}_${postId}`;

  posts.push({
    id: `vk-${String(ownerId).replace("-", "m")}-${postId}`,
    title: chooseTitle(text),
    text,
    category: "VK",
    publishedAt,
    media,
    links: [
      {
        label: "Оригинал во ВКонтакте",
        href: sourceUrl,
      },
    ],
    source: {
      type: "vk",
      ownerId,
      postId: Number(item.id),
      url: sourceUrl,
    },
  });
}

posts.sort((a, b) => {
  const byDate = String(b.publishedAt).localeCompare(String(a.publishedAt));
  if (byDate) return byDate;
  return String(b.id).localeCompare(String(a.id));
});

const partner = JSON.parse(
  await readFile(path.join(root, "partner.json"), "utf8"),
);

if (!partner?.id || !partner?.name) {
  throw new Error("partner.json must contain id and name");
}

// feed.json is partner-owned derived data. Syolana never edits the post body.
await writeFile(
  path.join(root, "feed.json"),
  JSON.stringify(posts, null, 2) + "\n",
  "utf8",
);

console.log(
  `VK sync complete for ${partner.id}. Public posts mirrored: ${posts.length}`,
);
