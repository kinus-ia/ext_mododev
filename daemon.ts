// modo-dev — daemon REUTILIZÁVEL. Rode DENTRO de qualquer projeto:
//   cd meu-projeto && bun /Users/gabriellimaoliveira/Documents/Kinus/modo-dev/daemon.ts
// Abra a página do projeto no navegador e clique no bookmarklet (pegue em http://localhost:4747).
// O overlay (anotar + print) manda o screenshot+pedido pra cá, e o Claude Code CLI edita
// o código DO PROJETO (o cwd onde você rodou o daemon).
import path from "path";
import { mkdirSync, existsSync, writeFileSync, readFileSync, rmSync } from "fs";

const PORTA = Number(process.env["MODODEV_PORT"] ?? 4747);
const PROJETO = process.cwd();             // o projeto a editar = onde você rodou o daemon
const DIR = import.meta.dir;               // pasta do modo-dev (pra servir overlay.js)
const TMP = path.join(PROJETO, ".modo-dev");

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "content-type",
};
function json(d: unknown): Response {
  return new Response(JSON.stringify(d), { headers: { "content-type": "application/json; charset=utf-8", ...CORS } });
}

// ---------------------------------------------------------------------------
// Bus de eventos (SSE): a cada linha JSONL que o `claude -p` emite, difundimos
// pra todos os painéis conectados. Mantemos um histórico curto pra quem chegar
// no meio de um lote ver o que já rolou (replay).
// ---------------------------------------------------------------------------
type EventoDev = {
  id: number;
  ts: number;
  tipo: "start" | "stdout" | "stderr" | "end" | "info";
  payload: unknown;
};
const clientes = new Set<ReadableStreamDefaultController<Uint8Array>>();
const historico: EventoDev[] = [];
const HISTORICO_MAX = 500;
let proximoId = 1;
const enc = new TextEncoder();

function emitir(tipo: EventoDev["tipo"], payload: unknown): void {
  const ev: EventoDev = { id: proximoId++, ts: Date.now(), tipo, payload };
  historico.push(ev);
  if (historico.length > HISTORICO_MAX) historico.splice(0, historico.length - HISTORICO_MAX);
  const linha = `id: ${ev.id}\nevent: ${tipo}\ndata: ${JSON.stringify(ev)}\n\n`;
  const bytes = enc.encode(linha);
  for (const c of clientes) {
    try { c.enqueue(bytes); } catch { /* cliente caiu — limpa adiante */ }
  }
}

// ---------------------------------------------------------------------------
// Injeção no terminal do Claude Code: cola texto no input + Enter via osascript.
// Em modo chat (MODODEV_MODO=chat), quando o print chega, em vez de só salvar
// e esperar você dizer "lê", o daemon ativa o terminal e cola direto pra você.
//
// Como acha a aba CERTA (mesmo Terminal tendo várias janelas/abas):
//  1. Lê ~/.claude/sessions/*.json — cada arquivo descreve uma sessão Claude Code
//     ativa com {pid, cwd}.
//  2. Filtra pelas que têm cwd === PROJETO (o cwd do daemon).
//  3. Pega o ppid do claude → é o shell que o hospeda. O tty desse shell = tty da
//     aba do Terminal.
//  4. AppleScript percorre todas as abas do Terminal e seleciona a que tem o tty
//     que bate. Só aí dispara cmd+v + Enter.
// Sem isso, o keystroke iria pra aba frontmost — que pode ser de outro projeto.
//
// Configurável via MODODEV_TERM_APP (default: Terminal). Pra desligar, defina
// MODODEV_INJETAR=off — aí volta ao save-only.
// ---------------------------------------------------------------------------
const TERM_APP = process.env["MODODEV_TERM_APP"] || "Terminal";
const INJETAR_ATIVO = (process.env["MODODEV_INJETAR"] || "on").toLowerCase() !== "off";

