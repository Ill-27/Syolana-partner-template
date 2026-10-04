import crypto from "node:crypto";

const env = process.env;
const allowedOrigin = String(env.ALLOWED_ORIGIN || "").trim();
const partnerId = String(env.PARTNER_ID || "").trim();
const githubRepo = String(env.GITHUB_REPO || "").trim();
const githubToken = String(env.GITHUB_TOKEN || "").trim();
const accessHash = String(env.PARTNER_ACCESS_KEY_HASH || "").toLowerCase().trim();
const sessionSecret = String(env.SESSION_SECRET || "").trim();
const entitlementUrl = String(env.ENTITLEMENT_URL || "").trim();
const entitlementServiceToken = String(
  env.ENTITLEMENT_SERVICE_TOKEN || "",
).trim();

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
        "access-control-allow-methods": "GET,POST,PUT,OPTIONS",
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
    const payload = JSON.parse(
      Buffer.from(body, "base64url").toString("utf8"),
    );
    if (payload.partnerId !== partnerId) return null;
    if (Number(payload.exp || 0) < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

function auth(event) {
  const headers = event.headers || {};
  const value = headers.authorization || headers.Authorization || "";
  const match = /^Bearer\s+(.+)$/i.exec(value);
  return verifySession(match?.[1]);
}

function assertConfig() {
  const required = {
    PARTNER_ID: partnerId,
    PARTNER_ACCESS_KEY_HASH: accessHash,
    SESSION_SECRET: sessionSecret,
    ALLOWED_ORIGIN: allowedOrigin,
    ENTITLEMENT_URL: entitlementUrl,
    ENTITLEMENT_SERVICE_TOKEN: entitlementServiceToken,
    GITHUB_REPO: githubRepo,
    GITHUB_TOKEN: githubToken,
  };

  const missing = Object.entries(required)
    .filter(([, value]) => !value)
    .map(([key]) => key);

  if (missing.length) {
    throw new Error("Studio API is not configured: " + missing.join(", "));
  }
}

async function assertPartnerActive() {
  const url = new URL(entitlementUrl);
  url.searchParams.set("partnerId", partnerId);

  const response = await fetch(url, {
    cache: "no-store",
    headers: {
      "authorization": "Bearer " + entitlementServiceToken,
      "accept": "application/json",
      "user-agent": "Partner-Studio/3.0",
    },
  });

  if (!response.ok) throw new Error("Entitlement unavailable");

  const data = await response.json();
  const record =
    typeof data?.active === "boolean"
      ? data
      : data?.partners?.[partnerId];

  if (!record?.active || record?.features?.studio === false) {
    const error = new Error("Partner Studio disabled");
    error.code = "PARTNER_DISABLED";
    throw error;
  }

  return record;
}

function safeContacts(value) {
  const input = value || {};
  const email = String(input.email || "").trim();
  const vk = String(input.vk || "").trim();
  const avito = String(input.avito || "").trim();

  const out = [];

  if (email) {
    const bare = email.replace(/^mailto:/i, "");
    if (!/^[^@\s]+@(yandex\.ru|ya\.ru)$/i.test(bare)) {
      throw new Error("Yandex email required");
    }
    out.push({
      type: "email",
      label: "Yandex-почта",
      href: "mailto:" + bare,
    });
  }

  const checkedUrl = (raw, hosts, label) => {
    if (!raw) return "";
    const url = new URL(raw);
    if (
      url.protocol !== "https:" ||
      !hosts.some(
        (host) =>
          url.hostname === host || url.hostname.endsWith("." + host),
      )
    ) {
      throw new Error("Invalid " + label + " URL");
    }
    return url.href;
  };

  const vkHref = checkedUrl(vk, ["vk.com"], "VK");
  if (vkHref) {
    out.push({
      type: "vk",
      label: "ВКонтакте",
      href: vkHref,
    });
  }

  const avitoHref = checkedUrl(avito, ["avito.ru"], "Avito");
  if (avitoHref) {
    out.push({
      type: "avito",
      label: "Авито",
      href: avitoHref,
    });
  }

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
    "https://api.github.com/repos/" +
      githubRepo +
      "/contents/" +
      ghPath(path),
    {
      method,
      headers: {
        "accept": "application/vnd.github+json",
        "authorization": "Bearer " + githubToken,
        "x-github-api-version": "2022-11-28",
        "user-agent": "Partner-Studio-Settings",
        ...(body ? { "content-type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    },
  );

  if (response.status === 404) return null;

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(
      "GitHub settings API " +
        response.status +
        ": " +
        detail.slice(0, 240),
    );
  }

  return response.json();
}

async function readPartner() {
  const item = await github("GET", "partner.json");
  if (!item || Array.isArray(item) || !item.content) return null;

  return {
    sha: item.sha,
    value: JSON.parse(
      Buffer.from(item.content.replace(/\s/g, ""), "base64").toString(
        "utf8",
      ),
    ),
  };
}

async function writePartner(current, value) {
  await github("PUT", "partner.json", {
    message: "Update partner contact settings",
    content: Buffer.from(
      JSON.stringify(value, null, 2) + "\n",
    ).toString("base64"),
    sha: current.sha,
    branch: "main",
  });
}

export async function handler(event) {
  const method = String(event?.httpMethod || "GET").toUpperCase();
  const path = String(event?.path || "/").replace(/\/+$/, "") || "/";

  if (method === "OPTIONS") {
    return { statusCode: 204, headers: cors(), body: "" };
  }

  try {
    assertConfig();
    const entitlement = await assertPartnerActive();

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

      return json(200, {
        token,
        expiresIn: 2700,
      });
    }

    const session = auth(event);
    if (!session) return json(401, { error: "unauthorized" });

    if (path === "/status" && method === "GET") {
      return json(200, {
        partnerId,
        active: true,
        features: entitlement.features || {},
        publishingSource: "vk",
        postEditing: false,
      });
    }

    if (path === "/contacts" && method === "GET") {
      const current = await readPartner();
      if (!current) return json(404, { error: "partner_not_found" });

      const byType = Object.fromEntries(
        (
          Array.isArray(current.value.contacts)
            ? current.value.contacts
            : []
        ).map((item) => [item.type, item.href]),
      );

      return json(200, {
        email: String(byType.email || "").replace(/^mailto:/i, ""),
        vk: byType.vk || "",
        avito: byType.avito || "",
      });
    }

    if (path === "/contacts" && method === "PUT") {
      const current = await readPartner();
      if (!current) return json(404, { error: "partner_not_found" });

      current.value.contacts = safeContacts(
        parseBody(event).contacts,
      );

      await writePartner(current, current.value);

      return json(200, {
        ok: true,
        contacts: current.value.contacts,
      });
    }

    return json(404, { error: "not_found" });
  } catch (error) {
    console.error(error);

    if (error?.code === "PARTNER_DISABLED") {
      return json(403, { error: "partner_disabled" });
    }

    return json(500, { error: "server_error" });
  }
}
