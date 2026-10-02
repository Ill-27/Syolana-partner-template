const runtime = await fetch("./_syolana/runtime.json", { cache: "no-store" }).then((r) => {
  if (!r.ok) throw new Error("Integration runtime unavailable");
  return r.json();
});

const platformUrl = runtime.platformUrl || "https://ill-27.github.io/Syolana-n/";
const make = (tag, cls = "", text = "") => {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== "") node.textContent = text;
  return node;
};

document.body.classList.add("syolana-active");

// Ambient layers used by the exact Syolana theme engine.
const aurora = make("div", "aurora-background");
aurora.setAttribute("aria-hidden", "true");
["one", "two", "three"].forEach((name) => aurora.append(make("div", "aurora-layer " + name)));
const canvas = make("canvas");
canvas.id = "starCanvas";
canvas.setAttribute("aria-hidden", "true");
document.body.prepend(canvas);
document.body.prepend(aurora);

// Floating chrome: same three controls and placement as the main Syolana site.
const chrome = make("header", "sy-top-bar");
chrome.id = "chrome";

const brand = make("a", "sy-brand sy-glass");
brand.href = platformUrl;
brand.target = "_blank";
brand.rel = "noopener noreferrer";
brand.setAttribute("aria-label", "Открыть Syolana");
const logo = make("img");
logo.src = "./assets/logo.svg";
logo.alt = "";
logo.width = 47;
logo.height = 47;
const brandText = make("span");
brandText.append(make("strong", "", "Syolana"), make("small", "", "ИММЕРСИВНАЯ ПЛАТФОРМА"));
brand.append(logo, brandText);

const actions = make("div", "sy-top-actions top-actions");
const themeButton = make("button", "sy-icon-btn sy-glass", "✧");
themeButton.id = "theme-toggle";
themeButton.type = "button";
themeButton.setAttribute("aria-label", "Выбрать тему");
themeButton.title = "Выбрать тему";

const zenButton = make("button", "sy-icon-btn sy-glass");
zenButton.id = "zen-toggle";
zenButton.type = "button";
zenButton.setAttribute("aria-label", "Режим созерцания");
zenButton.setAttribute("aria-pressed", "false");
zenButton.title = "Режим созерцания";
zenButton.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg>';

const fullscreen = make("button", "sy-icon-btn sy-glass");
fullscreen.id = "fullscreen";
fullscreen.type = "button";
fullscreen.setAttribute("aria-label", "На весь экран");
fullscreen.setAttribute("aria-pressed", "false");
fullscreen.title = "На весь экран";
fullscreen.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 3H3v5M16 3h5v5M21 16v5h-5M3 16v5h5"/></svg>';

actions.append(themeButton, zenButton, fullscreen);
chrome.append(brand, actions);
document.body.prepend(chrome);

// Syolana banner. It is injected only while the integration is active.
const banner = make("aside", "sy-banner sy-glass");
banner.setAttribute("aria-label", "Syolana");
const bannerVisual = make("div", "sy-banner-visual");
const bannerLogo = make("img");
bannerLogo.src = "./assets/logo.svg";
bannerLogo.alt = "";
bannerVisual.append(bannerLogo);

const bannerCopy = make("div", "sy-banner-copy");
bannerCopy.append(
  make("p", "sy-eyebrow", runtime.banner?.eyebrow || "ИММЕРСИВНАЯ ПЛАТФОРМА ДЛЯ ТВОРЧЕСТВА"),
  make("h2", "", runtime.banner?.title || "Ваш сайт — живой мир."),
  make("p", "sy-banner-description", runtime.banner?.description || "Живые темы, музыка, книги и публикации в одной системе.")
);

const features = make("div", "sy-banner-features");
(runtime.banner?.features || ["Живые темы", "Иммерсивные книги", "Музыка", "Публикации"]).slice(0, 4).forEach((label) => {
  const item = make("span", "sy-banner-feature");
  item.append(make("i", "", "✦"), document.createTextNode(label));
  features.append(item);
});
bannerCopy.append(features);

