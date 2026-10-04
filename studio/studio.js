const DRAFT_KEY = "partner-studio.drafts.v2";
const CONTACT_KEY = "partner-studio.contacts.v2";
const SESSION_KEY = "partner-studio.session.v1";

const $ = (s) => document.querySelector(s);
const today = () => new Date().toISOString().slice(0, 10);
const slug = (value) =>
  String(value || "post")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9а-яё]+/gi, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 70) || "post";

let cfg = {};
let apiEndpoint = "";
let token = "";
let published = [];
let vkDrafts = [];
let drafts = [];
let currentId = "";
let currentKind = "draft";
let previewImage = "";
let selectedFile = null;

function setStatus(message) {
  $("#form-status").textContent = message || "";
}

function loadLocal() {
  try {
    drafts = JSON.parse(localStorage.getItem(DRAFT_KEY) || "[]");
  } catch {
    drafts = [];
  }
}

function saveLocal() {
  localStorage.setItem(DRAFT_KEY, JSON.stringify(drafts));
}

function saveSession(value) {
  token = value || "";
  if (token) sessionStorage.setItem(SESSION_KEY, token);
  else sessionStorage.removeItem(SESSION_KEY);
}

function endpoint(path) {
  return new URL(path.replace(/^\//, ""), apiEndpoint.replace(/\/?$/, "/")).href;
}

async function api(path, { method = "GET", body } = {}) {
  if (!apiEndpoint) throw new Error("Studio API is not configured");

  const response = await fetch(endpoint(path), {
    method,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: "Bearer " + token } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: "omit",
    cache: "no-store",
  });

  const data = await response.json().catch(() => ({}));

  if (response.status === 401) {
    saveSession("");
    showLogin();
    throw new Error("Сессия закончилась. Войдите снова.");
  }

  if (!response.ok) {
    throw new Error(data?.error || "Ошибка Studio API");
  }

  return data;
}

function currentForm() {
  const id =
    currentId || slug($("#title").value) + "-" + Date.now().toString(36);

  const existing =
    currentKind === "published"
      ? published.find((p) => p.id === currentId)
      : currentKind === "vk"
        ? vkDrafts.find((p) => p.id === currentId)
        : drafts.find((p) => p.id === currentId);

  return {
    id,
    title: $("#title").value.trim(),
    category: $("#category").value.trim() || "Публикации",
    publishedAt: $("#publishedAt").value || today(),
    text: $("#text").value.trim(),
    caption: $("#caption").value.trim(),
    previewImage,
    media: Array.isArray(existing?.media) ? existing.media : [],
    links: Array.isArray(existing?.links) ? existing.links : [],
  };
}

function fill(post = {}, kind = "draft") {
  currentId = post.id || "";
  currentKind = kind;
  selectedFile = null;

  $("#title").value = post.title || "";
  $("#category").value = post.category || "Публикации";
  $("#publishedAt").value = post.publishedAt || today();
  $("#text").value = post.text || "";
  $("#caption").value = post.caption || post.media?.[0]?.caption || "";
  $("#image").value = "";

  previewImage =
    post.previewImage ||
    post.media?.[0]?.src ||
    "";

  const state =
    kind === "published"
      ? "ОПУБЛИКОВАНО"
      : kind === "vk"
        ? "ЧЕРНОВИК ИЗ VK"
        : currentId
          ? "ЛОКАЛЬНЫЙ ЧЕРНОВИК"
          : "НОВЫЙ ЧЕРНОВИК";

  $("#editor-state").textContent = state;
  $("#editor-title").textContent = post.title || "Новая публикация";
  $("#publish-post").textContent =
    kind === "published" ? "Сохранить на сайте" : "Отправить на публикацию";

  renderList();
  setStatus("");
}

function renderList() {
  const root = $("#post-list");
  root.replaceChildren();

  const items = [
    ...drafts.map((p) => ({ ...p, __kind: "draft" })),
    ...vkDrafts.map((p) => ({ ...p, __kind: "vk" })),
    ...published.map((p) => ({ ...p, __kind: "published" })),
  ];

  for (const post of items) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "post-item";
    b.dataset.active = String(
      post.id === currentId && post.__kind === currentKind,
    );
    b.innerHTML = "<strong></strong><small></small>";
    b.querySelector("strong").textContent = post.title || "Без названия";

    const label =
      post.__kind === "published"
        ? "На сайте"
        : post.__kind === "vk"
          ? "VK · черновик"
          : "Черновик";

    b.querySelector("small").textContent =
      label + " · " + (post.publishedAt || "");
    b.onclick = () => fill(post, post.__kind);
    root.append(b);
  }
}

