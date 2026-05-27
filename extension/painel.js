// Painel lateral: conecta no SSE do daemon (/eventos) e renderiza, em tempo
// real, o que o `claude -p` tá emitindo: assistant text, tool_use, tool_result,
// stderr e marcos de start/end. Re-conecta sozinho (EventSource faz isso) e
// usa Last-Event-ID pra não perder eventos numa reconexão.

const listaEl = document.getElementById("lista");
const estadoEl = document.getElementById("estado");
const limparBtn = document.getElementById("limpar");
const autoBtn = document.getElementById("auto");

let autoRolar = true;
let es = null;
let vistos = new Set(); // ids já renderizados (dedup no replay)
let porta = 4747;

autoBtn.onclick = () => {
  autoRolar = !autoRolar;
  autoBtn.textContent = `auto-rolar: ${autoRolar ? "on" : "off"}`;
};
limparBtn.onclick = () => {
  listaEl.innerHTML = `<div class="vazio">limpo. Aguardando próximo evento…</div>`;
  vistos = new Set();
};

function setEstado(txt, classe) {
  estadoEl.textContent = txt;
  estadoEl.className = `estado ${classe}`;
}

function rolarSeNecessario() {
  if (!autoRolar) return;
  window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
}

function el(tag, attrs = {}, ...filhos) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") e.className = v;
    else if (k === "text") e.textContent = v;
    else e.setAttribute(k, v);
  }
  for (const f of filhos) if (f) e.append(f);
  return e;
}