const bannerActions = make("div", "sy-banner-actions");
const about = make("a", "sy-btn sy-primary", "Открыть Syolana");
about.href = platformUrl;
about.target = "_blank";
about.rel = "noopener noreferrer";
const live = make("button", "sy-btn", "Попробовать тему здесь");
live.type = "button";
live.onclick = () => document.getElementById("theme-dialog")?.showModal();
bannerActions.append(about, live);
bannerCopy.append(bannerActions);
banner.append(bannerVisual, bannerCopy);

const main = document.querySelector("main");
main?.prepend(banner);

// Theme chooser.
const dialog = make("dialog", "sy-dialog");
dialog.id = "theme-dialog";
const dialogHead = make("div", "sy-dialog-head");
const dialogTitle = make("div");
dialogTitle.append(make("p", "sy-eyebrow", "АТМОСФЕРА"), make("h2", "", "Выберите свой мир"));
const close = make("button", "sy-icon-btn", "×");
close.type = "button";
close.setAttribute("aria-label", "Закрыть");
close.onclick = () => dialog.close();
dialogHead.append(dialogTitle, close);
const themeList = make("div", "sy-theme-list");
themeList.id = "theme-list";
dialog.append(dialogHead, themeList);
document.body.append(dialog);

// Required helpers for the shared theme engine.
const themeName = make("span");
themeName.id = "theme-name";
themeName.hidden = true;
document.body.append(themeName);

const toast = make("div", "sy-toast sy-glass");
toast.id = "toast";
toast.hidden = true;
toast.setAttribute("role", "status");
document.body.append(toast);

const flight = make("div", "sy-flight-layer");
flight.id = "flight-layer";
flight.hidden = true;
flight.setAttribute("aria-hidden", "true");
const hint = make("p", "flight-hint", "Перетаскивайте мир · колесо или два пальца — в глубину");
flight.append(hint);
document.body.append(flight);

// Compact shared music dock.
const songs = Array.isArray(runtime.songs) ? runtime.songs : [];
let songIndex = 0;
let playing = false;
const audio = make("audio");
audio.preload = "none";
audio.volume = 0.18;
document.body.append(audio);

let dock = null;
let dockTitle = null;
let dockSubtitle = null;
let dockPlay = null;

function selectSong(index, autoplay = false) {
  if (!songs.length) return;
  songIndex = (index + songs.length) % songs.length;
  const song = songs[songIndex];
  audio.pause();
  audio.src = song.src;
  audio.load();
  dockTitle.textContent = song.title || "Музыка";
  dockSubtitle.textContent = song.sourceTitle || song.artist || "Syolana";
  playing = false;
  dockPlay.textContent = "▶";
  dockPlay.setAttribute("aria-label", "Слушать");
  if (autoplay) {
    audio.play().then(() => {
      playing = true;
      dockPlay.textContent = "Ⅱ";
      dockPlay.setAttribute("aria-label", "Пауза");
    }).catch(() => {});
  }
}

if (songs.length) {
  dock = make("aside", "sy-music-dock sy-glass");
  dock.setAttribute("aria-label", "Музыкальный плеер");
  const summary = make("div", "sy-track-summary");
  const art = make("span", "sy-track-art", "♫");
  const info = make("span");
  dockTitle = make("strong");
  dockSubtitle = make("small");
  info.append(dockTitle, dockSubtitle);
  summary.append(art, info);

  const controls = make("div", "sy-dock-controls");
  const prev = make("button", "sy-icon-btn", "‹");
  prev.type = "button";
  prev.setAttribute("aria-label", "Предыдущая песня");
  prev.onclick = () => selectSong(songIndex - 1, playing);
  dockPlay = make("button", "sy-icon-btn sy-play", "▶");
  dockPlay.type = "button";
  dockPlay.setAttribute("aria-label", "Слушать");
  dockPlay.onclick = () => {
    if (audio.paused) {
      audio.play().then(() => {
        playing = true;
        dockPlay.textContent = "Ⅱ";
        dockPlay.setAttribute("aria-label", "Пауза");
      }).catch(() => {});
    } else {
      audio.pause();
      playing = false;
      dockPlay.textContent = "▶";
      dockPlay.setAttribute("aria-label", "Слушать");
    }
  };
  const next = make("button", "sy-icon-btn", "›");
  next.type = "button";
  next.setAttribute("aria-label", "Следующая песня");
  next.onclick = () => selectSong(songIndex + 1, playing);
  controls.append(prev, dockPlay, next);
  dock.append(summary, controls);
  document.body.append(dock);
  audio.addEventListener("ended", () => selectSong(songIndex + 1, true));
  selectSong(0);
}

