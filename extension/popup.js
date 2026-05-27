const portaEl = document.getElementById("porta");
const sitesEl = document.getElementById("sites");
const statusEl = document.getElementById("status");
const DEFAULT_SITES = ["http://localhost/*", "http://127.0.0.1/*"];

// Carrega valores salvos
chrome.storage.local.get(["mododevPort", "mododevSites"], (o) => {
  if (o.mododevPort) portaEl.value = o.mododevPort;
  const lista = Array.isArray(o.mododevSites) ? o.mododevSites : DEFAULT_SITES;
  sitesEl.value = lista.join("\n");
});

function piscarOk(msg) {
  statusEl.textContent = msg;
  setTimeout(() => { statusEl.textContent = ""; }, 1500);
}

// Salva a porta ao perder o foco
portaEl.addEventListener("blur", async () => {
  const porta = (portaEl.value || "4747").replace(/\D+/g, "") || "4747";
  await chrome.storage.local.set({ mododevPort: porta });
});

// Salva a lista de sites ao perder o foco — o background re-registra os content scripts na hora
sitesEl.addEventListener("blur", async () => {
  const sites = sitesEl.value.split("\n").map((s) => s.trim()).filter(Boolean);
  await chrome.storage.local.set({ mododevSites: sites });
  piscarOk(sites.length ? `✓ ${sites.length} site(s) salvos · vale no próximo reload` : "✓ auto-inject desligado");
});

// Botão: abre o painel lateral (side_panel). Precisa de gesture do usuário,
// por isso fica aqui (clique no popup conta como gesture).
document.getElementById("painel").onclick = async () => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (chrome.sidePanel?.open && tab?.windowId) {
      await chrome.sidePanel.open({ windowId: tab.windowId });
    }
  } catch (e) {
    console.error("[modo dev] erro abrindo painel:", e);
  }
  window.close();
};

// Botão: injeta na aba atual (uso pontual / sites fora da lista)
document.getElementById("ativar").onclick = async () => {
  const porta = (portaEl.value || "4747").replace(/\D+/g, "") || "4747";
  await chrome.storage.local.set({ mododevPort: porta });
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["html2canvas.min.js", "overlay.js"] });
  window.close();
};
