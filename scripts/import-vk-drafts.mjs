import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const ownerId = String(process.env.VK_OWNER_ID || "").trim();
const token = String(process.env.VK_ACCESS_TOKEN || "").trim();
const version = String(process.env.VK_API_VERSION || "5.199").trim();
const count = Math.min(50, Math.max(1, Number(process.env.VK_IMPORT_COUNT || 12)));

if (!/^-?\d+$/.test(ownerId)) throw new Error("VK_OWNER_ID is required");
if (!token) throw new Error("VK_ACCESS_TOKEN is required");

const readJsonDir = async (dir) => {
  try {
    const names = (await readdir(dir)).filter((n) => n.endsWith(".json"));
    const out = [];
    for (const name of names) {
      try {
        out.push(JSON.parse(await readFile(path.join(dir, name), "utf8")));
      } catch {}
    }
    return out;
  } catch {
    return [];
  }
};

const known = new Set();
for (const item of [
  ...(await readJsonDir(path.join(root, "posts"))),
  ...(await readJsonDir(path.join(root, "drafts", "vk"))),
]) {
  if (item?.source?.type === "vk" && item.source.ownerId != null && item.source.postId != null) {
    known.add(String(item.source.ownerId) + ":" + String(item.source.postId));
  }
}

const params = new URLSearchParams({
  owner_id: ownerId,
  count: String(count),
  filter: "owner",
  access_token: token,
  v: version,
});

const response = await fetch("https://api.vk.com/method/wall.get?" + params, {
  headers: { "User-Agent": "SyolanaPartnerImporter/1.0" },
});

if (!response.ok) throw new Error("VK HTTP " + response.status);
const payload = await response.json();
if (payload.error) {
  throw new Error("VK API error " + payload.error.error_code + ": " + payload.error.error_msg);
}

const items = Array.isArray(payload?.response?.items) ? payload.response.items : [];
const targetDir = path.join(root, "drafts", "vk");
await mkdir(targetDir, { recursive: true });

let created = 0;

for (const item of items) {
  // Import only posts authored by the configured owner/community.
  if (String(item.from_id) !== ownerId) continue;

  const key = ownerId + ":" + String(item.id);
  if (known.has(key)) continue;

  const text = String(item.text || "").trim();
  if (!text && !item.attachments?.length) continue;

  const firstLine = text.split(/\n+/)[0].trim();
  const title =
    firstLine.length > 0
      ? firstLine.slice(0, 110)
      : "Публикация из VK";

  const media = [];
  for (const attachment of Array.isArray(item.attachments) ? item.attachments : []) {
    if (attachment?.type !== "photo" || !attachment.photo) continue;
    const sizes = Array.isArray(attachment.photo.sizes) ? attachment.photo.sizes : [];
    const largest = [...sizes].sort((a, b) => (b.width || 0) * (b.height || 0) - (a.width || 0) * (a.height || 0))[0];
    if (largest?.url) {
      media.push({
        type: "image",
        src: largest.url,
        alt: "",
        remote: true,
      });
    }
  }

  const date = new Date(Number(item.date || 0) * 1000);
  const publishedAt = Number.isFinite(date.getTime())
    ? date.toISOString().slice(0, 10)
    : new Date().toISOString().slice(0, 10);

  const draft = {
    id: `vk-${String(ownerId).replace("-", "m")}-${item.id}`,
    status: "draft",
    title,
    text,
    category: "VK",
    publishedAt,
    media,
    links: [
      {
        label: "Оригинал во ВКонтакте",
        href: `https://vk.com/wall${ownerId}_${item.id}`,
      },
    ],
    source: {
      type: "vk",
      ownerId,
      postId: item.id,
      url: `https://vk.com/wall${ownerId}_${item.id}`,
      importedAt: new Date().toISOString(),
    },
  };

  await writeFile(
    path.join(targetDir, draft.id + ".json"),
    JSON.stringify(draft, null, 2) + "\n",
    "utf8",
  );

  known.add(key);
  created += 1;
}

console.log(`VK import complete. New drafts: ${created}`);
