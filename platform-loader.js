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

function normalizedAccess(data, config) {
  const isDemo = config?.environment !== "production";

  if (!data?.active) return { active: false };

  const features = data.features || config?.features || {};
  const allowedHosts = Array.isArray(data.allowedHosts)
    ? data.allowedHosts
    : [];

  if (allowedHosts.length && !allowedHosts.includes(location.hostname)) {
    return { active: false };
  }

  const assets = data.assets || {};
  let assetBase = safeHttps(assets.baseUrl || data.assetBase || "");
  let coreUrl = safeHttps(assets.coreUrl || data.coreUrl || "");

  if (!coreUrl && assetBase) {
    coreUrl = new URL("partner-core.js", assetBase).href;
  }

  // Public permanent asset URLs are allowed only in demo mode.
  if (!coreUrl && isDemo) {
    coreUrl = safeHttps(config?.coreUrl || "");
    if (coreUrl) assetBase = new URL("./", coreUrl).href;
  }

  if (!coreUrl) return { active: false };

  if (!assetBase) assetBase = new URL("./", coreUrl).href;

  const styleUrls = Array.isArray(assets.styles)
    ? assets.styles.map(safeHttps).filter(Boolean)
    : [
        new URL("assets/fonts/fonts.css", assetBase).href,
        new URL("styles.css", assetBase).href,
        new URL("partner-core.css", assetBase).href,
      ];

  return {
    active: true,
    features,
    coreUrl,
    assetBase,
    styleUrls,
    version: String(data.version || config?.coreVersion || "live"),
    expiresAt: data.expiresAt || assets.expiresAt || null,
  };
}

async function entitlement(config) {
  const forcedOff =
    new URLSearchParams(location.search).get("syolana") === "off";

  if (forcedOff || !config || ["off", "inactive"].includes(config.mode)) {
    return { active: false };
  }

  if (config.mode === "preview") {
    const localPreview = ["localhost", "127.0.0.1"].includes(
      location.hostname,
    );

    return localPreview
      ? normalizedAccess(
          {
            active: true,
            features: config.features || {},
            coreUrl: config.coreUrl || "",
          },
          { ...config, environment: "demo" },
        )
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
      headers: { accept: "application/json" },
    });

    if (!response.ok) return { active: false };

    const data = await response.json();

    if (typeof data?.active === "boolean") {
      return normalizedAccess(data, config);
    }

    // Compatibility only for the current demo registry. Production must
    // return one partner-specific response with short-lived asset URLs.
    const record = data?.partners?.[config.partnerId || ""];
    if (!record?.active) return { active: false };

    return normalizedAccess(
      {
        active: true,
        features: record.features || config.features || {},
        allowedHosts: record.allowedHosts || [],
        coreUrl:
          config.environment === "production"
            ? ""
            : config.coreUrl || "",
      },
      config,
    );
  } catch {
    return { active: false };
  }
}

function loadStyle(url, marker) {
  return new Promise((resolve) => {
    const href = safeHttps(url);
    if (!href) return resolve(false);

    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    link.dataset.platformRemote = marker;
    link.onload = () => resolve(true);
    link.onerror = () => resolve(false);
    document.head.append(link);
  });
}

function removeRemoteStyles() {
  document
    .querySelectorAll("link[data-platform-remote]")
    .forEach((node) => node.remove());
}

async function bootIntegration() {
  let shellReady = false;
  const onShellReady = () => {
    shellReady = true;
    finishBoot();
  };

  window.addEventListener("syolana:shell-ready", onShellReady, {
    once: true,
  });

  try {
    const [config, partner] = await Promise.all([
      readJSON("./integration.json"),
      readJSON("./partner.json"),
    ]);

    const access = await entitlement(config);

    document.documentElement.dataset.syolana = access.active
      ? "active"
      : "off";

    if (!access.active) return;

    const core = new URL(access.coreUrl);
    core.searchParams.set("v", access.version);

    const styles = access.styleUrls.map((url, index) => {
      const target = new URL(url);
      target.searchParams.set("v", access.version);
      return loadStyle(target.href, "asset-" + index);
    });

    try {
      const modulePromise = import(core.href);
      const [module] = await Promise.all([
        modulePromise,
        Promise.all(styles),
      ]);

      if (typeof module.mountPartnerCore !== "function") return;

      const handle = await module.mountPartnerCore({
        partner: partner || {},
        partnerId: config.partnerId || "",
        features: access.features || config.features || {},
        version: access.version,
        assetBase: access.assetBase,
      });

      let checking = false;

      const revoke = async () => {
        await handle?.destroy?.();
        removeRemoteStyles();
        document.documentElement.dataset.syolana = "off";
      };

      const revalidate = async () => {
        if (checking) return;
        checking = true;

        try {
          const next = await entitlement(config);

          if (!next.active) {
            await revoke();
            clearInterval(interval);
            document.removeEventListener(
              "visibilitychange",
              onVisibility,
            );
          }
        } catch {
          // A transient network failure does not destroy a working shell.
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
      removeRemoteStyles();
      console.warn("Optional immersive layer unavailable", error);
    }
  } finally {
    window.removeEventListener("syolana:shell-ready", onShellReady);
    if (!shellReady) finishBoot();
  }
}

bootIntegration().catch(() => finishBoot());
