// tools/importar.mjs — monta dados/colecoes/*.json (fora do git: texto da Jambo) a partir de
//   • arsenal (github.com/nicholemos/arsenal): ameaças, itens, STR, breves jornadas, perigos, distinções, parceiros
//   • tormenta-livros/livros (markdown dos 5 livros): regras, raças, classes, origens, deuses
// Uso: node tools/importar.mjs [--arsenal ../arsenal] [--livros ../tormenta-livros/livros] [--missoes ../guilda-mineradores]
// Cada coleção = { meta:{titulo, filtros:[{k,rotulo}], ordem:{k:[valores]}}, itens:[{id,nome,linha,grupo,f:{},t,html}] }
//   t = texto pesquisável já normalizado (sem acento, minúsculo); html = corpo já sanitizado (o servidor confia).
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const RAIZ = dirname(dirname(fileURLToPath(import.meta.url)));
const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const ARSENAL = arg("--arsenal", join(RAIZ, "..", "arsenal"));
const LIVROS = arg("--livros", join(RAIZ, "..", "tormenta-livros", "livros"));
const GUILDA = arg("--missoes", null);
const SAIDA = join(RAIZ, "dados", "colecoes");
mkdirSync(SAIDA, { recursive: true });

// ---------------------------------------------------------------- utilidades
export const norm = (s) => String(s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
export const slug = (s) => norm(s).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
export const esc = (s) => String(s ?? "").replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c]));
const soTexto = (html) => String(html ?? "").replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
const TAGS_OK = "b|strong|i|em|u|s|br|p|ul|ol|li|hr|table|thead|tbody|tr|td|th|span|div|sub|sup";
// whitelist de tags, zero atributos; <h6> vira <b>; script/style somem com conteúdo; a/img viram texto
export function limpar(html) {
  return String(html ?? "")
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<\/?h[1-6][^>]*>/gi, (m) => m.startsWith("</") ? "</b><br>" : "<b>")
    .replace(new RegExp(`<(?!\\/?(${TAGS_OK})\\b)[^>]*>`, "gi"), "")
    .replace(new RegExp(`<(\\/?)(${TAGS_OK})\\b[^>]*>`, "gi"), "<$1$2>")
    .replace(/(<br>\s*){3,}/g, "<br><br>").trim();
}
const inline = (s) => esc(s)
  .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
  .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
  .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>")
  .replace(/(^|[^*\w])\*([^*\n]+)\*(?!\w)/g, "$1<i>$2</i>")
  .replace(/(^|\s)_([^_\n]+)_(?=\s|[.,;:!?)]|$)/g, "$1<i>$2</i>")
  .replace(/`([^`]+)`/g, "<code>$1</code>");
// markdown mínimo (os livros são "markdown puro sem HTML"): títulos, parágrafos, listas, tabelas, hr, negrito/itálico
export function md(texto) {
  const linhas = String(texto).replace(/\r/g, "").split("\n");
  const out = []; let par = [], lista = null, tabela = null;
  const fechaPar = () => { if (par.length) { out.push(`<p>${inline(par.join(" "))}</p>`); par = []; } };
  const fechaLista = () => { if (lista) { out.push(`</${lista}>`); lista = null; } };
  const fechaTabela = () => { if (tabela) { out.push("</table>"); tabela = null; } };
  const fecha = () => { fechaPar(); fechaLista(); fechaTabela(); };
  for (const l of linhas) {
    const s = l.trim();
    if (!s) { fecha(); continue; }
    if (/^\[◂/.test(s) || /^---+$/.test(s) && !par.length && !tabela) { fecha(); if (/^---+$/.test(s)) out.push("<hr>"); continue; }
    const h = s.match(/^(#{1,6})\s+(.*)/);
    if (h) { fecha(); out.push(`<h4>${inline(limparTitulo(h[2]))}</h4>`); continue; }
    if (s.startsWith("|")) {
      if (/^\|[\s:|-]+\|$/.test(s)) continue; // separador
      fechaPar(); fechaLista();
      const cel = s.replace(/^\||\|$/g, "").split("|").map((c) => inline(c.trim()));
      if (!tabela) { tabela = true; out.push("<table>", `<tr>${cel.map((c) => `<th>${c}</th>`).join("")}</tr>`); }
      else out.push(`<tr>${cel.map((c) => `<td>${c}</td>`).join("")}</tr>`);
      continue;
    }
    fechaTabela();
    const li = s.match(/^([-*•]|\d+[.)])\s+(.*)/);
    if (li) {
      fechaPar();
      const tipo = /^\d/.test(li[1]) ? "ol" : "ul";
      if (lista !== tipo) { fechaLista(); lista = tipo; out.push(`<${tipo}>`); }
      out.push(`<li>${inline(li[2])}</li>`);
      continue;
    }
    fechaLista();
    par.push(s);
  }
  fecha();
  return out.join("");
}
const limparTitulo = (t) => String(t).replace(/^[^\p{L}\p{N}"'(]+/u, "").replace(/\s+/g, " ").trim();
// frontmatter (--- ... ---) → {title, ...}; devolve [meta, corpo sem o H1]
function frontmatter(src) {
  const m = src.match(/^---\n([\s\S]*?)\n---\n?/);
  const meta = {};
  if (m) for (const l of m[1].split("\n")) { const kv = l.match(/^(\w+):\s*"?(.*?)"?\s*$/); if (kv) meta[kv[1]] = kv[2]; }
  let corpo = m ? src.slice(m[0].length) : src;
  const h1 = corpo.match(/^#\s+(.*)$/m);
  if (h1) { meta.title = meta.title || h1[1]; corpo = corpo.slice(corpo.indexOf(h1[0]) + h1[0].length); }
  return [meta, corpo];
}
// seções por título (## … ######): cada uma com o texto até o PRÓXIMO título de qualquer nível
function secoes(corpo) {
  const out = []; const pilha = []; let atual = null;
  for (const l of corpo.replace(/\r/g, "").split("\n")) {
    const h = l.match(/^(#{2,6})\s+(.*)/);
    if (h) {
      const nivel = h[1].length, titulo = limparTitulo(h[2]);
      while (pilha.length && pilha[pilha.length - 1].nivel >= nivel) pilha.pop();
      atual = { nivel, titulo, pais: pilha.map((p) => p.titulo), linhas: [] };
      out.push(atual); pilha.push(atual);
    } else if (atual) atual.linhas.push(l);
  }
  return out.map((s) => ({ ...s, corpo: s.linhas.join("\n") })).filter((s) => soTexto(s.corpo).length > 20);
}
function lerMd(rel) { return readFileSync(join(LIVROS, rel), "utf-8"); }
const arquivosMd = (dir) => existsSync(join(LIVROS, dir)) ? readdirSync(join(LIVROS, dir)).filter((f) => f.endsWith(".md") && !/README|RELATORIO|CATALOG/i.test(f)).map((f) => `${dir}/${f}`) : [];

function evalVar(rel, nome, corte) {
  let src = readFileSync(join(ARSENAL, rel), "utf-8");
  if (corte) src = src.split(corte)[0];
  return vm.runInNewContext(src + `\n;${nome};`, { window: {}, document: {}, console, localStorage: { getItem() { return null; }, setItem() {} } });
}
const primeiraLista = (v) => Array.isArray(v) ? v : Object.values(v || {}).find(Array.isArray) || [];
const ROTULOS = { preco: "Preço", critico: "Crítico", espacos: "Espaços", tipo_dano: "Tipo de dano", empunhadura: "Empunhadura", alcance: "Alcance", dano: "Dano", defesa: "Defesa", penalidade: "Penalidade", tipo: "Tipo" };
const rotulo = (k) => ROTULOS[k] || k.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
// objeto qualquer → html genérico (usado em distinções/parceiros: campos variam por item)
function objetoHtml(o, pular = new Set()) {
  const partes = [];
  for (const [k, v] of Object.entries(o || {})) {
    if (pular.has(k) || v == null || v === "" || v === false) continue;
    if (typeof v === "string" || typeof v === "number") partes.push(`<div><b>${esc(rotulo(k))}:</b> ${limpar(String(v))}</div>`);
    else if (Array.isArray(v)) partes.push(`<div><b>${esc(rotulo(k))}:</b><ul>${v.map((x) => `<li>${typeof x === "object" ? objetoHtml(x) : limpar(String(x))}</li>`).join("")}</ul></div>`);
    else if (typeof v === "object") partes.push(`<div class="bloco"><b>${esc(v.name || v.nome || v.titulo || rotulo(k))}</b>${objetoHtml(v, new Set(["name", "nome", "titulo"]))}</div>`);
  }
  return partes.join("");
}
const contagem = {};
function gravar(nome, meta, itens) {
  const vistos = new Set();
  for (const it of itens) { let id = it.id, n = 2; while (vistos.has(id)) id = `${it.id}-${n++}`; vistos.add(id); it.id = id; }
  // ordem natural dos valores de cada filtro (na ordem em que aparecem), pra chips e agrupamento
  const ordem = {};
  for (const f of meta.filtros || []) {
    const vs = [];
    for (const it of itens) for (const v of String(it.f?.[f.k] ?? "").split("|")) if (v && !vs.includes(v)) vs.push(v);
    ordem[f.k] = meta.ordem?.[f.k] || vs;
  }
  writeFileSync(join(SAIDA, `${nome}.json`), JSON.stringify({ meta: { ...meta, ordem }, itens }));
  contagem[nome] = itens.length;
  console.log(`${nome.padEnd(12)} ${String(itens.length).padStart(5)} itens`);
}
const ficha = (o) => ({ ...o, t: norm([o.nome, o.linha, o.grupo, Object.values(o.f || {}).join(" "), soTexto(o.html)].join(" ")) });

// ---------------------------------------------------------------- AMEAÇAS (arsenal/ameacas)
const TAMANHOS = ["Minúsculo", "Pequeno", "Médio", "Grande", "Enorme", "Colossal"];
export const ndNum = (nd) => ({ "1/4": 0.25, "1/2": 0.5, S: 20.5, "S+": 21 }[nd] ?? (Number(nd) || 99));
const lista = (x) => x == null ? [] : Array.isArray(x) ? x.map((i) => typeof i === "string" ? i : [i.nome || i.name, i.bonus ?? i.valor, i.desc].filter((v) => v != null && v !== "").join(" ")) : [String(x)];
export function ameacaHtml(a) {
  const st = [["ND", a.nd], ["Iniciativa", a.iniciativa], ["Percepção", [a.percepcao, a.percepcaoObs && `(${a.percepcaoObs})`].filter(Boolean).join(" ")],
    ["Defesa", [a.defesa, a.defesaObs && `(${a.defesaObs})`].filter(Boolean).join(" ")], ["Fort", a.fort], ["Ref", a.ref], ["Von", a.von],
    ["PV", a.pv], ["PM", a.pm], ["Desl.", a.desl]].filter(([, v]) => v);
  const at = a.atributos || {};
  const atrib = ["for", "des", "con", "int", "sab", "car"].filter((k) => at[k] != null).map((k) => `<span><b>${k.toUpperCase()}</b> ${esc(at[k])}</span>`).join(" ");
  const ataques = (a.ataques || []).map((x) => `<div>• <b>${esc(x.nome)}</b>${x.tipo ? ` (${esc(x.tipo)})` : ""} ${esc(x.bonus || "")}${x.dano ? `, ${esc(x.dano)}` : ""}${x.desc ? ` — ${limpar(x.desc)}` : ""}</div>`).join("");
  const habs = [...(a.habilidades || []), ...(a.habilities || [])].map((x) => typeof x === "string" ? `<div>• ${limpar(x)}</div>` : `<div>• <b>${esc(x.nome)}</b>${x.tipo ? ` (${esc(x.tipo)})` : ""}${x.custo ? ` [${esc(x.custo)}]` : ""}: ${limpar(x.desc || "")}</div>`).join("");
  const extra = [["Perícias", lista(a.pericias).join(", ")], ["Equipamento", [lista(a.equipamento).join(", "), a.equipamentoObs].filter(Boolean).join(" ")], ["Tesouro", a.tesouro]]
    .filter(([, v]) => v).map(([k, v]) => `<div><b>${k}:</b> ${limpar(String(v))}</div>`).join("");
  const img = a.imagem || a.img;
  return (img && /^https?:\/\//.test(img) ? `<img class="a-img" src="${esc(img)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : "")
    + `<div class="stats">${st.map(([k, v]) => `<b>${k}:</b> ${esc(v)}`).join("; ")}</div>`
    + (atrib ? `<div class="atrib">${atrib}</div>` : "")
    + (ataques ? `<div class="bloco"><b>Ataques</b>${ataques}</div>` : "")
    + (habs ? `<div class="bloco"><b>Habilidades</b>${habs}</div>` : "")
    + extra + (a.observacao ? `<div class="obs">${limpar(a.observacao)}</div>` : "");
}
function ameacas() {
  const db = evalVar("ameacas/ameacas_db.js", "AMEACAS_DB");
  const itens = db.filter((a) => a.nome).map((a) => {
    const tipoStr = String(a.tipo || "").trim();
    const tamanho = TAMANHOS.find((t) => tipoStr.endsWith(t)) || "";
    const tipo = tipoStr.split(/\s+/)[0].replace(/[^\p{L}-]/gu, "") || "?";
    const nd = String(a.nd || "?").trim();
    return ficha({ id: slug(a.nome), nome: a.nome, linha: `${tipoStr} · ND ${nd} · ${a.fonte || ""}`, grupo: a.fonte || "?",
      f: { nd, tipo, tamanho, fonte: a.fonte || "?" }, ndn: ndNum(nd), html: ameacaHtml(a) });
  }).sort((a, b) => a.ndn - b.ndn || a.nome.localeCompare(b.nome));
  const nds = [...new Set(itens.map((i) => i.f.nd))].filter((v) => /^(\d+|1\/4|1\/2|S|S\+)$/.test(v)).sort((a, b) => ndNum(a) - ndNum(b)); // "-" e "?" ficam fora do slider
  gravar("ameacas", { titulo: "Bestiário", filtros: [{ k: "nd", rotulo: "ND", tipo: "faixa" }, { k: "tipo", rotulo: "tipo" }, { k: "tamanho", rotulo: "tamanho" }, { k: "fonte", rotulo: "livro" }], ordem: { nd: nds, tamanho: TAMANHOS } }, itens);
}