async function pidVivo(pid: number): Promise<boolean> {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

async function rodar(cmd: string[]): Promise<string> {
  const p = Bun.spawn(cmd, { stdout: "pipe", stderr: "ignore" });
  const t = await new Response(p.stdout).text();
  await p.exited;
  return t.trim();
}

async function acharTtyDaSessaoClaude(): Promise<string | null> {
  const sessoesDir = path.join(process.env["HOME"] || "", ".claude", "sessions");
  if (!existsSync(sessoesDir)) return null;
  const { readdirSync } = await import("fs");
  for (const f of readdirSync(sessoesDir)) {
    if (!f.endsWith(".json")) continue;
    try {
      const dados = JSON.parse(readFileSync(path.join(sessoesDir, f), "utf-8")) as { pid?: number; cwd?: string };
      if (dados.cwd !== PROJETO) continue;
      const pidClaude = Number(dados.pid);
      if (!pidClaude || !(await pidVivo(pidClaude))) continue;
      const ppid = Number(await rodar(["ps", "-p", String(pidClaude), "-o", "ppid="]));
      if (!ppid) continue;
      const tty = await rodar(["ps", "-p", String(ppid), "-o", "tty="]);
      if (!tty || tty === "??" || tty === "?") continue;
      return tty.startsWith("/dev/") ? tty : `/dev/${tty}`;
    } catch { /* ignora json corrompido */ }
  }
  return null;
}

async function injetarNoTerminal(texto: string): Promise<void> {
  if (!INJETAR_ATIVO) return;
  const tty = await acharTtyDaSessaoClaude();
  if (!tty) {
    console.warn(`[modo-dev] nenhum Claude Code aberto com cwd=${PROJETO}. Print foi salvo, mas sem injeção.`);
    return;
  }
  const escapado = texto.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r?\n/g, "\\n");
  // ATENÇÃO: este AppleScript é específico pro Terminal.app. iTerm2/Warp/Hyper
  // usam APIs diferentes — pra suportar, ramificar pelo TERM_APP aqui.
  const script = `
set targetTTY to "${tty}"
set the clipboard to "${escapado}"
set achou to false
tell application "${TERM_APP}"
  activate
  repeat with w in windows
    if achou then exit repeat
    repeat with t in tabs of w
      try
        if (tty of t) is targetTTY then
          set selected of t to true
          set frontmost of w to true
          set achou to true
          exit repeat
        end if
      end try
    end repeat
  end repeat
end tell
if achou then
  delay 0.18
  tell application "System Events"
    keystroke "v" using command down
    delay 0.12
    key code 36
  end tell
  return "OK"
else
  return "NOTFOUND"
end if
  `.trim();
  try {
    const proc = Bun.spawn(["osascript", "-e", script], { stdout: "pipe", stderr: "pipe" });
    const code = await proc.exited;
    const out = (await new Response(proc.stdout).text()).trim();
    if (code !== 0 || out !== "OK") {
      const err = await new Response(proc.stderr).text();
      console.warn(`[modo-dev] osascript: exit=${code} out=${out} err=${err.slice(0, 200)}`);
    } else {
      console.log(`[modo-dev] injetado em ${tty}`);
    }
  } catch (e) {
    console.error("[modo-dev] osascript falhou:", e);
  }
}

function streamSSE(req: Request): Response {
  const lastIdHeader = req.headers.get("last-event-id");
  const lastId = lastIdHeader ? Number(lastIdHeader) : 0;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      clientes.add(controller);
      // Replay: manda o histórico mais novo que o último id que o cliente viu.
      controller.enqueue(enc.encode(`retry: 2000\n\n`));
      for (const ev of historico) {
        if (ev.id > lastId) {
          controller.enqueue(enc.encode(`id: ${ev.id}\nevent: ${ev.tipo}\ndata: ${JSON.stringify(ev)}\n\n`));
        }
      }
      // Keepalive (comentário SSE) pra evitar timeout de proxy / fechar conexão.
      const kp = setInterval(() => {
        try { controller.enqueue(enc.encode(`: keepalive ${Date.now()}\n\n`)); } catch { clearInterval(kp); }
      }, 15_000);
      (controller as unknown as { _kp?: ReturnType<typeof setInterval> })._kp = kp;
    },
    cancel(reason) {
      const ctl = this as unknown as ReadableStreamDefaultController<Uint8Array> & { _kp?: ReturnType<typeof setInterval> };
      if (ctl._kp) clearInterval(ctl._kp);
      clientes.delete(ctl);
      void reason;
    },
  });
  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      "connection": "keep-alive",
      "x-accel-buffering": "no",
      ...CORS,
    },
  });
}

