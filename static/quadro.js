// Mesa: cartas de magia flutuantes sobre QUALQUER página, tipo janelas na área
// de trabalho. Singleton por página; as cartas abertas ficam no localStorage e
// reaparecem quando a pessoa muda de página (grimório ⇄ criador).
import { cartaHtml, cartaOficialHtml, cartaPoderHtml, cartaGenericaHtml } from "/carta.mjs";

const el = (tag, props = {}, ...filhos) => {
  const n = Object.assign(document.createElement(tag), props);
  n.append(...filhos.filter((f) => f != null));
  return n;
};

const LS = "cm_mesa";
export const TIPO_ARRASTO = "text/x-magia"; // dataTransfer: "o:<slug>", "p:<id>" ou "d:<slug>" (poder)
let mesa;

export function mesaGlobal() {
  if (mesa) return mesa;
  const raiz = el("div", { id: "mesa" });
  const barra = el("div", { className: "mesa-barra", hidden: true },
    el("span", { className: "mesa-conta" }),
    el("button", { className: "bt mini", textContent: "⊞ alinhar", title: "pôr as cartas lado a lado pra comparar", onclick: () => alinhar() }),
    el("button", { className: "bt mini", textContent: "✕ limpar", onclick: () => { for (const k of [...abertas.keys()]) fechar(k); } }));
  document.body.append(raiz, barra);
  let z = 1000; // acima da barra do hub (50), da gaveta (60) e de tudo mais
  const abertas = new Map();

  const salvar = () => {
    try {
      localStorage.setItem(LS, JSON.stringify([...abertas].map(([chave, c]) => ({
        chave, x: c.offsetLeft, y: c.offsetTop, w: c.style.width || undefined, h: c.style.height || undefined, min: c.classList.contains("q-min") || undefined,
      }))));
    } catch {}
    barra.hidden = !abertas.size;
    barra.querySelector(".mesa-conta").textContent = `${abertas.size} na mesa`;
  };
  const fechar = (chave) => { abertas.get(chave)?.remove(); abertas.delete(chave); salvar(); };
  const clamp = (v, max) => Math.max(0, Math.min(v, max));

  async function html(chave) {
    const [tipo, id] = [chave[0], chave.slice(2)];
    if (tipo === "p") {
      const m = await (await fetch(`/api/magia/${id.replace(/[^a-f0-9]/g, "")}`)).json();
      if (m.erro) throw new Error("despublicada");
      return cartaHtml(m, { total: m.pontos?.gasto ?? "?", orcamento: m.pontos?.orcamento ?? 10, valido: true })
       ;
    }
    // "c:<coleção>/<id>": ficha de qualquer coleção (bestiário, itens, regras, compêndio), corpo já pronto do servidor
    if (tipo === "c") {
      const [col, cid] = id.split("/");
      const t = await (await fetch(`/api/c/${col.replace(/[^\w-]/g, "")}/${(cid || "").replace(/[^\w-]/g, "")}`)).json();
      if (t.erro) throw new Error("sem texto");
      return cartaGenericaHtml(t);
    }
    const slug = id.replace(/[^\w-]/g, "");
    if (tipo === "d") {
      const d = await (await fetch(`/api/poder/${slug}`)).json();
      if (d.erro) throw new Error("sem texto");
      return cartaPoderHtml(d);
    }
    const t = await (await fetch(`/api/texto/${slug}`)).json();
    if (t.erro) throw new Error("sem texto");
    return cartaOficialHtml(t);
  }

  // lado a lado: distribui as cartas abertas em linhas, da esquerda pra direita
  function alinhar() {
    let x = 12, y = 60, altura = 0;
    for (const c of abertas.values()) {
      c.classList.remove("q-min");
      const w = c.offsetWidth + 12;
      if (x + w > innerWidth && x > 12) { x = 12; y += altura + 12; altura = 0; }
      c.style.left = x + "px"; c.style.top = y + "px";
      x += w; altura = Math.max(altura, c.offsetHeight);
    }
    salvar();
  }

  async function abrir(chave, pos) {
    if (abertas.has(chave)) {
      const c = abertas.get(chave);
      c.style.zIndex = ++z;
      c.classList.remove("q-pulso"); void c.offsetWidth; c.classList.add("q-pulso");
      return c;
    }
    const carta = el("article", { className: "carta quadro-carta" });
    carta.innerHTML = "<h2>…</h2>";
    const botoes = el("div", { className: "q-botoes" },
      el("button", { className: "q-fechar", textContent: "–", title: "minimizar (2 cliques no título restaura)", onclick: () => { carta.classList.toggle("q-min"); if (carta.classList.contains("q-min")) carta.style.height = ""; salvar(); } }),
      el("button", { className: "q-fechar", textContent: "✕", title: "fechar (Esc)", onclick: () => fechar(chave) }));
    carta.append(botoes);
    if (pos?.w) carta.style.width = pos.w;
    if (pos?.h) carta.style.height = pos.h;
    if (pos?.min) carta.classList.add("q-min");
    const n = abertas.size;
    const w = Math.min(430, innerWidth * .92);
    carta.style.left = clamp(pos?.x ?? 40 + (n % 5) * 70, innerWidth - w) + "px";
    carta.style.top = clamp(pos?.y ?? 70 + (n % 4) * 56, innerHeight - 120) + "px";
    carta.style.zIndex = ++z;

    // arrastar pelo título (fora do miolo, botões e links)
    carta.addEventListener("pointerup", () => salvar());
    carta.addEventListener("pointerdown", (e) => {
      carta.style.zIndex = ++z;
      if (e.target.closest(".miolo, button, a")) return;
      const r = carta.getBoundingClientRect();
      if (r.right - e.clientX < 20 && r.bottom - e.clientY < 20) return; // alça de redimensionar (CSS resize)
      e.preventDefault();
      const dx = e.clientX - r.left, dy = e.clientY - r.top;
      carta.setPointerCapture(e.pointerId);
      carta.classList.add("q-arrastando");
      const mover = (ev) => {
        carta.style.left = clamp(ev.clientX - dx, innerWidth - r.width) + "px";
        carta.style.top = clamp(ev.clientY - dy, innerHeight - 60) + "px";
      };
      const soltar = () => {
        carta.classList.remove("q-arrastando");
        carta.removeEventListener("pointermove", mover);
        carta.removeEventListener("pointerup", soltar);
        salvar();
      };
      carta.addEventListener("pointermove", mover);
      carta.addEventListener("pointerup", soltar);
    });

    // 2 cliques no título: restaura tamanho e desminimiza
    carta.addEventListener("dblclick", (e) => { if (!e.target.closest(".miolo, button, a")) { carta.classList.remove("q-min"); carta.style.width = carta.style.height = ""; salvar(); } });
    raiz.append(carta);
    abertas.set(chave, carta);
    salvar();
    try {
      carta.innerHTML = await html(chave);
      carta.append(botoes);
    } catch (e) {
      carta.querySelector("h2").textContent = e.message === "despublicada" ? "magia despublicada" : "texto não disponível";
    }
    return carta;
  }

  // soltar uma magia arrastada da lista em qualquer lugar da página
  document.addEventListener("dragover", (e) => { if (e.dataTransfer.types.includes(TIPO_ARRASTO)) e.preventDefault(); });
  document.addEventListener("drop", (e) => {
    const chave = e.dataTransfer.getData(TIPO_ARRASTO);
    if (!chave) return;
    e.preventDefault();
    abrir(chave, { x: e.clientX - 60, y: e.clientY - 20 });
  });
  // Esc fecha a carta de cima
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || !abertas.size || e.target.closest("input, textarea, [contenteditable]")) return;
    const topo = [...abertas].sort((a, b) => +b[1].style.zIndex - +a[1].style.zIndex)[0];
    fechar(topo[0]);
  });

  try { for (const c of JSON.parse(localStorage.getItem(LS) || "[]")) abrir(c.chave, c); } catch {}

  return (mesa = { abrir, fechar, abertas });
}
