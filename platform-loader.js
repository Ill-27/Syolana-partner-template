function finishBoot() {
  if (typeof window.__partnerBootDone === "function") {
    window.__partnerBootDone("platform");
    return;
  }
  document.documentElement.classList.remove("partner-booting");
  const boot = document.getElementById("partner-boot");
  if (boot) {
    boot.style.opacity = "0";
    window.setTimeout(() => boot.remove(), 320);
  }
}

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

  if (config.mode === "preview") {
    const localPreview = ["localhost", "127.0.0.1"].includes(location.hostname);
    return localPreview
      ? { active: true, preview: true, features: config.features || {} }
      : { active: false };
  }

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
  let shellReady = false;
  const onShellReady = () => {
    shellReady = true;
    finishBoot();
  };
  window.addEventListener("syolana:shell-ready", onShellReady, { once: true });

  try {
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

  const base = new URL("./", coreUrl);

  let build = String(config.coreVersion || "live");
  try {
    const versionResponse = await fetch(
      new URL("partners/core-version.json", base),
      { cache: "no-store", credentials: "omit", signal: AbortSignal.timeout(2500) },
    );
    if (versionResponse.ok) {
      const versionData = await versionResponse.json();
      if (versionData?.version) build = String(versionData.version);
    }
  } catch {}

  const core = new URL(coreUrl);
  core.searchParams.set("v", build);

  const mainCss = new URL("styles.css", base);
  const fontsCss = new URL("assets/fonts/fonts.css", base);
  const adapterCss = new URL("partner-core.css", base);

  mainCss.searchParams.set("v", build);
  fontsCss.searchParams.set("v", build);
  adapterCss.searchParams.set("v", build);

  try {
    const modulePromise = import(core.href);
    const stylePromise = Promise.all([
      loadStyle(fontsCss.href, "fonts"),
      loadStyle(mainCss.href, "main-style"),
      loadStyle(adapterCss.href, "partner-adapter"),
    ]);

    const [module] = await Promise.all([modulePromise, stylePromise]);
    if (typeof module.mountPartnerCore !== "function") return;

    const handle = await module.mountPartnerCore({
      partner: partner || {},
      partnerId: config.partnerId || "",
      features: access.features || config.features || {},
      version: build,
    });

    // Manual disable always wins, even for a tab that was already open.
    // Re-check on return to the tab and periodically. If access was revoked,
    // remove the central UI and remote styles immediately; partner content
    // remains in the neutral local shell.
    let checking = false;
    const revalidate = async () => {
      if (checking) return;
      checking = true;
      try {
        const next = await entitlement(config);
        if (!next.active) {
          await handle?.destroy?.();
          document
            .querySelectorAll("link[data-syolana-remote]")
            .forEach((node) => node.remove());
          document.documentElement.dataset.syolana = "off";
          clearInterval(interval);
          document.removeEventListener("visibilitychange", onVisibility);
        }
      } catch {
        // A transient network failure must not destroy a working partner site.
      } finally {
        checking = false;
      }
    };

    const onVisibility = () => {
      if (!document.hidden) revalidate();
    };
    document.addEventListener("visibilitychange", onVisibility);
    const interval = setInterval(revalidate, 60 * 1000);
  } catch (error) {
    console.warn("Optional Syolana layer unavailable", error);
  }
  } finally {
    window.removeEventListener("syolana:shell-ready", onShellReady);
    if (!shellReady) finishBoot();
  }
}

bootIntegration().catch(() => finishBoot());