async function loadServerState() {
  const data = await api("/posts");
  published = Array.isArray(data.posts) ? data.posts : [];
  vkDrafts = Array.isArray(data.vkDrafts) ? data.vkDrafts : [];

  const contacts = await api("/contacts").catch(() => ({}));
  $("#contact-email").value = contacts.email || "";
  $("#contact-vk").value = contacts.vk || "";
  $("#contact-avito").value = contacts.avito || "";

  renderList();
}

async function loadPublicFallback() {
  try {
    published = await fetch("../feed.json", { cache: "no-store" }).then((r) =>
      r.ok ? r.json() : [],
    );
  } catch {
    published = [];
  }

  try {
    const partner = await fetch("../partner.json", { cache: "no-store" }).then(
      (r) => r.json(),
    );
    const byType = Object.fromEntries(
      (partner.contacts || []).map((c) => [c.type, c.href]),
    );
    $("#contact-email").value = (byType.email || "").replace(/^mailto:/i, "");
    $("#contact-vk").value = byType.vk || "";
    $("#contact-avito").value = byType.avito || "";
  } catch {}

  try {
    const saved = JSON.parse(localStorage.getItem(CONTACT_KEY) || "{}");
    if (saved.email) $("#contact-email").value = saved.email;
    if (saved.vk) $("#contact-vk").value = saved.vk;
    if (saved.avito) $("#contact-avito").value = saved.avito;
  } catch {}
}

function showLogin(message = "") {
  $("#studio-login").hidden = false;
  $("#login-partner-id").value =
    $("#login-partner-id").value || cfg.partnerId || "";
  $("#login-status").textContent = message;
}

function hideLogin() {
  $("#studio-login").hidden = true;
  $("#login-access-key").value = "";
  $("#login-status").textContent = "";
}

async function boot() {
  loadLocal();

  try {
    cfg = await fetch("./studio-config.json", { cache: "no-store" }).then((r) =>
      r.ok ? r.json() : {},
    );
  } catch {
    cfg = {};
  }

  apiEndpoint = String(cfg.apiEndpoint || "").trim();
  token = sessionStorage.getItem(SESSION_KEY) || "";

  if (apiEndpoint) {
    $("#security-title").textContent = "Защищённый Studio API";
    $("#security-text").textContent =
      "Публикации меняются через короткую серверную сессию. GitHub/VK-секреты никогда не попадают в браузер.";

    if (token) {
      try {
        await loadServerState();
        hideLogin();
      } catch (error) {
        showLogin(error.message);
        await loadPublicFallback();
      }
    } else {
      showLogin();
      await loadPublicFallback();
    }
  } else {
    $("#security-title").textContent = "Безопасный демонстрационный режим";
    $("#security-text").textContent =
      "Пока Studio API не развёрнут, черновики сохраняются только в этом браузере. GitHub-токенов здесь нет.";
    await loadPublicFallback();
  }

  fill(drafts[0] || published[0] || {}, drafts[0] ? "draft" : published[0] ? "published" : "draft");
}

$("#login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("#login-status").textContent = "Проверяем доступ…";

  try {
    const data = await api("/session", {
      method: "POST",
      body: {
        partnerId: $("#login-partner-id").value.trim(),
        accessKey: $("#login-access-key").value,
      },
    });

    saveSession(data.token || "");
    await loadServerState();
    hideLogin();
    fill(published[0] || vkDrafts[0] || drafts[0] || {}, published[0] ? "published" : vkDrafts[0] ? "vk" : "draft");
  } catch (error) {
    $("#login-status").textContent = error.message || "Не удалось войти.";
  }
});

$("#new-post").onclick = () =>
  fill({ publishedAt: today(), category: "Публикации" }, "draft");

$("#post-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const post = currentForm();
  if (!post.title || !post.text) return;

  const local = {
    id: post.id,
    title: post.title,
    category: post.category,
    publishedAt: post.publishedAt,
    text: post.text,
    caption: post.caption,
    previewImage: post.previewImage,
  };

  const index = drafts.findIndex((p) => p.id === local.id);
  if (index >= 0) drafts[index] = local;
  else drafts.unshift(local);

  currentId = local.id;
  currentKind = "draft";
  saveLocal();
  renderList();
  setStatus("Черновик сохранён в этом браузере.");
});

$("#delete-post").onclick = async () => {
  if (!currentId)
    return fill({ publishedAt: today(), category: "Публикации" }, "draft");

  if (currentKind === "draft") {
    const index = drafts.findIndex((p) => p.id === currentId);
    if (index >= 0) drafts.splice(index, 1);
    saveLocal();
    fill(
      drafts[0] || published[0] || {},
      drafts[0] ? "draft" : published[0] ? "published" : "draft",
    );
    setStatus("Локальный черновик удалён.");
    return;
  }

  if (!apiEndpoint || !token) {
    setStatus("Для удаления с сайта нужен вход в защищённый Studio API.");
    return;
  }

  const title = $("#title").value.trim() || currentId;
  if (!confirm("Удалить «" + title + "»? Это изменение попадёт на сайт.")) return;

  try {
    if (currentKind === "published")
      await api("/posts/" + encodeURIComponent(currentId), { method: "DELETE" });
    else if (currentKind === "vk")
      await api("/vk-drafts/" + encodeURIComponent(currentId), {
        method: "DELETE",
      });

    await loadServerState();
    fill(
      published[0] || vkDrafts[0] || drafts[0] || {},
      published[0] ? "published" : vkDrafts[0] ? "vk" : "draft",
    );
    setStatus("Удалено.");
  } catch (error) {
    setStatus(error.message);
  }
};

