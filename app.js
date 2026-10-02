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

  for (const item of Array.isArray(partner.links) ? partner.links : []) {
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
  } catch (error) {
    console.error(error);
    setText("#partner-name", "Сайт временно недоступен");
    setText(
      "#partner-description",
      "Не удалось загрузить данные проекта. Попробуйте обновить страницу позже.",
    );
  }
}

boot();