// ---------------------------------------------------------------- ITENS (arsenal/itens)
const ITENS = [["itens/data/armas.js", "armasData", "Armas"], ["itens/data/armaduras.js", "armadurasData", "Armaduras e escudos"],
  ["itens/data/itens.js", "itensData", "Itens gerais"], ["itens/data/itensmagicos.js", "itensMagicosData", "Itens mágicos"],
  ["itens/data/encantamentos.js", "enchantmentosData", "Encantamentos"], ["itens/data/modificacoes.js", "modificacoesData", "Modificações"],
  ["itens/data/maldicao.js", "maldicaoData", "Maldições"], ["itens/data/culinaria.js", "culinariaData", "Culinária"]];
const PULAR_ITEM = new Set(["nome", "descricao", "imagem", "categoria", "id", "img"]);
function itens() {
  const todos = [];
  for (const [rel, v, cat] of ITENS) {
    if (!existsSync(join(ARSENAL, rel))) continue;
    for (const it of primeiraLista(evalVar(rel, v))) {
      if (!it?.nome) continue;
      const stats = Object.entries(it).filter(([k, val]) => !PULAR_ITEM.has(k) && val != null && val !== "" && typeof val !== "object")
        .map(([k, val]) => `<b>${esc(rotulo(k))}:</b> ${esc(val)}`).join("; ");
      todos.push(ficha({ id: slug(`${cat}-${it.nome}`), nome: it.nome, linha: [cat, it.tipo, it.preco].filter(Boolean).join(" · "), grupo: cat,
        f: { categoria: cat, tipo: it.tipo || "" }, html: `${stats ? `<div class="stats">${stats}</div>` : ""}<div class="desc">${limpar(it.descricao || "")}</div>` }));
    }
  }
  gravar("itens", { titulo: "Itens", filtros: [{ k: "categoria", rotulo: "categoria" }, { k: "tipo", rotulo: "tipo" }] }, todos);
}

