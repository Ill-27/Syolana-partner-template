async function readJSON(path) {
  try {
    const response = await fetch(path, { cache: "no-store" });
    if (!response.ok) return null;
    return response.json();
  } catch {
    return null;
  }
}

function safeHttps(value) {
  if (typeof value !== "string" || !value.trim()) return "";
  try {
    const url = new URL(value, location.href);
    return url.protocol === "https:" ? url.href : "";
  } catch {
    return "";
  }
}

async function entitlement(config) {
  const forcedOff =
    new URLSearchParams(location.search).get("syolana") === "off";
  if (forcedOff || !config || ["off", "inactive"].includes(config.mode))
    return { active: false };

  if (config.mode === "preview")
    return { active: true, preview: true, features: config.features || {} };

  if (config.mode !== "active") return { active: false };

  const endpoint = safeHttps(config.licenseEndpoint);
  if (!endpoint) return { active: false };

  try {
    const url = new URL(endpoint);
    url.searchParams.set("partnerId", config.partnerId || "");
    url.searchParams.set("hostname", location.hostname);

    const response = await fetch(url, {
      cache: "no-store",
      credentials: "omit",
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return { active: false };

    const data = await response.json();

    // Production endpoint may return {active, features}. The current demo
    // registry returns {partners:{id:{active,allowedHosts,features}}}.
    if (typeof data?.active === "boolean")
      return {
        active: data.active,
        features: data.features || config.features || {},
      };

    const record = data?.partners?.[config.partnerId || ""];
    if (!record?.active) return { active: false };

    const hosts = Array.isArray(record.allowedHosts)
      ? record.allowedHosts
      : [];
    if (hosts.length && !hosts.includes(location.hostname))
      return { active: false };

    return {
      active: true,
      features: record.features || config.features || {},
    };
  } catch {
    return { active: false };
  }
}

function loadStyle(url, marker) {
  return new Promise((resolve) => {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = url;
    link.dataset.syolanaRemote = marker;
    link.onload = () => resolve(true);
    link.onerror = () => resolve(false);
    document.head.append(link);
  });
}

async function bootIntegration() {
  const [config, partner] = await Promise.all([
    readJSON("./integration.json"),
    readJSON("./partner.json"),
  ]);

  const access = await entitlement(config);
  document.documentElement.dataset.syolana =
    access.active ? "active" : "off";

  if (!access.active) return;

  const coreUrl = safeHttps(config.coreUrl);
  if (!coreUrl) return;

  const build = String(Date.now());
  const core = new URL(coreUrl);
  core.searchParams.set("v", build);

  const base = new URL("./", coreUrl);
  const mainCss = new URL("styles.css", base);
  const fontsCss = new URL("assets/fonts/fonts.css", base);
  const adapterCss = new URL("partner-core.css", base);

  // Cache-bust only the CSS entry points. Font and media URLs inside them stay
  // stable and cache efficiently.
  mainCss.searchParams.set("v", build);
  fontsCss.searchParams.set("v", build);
  adapterCss.searchParams.set("v", build);

  await Promise.all([
    loadStyle(fontsCss.href, "fonts"),
    loadStyle(mainCss.href, "main-style"),
  ]);
  await loadStyle(adapterCss.href, "partner-adapter");

  try {
    const module = await import(core.href);
    if (typeof module.mountPartnerCore !== "function") return;

    await module.mountPartnerCore({
      partner: partner || {},
      partnerId: config.partnerId || "",
      features: access.features || config.features || {},
      version: build,
    });
  } catch (error) {
    console.warn("Optional Syolana layer unavailable", error);
  }
}

bootIntegration();
