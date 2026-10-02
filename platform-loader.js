async function readIntegration() {
  try {
    const response = await fetch("./integration.json", { cache: "no-store" });
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

async function entitlementAllows(config) {
  if (!config || config.mode === "off") return false;
  if (config.mode === "preview") return true;
  if (config.mode !== "active") return false;

  const endpoint = safeHttps(config.licenseEndpoint);
  if (!endpoint) return false;

  try {
    const url = new URL(endpoint);
    url.searchParams.set("partnerId", config.partnerId || "");
    url.searchParams.set("hostname", location.hostname);

    const response = await fetch(url, {
      cache: "no-store",
      credentials: "omit",
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return false;

    const data = await response.json();
    return data?.active === true;
  } catch {
    return false;
  }
}

async function bootIntegration() {
  const config = await readIntegration();
  if (!(await entitlementAllows(config))) return;

  const coreUrl = safeHttps(config.coreUrl);
  if (!coreUrl) return;

  try {
    const module = await import(coreUrl);
    if (typeof module.mountPartnerCore !== "function") return;

    await module.mountPartnerCore({
      headerSelector: ".site-header",
      mainSelector: "main",
      partnerId: config.partnerId || "",
      features: config.features || {},
    });
  } catch (error) {
    console.warn("Optional visual layer unavailable", error);
  }
}

bootIntegration();