// ---------------------------------------------------------------- STR + BREVES JORNADAS (arsenal/STR)
function str() {
  const db = evalVar("STR/database.js", "DATABASE");
  const out = [];
  for (const ed of db) {
    const n = Number((ed.id || "").replace(/\D/g, "")) || 0;
    (ed.artigos || []).forEach((a, i) => {
      // o "nome" é a pergunta inteira: a lista é um acordeão (fechado, abre pra ler), como no arsenal
      const nome = soTexto(a.pergunta);
      out.push(ficha({ id: `${ed.id}-${i + 1}`, nome, linha: [ed.label, a.sistema, a.conselheiro].filter(Boolean).join(" · "), grupo: ed.label,
        f: { sistema: a.sistema || "?", tags: (a.tags || []).join("|"), edicao: n <= 182 ? "pré-JdA" : "Jogo do Ano" }, n,
        html: `<div class="perg">${limpar(a.pergunta)}</div><div class="resp">${limpar(a.resposta)}</div>` }));
    });
  }
  out.sort((a, b) => b.n - a.n);
  gravar("str", { titulo: "STR — Supremo Tribunal Regreiro", modo: "acordeao", ordemPadrao: "",
    filtros: [{ k: "sistema", rotulo: "sistema", tipo: "chips" }, { k: "tags", rotulo: "tema", tipo: "chips" }, { k: "edicao", rotulo: "edição", tipo: "chips" }] }, out);
  if (existsSync(join(ARSENAL, "STR/breves_jornadas.js"))) {
    const bj = evalVar("STR/breves_jornadas.js", "BJ_DATABASE").map((a) => ficha({ id: slug(`${a.db}-${a.titulo}`), nome: a.titulo, linha: `${a.db} · nível ${a.nivel}`, grupo: a.db,
      f: { nivel: String(a.nivel || "?"), db: a.db }, html: `<div class="desc">${limpar(a.resumo)}</div>` }));
    const niveis = [...new Set(bj.map((i) => i.f.nivel))].sort((a, b) => ndNum(a) - ndNum(b));
    gravar("aventuras", { titulo: "Breves Jornadas", filtros: [{ k: "nivel", rotulo: "nível", tipo: "faixa" }], ordem: { nivel: niveis } }, bj);
  }
}

