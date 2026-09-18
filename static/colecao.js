// colecao.js — navegador genérico de coleções (bestiário, itens, regras, compêndio): mesma UX do grimório.
// Cada aba = uma coleção de /api/c/<nome>; chips vêm de meta.filtros; clicar/arrastar põe a ficha na mesa (quadro.js).
import { mesaGlobal, TIPO_ARRASTO } from "/quadro.js";
import { el, PAGINAS_COL, paginaDaColecao } from "/hub.js";

const rota = location.pathname.match(/^\/c\/([\w-]+)\/([\w-]+)/);
const caminho = rota ? paginaDaColecao(rota[1]) : location.pathname;
const pagina = PAGINAS_COL[caminho] || PAGINAS_COL["/bestiario"];
document.querySelector("#titulo").textContent = pagina.titulo;
document.querySelector("#sub").textContent = pagina.sub;
document.title = `${pagina.titulo} — Hub T20`;

const raiz = document.querySelector("#c-pagina");
const mesa = mesaGlobal();
const params = new URLSearchParams(location.search);
const filtro = { aba: rota?.[1] || params.get("aba") || pagina.abas[0][0], q: params.get("q") || "", sel: {}, ord: params.get("ord") ?? null };
if (!pagina.abas.some(([c]) => c === filtro.aba)) filtro.aba = pagina.abas[0][0];
let META = { filtros: [], ordem: {} }, ITENS = [], buscaTimer;

const busca = el("input", { type: "search", className: "g-busca", value: filtro.q, autocomplete: "off", placeholder: "pesquisar por nome ou texto…",
  oninput: (e) => { filtro.q = e.target.value; clearTimeout(buscaTimer); buscaTimer = setTimeout(buscar, 300); } });
const barraAbas = el("div", { className: "g-abas" });
const boxFiltros = el("div", { className: "g-filtros" });
const conta = el("div", { className: "explica" });
const ordem = el("select", { className: "g-ordem", title: "agrupar por", onchange: (e) => { filtro.ord = e.target.value; render(); } });
const lista = el("div", { className: "grimorio-lista" });
raiz.append(barraAbas, busca, boxFiltros, el("div", { className: "g-conta-linha" }, conta, ordem), lista);

for (const [col, rot] of pagina.abas) {
  const b = el("button", { type: "button", className: "chip g-aba", textContent: rot, onclick: () => { if (filtro.aba !== col) { filtro.aba = col; filtro.sel = {}; filtro.ord = null; trocarAba(); } } });
  b.dataset.col = col;
  barraAbas.append(b);
}
if (pagina.abas.length === 1) barraAbas.hidden = true;

function gravarUrl() {
  const ps = new URLSearchParams();
  if (filtro.aba !== pagina.abas[0][0]) ps.set("aba", filtro.aba);
  if (filtro.q.trim()) ps.set("q", filtro.q.trim());
  for (const [k, v] of Object.entries(filtro.sel)) if (v.size) ps.set(k, [...v].join(","));
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
// chips por filtro da meta (valores na ordem da meta); lista longa (>28 valores) vira dropdown
function montarFiltros() {
  boxFiltros.replaceChildren();
  for (const f of META.filtros || []) {
    const valores = (META.ordem?.[f.k] || []).filter(Boolean);
    if (!valores.length) continue;
    filtro.sel[f.k] = filtro.sel[f.k] || new Set((params.get(f.k) || "").split(",").filter(Boolean));
    params.delete(f.k); // só na primeira montagem
    const sel = filtro.sel[f.k];
    if (valores.length > 28) {
      const s = el("select", { className: "g-sel" + (sel.size ? " on" : ""), title: "filtrar por " + f.rotulo,
        onchange: (e) => { filtro.sel[f.k] = new Set(e.target.value ? [e.target.value] : []); s.classList.toggle("on", !!e.target.value); render(); } },
        el("option", { value: "", textContent: f.rotulo + ": tudo" }), ...valores.map((v) => el("option", { value: v, textContent: v, selected: sel.has(v) })));
      boxFiltros.append(el("div", { className: "g-selects" }, s));
      continue;
    }
    const box = el("div", { className: "chips" }, el("span", { className: "chips-rotulo", textContent: f.rotulo }));
    for (const v of valores) {
      const b = el("button", { type: "button", className: "chip" + (sel.has(v) ? " on" : ""), textContent: v,
        onclick: () => { sel.has(v) ? sel.delete(v) : sel.add(v); b.classList.toggle("on", sel.has(v)); render(); } });
      box.append(b);
    }
    boxFiltros.append(box);
  }
  const ords = [["", "por nome"], ...(META.filtros || []).map((f) => [f.k, "por " + f.rotulo])];
  if (filtro.ord === null || !ords.some(([k]) => k === filtro.ord)) filtro.ord = (META.filtros?.[0]?.k) || ""; // padrão: agrupar pelo 1º filtro (ND, categoria…)
  ordem.replaceChildren(...ords.map(([v, t]) => el("option", { value: v, textContent: t, selected: v === filtro.ord })));
}
// valor multi ("magia|itens") casa se qualquer parte estiver selecionada
const passa = (it) => Object.entries(filtro.sel).every(([k, sel]) => !sel.size || String(it.f?.[k] ?? "").split("|").some((v) => sel.has(v)));
const posicao = (k, v) => { const i = (META.ordem?.[k] || []).indexOf(v); return i < 0 ? 999 : i; };
const badge = (it) => { const k = META.filtros?.[0]?.k; const v = k && String(it.f?.[k] ?? ""); return v && v.length <= 4 ? v : ""; };

function render() {
  gravarUrl();
  lista.replaceChildren();
  const itens = ITENS.filter(passa);
  const k = filtro.ord;
  const chave = (it) => String(it.f?.[k] ?? "").split("|")[0];
  itens.sort((a, b) => k ? posicao(k, chave(a)) - posicao(k, chave(b)) || a.nome.localeCompare(b.nome) : a.nome.localeCompare(b.nome));
  conta.textContent = `${itens.length} ${itens.length === 1 ? "ficha" : "fichas"} · clique ou arraste pra pôr na mesa`;
  if (!itens.length) return lista.append(el("div", { className: "vazio", textContent: "nada com esses filtros." }));
  let grupo = null;
  for (const it of itens) {
    const g = k ? chave(it) || "—" : null;
    if (g !== null && g !== grupo) { grupo = g; lista.append(el("h2", { className: "g-grupo", textContent: g })); }
    const ch = `c:${filtro.aba}/${it.id}`;
    lista.append(el("div", { className: "card", draggable: true, title: "clique ou arraste pra pôr na mesa",
      onclick: () => mesa.abrir(ch), ondragstart: (e) => { e.dataTransfer.setData(TIPO_ARRASTO, ch); e.dataTransfer.effectAllowed = "copy"; } },
      el("span", { className: "circ", textContent: badge(it) }),
      el("h3", { textContent: it.nome }),
      el("div", { className: "meta", textContent: it.linha || "" })));
  }
}

trocarAba().then(() => { if (rota) mesa.abrir(`c:${rota[1]}/${rota[2]}`); });
document.addEventListener("keydown", (e) => {
  if (e.key === "/" && !e.target.closest("input, textarea, [contenteditable]")) { e.preventDefault(); busca.focus(); busca.select(); }
});
