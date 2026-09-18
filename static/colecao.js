// colecao.js — navegador genérico de coleções (bestiário, itens, regras, compêndio): mesma UX do grimório.
// Cada aba = uma coleção de /api/c/<nome>. Os filtros vêm de meta.filtros e cada um tem a cara que faz sentido:
//   tipo "faixa" (ND, nível) = barra de dois cursores; poucos valores = chips; muitos valores = select.
// meta.modo "acordeao" (STR): lista fechada de perguntas, abre pra ler a resposta — nada de popup.
// Clicar/arrastar um card põe a ficha na mesa (quadro.js). O roteador roda este módulo de novo a cada visita.
import { mesaGlobal, TIPO_ARRASTO } from "/quadro.js";
import { el, PAGINAS_COL, paginaDaColecao, capitalizar, aoSair } from "/hub.js";

const rota = location.pathname.match(/^\/c\/([\w-]+)\/([\w-]+)/);
const caminho = rota ? paginaDaColecao(rota[1]) : location.pathname;
const pagina = PAGINAS_COL[caminho] || PAGINAS_COL["/bestiario"];
document.querySelector("#titulo").textContent = pagina.titulo;
document.querySelector("#sub").textContent = pagina.sub;
document.title = `${pagina.titulo} — Hub T20`;

const raiz = document.querySelector("#c-pagina");
const mesa = mesaGlobal();
const params = new URLSearchParams(location.search);
const filtro = { aba: rota?.[1] || params.get("aba") || pagina.abas[0][0], q: params.get("q") || "", sel: {}, faixa: {}, ord: params.get("ord") ?? null };
if (!pagina.abas.some(([c]) => c === filtro.aba)) filtro.aba = pagina.abas[0][0];
let META = { filtros: [], ordem: {} }, ITENS = [], buscaTimer;
const MAX_CHIPS = 12;

const busca = el("input", { type: "search", className: "g-busca", value: filtro.q, autocomplete: "off", placeholder: "Pesquisar por nome ou texto…",
  oninput: (e) => { filtro.q = e.target.value; clearTimeout(buscaTimer); buscaTimer = setTimeout(buscar, 300); } });
const barraAbas = el("div", { className: "g-abas" });
const boxFiltros = el("div", { className: "g-filtros" });
const conta = el("div", { className: "explica" });
const ordem = el("select", { className: "g-ordem", title: "agrupar por", onchange: (e) => { filtro.ord = e.target.value; render(); } });
const lista = el("div", { className: "grimorio-lista" });
raiz.append(barraAbas, busca, boxFiltros, el("div", { className: "g-conta-linha" }, conta, ordem), lista);

for (const [col, rot] of pagina.abas) {
  const b = el("button", { type: "button", className: "chip g-aba", textContent: capitalizar(rot), onclick: () => { if (filtro.aba !== col) { filtro.aba = col; filtro.sel = {}; filtro.faixa = {}; filtro.ord = null; trocarAba(); } } });
  b.dataset.col = col;
  barraAbas.append(b);
}
if (pagina.abas.length === 1) barraAbas.hidden = true;

const valoresDe = (k) => (META.ordem?.[k] || []).filter(Boolean);
const posicao = (k, v) => { const i = (META.ordem?.[k] || []).indexOf(v); return i < 0 ? 999 : i; };
function gravarUrl() {
  const ps = new URLSearchParams();
  if (filtro.aba !== pagina.abas[0][0]) ps.set("aba", filtro.aba);
  if (filtro.q.trim()) ps.set("q", filtro.q.trim());
  for (const [k, v] of Object.entries(filtro.sel)) if (v.size) ps.set(k, [...v].join(","));
  for (const [k, [a, b]] of Object.entries(filtro.faixa)) { const vs = valoresDe(k); if (a > 0 || b < vs.length - 1) ps.set(k, `${vs[a]}..${vs[b]}`); }
  if (filtro.ord) ps.set("ord", filtro.ord);
  history.replaceState(null, "", caminho + (ps.size ? "?" + ps : ""));
}
async function trocarAba() {
  for (const b of barraAbas.children) b.classList.toggle("on", b.dataset.col === filtro.aba);
  await buscar();
}
async function buscar() {
  const q = filtro.q.trim();
  try {
    const r = await (await fetch(`/api/c/${filtro.aba}${q ? "?q=" + encodeURIComponent(q) : ""}`)).json();
    if (r.erro) throw new Error(r.erro);
    META = r.meta; ITENS = r.itens;
  } catch (e) { META = { filtros: [], ordem: {} }; ITENS = []; conta.textContent = e.message; }
  montarFiltros();
  render();
}

