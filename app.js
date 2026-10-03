async function readJSON(path) {
  const response = await fetch(path, { cache: "no-store" });
  if (!response.ok) throw new Error(`Не удалось загрузить ${path}`);
  return response.json();
}

function setText(selector, value = "") {
  const node = document.querySelector(selector);
  if (node) node.textContent = String(value ?? "");
}

function safeLink(value) {
  if (typeof value !== "string" || !value.trim()) return "";
  try {
    const u = new URL(value, location.href);
    return ["https:", "http:", "mailto:"].includes(u.protocol) ? u.href : "";
  } catch {
    return "";
  }
}

function safeMedia(value) {
  if (typeof value !== "string" || !value.trim()) return "";
  try {
    const u = new URL(value, location.href);
    if (u.origin === location.origin) return u.href;
    return u.protocol === "https:" ? u.href : "";
  } catch {
    return "";
  }
}

function initials(name = "") {
  return String(name)
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0] || "")
    .join("")
    .toUpperCase() || "•";
}

function renderPartner(partner) {
  setText("#brand-name", partner.name);
  setText("#brand-tagline", partner.tagline || "Авторский сайт");
  setText("#brand-mark", partner.brandMark || initials(partner.name));
  setText("#partner-name", partner.name);
  setText("#partner-tagline", partner.tagline);
  setText("#partner-description", partner.description);
  setText("#footer-owner", partner.ownerDisplayName || partner.name);
  setText("#footer-note", partner.footerNote || "Все права защищены.");
  setText(
    "#about-owner",
    partner.aboutText ||
      "Этот сайт и опубликованные материалы принадлежат его владельцу.",
  );

  document.title = partner.name || "Авторский сайт";

  const links = document.querySelector("#partner-links");
  links.replaceChildren();

  const heroLinks = Array.isArray(partner.links) ? partner.links : [];

  for (const item of heroLinks) {
    const href = safeLink(item.href);
    if (!href) continue;

    const a = document.createElement("a");
    a.href = href;
    a.className = item.primary ? "action primary" : "action";
    a.textContent = item.label || "Открыть";

    if (/^https?:/i.test(href) && new URL(href).origin !== location.origin) {
      a.target = "_blank";
      a.rel = "noopener noreferrer";
    }
    links.append(a);
  }

  const contactsRoot = document.querySelector("#partner-contacts");
  const contactsPanel = document.querySelector("#contact");
  const contacts = (Array.isArray(partner.contacts) ? partner.contacts : [])
    .map((item) => ({ ...item, href: safeLink(item.href) }))
    .filter((item) => item.href);

  contactsRoot?.replaceChildren();
  contactsPanel?.toggleAttribute("hidden", !contacts.length);

  const icon = {
    email:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 6.5h17v11h-17z"/><path d="m4 7 8 6 8-6"/></svg>',
    vk:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7.5c.6 5.3 3.3 8.3 8 8.3h.8v-3c1.8.2 3.2 1.5 3.8 3h2.5c-.8-1.8-2.1-3.3-3.8-4.2 1.5-.9 2.7-2.3 3.4-4.1h-2.4c-.7 1.7-1.9 3-3.5 3.5V7.5h-2.2v6c-2.6-.6-3.9-2.6-4.2-6H5Z"/></svg>',
    avito:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="7" cy="7" r="2.2"/><circle cx="17" cy="7" r="2.2"/><circle cx="7" cy="17" r="2.2"/><circle cx="17" cy="17" r="2.2"/></svg>',
  };

  for (const item of contacts) {
    const a = document.createElement("a");
    a.href = item.href;
    a.className = "contact-action contact-" + (item.type || "link");
    a.dataset.contactType = item.type || "link";

    const badge = document.createElement("span");
    badge.className = "contact-icon";
    badge.innerHTML = icon[item.type] || "↗";

    const label = document.createElement("span");
    label.className = "contact-label";
    label.textContent = item.label || "Связаться";

    a.append(badge, label);

    if (/^https?:/i.test(item.href) && new URL(item.href).origin !== location.origin) {
      a.target = "_blank";
      a.rel = "noopener noreferrer";
    }
    contactsRoot?.append(a);
  }
}

function renderFilters(posts, partner, onSelect) {
  const root = document.querySelector("#category-filter");
  root.replaceChildren();

  const inferred = [...new Set(posts.map((p) => p.category).filter(Boolean))];
  const categories = Array.from(
    new Set(["Все", ...(partner.categories || []), ...inferred]),
  );

  categories.forEach((category, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "filter";
    button.textContent = category;
    button.setAttribute("aria-pressed", String(index === 0));

    button.onclick = () => {
      root.querySelectorAll("button").forEach((item) =>
        item.setAttribute("aria-pressed", String(item === button)),
      );
      onSelect(category);
    };
    root.append(button);
  });
}

function renderFeed(posts, category = "Все") {
  const list = document.querySelector("#feed-list");
  list.replaceChildren();

  const visible = posts.filter(
    (post) => category === "Все" || post.category === category,
  );

  if (!visible.length) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = "В этой категории пока нет публикаций.";
    list.append(empty);
    return;
  }

  for (const post of visible) {
    const article = document.createElement("article");
    article.className = "post";

    const meta = document.createElement("div");
    meta.className = "meta";
    meta.textContent = [post.category, post.publishedAt]
      .filter(Boolean)
      .join(" · ");

    const title = document.createElement("h3");
    title.textContent = String(post.title ?? "");

    const body = document.createElement("p");
    body.textContent = String(post.text ?? "");

    const mediaItems = Array.isArray(post.media) ? post.media : [];
    for (const item of mediaItems.slice(0, 4)) {
      const entry =
        typeof item === "string" ? { type: "image", src: item } : item || {};
      if ((entry.type || "image") !== "image") continue;

      const src = safeMedia(entry.src);
      if (!src) continue;

      const figure = document.createElement("figure");
      figure.className = "post-media";

      const image = document.createElement("img");
      image.src = src;
      image.alt = String(entry.alt || "");
      image.loading = "lazy";
      image.decoding = "async";
      figure.append(image);

      if (entry.caption) {
        const caption = document.createElement("figcaption");
        caption.textContent = String(entry.caption);
        figure.append(caption);
      }

      article.append(figure);
    }

    article.append(meta, title, body);

    if (Array.isArray(post.links) && post.links.length) {
      const actions = document.createElement("div");
      actions.className = "post-actions";

      for (const item of post.links) {
        const href = safeLink(item.href);
        if (!href) continue;

        const a = document.createElement("a");
        a.href = href;
        a.textContent = item.label || "Открыть";

        if (/^https?:/i.test(href) && new URL(href).origin !== location.origin) {
          a.target = "_blank";
          a.rel = "noopener noreferrer";
        }
        actions.append(a);
      }
      article.append(actions);
    }

    list.append(article);
  }
}

async function boot() {
  try {
    const [partner, feed] = await Promise.all([
      readJSON("./partner.json"),
      readJSON("./feed.json"),
    ]);

    renderPartner(partner);

    const posts = [...feed].sort((a, b) =>
      String(b.publishedAt).localeCompare(String(a.publishedAt)),
    );

    renderFilters(posts, partner, (category) => renderFeed(posts, category));
    renderFeed(posts);
    window.__partnerBootDone?.("content");
  } catch (error) {
    console.error(error);
    setText("#partner-name", "Сайт временно недоступен");
    setText(
      "#partner-description",
      "Не удалось загрузить данные проекта. Попробуйте обновить страницу позже.",
    );
    window.__partnerBootDone?.("content");
  }
}

boot();
