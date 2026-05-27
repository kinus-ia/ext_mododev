// Overlay injetado pela extensão. Clicar de novo no ícone remove (toggle).
// Lê a porta do daemon do chrome.storage. html2canvas já é injetado antes deste.
(function () {
  if (window.__modoDev) return; // idempotente: já tá na tela (content script roda a cada load; popup só reforça)
  window.__modoDev = true;
  const Z = 2147483000;
  let BASE = "http://localhost:4747";
  try { chrome.storage.local.get("mododevPort", (o) => { if (o && o.mododevPort) BASE = "http://localhost:" + o.mododevPort; }); } catch (e) { /* fora da extensão */ }

  const layer = document.createElement("div");
  layer.id = "__md_layer";
  Object.assign(layer.style, { position: "fixed", inset: "0", zIndex: Z, pointerEvents: "none" });
  document.body.appendChild(layer);

  // ============== UNDO ==============
  // Histórico de operações reversíveis (Cmd/Ctrl+Z e botão "↩ desfazer").
  // MutationObserver no layer captura criação/remoção de qualquer [data-ann] sem precisar instrumentar
  // todos os call sites (rect/arrow/text/pen/inserir item/borracha). Operações em elementos REAIS da
  // página (apagar, aplicar a todos, limpar tudo) registram undo manualmente.
  const histUndo = [];
  let undoing = false; // ativo durante undo OU batch operations — o observer ignora, regUndo não empilha
  function regUndo(fn) {
    if (undoing) return;
    histUndo.push(fn);
    if (histUndo.length > 100) histUndo.shift(); // teto pra não vazar memória
  }
  function desfazer() {
    if (!histUndo.length) { try { logln && logln("nada pra desfazer", "mut"); } catch {} return; }
    undoing = true;
    try { histUndo.pop()(); try { logln && logln("↩ desfeito (" + histUndo.length + " no histórico)", "mut"); } catch {} }
    catch (e) { try { logln && logln("erro ao desfazer", "er"); } catch {} }
    finally { setTimeout(() => { undoing = false; }, 50); } // libera após mutações decorrentes
  }
  // Suspende o observer enquanto roda fn (batch destrutivo), e empilha UM undo só pra reverter tudo.
  function batchUndoable(fn, undoFn) {
    undoing = true;
    try { fn(); } finally {
      setTimeout(() => {
        undoing = false;
        histUndo.push(() => { undoing = true; try { undoFn(); } finally { setTimeout(() => { undoing = false; }, 50); } });
        if (histUndo.length > 100) histUndo.shift();
      }, 50);
    }
  }
  new MutationObserver((muts) => {
    if (undoing) return;
    for (const m of muts) {
      m.addedNodes.forEach((n) => { if (n.nodeType === 1 && n.dataset && n.dataset.ann === "1") regUndo(() => { undoing = true; n.remove(); setTimeout(() => { undoing = false; }, 50); }); });
      m.removedNodes.forEach((n) => {
        if (n.nodeType === 1 && n.dataset && n.dataset.ann === "1") {
          const parent = m.target; const ref = m.nextSibling;
          regUndo(() => { undoing = true; parent.insertBefore(n, ref && ref.isConnected ? ref : null); setTimeout(() => { undoing = false; }, 50); });
        }
      });
    }
  }).observe(layer, { childList: true });

  let mode = null, draw = null;
  function setMode(m) {
    mode = mode === m ? null : m;
    const layerAtivo = mode === "rect" || mode === "arrow" || mode === "text" || mode === "pen" || mode === "borracha";
    layer.style.pointerEvents = layerAtivo ? "auto" : "none"; // pick/edit precisam do mouse na PÁGINA
    layer.style.cursor = (mode === "rect" || mode === "arrow" || mode === "pen") ? "crosshair" : mode === "text" ? "text" : mode === "borracha" ? "not-allowed" : "default";
    bar.querySelectorAll(".md_row button[data-a]").forEach((b) => b.classList.toggle("on", b.dataset.a === mode));
    if (mode === "pick" || mode === "edit") ativarSeletor(mode); else desativarSeletor();
  }
  function posBox(el, x, y, w, h) { el.style.left = x + "px"; el.style.top = y + "px"; el.style.width = w + "px"; el.style.height = h + "px"; }

  function makeMovable(el, handle) {
    handle.style.cursor = "move";
    handle.addEventListener("mousedown", (e) => {
      if (mode) return; e.preventDefault(); e.stopPropagation();
      const r = el.getBoundingClientRect(); const off = { x: e.clientX - r.left, y: e.clientY - r.top };
      function mv(ev) { el.style.left = (ev.clientX - off.x) + "px"; el.style.top = (ev.clientY - off.y) + "px"; }
      function up() { window.removeEventListener("mousemove", mv); window.removeEventListener("mouseup", up); }
      window.addEventListener("mousemove", mv); window.addEventListener("mouseup", up);
    });
    handle.addEventListener("dblclick", (e) => { e.preventDefault(); e.stopPropagation(); el.remove(); });
  }

  function makeArrow() {
    const a = document.createElement("div"); a.dataset.ann = "1";
    Object.assign(a.style, { position: "fixed", height: "0", zIndex: Z, pointerEvents: "auto", transformOrigin: "0 50%" });
    const shaft = document.createElement("div");
    Object.assign(shaft.style, { position: "absolute", left: "0", top: "-1.5px", height: "3px", width: "100%", background: "#e5484d", borderRadius: "2px", cursor: "move" });
    const head = document.createElement("div");
    Object.assign(head.style, { position: "absolute", right: "-2px", top: "-7px", width: "0", height: "0", borderTop: "7px solid transparent", borderBottom: "7px solid transparent", borderLeft: "13px solid #e5484d" });
    a.appendChild(shaft); a.appendChild(head); layer.appendChild(a); return a;
  }
  function posArrow(a, x0, y0, x1, y1) {
    const dx = x1 - x0, dy = y1 - y0;
    a.style.left = x0 + "px"; a.style.top = y0 + "px"; a.style.width = Math.hypot(dx, dy) + "px";
    a.style.transform = "rotate(" + (Math.atan2(dy, dx) * 180 / Math.PI) + "deg)";
  }

  layer.addEventListener("mousedown", (e) => {
    if (mode === "borracha") { const ann = e.target.closest && e.target.closest("[data-ann]"); if (ann) { e.preventDefault(); e.stopPropagation(); ann.remove(); logln("🧽 apagado", "mut"); } return; }
    if (mode === "rect") {
      const b = document.createElement("div"); b.dataset.ann = "1";
      Object.assign(b.style, { position: "fixed", border: "2px solid #e5484d", background: "rgba(229,72,77,.08)", borderRadius: "4px", zIndex: Z, pointerEvents: "auto" });
      layer.appendChild(b); draw = { type: "rect", el: b, x0: e.clientX, y0: e.clientY }; posBox(b, e.clientX, e.clientY, 0, 0); makeMovable(b, b);
    } else if (mode === "arrow") {
      const a = makeArrow(); draw = { type: "arrow", el: a, x0: e.clientX, y0: e.clientY }; posArrow(a, e.clientX, e.clientY, e.clientX, e.clientY); makeMovable(a, a);
    } else if (mode === "pen") {
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg"); svg.dataset.ann = "1";
      Object.assign(svg.style, { position: "fixed", inset: "0", width: "100%", height: "100%", zIndex: Z, pointerEvents: "none", overflow: "visible" });
      const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
      p.setAttribute("fill", "none"); p.setAttribute("stroke", "#e5484d"); p.setAttribute("stroke-width", "3"); p.setAttribute("stroke-linecap", "round"); p.setAttribute("stroke-linejoin", "round");
      p.setAttribute("pointer-events", "stroke"); // borracha consegue clicar no traço
      const d0 = "M " + e.clientX + " " + e.clientY; p.setAttribute("d", d0); svg.appendChild(p); layer.appendChild(svg);
      draw = { type: "pen", el: p, d: d0 };
    } else if (mode === "text") { addText(e.clientX, e.clientY); setMode(null); }
  });
  window.addEventListener("mousemove", (e) => {
    if (!draw) return;
    if (draw.type === "pen") { draw.d += " L " + e.clientX + " " + e.clientY; draw.el.setAttribute("d", draw.d); }
    else if (draw.type === "arrow") posArrow(draw.el, draw.x0, draw.y0, e.clientX, e.clientY);
    else posBox(draw.el, Math.min(e.clientX, draw.x0), Math.min(e.clientY, draw.y0), Math.abs(e.clientX - draw.x0), Math.abs(e.clientY - draw.y0));
  });
  window.addEventListener("mouseup", () => { if (draw) { const pen = draw.type === "pen"; draw = null; if (!pen) setMode(null); } }); // desenho fica ativo p/ vários traços
  window.addEventListener("keydown", (e) => { // Esc deseleciona · Delete/Backspace apaga · Cmd/Ctrl+Z desfaz
    const ed = document.activeElement, dig = ed && (ed.tagName === "INPUT" || ed.tagName === "TEXTAREA" || ed.isContentEditable);
    if ((e.metaKey || e.ctrlKey) && (e.key === "z" || e.key === "Z") && !e.shiftKey) { e.preventDefault(); desfazer(); return; }
    if (e.key === "Escape" && editAtivo) { e.preventDefault(); deselecionar(); }
    else if ((e.key === "Delete" || e.key === "Backspace") && editAtivo && !dig) { e.preventDefault(); apagarEditado(); }
  });

  function addText(x, y) {
    const c = document.createElement("div"); c.dataset.ann = "1";
    Object.assign(c.style, { position: "fixed", left: x + "px", top: y + "px", zIndex: Z, display: "flex", alignItems: "stretch", pointerEvents: "auto" });
    const grip = document.createElement("div"); grip.textContent = "⠿"; grip.title = "arraste pra mover";
    Object.assign(grip.style, { background: "#e5484d", color: "#fff", font: "700 12px system-ui", display: "flex", alignItems: "center", padding: "0 5px", borderRadius: "6px 0 0 6px", userSelect: "none" });
    const t = document.createElement("div"); t.contentEditable = "true"; t.textContent = "nota...";
    Object.assign(t.style, { color: "#e5484d", background: "#fff", border: "1px solid #e5484d", borderLeft: "none", borderRadius: "0 6px 6px 0", padding: "2px 7px", font: "600 13px -apple-system,system-ui", minWidth: "26px", outline: "none" });
    c.appendChild(grip); c.appendChild(t); layer.appendChild(c); makeMovable(c, grip); setTimeout(() => t.focus(), 0);
  }

  // --- 🎯 selecionar / ✥ mover / redimensionar um elemento REAL da página ---
  let hoverBox = null, seletorAtivo = null;
  function elNoPonto(x, y) {
    const el = document.elementFromPoint(x, y);
    if (!el || el.id === "__md_hover" || el.closest("#__md_bar") || el.closest("#__md_layer")) return null;
    return el;
  }
  function onSelMove(e) {
    if (!hoverBox) return;
    const el = elNoPonto(e.clientX, e.clientY);
    if (!el) { hoverBox.style.display = "none"; return; }
    const r = el.getBoundingClientRect();
    Object.assign(hoverBox.style, { display: "block", left: r.left + "px", top: r.top + "px", width: r.width + "px", height: r.height + "px" });
  }
  function onSelClick(e) {
    const el = elNoPonto(e.clientX, e.clientY);
    if (!el) return;
    e.preventDefault(); e.stopPropagation();
    if (seletorAtivo === "pick") selecionarElemento(el); else if (seletorAtivo === "edit") editarElemento(el);
    setMode(null);
  }
  function ativarSeletor(m) {
    desativarSeletor();
    hoverBox = document.createElement("div"); hoverBox.id = "__md_hover";
    Object.assign(hoverBox.style, { position: "fixed", zIndex: Z + 2, pointerEvents: "none", border: "2px solid #2563eb", background: "rgba(37,99,235,.08)", borderRadius: "3px", display: "none" });
    document.body.appendChild(hoverBox);
    document.addEventListener("mousemove", onSelMove, true);
    document.addEventListener("click", onSelClick, true);
    seletorAtivo = m;
  }
  function desativarSeletor() {
    document.removeEventListener("mousemove", onSelMove, true);
    document.removeEventListener("click", onSelClick, true);
    if (hoverBox) { hoverBox.remove(); hoverBox = null; }
    seletorAtivo = null;
  }
  function seletorCss(el) {
    if (el.id) return "#" + el.id;
    let s = el.tagName.toLowerCase();
    if (typeof el.className === "string" && el.className.trim()) s += "." + el.className.trim().split(/\s+/).slice(0, 2).join(".");
    const par = el.parentElement;
    if (par) s += ":nth-child(" + (Array.prototype.indexOf.call(par.children, el) + 1) + ")";
    return s;
  }
  function selecionarElemento(el) {
    const sel = seletorCss(el);
    const txt = (el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 40);
    const r = el.getBoundingClientRect();
    const b = document.createElement("div"); b.dataset.ann = "1";
    Object.assign(b.style, { position: "fixed", left: r.left + "px", top: r.top + "px", width: r.width + "px", height: r.height + "px", border: "2px solid #2563eb", borderRadius: "3px", zIndex: Z, pointerEvents: "none" });
    layer.appendChild(b);
    msgEl.value = (msgEl.value ? msgEl.value.trim() + " " : "") + "[elemento: " + sel + (txt ? ' "' + txt + '"' : "") + "] ";
    logln("🎯 elemento: " + sel, "mut");
  }
  let editAtivo = null;
  function deselecionar() {
    if (!editAtivo) return;
    editAtivo.el.style.outline = ""; editAtivo.el.style.cursor = "";
    editAtivo.el.removeEventListener("mousedown", editAtivo.onDown, true);
    editAtivo.el.removeEventListener("click", editAtivo.blockClick, true);
    editAtivo.h.remove(); editAtivo.tb.remove();
    logln("✓ deselecionado", "mut"); editAtivo = null;
  }
  function apagarEditado() {
    if (!editAtivo) return;
    const elPag = editAtivo.el, paiPag = elPag.parentNode, refPag = elPag.nextSibling;
    editAtivo.h.remove(); editAtivo.tb.remove();
    elPag.remove(); // some o elemento da página
    regUndo(() => { if (paiPag) paiPag.insertBefore(elPag, refPag && refPag.isConnected ? refPag : null); });
    logln("🗑 elemento apagado da tela", "mut"); editAtivo = null;
  }
  function aplicarATodos(el) {
    const w = el.style.width, ht = el.style.height;
    const cls = (typeof el.className === "string" && el.className.trim()) ? "." + el.className.trim().split(/\s+/).join(".") : "";
    const seletor = el.tagName.toLowerCase() + cls;
    const alterados = [];
    document.querySelectorAll(seletor).forEach((o) => { alterados.push({ el: o, prevW: o.style.width, prevH: o.style.height }); if (w) o.style.width = w; if (ht) o.style.height = ht; });
    if (alterados.length) regUndo(() => alterados.forEach(({ el: o, prevW, prevH }) => { o.style.width = prevW; o.style.height = prevH; }));
    msgEl.value = (msgEl.value ? msgEl.value.trim() + " " : "") + "[aplicar mesmo tamanho a TODOS '" + seletor + "' (" + alterados.length + ")] ";
    logln("⎘ tamanho copiado p/ " + alterados.length + " elemento(s) '" + seletor + "'", "mut");
  }
  function editarElemento(el) {
    deselecionar(); // um por vez
    el.style.outline = "2px dashed #7c3aed"; el.style.cursor = "move";
    const st = { tx: 0, ty: 0 };
    function posUI() { const r = el.getBoundingClientRect(); h.style.left = (r.right - 7) + "px"; h.style.top = (r.bottom - 7) + "px"; tb.style.left = r.left + "px"; tb.style.top = Math.max(2, r.top - 30) + "px"; }
    const onDown = (e) => {
      if (e.target.closest && e.target.closest(".__md_ui")) return;
      e.preventDefault(); e.stopPropagation();
      const ox = e.clientX, oy = e.clientY, bx = st.tx, by = st.ty;
      const mv = (ev) => { st.tx = bx + (ev.clientX - ox); st.ty = by + (ev.clientY - oy); el.style.transform = "translate(" + st.tx + "px," + st.ty + "px)"; posUI(); };
      const up = () => { document.removeEventListener("mousemove", mv, true); document.removeEventListener("mouseup", up, true); };
      document.addEventListener("mousemove", mv, true); document.addEventListener("mouseup", up, true);
    };
    el.addEventListener("mousedown", onDown, true);
    const blockClick = (e) => { e.preventDefault(); e.stopPropagation(); }; // mata o "action" (link/botão/submit) enquanto edita
    el.addEventListener("click", blockClick, true);
    const h = document.createElement("div"); h.className = "__md_resize __md_ui";
    Object.assign(h.style, { position: "fixed", width: "14px", height: "14px", background: "#7c3aed", border: "2px solid #fff", borderRadius: "50%", boxShadow: "0 1px 4px rgba(0,0,0,.3)", zIndex: Z + 2, cursor: "nwse-resize", pointerEvents: "auto" });
    layer.appendChild(h);
    h.addEventListener("mousedown", (e) => {
      e.preventDefault(); e.stopPropagation();
      const r0 = el.getBoundingClientRect(), ox = e.clientX, oy = e.clientY;
      const mv = (ev) => { el.style.width = Math.max(20, r0.width + (ev.clientX - ox)) + "px"; el.style.height = Math.max(20, r0.height + (ev.clientY - oy)) + "px"; posUI(); };
      const up = () => { document.removeEventListener("mousemove", mv, true); document.removeEventListener("mouseup", up, true); };
      document.addEventListener("mousemove", mv, true); document.addEventListener("mouseup", up, true);
    });
    const tb = document.createElement("div"); tb.className = "__md_ui";
    Object.assign(tb.style, { position: "fixed", zIndex: Z + 3, display: "flex", gap: "4px", pointerEvents: "auto" });
    const mk = (txt, fn) => { const b = document.createElement("button"); b.className = "__md_ui"; b.textContent = txt; Object.assign(b.style, { font: "600 11px system-ui", background: "#7c3aed", color: "#fff", border: "none", borderRadius: "6px", padding: "3px 8px", cursor: "pointer", boxShadow: "0 1px 4px rgba(0,0,0,.25)" }); b.addEventListener("mousedown", (e) => { e.preventDefault(); e.stopPropagation(); }); b.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); fn(); }); return b; };
    tb.appendChild(mk("⎘ aplicar a todos", () => aplicarATodos(el)));
    tb.appendChild(mk("✓ ok", () => deselecionar()));
    layer.appendChild(tb);
    posUI();
    editAtivo = { el, onDown, blockClick, h, tb };
    msgEl.value = (msgEl.value ? msgEl.value.trim() + " " : "") + "[mover/redimensionar: " + seletorCss(el) + "] ";
    logln("✥ arrasta / alça = tamanho · ⎘ aplica a todos os iguais · ✓ ou Esc = deselecionar", "mut");
  }

  const bar = document.createElement("div"); bar.id = "__md_bar";
  bar.innerHTML =
    '<div class="md_head">🛠 modo dev <span class="md_btns"><span class="md_min" title="recolher">—</span><span class="md_close" title="fechar (volta no F5)">✕</span></span></div>' +
    '<div class="md_body">' +
    '<div class="md_row"><button data-a="rect">✏️ caixa</button><button data-a="arrow">↗ seta</button><button data-a="text">🅣 texto</button></div>' +
    '<div class="md_row"><button data-a="pen">🖊 desenho</button><button data-a="pick">🎯 elemento</button><button data-a="edit">✥ mover/tam.</button></div>' +
    '<div class="md_row"><button data-a="borracha">🧽 borracha</button><button class="md_clear">🧹 limpar</button><button class="md_undo" title="Cmd/Ctrl+Z">↩ desfazer</button></div>' +
    '<button class="md_itens">➕ inserir item ▾</button>' +
    '<div class="md_pal"></div>' +
    '<textarea class="md_msg" rows="2" placeholder="o que mudar? ex: deixa esses botões maiores e azuis"></textarea>' +
    '<div class="md_row2"><button class="md_add">📷 Print (0)</button><button class="md_send">📤 Enviar (0)</button></div>' +
    '<label class="md_up" title="imagem → fila">🖼️ Upload Imagem<input type="file" accept="image/*" hidden></label>' +
    '<div class="md_status"></div></div>';
  document.body.appendChild(bar);

  const css = document.createElement("style"); css.id = "__md_style";
  css.textContent =
    "#__md_bar{position:fixed;right:16px;bottom:16px;width:280px;z-index:" + (Z + 1) + ";background:#fff;border:1px solid #e2e2e8;border-radius:12px;box-shadow:0 8px 30px rgba(0,0,0,.16);font-family:-apple-system,system-ui,sans-serif;overflow:hidden}" +
    "#__md_bar .md_head{display:flex;justify-content:space-between;align-items:center;background:#1c1c1e;color:#fff;font-size:12px;font-weight:650;padding:8px 12px}" +
    "#__md_bar .md_min{cursor:pointer;font-weight:700;padding:0 2px}" +
    "#__md_bar .md_btns{display:flex;gap:10px;align-items:center}#__md_bar .md_close{cursor:pointer;font-weight:700}" +
    "#__md_bar .md_body{padding:10px 12px;display:flex;flex-direction:column;gap:8px}" +
    "#__md_bar.min .md_body{display:none}" +
    "#__md_bar .md_row{display:flex;gap:6px}" +
    "#__md_bar .md_row button{flex:1;font:inherit;font-size:12px;font-weight:550;border:1px solid #dcdce2;background:#fff;border-radius:8px;padding:6px 0;cursor:pointer}" +
    "#__md_bar .md_row button.on{background:#e5484d;color:#fff;border-color:#e5484d}" +
    "#__md_bar .md_row2{display:flex;gap:6px}" +
    "#__md_bar .md_row2 .md_add,#__md_bar .md_row2 .md_send{flex:1}" +
    "#__md_bar .md_msg{border:1px solid #dcdce2;border-radius:8px;padding:7px 9px;font:inherit;font-size:13px;resize:vertical}" +
    "#__md_bar .md_add{background:#1c1c1e;color:#fff;border:none;border-radius:8px;padding:9px;font:inherit;font-weight:600;font-size:13px;cursor:pointer}" +
    "#__md_bar .md_add:hover{background:#000}#__md_bar .md_add:disabled{opacity:.6}" +
    "#__md_bar .md_send{background:#1f8a5b;color:#fff;border:none;border-radius:8px;padding:9px;font:inherit;font-weight:600;font-size:13px;cursor:pointer}" +
    "#__md_bar .md_send:disabled{opacity:.6}" +
    "#__md_bar .md_up{display:block;text-align:center;background:#fff;color:#1c1c1e;border:1px solid #dcdce2;border-radius:8px;padding:8px;font:inherit;font-size:12.5px;font-weight:550;cursor:pointer}" +
    "#__md_bar .md_up:hover{background:#f4f4f6}" +
    "#__md_bar .md_itens{background:#fff;color:#1c1c1e;border:1px solid #dcdce2;border-radius:8px;padding:8px;font:inherit;font-size:12.5px;font-weight:550;cursor:pointer}" +
    "#__md_bar .md_itens:hover{background:#f4f4f6}" +
    "#__md_bar .md_pal{display:none;flex-wrap:wrap;gap:5px;padding:7px;border:1px solid #ececf0;border-radius:8px;background:#fafafa}#__md_bar .md_pal.on{display:flex}" +
    "#__md_bar .md_pitem{border:1px solid #dcdce2;background:#fff;border-radius:7px;padding:4px 9px;font:inherit;font-size:11.5px;cursor:pointer}" +
    "#__md_bar .md_pitem:hover{background:#ececf0}" +
    "#__md_bar .md_status{font-size:11.5px;color:#777;min-height:14px}" +
    "#__md_bar .md_status.ok{color:#0f6e46}#__md_bar .md_status.er{color:#b42318}#__md_bar .md_status.mut{color:#999}" +
    "@keyframes md_pulse{0%,100%{box-shadow:0 0 0 0 rgba(31,138,91,.55)}50%{box-shadow:0 0 0 8px rgba(31,138,91,0)}}" +
    "#__md_bar .md_pulse{animation:md_pulse 1.4s ease-out infinite}" +
    "#__md_bar .md_busy{background:#6b6b73!important;cursor:wait!important;animation:none!important}";
  document.body.appendChild(css);

  bar.querySelector(".md_min").onclick = () => bar.classList.toggle("min");
  bar.querySelector(".md_close").onclick = () => { document.getElementById("__md_bar")?.remove(); document.getElementById("__md_layer")?.remove(); document.getElementById("__md_style")?.remove(); window.__modoDev = false; };
  bar.querySelectorAll(".md_row button[data-a]").forEach((b) => { b.onclick = () => setMode(b.dataset.a); });
  bar.querySelector(".md_clear").onclick = () => {
    const remov = [...layer.querySelectorAll("[data-ann]")].map((e) => ({ el: e, parent: e.parentNode, ref: e.nextSibling }));
    if (!remov.length) { logln("já tá vazio", "mut"); return; }
    batchUndoable(() => remov.forEach(({ el }) => el.remove()), () => remov.forEach(({ el, parent, ref }) => parent.insertBefore(el, ref && ref.isConnected ? ref : null)));
    logln("🧹 tela limpa (Cmd+Z desfaz)", "mut");
  };
  bar.querySelector(".md_undo").onclick = () => desfazer();
  const status = bar.querySelector(".md_status"), sendBtn = bar.querySelector(".md_send"), addBtn = bar.querySelector(".md_add"), msgEl = bar.querySelector(".md_msg");
  function logln(t, cls) { status.textContent = t; status.className = "md_status" + (cls ? " " + cls : ""); }

  // arrastar a barra pela cabeça (salva a posição → persiste no refresh)
  const head = bar.querySelector(".md_head");
  head.style.cursor = "move";
  head.addEventListener("mousedown", (e) => {
    if (e.target.closest(".md_btns")) return;
    e.preventDefault();
    const r = bar.getBoundingClientRect(), off = { x: e.clientX - r.left, y: e.clientY - r.top };
    bar.style.right = "auto"; bar.style.bottom = "auto"; bar.style.left = r.left + "px"; bar.style.top = r.top + "px";
    const mv = (ev) => { bar.style.left = Math.max(0, ev.clientX - off.x) + "px"; bar.style.top = Math.max(0, ev.clientY - off.y) + "px"; };
    const up = () => { window.removeEventListener("mousemove", mv); window.removeEventListener("mouseup", up); try { chrome.storage.local.set({ mododevBarPos: { left: bar.style.left, top: bar.style.top } }); } catch (e2) { /* ok */ } };
    window.addEventListener("mousemove", mv); window.addEventListener("mouseup", up);
  });
  try { chrome.storage.local.get("mododevBarPos", (o) => { if (o && o.mododevBarPos) { bar.style.right = "auto"; bar.style.bottom = "auto"; bar.style.left = o.mododevBarPos.left; bar.style.top = o.mododevBarPos.top; } }); } catch (e) { /* ok */ }

  // paleta de itens decentes (estilo Tailwind, inline → renderiza em qualquer página)
  const ITENS = {
    "Botão": '<button style="background:#2563eb;color:#fff;border:none;border-radius:8px;padding:9px 16px;font:600 14px system-ui;cursor:pointer;box-shadow:0 1px 3px rgba(0,0,0,.15)">Botão</button>',
    "Botão linha": '<button style="background:#fff;color:#2563eb;border:1.5px solid #2563eb;border-radius:8px;padding:8px 15px;font:600 14px system-ui;cursor:pointer">Botão</button>',
    "Card": '<div style="background:#fff;border:1px solid #e5e7eb;border-radius:12px;box-shadow:0 4px 16px rgba(0,0,0,.08);padding:16px;width:220px;font-family:system-ui"><div style="font:600 15px system-ui;color:#111">Título do card</div><div style="font:14px system-ui;color:#6b7280;margin-top:4px">Texto de apoio, curto e direto.</div><button style="margin-top:12px;background:#111;color:#fff;border:none;border-radius:8px;padding:7px 14px;font:600 13px system-ui;cursor:pointer">Ação</button></div>',
    "Campo": '<input placeholder="Digite aqui…" style="border:1px solid #d1d5db;border-radius:8px;padding:9px 12px;font:14px system-ui;width:200px;outline:none" />',
    "Selo": '<span style="background:#dcfce7;color:#166534;border-radius:999px;padding:4px 11px;font:600 12px system-ui">Ativo</span>',
    "Avatar": '<div style="width:44px;height:44px;border-radius:50%;background:#e5e7eb;display:flex;align-items:center;justify-content:center;font:600 16px system-ui;color:#6b7280">A</div>',
    "Alerta": '<div style="background:#fef3c7;border:1px solid #fcd34d;color:#92400e;border-radius:10px;padding:10px 14px;font:14px system-ui;width:240px">⚠ Mensagem de atenção pro usuário.</div>',
  };
  function inserirItem(html) {
    const w = document.createElement("div"); w.dataset.ann = "1";
    Object.assign(w.style, { position: "fixed", left: (window.innerWidth / 2 - 110) + "px", top: (window.innerHeight / 2 - 30) + "px", zIndex: Z, pointerEvents: "auto", cursor: "move" });
    w.innerHTML = html; layer.appendChild(w); makeMovable(w, w);
    logln("➕ item inserido — arraste pra posicionar · 2 cliques = remover", "mut");
  }
  const pal = bar.querySelector(".md_pal");
  Object.keys(ITENS).forEach((k) => { const b = document.createElement("button"); b.className = "md_pitem"; b.textContent = k; b.onclick = () => inserirItem(ITENS[k]); pal.appendChild(b); });
  bar.querySelector(".md_itens").onclick = () => pal.classList.toggle("on");

  const fila = [];
  function contador() { addBtn.textContent = "📷 Print (" + fila.length + ")"; sendBtn.textContent = "📤 Enviar (" + fila.length + ")"; }

  async function capturar() {
    bar.style.visibility = "hidden";
    try { const c = await window.html2canvas(document.body, { backgroundColor: "#ffffff", scale: 1, logging: false, ignoreElements: (el) => el.id === "__md_bar" || el.id === "__md_hover" || (el.classList && el.classList.contains("__md_ui")) }); return c.toDataURL("image/png"); }
    finally { bar.style.visibility = "visible"; }
  }

  addBtn.onclick = async () => {
    addBtn.disabled = true; addBtn.textContent = "📷 capturando…";
    try {
      const img = await capturar();
      const item = { img, msg: msgEl.value.trim() };
      fila.push(item);
      undoing = true; layer.querySelectorAll("[data-ann]").forEach((e) => e.remove()); setTimeout(() => { undoing = false; }, 50); msgEl.value = "";
      contador();
      // registra direto (bypass regUndo — undoing tá true por causa do clear de anotações acima): o print é desfazível
      histUndo.push(() => { const i = fila.indexOf(item); if (i >= 0) { fila.splice(i, 1); contador(); } });
      if (histUndo.length > 100) histUndo.shift();
      logln("✓ adicionado à fila (" + fila.length + ") — Cmd+Z tira esse print", "mut");
    } catch (e) { logln("erro ao capturar: " + e, "er"); }
    addBtn.disabled = false; contador();
  };

  sendBtn.onclick = async () => {
    sendBtn.classList.remove("md_pulse");
    if (!fila.length) { logln("fila vazia — clica '📷 Print (+ fila)' primeiro", "er"); return; }
    sendBtn.disabled = true; addBtn.disabled = true;
    const t0 = Date.now(); const tmr = setInterval(() => { sendBtn.textContent = "🤖 editando… " + Math.round((Date.now() - t0) / 1000) + "s"; }, 1000);
    logln("enviando " + fila.length + " print(s) de uma vez…", "mut");
    try {
      const r = await (await fetch(BASE + "/api/dev-lote", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ itens: fila }) })).json();
      clearInterval(tmr);
      if (r.ok) { logln("✓ " + r.resposta, "ok"); logln("→ aperta F5 pra ver", "mut"); fila.length = 0; histUndo.length = 0; }
      else logln("✗ " + (r.erro || "falhou"), "er");
    } catch (e) { clearInterval(tmr); logln("erro: " + e + " (o daemon tá rodando em " + BASE + "?)", "er"); }
    contador(); sendBtn.disabled = false; addBtn.disabled = false;
  };

  bar.querySelector(".md_up input").onchange = function () {
    const file = this.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const im = new Image();
      im.onload = () => {
        let w = im.width, h = im.height; const max = 1600;
        if (Math.max(w, h) > max) { const s = max / Math.max(w, h); w = Math.round(w * s); h = Math.round(h * s); }
        const cv = document.createElement("canvas"); cv.width = w; cv.height = h; cv.getContext("2d").drawImage(im, 0, 0, w, h);
        const item = { img: cv.toDataURL("image/png"), msg: msgEl.value.trim() };
        fila.push(item); msgEl.value = ""; contador();
        histUndo.push(() => { const i = fila.indexOf(item); if (i >= 0) { fila.splice(i, 1); contador(); } });
        if (histUndo.length > 100) histUndo.shift();
        logln("✓ imagem '" + file.name + "' na fila (" + fila.length + ") — Cmd+Z tira", "mut");
      };
      im.src = reader.result;
    };
    reader.readAsDataURL(file);
    this.value = "";
  };

  // ============== STATUS DO CLI ==============
  // Polla o daemon a cada 2s pra saber se o CLI tá processando o lote anterior.
  // BUSY (lock presente): trava sendBtn + mostra "🤖 CLI trabalhando…". Adicionar à fila segue livre.
  // FREE (sem lock): destrava sendBtn; se fila.length > 0, PULSA pra te chamar atenção (decisão sua: tu decide quando mandar).
  let cliBusy = false;
  const pollStatus = async () => {
    if (!document.getElementById("__md_bar")) return; // barra fechada → não polla mais
    try {
      const r = await fetch(BASE + "/status", { cache: "no-store" });
      const d = await r.json();
      const eraBusy = cliBusy; cliBusy = !!d.busy;
      if (cliBusy && !eraBusy) {
        sendBtn.disabled = true; sendBtn.classList.add("md_busy"); sendBtn.classList.remove("md_pulse");
        sendBtn.textContent = "🤖 CLI trabalhando…";
      } else if (!cliBusy && eraBusy) {
        sendBtn.classList.remove("md_busy"); sendBtn.disabled = false;
        contador(); // restaura "📤 Enviar (N)"
        if (fila.length > 0) sendBtn.classList.add("md_pulse"); // pulsa só se tem coisa pra mandar
      }
    } catch { /* daemon offline — ignora silencioso */ }
  };
  setInterval(pollStatus, 2000); pollStatus(); // primeira check imediata
})();