// ---- filtros: faixa (dois cursores) · chips (multi) · select (um valor); o rótulo do grupo fica à esquerda
function faixa(f, valores) {
  const n = valores.length - 1;
  let ini = [0, n];
  const url = params.get(f.k); params.delete(f.k);
  if (url?.includes("..")) { const [a, b] = url.split(".."); const ia = valores.indexOf(a), ib = valores.indexOf(b); if (ia >= 0 && ib >= 0) ini = [ia, ib]; }
  filtro.faixa[f.k] = filtro.faixa[f.k] || ini;
  const lo = el("input", { type: "range", min: 0, max: n, value: filtro.faixa[f.k][0], step: 1 });
  const hi = el("input", { type: "range", min: 0, max: n, value: filtro.faixa[f.k][1], step: 1 });
  const txt = el("span", { className: "faixa-txt" });
  const trilho = el("div", { className: "faixa-trilho" }, el("div", { className: "faixa-fundo" }), el("div", { className: "faixa-sel" }), lo, hi);
  const box = el("div", { className: "filtro faixa" }, el("span", { className: "chips-rotulo", textContent: f.rotulo }), trilho, txt);
  const atualizar = (render_ = true) => {
    let a = +lo.value, b = +hi.value;
    if (a > b) [a, b] = [b, a];
    filtro.faixa[f.k] = [a, b];
    const tudo = a === 0 && b === n;
    txt.textContent = tudo ? "Tudo" : a === b ? valores[a] : `${valores[a]} – ${valores[b]}`;
    box.classList.toggle("on", !tudo);
    trilho.querySelector(".faixa-sel").style.cssText = `left:${(a / n) * 100}%;right:${100 - (b / n) * 100}%`;
    if (render_) render();
  };
  lo.oninput = hi.oninput = () => atualizar();
  atualizar(false);
  return box;
}
function chips(f, valores) {
  const sel = filtro.sel[f.k];
  const box = el("div", { className: "filtro chips" }, el("span", { className: "chips-rotulo", textContent: f.rotulo }));
  for (const v of valores) {
    const b = el("button", { type: "button", className: "chip" + (sel.has(v) ? " on" : ""), textContent: capitalizar(v),
      onclick: () => { sel.has(v) ? sel.delete(v) : sel.add(v); b.classList.toggle("on", sel.has(v)); render(); } });
    box.append(b);
  }
  return box;
}
function seletor(f, valores) {
  const sel = filtro.sel[f.k];
  const s = el("select", { className: "g-sel" + (sel.size ? " on" : ""), title: "filtrar por " + f.rotulo,
    onchange: (e) => { filtro.sel[f.k] = new Set(e.target.value ? [e.target.value] : []); s.classList.toggle("on", !!e.target.value); render(); } },
    el("option", { value: "", textContent: "Tudo" }), ...valores.map((v) => el("option", { value: v, textContent: capitalizar(v), selected: sel.has(v) })));
  return el("div", { className: "filtro select" }, el("span", { className: "chips-rotulo", textContent: f.rotulo }), s);
}
function montarFiltros() {
  boxFiltros.replaceChildren();
  for (const f of META.filtros || []) {
    const valores = valoresDe(f.k);
    if (!valores.length) continue;
    if (f.tipo === "faixa" && valores.length > 2) { boxFiltros.append(faixa(f, valores)); continue; }
    filtro.sel[f.k] = filtro.sel[f.k] || new Set((params.get(f.k) || "").split(",").filter(Boolean));
    params.delete(f.k); // só na primeira montagem
    const tipo = f.tipo === "chips" || f.tipo === "select" ? f.tipo : valores.length > MAX_CHIPS ? "select" : "chips";
    boxFiltros.append(tipo === "select" ? seletor(f, valores) : chips(f, valores));
  }
  const ords = [["", "Por nome"], ...(META.filtros || []).map((f) => [f.k, "Por " + f.rotulo])];
  if (filtro.ord === null) filtro.ord = META.ordemPadrao ?? (META.filtros?.[0]?.k || "");
  if (!ords.some(([k]) => k === filtro.ord)) filtro.ord = "";
  ordem.replaceChildren(...ords.map(([v, t]) => el("option", { value: v, textContent: t, selected: v === filtro.ord })));
  ordem.hidden = META.modo === "acordeao";
}
// valor multi ("magia|itens") casa se qualquer parte estiver selecionada; faixa só filtra quem tem valor
const passa = (it) =>
  Object.entries(filtro.sel).every(([k, sel]) => !sel.size || String(it.f?.[k] ?? "").split("|").some((v) => sel.has(v))) &&
  Object.entries(filtro.faixa).every(([k, [a, b]]) => { const v = String(it.f?.[k] ?? ""); if (!v) return true; const i = posicao(k, v); return i >= a && i <= b; });