// ---------------------------------------------------------------------------
// claudeDev: spawna o `claude -p` com --output-format stream-json e difunde
// cada linha JSON pelo bus. Retorna o texto final (campo "result" no evento
// final do CLI, com fallback pro último assistant.text agregado).
// ---------------------------------------------------------------------------
async function claudeDev(prompt: string, rotulo: string, tentativas = 2): Promise<string> {
  for (let i = 0; i < tentativas; i++) {
    emitir("start", { rotulo, tentativa: i + 1, prompt: prompt.slice(0, 400) });
    let textoFinal = "";
    let agregadoAssistant = "";
    let stderrBuf = "";

    const proc = Bun.spawn(
      ["claude", "-p", "--dangerously-skip-permissions", "--output-format", "stream-json", "--verbose", prompt],
      { cwd: PROJETO, stdout: "pipe", stderr: "pipe" },
    );

    const lerStdout = (async () => {
      const reader = proc.stdout.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const linha = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!linha) continue;
          try {
            const obj = JSON.parse(linha) as Record<string, unknown>;
            emitir("stdout", obj);
            // tenta extrair texto de assistant.message.content[].text pra fallback
            const tipo = obj["type"];
            if (tipo === "assistant") {
              const msg = obj["message"] as { content?: Array<{ type?: string; text?: string }> } | undefined;
              const blocos = msg?.content ?? [];
              for (const b of blocos) if (b?.type === "text" && typeof b.text === "string") agregadoAssistant += b.text;
            } else if (tipo === "result") {
              const r = obj["result"];
              if (typeof r === "string") textoFinal = r;
            }
          } catch {
            emitir("stdout", { raw: linha });
          }
        }
      }
      if (buf.trim()) emitir("stdout", { raw: buf.trim() });
    })();

    const lerStderr = (async () => {
      const reader = proc.stderr.getReader();
      const dec = new TextDecoder();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        const txt = dec.decode(value, { stream: true });
        stderrBuf += txt;
        emitir("stderr", { texto: txt });
      }
    })();

    const code = await proc.exited;
    await Promise.allSettled([lerStdout, lerStderr]);
    const t = (textoFinal || agregadoAssistant).trim();
    emitir("end", { rotulo, tentativa: i + 1, exitCode: code, ok: !!t, resposta: t.slice(0, 400) });
    if (t) return t;
    if (i < tentativas - 1) {
      emitir("info", { aviso: "CLI sem resposta — tentando de novo em 3s", stderr: stderrBuf.slice(-200) });
      await Bun.sleep(3000);
    }
  }
  return "(o CLI não respondeu — pode ser limite do Claude; tente de novo)";
}

function paginaInicial(): string {
  const bm = `javascript:(function(){var s=document.createElement('script');s.src='http://localhost:${PORTA}/overlay.js?'+Date.now();document.body.appendChild(s);})()`;
  return `<!doctype html><meta charset="utf-8"><title>modo-dev</title>
<style>body{font-family:-apple-system,system-ui,sans-serif;background:#f6f6f7;color:#1c1c1e;max-width:680px;margin:40px auto;padding:0 22px;line-height:1.6}
code{background:#ececf0;padding:2px 6px;border-radius:5px;font-size:13px}
.bm{display:inline-block;background:#1c1c1e;color:#fff;text-decoration:none;padding:10px 18px;border-radius:10px;font-weight:650;margin:8px 0}
.box{background:#fff;border:1px solid #e7e7ec;border-radius:14px;padding:18px 22px;margin:16px 0}</style>
<h2>🛠 modo-dev</h2>
<p>Editando o projeto: <code>${PROJETO}</code></p>
<div class="box">
  <p><b>1.</b> Arraste este botão pra sua barra de favoritos:</p>
  <p><a class="bm" href="${bm}">🛠 modo dev</a></p>
  <p><b>2.</b> Abra a página do seu projeto (qualquer localhost) e clique no favorito.</p>
  <p><b>3.</b> Anote na tela (caixa/seta/texto), escreva o pedido e <b>Print</b> — o Claude edita o código.</p>
</div>
<p style="color:#6b6b73;font-size:14px">Pra editar outro projeto: feche este daemon e rode <code>bun ${path.join(DIR, "daemon.ts")}</code> dentro do outro projeto.</p>`;
}

