import crypto from "node:crypto";

const env = process.env;
const allowedOrigin = String(env.ALLOWED_ORIGIN || "");
const partnerId = String(env.PARTNER_ID || "");
const githubRepo = String(env.GITHUB_REPO || "");
const githubToken = String(env.GITHUB_TOKEN || "");
const accessHash = String(env.PARTNER_ACCESS_KEY_HASH || "").toLowerCase();
const sessionSecret = String(env.SESSION_SECRET || "");
const maxImageBytes = 8 * 1024 * 1024;

const json = (statusCode, data, extra = {}) => ({
  statusCode,
  headers: {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    ...cors(),
    ...extra,
  },
  body: JSON.stringify(data),
});

function cors() {
  return allowedOrigin
    ? {
        "access-control-allow-origin": allowedOrigin,
        "access-control-allow-headers": "authorization,content-type",
        "access-control-allow-methods": "GET,POST,PUT,DELETE,OPTIONS",
        "vary": "Origin",
      }
    : {};
}

function parseBody(event) {
  const raw = event?.body || "";
  if (!raw) return {};
  const text = event.isBase64Encoded
    ? Buffer.from(raw, "base64").toString("utf8")
    : raw;
  return JSON.parse(text);
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function constantEqual(a, b) {
  const aa = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}

function b64url(value) {
  return Buffer.from(value).toString("base64url");
}

function signSession(payload) {
  const body = b64url(JSON.stringify(payload));
  const sig = crypto
    .createHmac("sha256", sessionSecret)
    .update(body)
    .digest("base64url");
  return body + "." + sig;
}

function verifySession(token) {
  if (!token || !sessionSecret) return null;
  const [body, sig] = String(token).split(".");
  if (!body || !sig) return null;
  const expected = crypto
    .createHmac("sha256", sessionSecret)
    .update(body)
    .digest("base64url");
  if (!constantEqual(sig, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (payload.partnerId !== partnerId) return null;
    if (Number(payload.exp || 0) < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

function auth(event) {
  const headers = event.headers || {};
  const value =
    headers.authorization ||
    headers.Authorization ||
    "";
  const match = /^Bearer\s+(.+)$/i.exec(value);
  return verifySession(match?.[1]);
}

function assertConfig() {
  if (!partnerId || !githubRepo || !githubToken || !accessHash || !sessionSecret) {
    throw new Error("Studio API is not configured");
  }
}

function safePost(post) {
  const id = String(post?.id || "").trim();
  const title = String(post?.title || "").trim();
  const text = String(post?.text || "").trim();
  const category = String(post?.category || "Публикации").trim().slice(0, 60);
  const publishedAt = String(post?.publishedAt || "").trim();

  if (!/^[a-z0-9][a-z0-9._-]{1,90}$/i.test(id)) throw new Error("Invalid post id");
  if (!title || title.length > 140) throw new Error("Invalid title");
  if (!text || text.length > 12000) throw new Error("Invalid text");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(publishedAt)) throw new Error("Invalid date");

  const links = Array.isArray(post?.links) ? post.links.slice(0, 8) : [];
  const media = Array.isArray(post?.media) ? post.media.slice(0, 4) : [];

  return {
    id,
    title,
    text,
    category,
    publishedAt,
    media,
    links,
  };
}

function safeContacts(value) {
  const input = value || {};
  const email = String(input.email || "").trim();
  const vk = String(input.vk || "").trim();
  const avito = String(input.avito || "").trim();

  const out = [];

  if (email) {
    const bare = email.replace(/^mailto:/i, "");
    if (!/^[^@\s]+@(yandex\.ru|ya\.ru)$/i.test(bare))
      throw new Error("Yandex email required");
    out.push({
      type: "email",
      label: "Yandex-почта",
      href: "mailto:" + bare,
    });
  }

  const checkedUrl = (raw, hosts, label) => {
    if (!raw) return "";
    const u = new URL(raw);
    if (u.protocol !== "https:" || !hosts.some((host) => u.hostname === host || u.hostname.endsWith("." + host)))
      throw new Error("Invalid " + label + " URL");
    return u.href;
  };

  const vkHref = checkedUrl(vk, ["vk.com"], "VK");
  if (vkHref)
    out.push({ type: "vk", label: "ВКонтакте", href: vkHref });

  const avitoHref = checkedUrl(avito, ["avito.ru"], "Avito");
  if (avitoHref)
    out.push({ type: "avito", label: "Авито", href: avitoHref });

  return out;
}

function ghPath(path) {
  return path
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
}

async function github(method, path, body) {
  const response = await fetch(
    "https://api.github.com/repos/" + githubRepo + "/contents/" + ghPath(path),
    {
      method,
      headers: {
        "accept": "application/vnd.github+json",
        "authorization": "Bearer " + githubToken,
        "x-github-api-version": "2022-11-28",
        "user-agent": "Syolana-Partner-Studio",
        ...(body ? { "content-type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    },
  );

  if (response.status === 404) return null;
  if (!response.ok) {
    const detail = await response.text();
    throw new Error("GitHub API " + response.status + ": " + detail.slice(0, 300));
  }
  return response.status === 204 ? null : response.json();
}

async function readContent(path) {
  const item = await github("GET", path);
  if (!item || Array.isArray(item) || !item.content) return null;
  return {
    sha: item.sha,
    text: Buffer.from(item.content.replace(/\s/g, ""), "base64").toString("utf8"),
  };
}

async function listJson(dir) {
  const items = await github("GET", dir);
  if (!Array.isArray(items)) return [];
  const out = [];
  for (const item of items.filter((x) => x.type === "file" && x.name.endsWith(".json"))) {
    const file = await readContent(dir + "/" + item.name);
    if (!file) continue;
    try {
      out.push(JSON.parse(file.text));
    } catch {}
  }
  return out;
}

async function putJson(path, value, message) {
  const existing = await readContent(path);
  const payload = {
    message,
    content: Buffer.from(JSON.stringify(value, null, 2) + "\n").toString("base64"),
    branch: "main",
  };
  if (existing?.sha) payload.sha = existing.sha;
  await github("PUT", path, payload);
}

async function deletePath(path, message) {
  const existing = await readContent(path);
  if (!existing?.sha) return false;
  await github("DELETE", path, {
    message,
    sha: existing.sha,
    branch: "main",
  });
  return true;
}

async function saveMedia(body) {
  const filename = String(body?.filename || "").trim();
  const mime = String(body?.mime || "").trim().toLowerCase();
  const base64 = String(body?.base64 || "").replace(/^data:[^;]+;base64,/, "");

  const extensions = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/avif": "avif",
    "image/svg+xml": "svg",
  };
  const ext = extensions[mime];
  if (!ext) throw new Error("Unsupported image type");

  const bytes = Buffer.from(base64, "base64");
  if (!bytes.length || bytes.length > maxImageBytes) throw new Error("Invalid image size");

  const stem = filename
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/[^a-z0-9._-]+/gi, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 70) || "image";

  const path = "media/" + Date.now().toString(36) + "-" + stem + "." + ext;
  await github("PUT", path, {
    message: "Add Partner Studio media",
    content: bytes.toString("base64"),
    branch: "main",
  });
  return path;
}

export async function handler(event) {
  const method = String(event?.httpMethod || "GET").toUpperCase();
  const path = String(event?.path || "/").replace(/\/+$/, "") || "/";

  if (method === "OPTIONS") return { statusCode: 204, headers: cors(), body: "" };

  try {
    assertConfig();

    if (path === "/session" && method === "POST") {
      const body = parseBody(event);
      if (
        String(body.partnerId || "") !== partnerId ||
        !constantEqual(sha256(body.accessKey || ""), accessHash)
      ) {
        return json(401, { error: "invalid_credentials" });
      }

      const token = signSession({
        partnerId,
        exp: Date.now() + 45 * 60 * 1000,
      });
      return json(200, { token, expiresIn: 2700 });
    }

    const session = auth(event);
    if (!session) return json(401, { error: "unauthorized" });

    if (path === "/contacts" && method === "GET") {
      const current = await readContent("partner.json");
      if (!current) return json(404, { error: "partner_not_found" });
      const partner = JSON.parse(current.text);
      const byType = Object.fromEntries(
        (Array.isArray(partner.contacts) ? partner.contacts : []).map((item) => [
          item.type,
          item.href,
        ]),
      );
      return json(200, {
        email: String(byType.email || "").replace(/^mailto:/i, ""),
        vk: byType.vk || "",
        avito: byType.avito || "",
      });
    }

    if (path === "/contacts" && method === "PUT") {
      const current = await readContent("partner.json");
      if (!current) return json(404, { error: "partner_not_found" });
      const partner = JSON.parse(current.text);
      partner.contacts = safeContacts(parseBody(event).contacts);
      await putJson(
        "partner.json",
        partner,
        "Update Partner Studio contacts",
      );
      return json(200, { ok: true, contacts: partner.contacts });
    }

        if (path === "/posts" && method === "GET") {
      const [posts, vkDrafts] = await Promise.all([
        listJson("posts"),
        listJson("drafts/vk"),
      ]);
      return json(200, { posts, vkDrafts });
    }

    if (path === "/posts" && method === "POST") {
      const post = safePost(parseBody(event).post);
      await putJson(
        "posts/" + post.id + ".json",
        post,
        "Publish Partner Studio post: " + post.id,
      );
      return json(201, { ok: true, post });
    }

    const postMatch = /^\/posts\/([a-z0-9._-]+)$/i.exec(path);
    if (postMatch && method === "PUT") {
      const post = safePost({ ...parseBody(event).post, id: postMatch[1] });
      await putJson(
        "posts/" + post.id + ".json",
        post,
        "Update Partner Studio post: " + post.id,
      );
      return json(200, { ok: true, post });
    }

    if (postMatch && method === "DELETE") {
      const ok = await deletePath(
        "posts/" + postMatch[1] + ".json",
        "Delete Partner Studio post: " + postMatch[1],
      );
      return json(ok ? 200 : 404, { ok });
    }

    if (path === "/media" && method === "POST") {
      const mediaPath = await saveMedia(parseBody(event));
      return json(201, { ok: true, path: mediaPath });
    }

    const vkDraftDeleteMatch = /^\/vk-drafts\/([a-z0-9._-]+)$/i.exec(path);
    if (vkDraftDeleteMatch && method === "DELETE") {
      const ok = await deletePath(
        "drafts/vk/" + vkDraftDeleteMatch[1] + ".json",
        "Delete VK draft from Partner Studio: " + vkDraftDeleteMatch[1],
      );
      return json(ok ? 200 : 404, { ok });
    }

    const vkDraftMatch = /^\/vk-drafts\/([a-z0-9._-]+)\/publish$/i.exec(path);
    if (vkDraftMatch && method === "POST") {
      const id = vkDraftMatch[1];
      const draftFile = await readContent("drafts/vk/" + id + ".json");
      if (!draftFile) return json(404, { error: "draft_not_found" });

      const draft = JSON.parse(draftFile.text);
      const post = safePost({
        ...draft,
        id,
        category: draft.category || "VK",
        publishedAt:
          draft.publishedAt || new Date().toISOString().slice(0, 10),
      });

      await putJson(
        "posts/" + post.id + ".json",
        post,
        "Publish VK draft from Partner Studio: " + post.id,
      );
      await deletePath(
        "drafts/vk/" + id + ".json",
        "Remove published VK draft: " + id,
      );
      return json(201, { ok: true, post });
    }

    return json(404, { error: "not_found" });
  } catch (error) {
    console.error(error);
    return json(500, { error: "server_error" });
  }
}