// ---------------------------------------------------------------- PERIGOS (arsenal/perigos)
const imgHtml = (u) => (u && /^(https?:\/\/|\/)/.test(u) ? `<img class="a-img" src="${esc(u)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : "");
function perigos() {
  const out = [];
  for (const p of evalVar("perigos/perigos-diversos.js", "perigosDiversos"))
    out.push(ficha({ id: slug(`${p.categoria}-${p.nome}`), nome: p.nome, linha: [p.categoria, p.subcategoria, p.origem].filter(Boolean).join(" · "), grupo: p.categoria,
      f: { categoria: p.categoria || "?", tipo: p.subcategoria || "", origem: p.origem || "", nd: "" }, html: `${imgHtml(p.imagem)}<div class="desc">${limpar(p.descricao)}</div>${limpar(p.efeito)}` }));
  for (const p of evalVar("perigos/script.js", "perigos", "\nconst buscaInput"))
    out.push(ficha({ id: slug(`complexo-${p.nome}`), nome: p.nome, linha: ["Perigo complexo", p.tipo, p.nd && `ND ${p.nd}`, p.origem].filter(Boolean).join(" · "), grupo: "Perigos complexos",
      f: { categoria: "Perigos complexos", tipo: p.tipo || "", origem: p.origem || "", nd: String(p.nd || "") }, html: `${imgHtml(p.imagem)}${limpar(p.efeito)}` }));
  const nds = [...new Set(out.map((i) => i.f.nd).filter(Boolean))].sort((a, b) => ndNum(a) - ndNum(b));
  gravar("perigos", { titulo: "Perigos", filtros: [{ k: "categoria", rotulo: "categoria" }, { k: "tipo", rotulo: "tipo" }, { k: "nd", rotulo: "ND", tipo: "faixa" }, { k: "origem", rotulo: "origem" }], ordem: { nd: nds } }, out);
}
// galerias do arsenal (calculadora/racas.js): chassis de golem, heranças de suraggel, bênçãos de kallyanach… — cada uma com imagem
const GALERIAS = [["GOLEM_CHASSI", "golem", "Chassis"], ["GOLEM_FONTES", "golem", "Fontes de energia"], ["GOLEM_MARAVILHAS", "golem", "Maravilhas mecânicas"],
  ["SURAGEL_HERANCAS", "suraggel", "Heranças"], ["KALLYANACH_BENCAOS", "kallyanach", "Bênçãos"], ["ABERRANT_MUTATIONS", "aberrante", "Mutações"], ["KOBOLD_TALENTS", "kobold", "Talentos de bando"]];
function galeriasDeRacas(racas) {
  let consts;
  try { consts = evalVar("calculadora/racas.js", `({${GALERIAS.map(([c]) => c).join(",")}})`); } catch (e) { console.warn("galerias:", e.message); return; }
  for (const [c, raca, titulo] of GALERIAS) {
    const alvo = racas.find((r) => norm(r.nome).includes(raca));
    const itens = Object.entries(consts[c] || {});
    if (!alvo || !itens.length) continue;
    alvo.html += `<div class="bloco galeria"><b>${esc(titulo)}</b>${itens.map(([k, v]) => `<div class="galeria-item">${imgHtml(v.img)}<b>${esc(v.name || v.nome || k)}</b> ${limpar(v.description || v.desc || "")}</div>`).join("")}</div>`;
    alvo.t += " " + norm(itens.map(([k, v]) => `${v.name || v.nome || k} ${soTexto(v.description || v.desc || "")}`).join(" "));
  }
}

// ---------------------------------------------------------------- REGRAS (livros em markdown → uma ficha por seção)
const CAP_REGRAS = [
  ["Livro Básico", "tormenta20-core/07-regras-jogo/02-regras-testes.md"], ["Livro Básico", "tormenta20-core/07-regras-jogo/03-habilidades.md"],
  ["Livro Básico", "tormenta20-core/07-regras-jogo/04-tipos-efeitos-dano.md"], ["Livro Básico", "tormenta20-core/07-regras-jogo/05-sistema-combate.md"],
  ["Livro Básico", "tormenta20-core/07-regras-jogo/06-movimentacao-situacoes.md"], ["Livro Básico", "tormenta20-core/13-apendices/00-lista-condicoes.md"],
  ["Livro Básico", "tormenta20-core/09-magia/02-conceitos-regras.md"], ["Livro Básico", "tormenta20-core/06-equipamento/01-riqueza-moedas.md"],
  ["Livro Básico", "tormenta20-core/06-equipamento/05-itens-superiores.md"], ["Livro Básico", "tormenta20-core/08-combate/03-perigos.md"],
  ["Livro Básico", "tormenta20-core/10-mestre/05-tempo-entre-aventuras.md"], ["Livro Básico", "tormenta20-core/10-mestre/06-parceiros.md"],
  ["Livro Básico", "tormenta20-core/10-mestre/07-ambientes-aventura.md"], ["Livro Básico", "tormenta20-core/10-mestre/08-viagens-perseguicoes.md"],
  ...arquivosMd("herois-arton/04-regras-opcionais").map((f) => ["Heróis de Arton", f]),
  ...arquivosMd("ameacas-arton/02-regras-avancadas").map((f) => ["Ameaças de Arton", f]),
  ...arquivosMd("dragao-brasil/08-regras").map((f) => ["Dragão Brasil", f]),
];
function regras() {
  const out = [];
  for (const [livro, rel] of CAP_REGRAS) {
    if (!existsSync(join(LIVROS, rel))) { console.warn("sem arquivo:", rel); continue; }
    const [meta, corpo] = frontmatter(lerMd(rel));
    const cap = limparTitulo(meta.title || basename(rel, ".md"));
    for (const s of secoes(corpo)) {
      out.push(ficha({ id: slug(`${cap}-${s.pais.join("-")}-${s.titulo}`).slice(0, 90), nome: s.titulo, linha: [livro, cap, ...s.pais].join(" › "), grupo: cap,
        f: { livro, capitulo: cap }, html: md(s.corpo) }));
    }
  }
  gravar("regras", { titulo: "Regras", filtros: [{ k: "livro", rotulo: "livro" }, { k: "capitulo", rotulo: "capítulo" }] }, out);
}

// ---------------------------------------------------------------- COMPÊNDIO (livros: arquivo inteiro por raça/classe; seções por origem/deus)
function arquivoInteiro(livro, rel) {
  const [meta, corpo] = frontmatter(lerMd(rel));
  const nome = limparTitulo(meta.title || basename(rel, ".md"));
  return ficha({ id: slug(`${livro}-${nome}`), nome, linha: livro, grupo: livro, f: { livro }, html: md(corpo) });
}
// ícones do sistema Tormenta20 (via despejo do compêndio do criador de ficha, dados/ficha-site): raça/classe → imagem
function iconesDoCompendio(tipo) {
  const mapa = new Map();
  try {
    const d = JSON.parse(readFileSync(join(RAIZ, "dados", "ficha-site", "data", "compendio.json"), "utf-8"));
    for (const p of d.packs) for (const it of p.items) if (it.type === tipo && it.img && !/mystery-man/.test(it.img)) mapa.set(norm(it.name), "/ficha/" + it.img.replace(/^\//, ""));
  } catch { /* sem site de ficha: sem ícones */ }
  return mapa;
}
function porIcone(itens, tipo) {
  const mapa = iconesDoCompendio(tipo);
  let n = 0;
  for (const it of itens) {
    const chave = [norm(it.nome), norm(it.nome.split("/")[0]), norm(it.nome.split(" ")[0])].find((k) => mapa.has(k));
    if (chave) { it.html = imgHtml(mapa.get(chave)) + it.html; n++; }
  }
  if (itens.length) console.log(`  ícones (${tipo}): ${n}/${itens.length}`);
}
function compendio() {
  const racas = [...arquivosMd("tormenta20-core/03-racas").map((f) => ["Livro Básico", f]),
    ...arquivosMd("herois-arton/01-campeoes-arton").filter((f) => /^\d\d-/.test(basename(f)) && !/treinador/.test(f)).map((f) => ["Heróis de Arton", f]),
    ...arquivosMd("dragao-brasil/01-racas").map((f) => ["Dragão Brasil", f])].map(([l, f]) => arquivoInteiro(l, f));
  galeriasDeRacas(racas);
  porIcone(racas, "race");
  gravar("racas", { titulo: "Raças", filtros: [{ k: "livro", rotulo: "livro" }] }, racas);
  const classes = [...arquivosMd("tormenta20-core/04-classes").map((f) => ["Livro Básico", f]),
    ...arquivosMd("herois-arton/01-campeoes-arton").filter((f) => /treinador/.test(f)).map((f) => ["Heróis de Arton", f]),
    ...arquivosMd("dragao-brasil/02-classes").map((f) => ["Dragão Brasil", f])].map(([l, f]) => arquivoInteiro(l, f));
  porIcone(classes, "classe");
  gravar("classes", { titulo: "Classes", filtros: [{ k: "livro", rotulo: "livro" }] }, classes);
  const origens = [];
  const [, corpoOr] = frontmatter(lerMd("tormenta20-core/02-criacao-personagens/05-origens.md"));
  for (const s of secoes(corpoOr)) if (s.nivel === 3 && s.pais.includes("Origens Detalhadas"))
    origens.push(ficha({ id: slug(`lb-${s.titulo}`), nome: s.titulo, linha: "Livro Básico · origem", grupo: "Livro Básico", f: { livro: "Livro Básico" }, html: md(s.corpo) }));
  for (const f of arquivosMd("herois-arton/01-campeoes-arton").filter((f) => /origem-/.test(f))) origens.push(arquivoInteiro("Heróis de Arton", f));
  for (const f of arquivosMd("dragao-brasil/03-origens")) origens.push(arquivoInteiro("Dragão Brasil", f));
  gravar("origens", { titulo: "Origens", filtros: [{ k: "livro", rotulo: "livro" }] }, origens);
  const deuses = [];
  const [, corpoDe] = frontmatter(lerMd("tormenta20-core/02-criacao-personagens/06-deuses.md"));
  for (const s of secoes(corpoDe)) if (s.nivel === 3 && s.pais.includes("Os Vinte Deuses"))
    deuses.push(ficha({ id: slug(s.titulo.split("•")[0]), nome: s.titulo.split("•")[0].trim(), linha: (s.titulo.split("•")[1] || "Livro Básico").trim(), grupo: "Livro Básico", f: { livro: "Livro Básico" }, html: md(s.corpo) }));
  gravar("deuses", { titulo: "Deuses", filtros: [{ k: "livro", rotulo: "livro" }] }, deuses);
  // distinções e parceiros: dados estruturados do arsenal, renderização genérica campo a campo
  const dist = evalVar("poderes/js/distincoes-data.js", "distincoesData").map((d) => ficha({ id: slug(d.id || d.name), nome: d.name, linha: ["Distinção", d.source, d.exclusiva && "exclusiva"].filter(Boolean).join(" · "), grupo: d.source || "?",
    f: { fonte: d.source || "?" }, html: objetoHtml(d, new Set(["id", "name", "source", "exclusiva"])) }));
  gravar("distincoes", { titulo: "Distinções", filtros: [{ k: "fonte", rotulo: "fonte" }] }, dist);
  const parc = evalVar("parceiros/parceiros.js", "parceirosData").map((p) => ficha({ id: slug(`${p.category}-${p.name}`), nome: p.name, linha: [p.category, p.source].filter(Boolean).join(" · "), grupo: p.category || "?",
    f: { categoria: p.category || "?", fonte: p.source || "?" }, html: `<div class="desc">${limpar(p.desc)}</div>${objetoHtml(p, new Set(["name", "category", "source", "desc"]))}` }));
  gravar("parceiros", { titulo: "Parceiros e montarias", filtros: [{ k: "categoria", rotulo: "categoria" }, { k: "fonte", rotulo: "fonte" }] }, parc);
}

// ---------------------------------------------------------------- MISSÕES (migração única da guilda: missões + votos do Firebase)
const VOTOS_FIREBASE = { "amansar-espirito-do-gelo": ["Bjorn Stevenson", "Silvester, O Mártir"], "auxilio-em-manufatura": ["Lydia Alnari", "Valka Calen"], "cacada-exotica": ["Valka Calen"],
  "coleta-de-ingredientes": ["Bjorn Stevenson", "Lydia Alnari", "Valka Calen"], "investigacao-nas-minas-heldret": ["Bjorn Stevenson", "Mist Yavallan", "Silvester, O Mártir", "Valka Calen"] };
const CONCLUIDAS_FIREBASE = ["coleta-e-entrega-de-encomenda", "escolta-ate-tarrafet", "investigacao-de-contrabando-e-venda-de-material-ilegal", "reforco-nas-muralhas"];
function missoes() {
  const src = readFileSync(join(GUILDA, "missions.js"), "utf-8").replace(/\r/g, "").split("\nconst MESTRE")[0].replace(/^import[\s\S]*?;\n/gm, "");
  const lista = vm.runInNewContext(src + "\n;MISSOES;", {});
  const out = { missoes: [], votos: {} };
  for (const m of lista) {
    const id = slug(m.titulo);
    out.missoes.push({ id, titulo: m.titulo, solicitante: m.solicitante, local: m.local, descricao: m.descricao, perigo: m.perigo, recompensa: m.recompensa, concluida: CONCLUIDAS_FIREBASE.includes(id) });
    if (VOTOS_FIREBASE[id]) out.votos[id] = Object.fromEntries(VOTOS_FIREBASE[id].map((n) => [n, true]));
  }
  writeFileSync(join(RAIZ, "dados", "missoes.json"), JSON.stringify(out, null, 1));
  console.log(`missoes.json  ${out.missoes.length} missões (${CONCLUIDAS_FIREBASE.length} concluídas)`);
}

// ---------------------------------------------------------------- self-test do que é lógica pura
if (process.argv.includes("--check")) {
  const assert = (c, m) => { if (!c) { console.error("FALHOU:", m); process.exit(1); } };
  assert(limpar('<p onclick="x">a<script>alert(1)</script><a href="u">b</a><img src=x></p>') === "<p>ab</p>", "limpar: " + limpar('<p onclick="x">a<script>alert(1)</script><a href="u">b</a><img src=x></p>'));
  assert(md("## T\n\ntexto **forte** e *leve*\n\n- a\n- b\n\n| x | y |\n|---|---|\n| 1 | 2 |") === "<h4>T</h4><p>texto <b>forte</b> e <i>leve</i></p><ul><li>a</li><li>b</li></ul><table><tr><th>x</th><th>y</th></tr><tr><td>1</td><td>2</td></tr></table>", "md: " + md("## T\n\ntexto **forte** e *leve*\n\n- a\n- b\n\n| x | y |\n|---|---|\n| 1 | 2 |"));
  const s = secoes("## A\ntexto de a com tamanho bom\n### B\ntexto de b com tamanho bom\n## C\ntexto de c com tamanho bom");
  assert(s.length === 3 && s[1].pais[0] === "A" && s[2].pais.length === 0, "secoes: " + JSON.stringify(s.map((x) => [x.titulo, x.pais])));
  assert(ndNum("1/2") === 0.5 && ndNum("S+") === 21 && ndNum("7") === 7, "ndNum");
  assert(slug("Água-Viva (Grande)!") === "agua-viva-grande", "slug");
  const h = ameacaHtml({ nd: "1", defesa: "15", atributos: { for: "2" }, ataques: [{ nome: "Mordida", bonus: "+5", dano: "1d6" }], imagem: "https://x/y.png" });
  assert(h.includes('<img class="a-img" src="https://x/y.png"') && h.includes("<b>FOR</b> 2") && h.includes("<b>Mordida</b> +5, 1d6"), "ameacaHtml: " + h);
  console.log("importar.mjs --check OK");
} else if (import.meta.url === `file://${process.argv[1].replace(/\\/g, "/")}` || process.argv[1]?.endsWith("importar.mjs")) {
  if (GUILDA) missoes();
  else {
    ameacas(); itens(); str(); perigos(); regras(); compendio();
    writeFileSync(join(SAIDA, "INDEX.json"), JSON.stringify({ geradoEm: new Date().toISOString(), contagem }, null, 1));
  }
}
