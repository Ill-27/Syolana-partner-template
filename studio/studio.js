const DRAFT_KEY = "syolana.partner-studio.drafts.v1";
const CONTACT_KEY = "syolana.partner-studio.contacts.v1";

const $ = (s) => document.querySelector(s);
const today = () => new Date().toISOString().slice(0, 10);
const slug = (value) => String(value || "post").toLowerCase()
  .normalize("NFKD").replace(/[^a-z0-9а-яё]+/gi, "-").replace(/^-|-$/g, "")
  .slice(0, 70) || "post";

let published = [];
let drafts = [];
let currentId = "";
let previewImage = "";

function loadLocal() {
  try { drafts = JSON.parse(localStorage.getItem(DRAFT_KEY) || "[]"); }
  catch { drafts = []; }
}

function saveLocal() {
  localStorage.setItem(DRAFT_KEY, JSON.stringify(drafts));
}

function currentForm() {
  return {
    id: currentId || slug($("#title").value) + "-" + Date.now().toString(36),
    title: $("#title").value.trim(),
    category: $("#category").value.trim() || "Публикации",
    publishedAt: $("#publishedAt").value || today(),
    text: $("#text").value.trim(),
    caption: $("#caption").value.trim(),
    previewImage
  };
}

function fill(post = {}) {
  currentId = post.id || "";
  $("#title").value = post.title || "";
  $("#category").value = post.category || "Публикации";
  $("#publishedAt").value = post.publishedAt || today();
  $("#text").value = post.text || "";
  $("#caption").value = post.caption || post.media?.[0]?.caption || "";
  previewImage = post.previewImage || post.media?.[0]?.src || "";
  $("#editor-state").textContent = post.__published ? "ОПУБЛИКОВАНО · ЛОКАЛЬНАЯ КОПИЯ" : currentId ? "ЛОКАЛЬНЫЙ ЧЕРНОВИК" : "НОВЫЙ ЧЕРНОВИК";
  $("#editor-title").textContent = post.title || "Новая публикация";
  renderList();
}

function renderList() {
  const root = $("#post-list");
  root.replaceChildren();
  const items = [
    ...drafts.map((p) => ({...p,__published:false})),
    ...published.map((p) => ({...p,__published:true}))
  ];
  for (const post of items) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "post-item";
    b.dataset.active = String(post.id === currentId);
    b.innerHTML = "<strong></strong><small></small>";
    b.querySelector("strong").textContent = post.title || "Без названия";
    b.querySelector("small").textContent = (post.__published ? "На сайте · " : "Черновик · ") + (post.publishedAt || "");
    b.onclick = () => fill(post);
    root.append(b);
  }
}

async function boot() {
  loadLocal();
  try {
    published = await fetch("../feed.json",{cache:"no-store"}).then((r)=>r.ok?r.json():[]);
  } catch { published = []; }

  try {
    const partner = await fetch("../partner.json",{cache:"no-store"}).then((r)=>r.json());
    const byType = Object.fromEntries((partner.contacts || []).map((c)=>[c.type,c.href]));
    $("#contact-email").value = (byType.email || "").replace(/^mailto:/i,"");
    $("#contact-vk").value = byType.vk || "";
    $("#contact-avito").value = byType.avito || "";
  } catch {}

  try {
    const saved = JSON.parse(localStorage.getItem(CONTACT_KEY) || "{}");
    if (saved.email) $("#contact-email").value = saved.email;
    if (saved.vk) $("#contact-vk").value = saved.vk;
    if (saved.avito) $("#contact-avito").value = saved.avito;
  } catch {}

  fill(drafts[0] || {});
}

$("#new-post").onclick = () => fill({publishedAt:today(),category:"Публикации"});

$("#post-form").addEventListener("submit",(e)=>{
  e.preventDefault();
  const post = currentForm();
  if (!post.title || !post.text) return;
  const index = drafts.findIndex((p)=>p.id===post.id);
  if (index >= 0) drafts[index] = post; else drafts.unshift(post);
  currentId = post.id;
  saveLocal();
  renderList();
  $("#form-status").textContent = "Черновик сохранён только в этом браузере.";
});

$("#delete-post").onclick = ()=>{
  if (!currentId) return fill({publishedAt:today(),category:"Публикации"});
  const index = drafts.findIndex((p)=>p.id===currentId);
  if (index < 0) {
    $("#form-status").textContent = "Для удаления уже опубликованного поста нужен защищённый Studio API.";
    return;
  }
  drafts.splice(index,1);
  saveLocal();
  fill(drafts[0] || {publishedAt:today(),category:"Публикации"});
  $("#form-status").textContent = "Локальный черновик удалён.";
};

$("#image").addEventListener("change",()=>{
  const file = $("#image").files?.[0];
  if (!file) { previewImage=""; return; }
  if (file.size > 8*1024*1024) {
    $("#form-status").textContent = "Для Studio ограничим изображения 8 МБ.";
    $("#image").value = "";
    return;
  }
  const reader = new FileReader();
  reader.onload = () => { previewImage = String(reader.result || ""); };
  reader.readAsDataURL(file);
});

function showPreview() {
  const post = currentForm();
  $("#preview-title").textContent = post.title || "Без названия";
  $("#preview-meta").textContent = [post.category,post.publishedAt].filter(Boolean).join(" · ");
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

$("#publish-post").onclick = async ()=>{
  let cfg = {};
  try { cfg = await fetch("./studio-config.json",{cache:"no-store"}).then((r)=>r.ok?r.json():{}); } catch {}
  if (!cfg.apiEndpoint) {
    $("#form-status").textContent = "Публикация пока отключена: сначала подключаем защищённый российский Studio API. GitHub-токены в браузер не помещаем.";
    return;
  }
  $("#form-status").textContent = "Защищённый API настроен — после авторизации здесь будет отправка на публикацию.";
};

$("#save-contacts").onclick = ()=>{
  localStorage.setItem(CONTACT_KEY,JSON.stringify({
    email:$("#contact-email").value.trim(),
    vk:$("#contact-vk").value.trim(),
    avito:$("#contact-avito").value.trim()
  }));
  $("#form-status").textContent = "Контакты сохранены локально. На сайт их отправит защищённый Studio API.";
};

boot();
