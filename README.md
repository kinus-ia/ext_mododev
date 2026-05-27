# modo-dev

Anota na tela do navegador (caixa, seta, texto) → clica **Enviar** na extensão → o texto aparece sozinho no input do **Claude Code CLI** já com o caminho do print + pedido. O Claude lê o png e edita o código do projeto.

Sem `claude -p` headless, sem fila, sem espera. 3 segundos entre clicar Enviar e o Claude começar a trabalhar.

---

## Pré-requisitos

- macOS (a injeção no terminal usa `osascript`)
- [Bun](https://bun.sh) — `curl -fsSL https://bun.sh/install | bash`
- [Claude Code CLI](https://docs.claude.com/claude-code) — `claude` no PATH
- Google Chrome

---

## Instalação

```bash
git clone git@github.com:kinus-ia/ext_mododev.git ~/Documents/Kinus/modo-dev
cd ~/Documents/Kinus/modo-dev

# 1) Comando `modo-dev` no PATH
ln -sf "$PWD/bin/modo-dev" ~/.local/bin/modo-dev   # garanta que ~/.local/bin tá no PATH

# 2) Extensão Chrome
# Abra chrome://extensions → ative "Modo desenvolvedor" → "Carregar sem compactação"
# → aponte pra ~/Documents/Kinus/modo-dev/extension
```

**Permissão de Acessibilidade (uma vez só):**
System Settings → Privacy & Security → Accessibility → habilite **Terminal** (ou iTerm2 / Warp / etc., dependendo do que vc usa). Sem isso o `osascript` não consegue colar texto no terminal.

---

## Uso, por projeto

**Terminal A — daemon:**
```bash
cd ~/Documents/Kinus/meu-projeto
modo-dev
```
O daemon sobe na porta 4747 apontado pro cwd. Deixa essa janela aberta — é o coração da coisa.

**Terminal B — Claude Code:**
```bash
cd ~/Documents/Kinus/meu-projeto
claude --dangerously-skip-permissions
```
Tem que ser o **mesmo cwd** do daemon, senão os caminhos relativos (`.modo-dev/lote/shot-N.png`) não resolvem.

**Extensão Chrome:**
- Clica no ícone da extensão
- No campo "Aparece sozinho nestes sites" adiciona o URL do dev server (ex: `http://localhost:5173/*`, `http://localhost:3000/*`)
- Recarrega a aba

**No browser:**
- Anota na tela (caixa/seta/texto)
- Escreve o pedido no input do overlay (ou deixa vazio)
- Clica **Print** (entra no lote) → **Enviar**
- O texto aparece sozinho no Terminal B + o Claude começa a editar

---

## Variáveis de ambiente

| Variável | Default | Pra que serve |
|---|---|---|
| `MODODEV_MODO` | (vazio) | `chat` ativa o modo save+injetar (default no script `modo-dev`). Vazio = dispara `claude -p` headless (lento, evite). |
| `MODODEV_INJETAR` | `on` | `off` = não cola no terminal, só salva. Útil pra debug. |
| `MODODEV_TERM_APP` | `Terminal` | Nome do app que hospeda seu Claude CLI. Use `iTerm2`, `Warp`, `Hyper`, etc., conforme o caso. |
| `MODODEV_PORT` | `4747` | Porta do daemon. Mude se 4747 estiver ocupada. |

Exemplos:
```bash
MODODEV_TERM_APP=iTerm2 modo-dev          # quem usa iTerm2
MODODEV_INJETAR=off modo-dev              # save-only, vc fala "lê o print" manualmente
```

---

## Como funciona

```
┌──────────┐  POST /api/dev-lote  ┌────────┐  osascript    ┌────────────┐
│ Extensão │ ───────────────────▶ │ daemon │ ───────────▶  │ Terminal   │
│  Chrome  │  { img, msg }        │  4747  │  cmd+v        │ + Claude   │
└──────────┘                      └───┬────┘  + enter      │   CLI      │
                                      │                    └────────────┘
                                      ▼                          │
                              .modo-dev/lote/                    │ Read tool
                                shot-1.png                       │
                                pedidos.json   ◀─────────────────┘
```

1. Extensão captura a tela com html2canvas (anotações inclusas) e manda pra `http://localhost:4747/api/dev-lote`
2. Daemon salva `shot-N.png` + `pedidos.json` em `.modo-dev/lote/` (no cwd do daemon)
3. Daemon chama `osascript`: ativa o terminal config'do, cola um texto tipo `"lê os N prints que mandei: .modo-dev/lote/shot-1.png a shot-N.png — pedidos em .modo-dev/lote/pedidos.json"`, aperta Enter
4. Claude Code recebe esse input, usa Read tool pra ver os pngs + pedidos, e edita o código direto

---

## Estrutura

```
modo-dev/
├── bin/modo-dev          # script de inicialização (cwd + env vars)
├── daemon.ts             # servidor HTTP/SSE em 4747, salva print + injeta
├── overlay.js            # versão standalone via bookmarklet (alternativa à extensão)
└── extension/            # Chrome extension MV3
    ├── manifest.json
    ├── background.js     # registra content scripts nos sites configurados
    ├── popup.html / .js  # config de porta + lista de sites
    ├── painel.html / .js # side_panel — mostra eventos SSE (opcional, modo non-chat)
    ├── overlay.js        # barra flutuante + html2canvas + envio do print
    └── html2canvas.min.js
```

---

## Troubleshooting

**"Failed to fetch" no overlay** — daemon não tá rodando. Sobe com `modo-dev` no projeto.

**Texto não cola no terminal** — falta permissão de Acessibilidade. System Settings → Privacy → Accessibility → habilita seu terminal.

**Cola no app errado** — `MODODEV_TERM_APP` tá apontado pra outro app. Confere com `ps -p $(pgrep claude) -o ppid=` e use o nome do app.

**Porta 4747 ocupada** — `pkill -f modo-dev/daemon.ts` ou `MODODEV_PORT=4748 modo-dev`.

**Quero rodar sem terminal cola** — `MODODEV_INJETAR=off modo-dev`. Aí vc anota, envia, e diz no chat do Claude `"lê o print"`. Eu leio direto do disco.

---

## Licença

Uso interno Kinus.