Bun.serve({
  port: PORTA,
  async fetch(req) {
    const p = new URL(req.url).pathname;
    if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
    if (p === "/") return new Response(paginaInicial(), { headers: { "content-type": "text/html; charset=utf-8" } });
    if (p === "/overlay.js") return new Response(Bun.file(path.join(DIR, "overlay.js")), { headers: { "content-type": "text/javascript; charset=utf-8", ...CORS } });

    // SSE: stream em tempo real do que o `claude -p` tá emitindo. O painel da
    // extensão (e qualquer outro cliente) se conecta aqui.
    if (p === "/eventos") return streamSSE(req);

    // Status: a extensão polla aqui pra saber se o CLI tá ocupado processando um lote.
    // Lock = .modo-dev/processing.lock com {ts}. Expira em 5min (timeout de segurança).
    if (p === "/status") {
      let busy = false, since = 0, total = 0;
      try {
        const lock = path.join(TMP, "processing.lock");
        if (existsSync(lock)) {
          const d = JSON.parse(readFileSync(lock, "utf-8")) as { ts?: number; total?: number };
          if (Number(d.ts) && Date.now() - Number(d.ts) < 5 * 60 * 1000) { busy = true; since = Number(d.ts); total = Number(d.total) || 0; }
        }
      } catch { /* lock corrompido = livre */ }
      return json({ busy, since, total, clientesSSE: clientes.size });
    }

    // Chat direto pelo painel — sem screenshot, só texto. Útil pra perguntar
    // coisa ou pedir uma mudança que não precisa anotação visual.
    if (p === "/api/dev-texto" && req.method === "POST") {
      const { msg } = (await req.json()) as { msg?: string };
      const texto = String(msg ?? "").trim();
      if (!texto) return json({ ok: false, erro: "mensagem vazia" });
      const prompt = `Você é meu agente de dev neste projeto. Pedido: "${texto}". Edite o código real do projeto pra aplicar a mudança (ou, se for pergunta, responda em poucas linhas). Faça SÓ o que pedi, preserve o resto. Responda em 1-2 linhas o que mudou e em qual arquivo (ou a resposta direta).`;
      console.log(`[modo-dev] ${PROJETO} ← chat: "${texto.slice(0, 70)}"`);
      const t0 = Date.now();
      const resposta = await claudeDev(prompt, `chat: ${texto.slice(0, 50)}`);
      console.log(`[modo-dev] ✓ chat (${Math.round((Date.now() - t0) / 1000)}s) ${resposta.slice(0, 100)}`);
      return json({ ok: true, resposta });
    }

    if (p === "/api/dev" && req.method === "POST") {
      const { img, msg } = (await req.json()) as { img?: string; msg?: string };
      const b64 = String(img ?? "").replace(/^data:image\/\w+;base64,/, "");
      if (!b64) return json({ ok: false, erro: "sem screenshot" });
      if (!existsSync(TMP)) mkdirSync(TMP, { recursive: true });
      writeFileSync(path.join(TMP, "shot.png"), Buffer.from(b64, "base64"));
      writeFileSync(path.join(TMP, "pedido.txt"), String(msg ?? "").trim());
      // MODO CHAT: não roda claude headless; salva e deixa o Claude do chat (pareado) pegar e editar visível
      if (process.env["MODODEV_MODO"] === "chat") {
        writeFileSync(path.join(TMP, "processing.lock"), JSON.stringify({ ts: Date.now(), total: 1 })); // trava extensão até CLI responder
        console.log(`[modo-dev] (modo chat) print salvo → injetando no terminal: "${String(msg ?? "").slice(0, 70)}"`);
        const pedido = String(msg ?? "").trim();
        const txt = `lê o print que mandei em .modo-dev/shot.png (pedido em .modo-dev/pedido.txt). pedido: ${pedido || "(sem texto — só as anotações)"}`;
        void injetarNoTerminal(txt);
        return json({ ok: true, resposta: "📨 colei no terminal do Claude — olha lá" });
      }
      const prompt = `Você é meu agente de dev neste projeto. Veja o screenshot em ".modo-dev/shot.png": é a UI atual com ANOTAÇÕES (caixas, setas e textos vermelhos) marcando o que mudar.
Meu pedido: "${String(msg ?? "").trim() || "faça o que as anotações indicam"}"
Edite o código real do projeto pra aplicar a mudança. Faça SÓ o que pedi, preserve o resto. Responda em 1-2 linhas o que mudou e em qual arquivo.`;
      console.log(`[modo-dev] ${PROJETO} ← "${String(msg ?? "").slice(0, 70)}"`);
      const t0 = Date.now();
      const resposta = await claudeDev(prompt, `print: ${String(msg ?? "").slice(0, 50)}`);
      console.log(`[modo-dev] ✓ (${Math.round((Date.now() - t0) / 1000)}s) ${resposta.slice(0, 100)}`);
      return json({ ok: true, resposta });
    }

    if (p === "/api/dev-lote" && req.method === "POST") {
      const { itens } = (await req.json()) as { itens?: { img?: string; msg?: string }[] };
      const lista = (itens ?? []).filter((x) => x && x.img);
      if (!lista.length) return json({ ok: false, erro: "fila vazia" });
      if (!existsSync(TMP)) mkdirSync(TMP, { recursive: true });
      const loteDir = path.join(TMP, "lote");
      rmSync(loteDir, { recursive: true, force: true });
      mkdirSync(loteDir, { recursive: true });
      const pedidos = lista.map((it, i) => {
        const b64 = String(it.img).replace(/^data:image\/\w+;base64,/, "");
        writeFileSync(path.join(loteDir, `shot-${i + 1}.png`), Buffer.from(b64, "base64"));
        return { n: i + 1, msg: String(it.msg ?? "").trim() };
      });
      writeFileSync(path.join(loteDir, "pedidos.json"), JSON.stringify(pedidos, null, 2));
      if (process.env["MODODEV_MODO"] === "chat") {
        writeFileSync(path.join(TMP, "lote.json"), JSON.stringify({ ts: Date.now(), total: lista.length, pedidos })); // trigger pro monitor do chat
        writeFileSync(path.join(TMP, "processing.lock"), JSON.stringify({ ts: Date.now(), total: lista.length })); // trava extensão até CLI responder
        console.log(`[modo-dev] (chat) lote de ${lista.length} prints salvo → injetando no terminal`);
        const txt = `lê os ${lista.length} prints que mandei: .modo-dev/lote/shot-1.png a shot-${lista.length}.png — pedidos em .modo-dev/lote/pedidos.json (campo n = número do print). aplica cada pedido nas anotações.`;
        void injetarNoTerminal(txt);
        return json({ ok: true, resposta: `📨 colei ${lista.length} prints no terminal do Claude — olha lá` });
      }
      const prompt = `Você é meu agente de dev neste projeto. Recebi ${lista.length} prints anotados em .modo-dev/lote/shot-1.png até shot-${lista.length}.png, e os pedidos em .modo-dev/lote/pedidos.json (campo n = número do print). Veja TODAS as imagens e aplique TODAS as mudanças no código real do projeto. Faça só o que as anotações/pedidos indicam, preserve o resto. Responda em poucas linhas o que mudou em cada arquivo.`;
      console.log(`[modo-dev] ${PROJETO} ← lote de ${lista.length}`);
      const t0 = Date.now();
      const resposta = await claudeDev(prompt, `lote de ${lista.length}`);
      console.log(`[modo-dev] ✓ lote (${Math.round((Date.now() - t0) / 1000)}s)`);
      return json({ ok: true, resposta });
    }
    return new Response("not found", { status: 404, headers: CORS });
  },
});

console.log(`[modo-dev] daemon no ar:  http://localhost:${PORTA}`);
console.log(`[modo-dev] editando:      ${PROJETO}`);
console.log(`[modo-dev] pegue o bookmarklet em http://localhost:${PORTA}`);
console.log(`[modo-dev] painel SSE:    GET http://localhost:${PORTA}/eventos`);
