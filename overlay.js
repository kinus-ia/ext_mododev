// modo-dev overlay — injetado por bookmarklet em QUALQUER página. Anotar (caixa/seta/
// texto), Print (ou upload) → manda pro daemon → Claude Code edita o projeto → F5.
(function () {
  if (window.__modoDev) { return; } window.__modoDev = true;
  const Z = 2147483000;
  // base do daemon = de onde este script foi carregado (ex: http://localhost:4747)
  const BASE = (function () {
    const s = document.currentScript && document.currentScript.src;
    return s ? s.replace(/\/overlay\.js.*$/, "") : "http://localhost:4747";
  })();

  const layer = document.createElement("div");
  layer.id = "__md_layer";
  Object.assign(layer.style, { position: "fixed", inset: "0", zIndex: Z, pointerEvents: "none" });
  document.body.appendChild(layer);

  let mode = null, draw = null;
  function setMode(m) {
    mode = mode === m ? null : m;
    layer.style.pointerEvents = mode ? "auto" : "none";
    layer.style.cursor = mode === "rect" ? "crosshair" : mode === "text" ? "text" : "default";
    bar.querySelectorAll(".md_row button[data-a]").forEach((b) => b.classList.toggle("on", b.dataset.a === mode));
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
    if (mode === "rect") {
      const b = document.createElement("div"); b.dataset.ann = "1";
      Object.assign(b.style, { position: "fixed", border: "2px solid #e5484d", background: "rgba(229,72,77,.08)", borderRadius: "4px", zIndex: Z, pointerEvents: "auto" });
      layer.appendChild(b); draw = { type: "rect", el: b, x0: e.clientX, y0: e.clientY }; posBox(b, e.clientX, e.clientY, 0, 0); makeMovable(b, b);
    } else if (mode === "arrow") {
      const a = makeArrow(); draw = { type: "arrow", el: a, x0: e.clientX, y0: e.clientY }; posArrow(a, e.clientX, e.clientY, e.clientX, e.clientY); makeMovable(a, a);
    } else if (mode === "text") { addText(e.clientX, e.clientY); setMode(null); }
  });
  window.addEventListener("mousemove", (e) => {
    if (!draw) return;
    if (draw.type === "arrow") posArrow(draw.el, draw.x0, draw.y0, e.clientX, e.clientY);
    else posBox(draw.el, Math.min(e.clientX, draw.x0), Math.min(e.clientY, draw.y0), Math.abs(e.clientX - draw.x0), Math.abs(e.clientY - draw.y0));
  });
  window.addEventListener("mouseup", () => { if (draw) { draw = null; setMode(null); } });

  function addText(x, y) {
    const c = document.createElement("div"); c.dataset.ann = "1";
    Object.assign(c.style, { position: "fixed", left: x + "px", top: y + "px", zIndex: Z, display: "flex", alignItems: "stretch", pointerEvents: "auto" });
    const grip = document.createElement("div"); grip.textContent = "⠿"; grip.title = "arraste pra mover";
    Object.assign(grip.style, { background: "#e5484d", color: "#fff", font: "700 12px system-ui", display: "flex", alignItems: "center", padding: "0 5px", borderRadius: "6px 0 0 6px", userSelect: "none" });
    const t = document.createElement("div"); t.contentEditable = "true"; t.textContent = "nota...";
    Object.assign(t.style, { color: "#e5484d", background: "#fff", border: "1px solid #e5484d", borderLeft: "none", borderRadius: "0 6px 6px 0", padding: "2px 7px", font: "600 13px -apple-system,system-ui", minWidth: "26px", outline: "none" });
    c.appendChild(grip); c.appendChild(t); layer.appendChild(c); makeMovable(c, grip); setTimeout(() => t.focus(), 0);
  }

  const bar = document.createElement("div"); bar.id = "__md_bar";
  bar.innerHTML =
    '<div class="md_head">🛠 modo dev <span class="md_min" title="recolher">—</span></div>' +
    '<div class="md_body">' +
    '<div class="md_row"><button data-a="rect">✏️ caixa</button><button data-a="arrow">↗ seta</button><button data-a="text">🅣 texto</button></div>' +
    '<div class="md_tip">arraste pra mover · 2 cliques numa anotação = excluir</div>' +
    '<textarea class="md_msg" rows="2" placeholder="o que mudar? ex: deixa esses botões maiores e azuis"></textarea>' +
    '<button class="md_send">📷 Print → editar</button>' +
    '<label class="md_up">📎 enviar uma imagem (upload)<input type="file" accept="image/*" hidden></label>' +
    '<div class="md_log"></div></div>';
  document.body.appendChild(bar);

  const css = document.createElement("style");
  css.textContent =
    "#__md_bar{position:fixed;right:16px;bottom:16px;width:280px;z-index:" + (Z + 1) + ";background:#fff;border:1px solid #e2e2e8;border-radius:12px;box-shadow:0 8px 30px rgba(0,0,0,.16);font-family:-apple-system,system-ui,sans-serif;overflow:hidden}" +
    "#__md_bar .md_head{display:flex;justify-content:space-between;align-items:center;background:#1c1c1e;color:#fff;font-size:12px;font-weight:650;padding:8px 12px}" +
    "#__md_bar .md_min{cursor:pointer;font-weight:700;padding:0 4px}" +
    "#__md_bar .md_body{padding:10px 12px;display:flex;flex-direction:column;gap:8px}" +
    "#__md_bar.min .md_body{display:none}" +
    "#__md_bar .md_row{display:flex;gap:6px}" +
    "#__md_bar .md_row button{flex:1;font:inherit;font-size:12px;font-weight:550;border:1px solid #dcdce2;background:#fff;border-radius:8px;padding:6px 0;cursor:pointer}" +
    "#__md_bar .md_row button.on{background:#e5484d;color:#fff;border-color:#e5484d}" +
    "#__md_bar .md_tip{font-size:11px;color:#9a9aa2;margin:-2px 0 0}" +
    "#__md_bar .md_msg{border:1px solid #dcdce2;border-radius:8px;padding:7px 9px;font:inherit;font-size:13px;resize:vertical}" +
    "#__md_bar .md_send{background:#1f8a5b;color:#fff;border:none;border-radius:8px;padding:9px;font:inherit;font-weight:600;font-size:13px;cursor:pointer}" +
    "#__md_bar .md_send:disabled{opacity:.6}" +
    "#__md_bar .md_up{display:block;text-align:center;background:#fff;color:#1c1c1e;border:1px solid #dcdce2;border-radius:8px;padding:8px;font-size:12.5px;font-weight:550;cursor:pointer}" +
    "#__md_bar .md_up:hover{background:#f4f4f6}" +
    "#__md_bar .md_log{font-size:12px;color:#444;max-height:150px;overflow:auto;white-space:pre-wrap;line-height:1.45}" +
    "#__md_bar .md_log .ok{color:#0f6e46}#__md_bar .md_log .er{color:#b42318}#__md_bar .md_log .mut{color:#999}";
  document.body.appendChild(css);

  bar.querySelector(".md_min").onclick = () => bar.classList.toggle("min");
  bar.querySelectorAll(".md_row button[data-a]").forEach((b) => { b.onclick = () => setMode(b.dataset.a); });
  const log = bar.querySelector(".md_log"), sendBtn = bar.querySelector(".md_send"), msgEl = bar.querySelector(".md_msg");
  function logln(t, cls) { const d = document.createElement("div"); if (cls) d.className = cls; d.textContent = t; log.appendChild(d); log.scrollTop = 1e9; }

  async function enviar(img, msg) {
    let tmr = null;
    const t0 = Date.now();
    tmr = setInterval(() => { sendBtn.textContent = "🤖 editando… " + Math.round((Date.now() - t0) / 1000) + "s"; }, 1000);
    logln("enviado — o Claude tá vendo a tela e editando o código…", "mut");
    try {
      const r = await (await fetch(BASE + "/api/dev", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ img, msg }) })).json();
      clearInterval(tmr);
      if (r.ok) { logln("✓ " + r.resposta, "ok"); logln("→ aperta F5 pra ver", "mut"); }
      else logln("✗ " + (r.erro || "falhou"), "er");
    } catch (e) { clearInterval(tmr); logln("erro: " + e + " (o daemon tá rodando em " + BASE + "?)", "er"); }
  }

  sendBtn.onclick = async () => {
    const msg = msgEl.value.trim();
    if (!msg && !layer.querySelector("[data-ann]")) { logln("escreve o que mudar (ou desenha uma anotação)", "er"); return; }
    sendBtn.disabled = true; const old = "📷 Print → editar"; sendBtn.textContent = "📷 capturando…";
    bar.style.visibility = "hidden";
    try {
      if (!window.html2canvas) await new Promise((res, rej) => { const s = document.createElement("script"); s.src = "https://cdn.jsdelivr.net/npm/html2canvas-pro@1.5.11/dist/html2canvas-pro.min.js"; s.onload = res; s.onerror = rej; document.head.appendChild(s); });
      const canvas = await window.html2canvas(document.body, { backgroundColor: "#ffffff", scale: 1, logging: false, ignoreElements: (el) => el.id === "__md_bar" });
      bar.style.visibility = "visible";
      await enviar(canvas.toDataURL("image/png"), msg);
    } catch (e) { bar.style.visibility = "visible"; logln("erro ao capturar: " + e, "er"); }
    sendBtn.disabled = false; sendBtn.textContent = old;
  };

  bar.querySelector(".md_up input").onchange = function () {
    const file = this.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const im = new Image();
      im.onload = async () => {
        let w = im.width, h = im.height; const max = 1600;
        if (Math.max(w, h) > max) { const s = max / Math.max(w, h); w = Math.round(w * s); h = Math.round(h * s); }
        const cv = document.createElement("canvas"); cv.width = w; cv.height = h; cv.getContext("2d").drawImage(im, 0, 0, w, h);
        logln("enviando imagem (" + file.name + ")…", "mut");
        await enviar(cv.toDataURL("image/png"), msgEl.value.trim());
      };
      im.src = reader.result;
    };
    reader.readAsDataURL(file);
    this.value = "";
  };
})();