// Start the exact shared theme engine copied from the central Syolana repository at build time.
const { ThemeEngine } = await import("./themes.js");
const engine = new ThemeEngine();
await engine.init();

// Fullscreen.
function syncFullscreen() {
  const active = Boolean(document.fullscreenElement || document.webkitFullscreenElement);
  fullscreen.setAttribute("aria-pressed", String(active));
  fullscreen.setAttribute("aria-label", active ? "Выйти из полноэкранного режима" : "На весь экран");
}
fullscreen.onclick = async () => {
  try {
    if (document.fullscreenElement || document.webkitFullscreenElement) {
      await (document.exitFullscreen || document.webkitExitFullscreen).call(document);
    } else {
      const fn = document.documentElement.requestFullscreen || document.documentElement.webkitRequestFullscreen;
      if (fn) await fn.call(document.documentElement);
    }
  } catch {}
  syncFullscreen();
};
document.addEventListener("fullscreenchange", syncFullscreen);
document.addEventListener("webkitfullscreenchange", syncFullscreen);

// Zen / contemplation mode with drag, wheel and pinch depth.
let zen = false;
const pointers = new Map();
let pinchDistance = 0;

function setZen(active) {
  zen = Boolean(active);
  document.body.classList.toggle("sy-zen", zen);
  zenButton.setAttribute("aria-pressed", String(zen));
  zenButton.setAttribute("aria-label", zen ? "Вернуть интерфейс" : "Режим созерцания");
  engine.setZen?.(zen);
  dialog.open && dialog.close();
}
zenButton.onclick = () => setZen(!zen);

window.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && zen) setZen(false);
});

window.addEventListener("wheel", (e) => {
  if (!zen) return;
  e.preventDefault();
  engine.move?.(0, 0, Math.max(-0.38, Math.min(0.38, e.deltaY * 0.0018)));
}, { passive: false });

window.addEventListener("pointerdown", (e) => {
  if (!zen || e.target.closest("button,a,dialog")) return;
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    pinchDistance = Math.hypot(a.x - b.x, a.y - b.y);
  }
});

window.addEventListener("pointermove", (e) => {
  if (!zen || !pointers.has(e.pointerId)) return;
  const previous = pointers.get(e.pointerId);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

  if (pointers.size >= 2) {
    const [a, b] = [...pointers.values()];
    const nextDistance = Math.hypot(a.x - b.x, a.y - b.y);
    if (pinchDistance) engine.move?.(0, 0, (nextDistance - pinchDistance) / 220);
    pinchDistance = nextDistance;
  } else {
    const dx = e.clientX - previous.x;
    const dy = e.clientY - previous.y;
    engine.move?.(-dx / Math.max(320, innerWidth), -dy / Math.max(480, innerHeight), 0);
    engine.guideBirds?.(e.clientX / innerWidth, e.clientY / innerHeight, true);
  }
});

function endPointer(e) {
  pointers.delete(e.pointerId);
  if (pointers.size < 2) pinchDistance = 0;
  if (!pointers.size) engine.settle?.();
}
window.addEventListener("pointerup", endPointer);
window.addEventListener("pointercancel", endPointer);

dialog.addEventListener("click", (e) => {
  if (e.target === dialog) dialog.close();
});