$("#image").addEventListener("change", () => {
  const file = $("#image").files?.[0];
  selectedFile = file || null;
  if (!file) {
    previewImage = "";
    return;
  }

  const maxMb = Math.max(1, Number(cfg.maxImageMb || 8));
  if (file.size > maxMb * 1024 * 1024) {
    setStatus("Максимальный размер изображения: " + maxMb + " МБ.");
    $("#image").value = "";
    selectedFile = null;
    return;
  }

  const reader = new FileReader();
  reader.onload = () => {
    previewImage = String(reader.result || "");
  };
  reader.readAsDataURL(file);
});

function showPreview() {
  const post = currentForm();
  $("#preview-title").textContent = post.title || "Без названия";
  $("#preview-meta").textContent = [post.category, post.publishedAt]
    .filter(Boolean)
    .join(" · ");
  $("#preview-text").textContent = post.text || "";

  const figure = $("#preview-media");
  if (post.previewImage) {
    figure.hidden = false;
    figure.querySelector("img").src = post.previewImage;
    figure.querySelector("figcaption").textContent = post.caption || "";
  } else {
    figure.hidden = true;
    figure.querySelector("img").removeAttribute("src");
  }

  $("#preview").showModal();
}

$("#preview-post").onclick = showPreview;
$("#preview .preview-close").onclick = () => $("#preview").close();

async function filePayload(file) {
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Не удалось прочитать изображение."));
    reader.onload = () => resolve(String(reader.result || ""));
    reader.readAsDataURL(file);
  });

  return {
    filename: file.name,
    mime: file.type,
    base64: dataUrl,
  };
}

$("#publish-post").onclick = async () => {
  if (!apiEndpoint || !token) {
    showLogin("Чтобы публиковать на сайте, войдите в Partner Studio.");
    setStatus(
      "Публикация с сайта включится после входа в защищённый Studio API.",
    );
    return;
  }

  const post = currentForm();
  if (!post.title || !post.text) {
    setStatus("Добавьте заголовок и текст.");
    return;
  }

  $("#publish-post").disabled = true;
  setStatus("Сохраняем…");

  try {
    if (selectedFile) {
      const media = await api("/media", {
        method: "POST",
        body: await filePayload(selectedFile),
      });

      post.media = [
        {
          type: "image",
          src: media.path,
          alt: "",
          caption: post.caption || "",
        },
      ];
    } else if (post.media?.[0]) {
      post.media = [
        {
          ...post.media[0],
          caption: post.caption || post.media[0].caption || "",
        },
      ];
    }

    delete post.caption;
    delete post.previewImage;

    if (currentKind === "published") {
      await api("/posts/" + encodeURIComponent(post.id), {
        method: "PUT",
        body: { post },
      });
    } else if (currentKind === "vk") {
      await api("/vk-drafts/" + encodeURIComponent(post.id) + "/publish", {
        method: "POST",
      });
      await api("/posts/" + encodeURIComponent(post.id), {
        method: "PUT",
        body: { post },
      });
    } else {
      await api("/posts", {
        method: "POST",
        body: { post },
      });
    }

    drafts = drafts.filter((p) => p.id !== post.id);
    saveLocal();
    await loadServerState();

    const saved = published.find((p) => p.id === post.id) || post;
    fill(saved, "published");
    setStatus("Готово. GitHub Actions обновит публичный сайт автоматически.");
  } catch (error) {
    setStatus(error.message || "Не удалось сохранить публикацию.");
  } finally {
    $("#publish-post").disabled = false;
  }
};

$("#save-contacts").onclick = async () => {
  const contacts = {
    email: $("#contact-email").value.trim(),
    vk: $("#contact-vk").value.trim(),
    avito: $("#contact-avito").value.trim(),
  };

  if (!apiEndpoint || !token) {
    localStorage.setItem(CONTACT_KEY, JSON.stringify(contacts));
    setStatus(
      "Контакты сохранены локально. После входа Studio сможет обновить публичный сайт.",
    );
    return;
  }

  try {
    await api("/contacts", {
      method: "PUT",
      body: { contacts },
    });
    setStatus("Контакты обновлены на сайте партнёра.");
  } catch (error) {
    setStatus(error.message || "Не удалось сохранить контакты.");
  }
};

boot();