function tempoHHMMSS(ts) {
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

// Renderiza uma linha JSON do stream-json do `claude -p` em cartão "amigável".
function renderStdout(payload) {
  // 1) eventos system (boot do CLI)
  if (payload.type === "system") {
    const sub = payload.subtype || "system";
    return { classe: "info", titulo: `system / ${sub}`, corpo: detalhesRaw(payload) };
  }
  // 2) assistant: texto OU tool_use
  if (payload.type === "assistant") {
    const blocos = payload.message?.content ?? [];
    const partes = [];
    for (const b of blocos) {
      if (b.type === "text" && b.text) partes.push({ kind: "texto", text: b.text });
      else if (b.type === "tool_use") partes.push({ kind: "tool", nome: b.name, input: b.input });
    }
    if (!partes.length) return { classe: "assistant", titulo: "assistant", corpo: detalhesRaw(payload) };
    const wrap = document.createDocumentFragment();
    let classe = "assistant";
    let titulo = "assistant";
    for (const p of partes) {
      if (p.kind === "texto") {
        wrap.append(el("div", { class: "texto", text: p.text }));
      } else {
        classe = "tool";
        titulo = `tool · ${p.nome}`;
        const linha = el("div", { class: "arquivo", text: resumoToolInput(p.nome, p.input) });
        wrap.append(linha);
        wrap.append(detalhesRaw(p.input, "input"));
      }
    }
    return { classe, titulo, corpo: wrap };
  }
  // 3) user → tool_result (resposta da ferramenta que o claude rodou)
  if (payload.type === "user") {
    const blocos = payload.message?.content ?? [];
    const tr = blocos.find((b) => b.type === "tool_result");
    if (tr) {
      const txt = typeof tr.content === "string" ? tr.content : Array.isArray(tr.content) ? tr.content.map((c) => c.text || "").join("\n") : JSON.stringify(tr.content);
      const corpo = document.createDocumentFragment();
      corpo.append(el("div", { class: "raw", text: String(txt).slice(0, 800) + (String(txt).length > 800 ? "…" : "") }));
      return { classe: "tool", titulo: `tool_result${tr.is_error ? " · erro" : ""}`, corpo };
    }
  }
  // 4) result (final do turno)
  if (payload.type === "result") {
    const r = payload.result ?? "";
    return { classe: "end", titulo: "result", corpo: el("div", { class: "texto", text: String(r) }) };
  }
  // fallback: raw
  return { classe: "info", titulo: payload.type || "evento", corpo: detalhesRaw(payload) };
}

function resumoToolInput(nome, input) {
  if (!input || typeof input !== "object") return nome;
  if (input.file_path) return `${nome}  ${input.file_path}`;
  if (input.path) return `${nome}  ${input.path}`;
  if (input.command) return `${nome}  ${String(input.command).slice(0, 120)}`;
  if (input.pattern) return `${nome}  /${input.pattern}/`;
  return nome;
}

function detalhesRaw(obj, label = "json") {
  const det = el("details");
  det.append(el("summary", { text: label }));
  det.append(el("pre", { class: "raw", text: JSON.stringify(obj, null, 2) }));
  return det;
}

function adicionarEvento(ev) {
  if (vistos.has(ev.id)) return;
  vistos.add(ev.id);
  // Limpa o "aguardando…" inicial
  if (listaEl.firstElementChild && listaEl.firstElementChild.classList.contains("vazio")) {
    listaEl.innerHTML = "";
  }

  let classe = "info";
  let titulo = ev.tipo;
  let corpo;

  if (ev.tipo === "start") {
    classe = "start";
    titulo = `▶ ${ev.payload?.rotulo || "lote"}`;
    corpo = el("div", { class: "texto", text: ev.payload?.prompt || "" });
  } else if (ev.tipo === "end") {
    classe = "end";
    const ok = ev.payload?.ok;
    titulo = `${ok ? "✓" : "✗"} ${ev.payload?.rotulo || "fim"}  (exit ${ev.payload?.exitCode ?? "?"})`;
    corpo = el("div", { class: "texto", text: ev.payload?.resposta || "" });
  } else if (ev.tipo === "stderr") {
    classe = "stderr";
    titulo = "stderr";
    corpo = el("pre", { text: String(ev.payload?.texto || "").trim() });
  } else if (ev.tipo === "info") {
    classe = "info";
    titulo = "info";
    corpo = el("pre", { class: "raw", text: JSON.stringify(ev.payload, null, 2) });
  } else if (ev.tipo === "stdout") {
    const r = renderStdout(ev.payload || {});
    classe = r.classe;
    titulo = r.titulo;
    corpo = r.corpo;
  }

  const cab = el("div", { class: "cab" },
    el("span", { class: "tag", text: titulo }),
    el("span", { text: tempoHHMMSS(ev.ts) }),
  );
  const cartao = el("div", { class: `ev ${classe}` }, cab);
  if (corpo) cartao.append(corpo);
  listaEl.append(cartao);
  rolarSeNecessario();
}

function conectar() {
  if (es) try { es.close(); } catch {}
  const url = `http://localhost:${porta}/eventos`;
  setEstado("conectando…", "off");
  es = new EventSource(url);
  es.onopen = () => setEstado("ao vivo", "on");
  es.onerror = () => setEstado("desconectado (re-tentando)", "off");
  // O daemon emite com `event: <tipo>`. EventSource só entrega no listener
  // específico — então registramos um pra cada tipo conhecido.
  for (const tipo of ["start", "stdout", "stderr", "end", "info"]) {
    es.addEventListener(tipo, (e) => {
      try { adicionarEvento(JSON.parse(e.data)); } catch (err) { console.warn("[painel] parse falhou:", err, e.data); }
    });
  }
}

chrome.storage.local.get("mododevPort", (o) => {
  if (o.mododevPort) porta = Number(o.mododevPort) || 4747;
  conectar();
});

// ---------- composer: digita direto pro CLI sem print ----------
const entradaEl = document.getElementById("entrada");
const enviarBtn = document.getElementById("enviar");

function enviarTexto() {
  const msg = entradaEl.value.trim();
  if (!msg) return;
  // Dispara o request mas NÃO espera a resposta — o daemon só responde quando
  // o claude termina (minutos). O SSE vai mostrando o progresso na hora.
  fetch(`http://localhost:${porta}/api/dev-texto`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ msg }),
  }).catch((e) => {
    adicionarEvento({
      id: `local-${Date.now()}`,
      ts: Date.now(),
      tipo: "stderr",
      payload: { texto: `falha ao enviar: ${String(e)}` },
    });
  });
  entradaEl.value = "";
  entradaEl.focus();
}

enviarBtn.onclick = enviarTexto;
entradaEl.addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
    e.preventDefault();
    enviarTexto();
  }
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.mododevPort) {
    porta = Number(changes.mododevPort.newValue) || 4747;
    conectar();
  }
});
