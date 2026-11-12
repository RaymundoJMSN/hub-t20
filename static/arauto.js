// Arauto no site: a conversa com a mesma IA que responde no Papinho (o cérebro mora no servidor: lib/arauto.mjs).
// A resposta chega em eventos: primeiro o andamento ("🔎 procurando em poderes…"), depois o texto pronto.
// A conversa fica no aparelho (localStorage) e os últimos turnos vão junto em cada pergunta, pra ele lembrar do assunto.
import { el, aoSair } from "/hub.js";
import { mesaGlobal } from "/quadro.js";
import { md } from "/md.mjs";

const LS = "hub-arauto";
const EXEMPLOS = [
  "Quero um personagem focado em ser veloz: que raças e poderes me dão mais movimentação?",
  "Quais poderes melhoram a investida, e quem pode pegar cada um?",
  "O que um anão guerreiro de 3º nível pode pegar pra aguentar mais dano?",
  "O que Marah concede aos devotos e quem pode ser devoto dela?",
];
const caixa = document.querySelector("#a-conversa"), form = document.querySelector("#a-form"), campo = document.querySelector("#a-pergunta"), botao = document.querySelector("#a-enviar");
let conversa = [];
try { conversa = JSON.parse(localStorage.getItem(LS) || "[]").slice(-40); } catch {}
const guardar = () => { try { localStorage.setItem(LS, JSON.stringify(conversa.slice(-40))); } catch {} };
let emCurso = null; // AbortController da pergunta no ar

function bolha(m) {
  const b = el("div", { className: "a-msg a-" + m.de + (m.erro ? " a-erro" : "") });
  if (m.de === "arauto") b.innerHTML = md(m.texto); else b.textContent = m.texto;
  return b;
}
function desenhar() {
  caixa.replaceChildren(...(conversa.length ? conversa.map(bolha) : [el("div", { className: "a-vazio" },
    el("p", { textContent: "Pergunte qualquer coisa de Tormenta 20. Alguns exemplos:" }),
    ...EXEMPLOS.map((t) => el("button", { type: "button", className: "chip a-exemplo", textContent: t, onclick: () => perguntar(t) })))]));
  caixa.scrollTop = caixa.scrollHeight;
}
// nome sublinhado na resposta = item do acervo: abre a carta na mesa em vez de trocar de página
caixa.addEventListener("click", (e) => { const a = e.target.closest("a[data-carta]"); if (a) { e.preventDefault(); mesaGlobal().abrir(a.dataset.carta); } });

async function perguntar(texto) {
  texto = String(texto || "").trim();
  if (!texto || emCurso) return;
  const historico = conversa.filter((m) => !m.erro).slice(-8).map(({ de, texto }) => ({ de, texto }));
  conversa.push({ de: "eu", texto });
  desenhar();
  const espera = el("div", { className: "a-msg a-arauto a-espera" }, el("span", { className: "a-status", textContent: "🪶 o Arauto está pensando…" }));
  caixa.append(espera); caixa.scrollTop = caixa.scrollHeight;
  campo.value = ""; botao.disabled = true;
  emCurso = new AbortController();
  let fim = null;
  try {
    const r = await fetch("/api/arauto", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ pergunta: texto, historico }), signal: emCurso.signal });
    if (r.status === 401) { location.href = "/login?voltar=/arauto"; return; }
    if (!r.ok || !r.body) throw new Error("http " + r.status);
    // text/event-stream lido na mão (EventSource só faz GET): blocos separados por linha em branco
    const leitor = r.body.getReader(), dec = new TextDecoder();
    let resto = "";
    for (;;) {
      const { value, done } = await leitor.read();
      if (done) break;
      resto += dec.decode(value, { stream: true });
      const blocos = resto.split("\n\n");
      resto = blocos.pop();
      for (const bl of blocos) {
        const tipo = bl.match(/^event: (.+)$/m)?.[1], dado = bl.match(/^data: (.+)$/m)?.[1];
        if (!tipo || !dado) continue;
        const v = JSON.parse(dado);
        if (tipo === "status") espera.querySelector(".a-status").textContent = v;
        if (tipo === "fim") fim = v;
      }
    }
    if (!fim) throw new Error("resposta incompleta");
    conversa.push({ de: "arauto", texto: fim.resposta, erro: fim.erro || undefined });
  } catch (e) {
    if (e.name === "AbortError") return; // saiu da página
    conversa.push({ de: "arauto", texto: "Não consegui falar com o Arauto agora. Tente de novo em instantes.", erro: "rede" });
  } finally {
    emCurso = null; botao.disabled = false;
  }
  guardar(); desenhar(); campo.focus();
}

form.addEventListener("submit", (e) => { e.preventDefault(); perguntar(campo.value); });
campo.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); perguntar(campo.value); } });
document.querySelector("#a-nova").addEventListener("click", () => { if (emCurso) return; conversa = []; guardar(); desenhar(); campo.focus(); });
aoSair(() => emCurso?.abort()); // o roteador troca de página sem recarregar: a pergunta no ar morre junto

desenhar();
// veio da busca do topo ("perguntar ao Arauto: …"): já pergunta
const q = new URLSearchParams(location.search).get("q");
if (q) { history.replaceState(null, "", "/arauto"); perguntar(q); } else campo.focus();
