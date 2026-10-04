const CONTACT_KEY = "partner-studio.contacts.v3";
const SESSION_KEY = "partner-studio.session.v2";

const $ = (selector) => document.querySelector(selector);

let cfg = {};
let apiEndpoint = "";
let token = "";
let feed = [];
let currentPostId = "";

function endpoint(path) {
  return new URL(path.replace(/^\//, ""), apiEndpoint.replace(/\/?$/, "/")).href;
}

function saveSession(value) {
  token = String(value || "");
  if (token) sessionStorage.setItem(SESSION_KEY, token);
  else sessionStorage.removeItem(SESSION_KEY);
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
    showLogin("Сессия закончилась. Войдите снова.");
    throw new Error("Сессия закончилась. Войдите снова.");
  }

  if (!response.ok) {
    if (response.status === 403 && data?.error === "partner_disabled") {
      throw new Error("Доступ к настройкам Studio сейчас отключён.");
    }
    throw new Error(data?.error || "Ошибка Studio API");
  }

  return data;
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

function sourceUrl(post) {
  const direct = String(post?.source?.url || "").trim();
  if (/^https:\/\/vk\.com\//i.test(direct)) return direct;

  for (const item of Array.isArray(post?.links) ? post.links : []) {
    const href = String(item?.href || "").trim();
    if (/^https:\/\/vk\.com\//i.test(href)) return href;
  }

  return "";
}

function renderPreview(post) {
  currentPostId = String(post?.id || "");

  if (!post) {
    $("#preview-heading").textContent = "Публикация";
    $("#preview-meta").textContent = "";
    $("#preview-title").textContent = "Публикаций пока нет";
    $("#preview-text").textContent =
      "После первой синхронизации публичные записи из VK появятся здесь.";
    $("#preview-media").hidden = true;
    $("#open-vk-post").hidden = true;
    return;
  }

  $("#preview-heading").textContent = post.title || "Публикация";
  $("#preview-meta").textContent = [post.category || "VK", post.publishedAt]
    .filter(Boolean)
    .join(" · ");
  $("#preview-title").textContent = post.title || "Публикация";
  $("#preview-text").textContent = String(post.text || "");

  const firstImage = (Array.isArray(post.media) ? post.media : []).find(
    (item) => (item?.type || "image") === "image" && /^https:\/\//i.test(String(item?.src || "")),
  );

  const figure = $("#preview-media");
  const image = figure.querySelector("img");

  if (firstImage) {
    image.src = firstImage.src;
    image.alt = String(firstImage.alt || "");
    figure.hidden = false;
  } else {
    image.removeAttribute("src");
    image.alt = "";
    figure.hidden = true;
  }

  const vk = sourceUrl(post);
  const button = $("#open-vk-post");
  button.hidden = !vk;
  if (vk) button.href = vk;
  else button.removeAttribute("href");
}

function renderList() {
  const root = $("#post-list");
  root.replaceChildren();

  if (!feed.length) {
    const empty = document.createElement("p");
    empty.className = "studio-copy";
    empty.textContent = "Пока нет синхронизированных публичных записей.";
    root.append(empty);
    renderPreview(null);
    return;
  }

  for (const post of feed) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "post-item";
    button.dataset.active = String(String(post.id) === currentPostId);

    const title = document.createElement("strong");
    title.textContent = post.title || "Публикация";

    const meta = document.createElement("small");
    meta.textContent = ["VK", post.publishedAt].filter(Boolean).join(" · ");

    button.append(title, meta);
    button.onclick = () => {
      renderPreview(post);
      renderList();
    };
    root.append(button);
  }
}

async function loadFeed() {
  $("#feed-status").textContent = "Обновляем предпросмотр…";

  try {
    const response = await fetch("../feed.json", {
      cache: "no-store",
      headers: { accept: "application/json" },
    });

    if (!response.ok) throw new Error("feed.json unavailable");

    const data = await response.json();
    feed = Array.isArray(data) ? data : [];
    feed.sort((a, b) =>
      String(b.publishedAt || "").localeCompare(String(a.publishedAt || "")),
    );

    const keep =
      feed.find((item) => String(item.id) === currentPostId) || feed[0] || null;

    renderPreview(keep);
    renderList();

    $("#feed-status").textContent = feed.length
      ? "В предпросмотре: " + feed.length + " публичных записей."
      : "Синхронизированных записей пока нет.";
  } catch (error) {
    feed = [];
    renderList();
    $("#feed-status").textContent =
      "Не удалось загрузить предпросмотр. Публикации во VK не изменены.";
  }
}

function contactsFromPartner(partner) {
  const byType = Object.fromEntries(
    (Array.isArray(partner?.contacts) ? partner.contacts : []).map((item) => [
      item.type,
      item.href,
    ]),
  );

  return {
    email: String(byType.email || "").replace(/^mailto:/i, ""),
    vk: String(byType.vk || ""),
    avito: String(byType.avito || ""),
  };
}

function fillContacts(value = {}) {
  $("#contact-email").value = value.email || "";
  $("#contact-vk").value = value.vk || "";
  $("#contact-avito").value = value.avito || "";
}

async function loadPublicContacts() {
  try {
    const partner = await fetch("../partner.json", { cache: "no-store" }).then(
      (response) => {
        if (!response.ok) throw new Error("partner.json unavailable");
        return response.json();
      },
    );
    fillContacts(contactsFromPartner(partner));
  } catch {}

  if (!apiEndpoint) {
    try {
      const saved = JSON.parse(localStorage.getItem(CONTACT_KEY) || "{}");
      if (saved && Object.keys(saved).length) fillContacts(saved);
    } catch {}
  }
}

async function loadProtectedContacts() {
  if (!apiEndpoint || !token) return;
  const data = await api("/contacts");
  fillContacts(data);
}

$("#login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
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
    await loadProtectedContacts();
    hideLogin();
    $("#contact-status").textContent =
      "Защищённые настройки подключены.";
  } catch (error) {
    $("#login-status").textContent =
      error.message || "Не удалось войти.";
  }
});

$("#save-contacts").addEventListener("click", async () => {
  const contacts = {
    email: $("#contact-email").value.trim(),
    vk: $("#contact-vk").value.trim(),
    avito: $("#contact-avito").value.trim(),
  };

  $("#contact-status").textContent = "Сохраняем…";

  if (!apiEndpoint) {
    localStorage.setItem(CONTACT_KEY, JSON.stringify(contacts));
    $("#contact-status").textContent =
      "Демо: сохранено только в этом браузере.";
    return;
  }

  if (!token) {
    showLogin("Войдите, чтобы изменить контакты.");
    $("#contact-status").textContent =
      "Для сохранения контактов нужен вход в Studio.";
    return;
  }

  try {
    await api("/contacts", {
      method: "PUT",
      body: { contacts },
    });
    $("#contact-status").textContent = "Контакты сохранены.";
  } catch (error) {
    $("#contact-status").textContent =
      error.message || "Не удалось сохранить.";
  }
});

$("#refresh-feed").addEventListener("click", loadFeed);

async function boot() {
  try {
    cfg = await fetch("./studio-config.json", { cache: "no-store" }).then(
      (response) => (response.ok ? response.json() : {}),
    );
  } catch {
    cfg = {};
  }

  apiEndpoint = String(cfg.apiEndpoint || "").trim();
  token = sessionStorage.getItem(SESSION_KEY) || "";

  await Promise.all([loadFeed(), loadPublicContacts()]);

  if (!apiEndpoint) {
    $("#security-title").textContent = "VK — единственный источник";
    $("#security-text").textContent =
      "Демо-режим: публикации только читаются из feed.json. Продакшн-синхронизация выполняется в репозитории партнёра.";
    return;
  }

  $("#security-title").textContent = "Раздельная архитектура";
  $("#security-text").textContent =
    "Публикации синхронизируются у партнёра; Studio API отвечает только за защищённые настройки и лицензионный статус.";

  if (!token) {
    showLogin();
    return;
  }

  try {
    await loadProtectedContacts();
    hideLogin();
  } catch (error) {
    showLogin(error.message);
  }
}

boot();