const badge = (it) => { const k = META.filtros?.[0]?.k; const v = k && String(it.f?.[k] ?? ""); return v && v.length <= 4 ? v : ""; };

function render() {
  gravarUrl();
  lista.replaceChildren();
  const itens = ITENS.filter(passa);
  const k = filtro.ord;
  const chave = (it) => String(it.f?.[k] ?? "").split("|")[0];
  if (k) itens.sort((a, b) => posicao(k, chave(a)) - posicao(k, chave(b)) || a.nome.localeCompare(b.nome));
  else if (META.modo !== "acordeao") itens.sort((a, b) => a.nome.localeCompare(b.nome));
  const acordeao = META.modo === "acordeao";
  conta.textContent = `${itens.length} ${itens.length === 1 ? (acordeao ? "resposta" : "ficha") : (acordeao ? "respostas" : "fichas")}` + (acordeao ? " · clique numa pergunta pra ler" : " · clique ou arraste pra pôr na mesa");
  lista.classList.toggle("lista-acordeao", acordeao);
  if (!itens.length) return lista.append(el("div", { className: "vazio", textContent: "nada com esses filtros." }));
  let grupo = null;
  for (const it of itens) {
    const g = k ? chave(it) || "—" : null;
    if (g !== null && g !== grupo) { grupo = g; lista.append(el("h2", { className: "g-grupo", textContent: capitalizar(g) })); }
    if (acordeao) {
      const tags = String(it.f?.tags || "").split("|").filter(Boolean);
      const corpo = el("div", { className: "acord-corpo" });
      const d = el("details", { className: "acordeao" },
        el("summary", {}, el("div", { className: "acord-topo" }, ...tags.map((t) => el("span", { className: "acord-tag", textContent: capitalizar(t) })), el("span", { className: "acord-linha", textContent: it.linha || "" })),
          el("div", { className: "acord-perg", textContent: it.nome })), corpo);
      d.addEventListener("toggle", async () => {
        if (!d.open || d.dataset.ok) return;
        d.dataset.ok = "1";
        try { const t = await (await fetch(`/api/c/${filtro.aba}/${it.id}`)).json(); corpo.innerHTML = t.html || "…"; } catch { corpo.textContent = "não deu pra carregar"; }
      });
      lista.append(d);
      continue;
    }
    const ch = `c:${filtro.aba}/${it.id}`;
    lista.append(el("div", { className: "card", draggable: true, title: "clique ou arraste pra pôr na mesa",
      onclick: () => mesa.abrir(ch), ondragstart: (e) => { e.dataTransfer.setData(TIPO_ARRASTO, ch); e.dataTransfer.effectAllowed = "copy"; } },
      el("span", { className: "circ", textContent: badge(it) }),
      el("h3", { textContent: it.nome }),
      el("div", { className: "meta", textContent: it.linha || "" })));
  }
}

trocarAba().then(() => { if (rota) mesa.abrir(`c:${rota[1]}/${rota[2]}`); });
const atalho = (e) => { if (e.key === "/" && !e.target.closest("input, textarea, [contenteditable]")) { e.preventDefault(); busca.focus(); busca.select(); } };
document.addEventListener("keydown", atalho);
aoSair(() => document.removeEventListener("keydown", atalho));
