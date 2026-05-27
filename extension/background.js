// Service worker: registra (e re-registra) o content_script do overlay nos sites
// que o usuário marcar no popup. A lista vive em chrome.storage.local (mododevSites).
// Persiste no reload da página E entre sessões (persistAcrossSessions).
const SCRIPT_ID = "mododev-auto";
const DEFAULT_SITES = ["http://localhost/*", "http://127.0.0.1/*"];

async function aplicar() {
  const { mododevSites } = await chrome.storage.local.get("mododevSites");
  const matches = (Array.isArray(mododevSites) ? mododevSites : DEFAULT_SITES)
    .map((s) => String(s).trim())
    .filter(Boolean);
  // remove o antigo (idempotente — ignora se não tiver)
  try { await chrome.scripting.unregisterContentScripts({ ids: [SCRIPT_ID] }); } catch { /* ok */ }
  if (!matches.length) return; // lista vazia → não auto-injeta em nada
  try {
    await chrome.scripting.registerContentScripts([{
      id: SCRIPT_ID,
      matches,
      js: ["html2canvas.min.js", "overlay.js"],
      runAt: "document_idle",
      persistAcrossSessions: true,
    }]);
    console.log("[modo dev] auto-inject ativo em:", matches);
  } catch (e) {
    console.error("[modo dev] erro registrando content scripts:", e, "matches:", matches);
  }
}

// Na instalação: garante a lista default se ainda não tem; aplica.
chrome.runtime.onInstalled.addListener(async () => {
  const { mododevSites } = await chrome.storage.local.get("mododevSites");
  if (!mododevSites) await chrome.storage.local.set({ mododevSites: DEFAULT_SITES });
  aplicar();
});
chrome.runtime.onStartup.addListener(aplicar);
// Mudou a lista no popup → re-registra na hora
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.mododevSites) aplicar();
});
