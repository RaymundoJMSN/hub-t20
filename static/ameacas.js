// ameacas.js — criador de ameaças: os passos 0–7 do manual do Ameaças de Arton (+ chefe final) numa tela só, com a ficha ao vivo do lado.
// Números de combate = linha do ND/papel na Tabela 2-3; cada um mostra os valores de ND−2…ND+2 (a margem que o livro dá
// pra personalizar). Trocar ND ou papel mantém a diferença de cada número pra tabela ("Como modificar criaturas").
// Salva por conta no servidor (rascunho no navegador enquanto não salva) e exporta o ator NPC pro Foundry (sistema tormenta20).
import { el, aoSair } from "/hub.js";
import { ND_ORDEM, TIPOS, TAMANHOS, ACOES, ATRIBUTOS, TIPOS_DANO, PERICIAS, normalizar, paraFoundry, deFoundry, fichaHtml, fichaTexto,
  danoMedio, bonusPraMedia, nivelDoNd, meioNd, treinoDoNd, patamarDoNd, chavePericia, tipoPorArma, norm, sinal, num, comoChefe, ndRecompensa, porPatamar, RD_CHEFE,
  ALCANCES, FORMAS, DURACOES, EFEITOS_TESTE, TIPOS_HAB, CONDICOES_NOMES, TESTES, camposDoTexto, descDosCampos, mecanicaEfetiva, tracosDe, sentidosDe, luzDe, danoDoTexto,
  formulaOk } from "/ameaca.mjs?v=2"; // ?v= sobe quando mudam as exportações: o roteador do hub reimporta esta página, mas um /ameaca.mjs já carregado ficaria velho

const form = document.querySelector("#a-form"), lado = document.querySelector("#a-lado"), barra = document.querySelector("#a-barra");
const params = new URLSearchParams(location.search);
const RASCUNHO = "hub.ameaca.rascunho";
let R = { tabela: {}, desl: {}, passos: [], categorias: [] };
let A, id = null, salvo = "", minhas = [], semRegras = false;
const vivos = []; // pedaços da tela que se refazem a cada mudança (chips, médias, contadores, ficha)

// ---------------------------------------------------------------- regras
const linhaT = (papel, nd) => R.tabela?.[papel]?.[nd];
const tab = (campo, papel = A.papel, nd = A.nd) => linhaT(papel, nd)?.[campo];
const ndMais = (nd, d) => ND_ORDEM[Math.max(0, Math.min(ND_ORDEM.length - 1, ND_ORDEM.indexOf(nd) + d))];
const vizinhos = () => [...new Set([-2, -1, 0, 1, 2].map((d) => ndMais(A.nd, d)))];
const RES = [["fort", "Fortitude"], ["ref", "Reflexos"], ["von", "Vontade"]];
const COL_RES = [["forte", "forte (~80% de passar)"], ["media", "média (~50%)"], ["fraca", "fraca (~20%)"]];
// [campo do modelo, rótulo, coluna da Tabela 2-3]
const STATS = [["defesa", "Defesa", () => "defesa"], ["pv", "Pontos de Vida", () => "pv"], ["cd", "CD das habilidades", () => "cd"],
  ["atq", "Ataque", () => "atq"], ["danoAlvo", "Dano médio por rodada", () => "dano"], ["fort", "Fortitude", () => A.res.fort],
  ["ref", "Reflexos", () => A.res.ref], ["von", "Vontade", () => A.res.von]];
const COM_SINAL = new Set(["atq", "fort", "ref", "von"]);
// quantos NDs o valor está acima/abaixo do ND da ameaça: valor entre duas células conta o ND de valor mais perto (null = fora da faixa)
function deslocamento(k, campo) {
  const i0 = ND_ORDEM.indexOf(A.nd), v = A[k];
  if (v == null || foraDaFaixa(k, campo)) return null;
  let melhor = null, erro = Infinity;
  for (const nd of vizinhos()) {
    const t = tab(campo, A.papel, nd), d = ND_ORDEM.indexOf(nd) - i0;
    if (t != null && (Math.abs(t - v) < erro || (Math.abs(t - v) === erro && Math.abs(d) < Math.abs(melhor)))) { melhor = d; erro = Math.abs(t - v); }
  }
  return melhor;
}
// valor fora do que a tabela dá de ND−2 a ND+2 → { min, max, linha } (null = dentro, ou sem tabela)
function foraDaFaixa(k, campo) {
  const vs = vizinhos().map((nd) => tab(campo, A.papel, nd)).filter((v) => v != null);
  if (!vs.length || A[k] == null) return null;
  const min = Math.min(...vs), max = Math.max(...vs);
  return A[k] < min || A[k] > max ? { min, max, linha: tab(campo) } : null;
}
const ablDe = (nome) => chavePericia(nome)?.[1];
// tamanho (LB Tabela 1-1): [espaço = alcance natural, Furtividade, manobras]; a Furtividade da ficha já inclui o modificador
const TAM_INFO = { "Minúsculo": ["1,5m", 5, -5], Pequeno: ["1,5m", 2, -2], "Médio": ["1,5m", 0, 0], Grande: ["3m", -2, 2], Enorme: ["4,5m", -5, 5], Colossal: ["9m", -10, 10] };
const basePer = (nome, nd = A.nd, atr = A.atributos, tam = A.tamanho) => meioNd(nd) + (atr[ablDe(nome)] ?? 0) + (norm(nome) === "furtividade" ? TAM_INFO[tam]?.[1] || 0 : 0);
// treinada fica guardada no modelo (deduzida do valor, trocava sozinha quando o ND mudava o bônus de treino)
function estadoPer(p, nd = A.nd, atr = A.atributos, tam = A.tamanho) {
  const d = p.valor - basePer(p.nome, nd, atr, tam), t = treinoDoNd(nd), treinado = typeof p.treinado === "boolean" ? p.treinado : d >= t;
  return { treinado, extra: d - (treinado ? t : 0) };
}
const valorPer = (nome, treinado, extra) => basePer(nome) + (treinado ? treinoDoNd(A.nd) : 0) + extra;
// perícia segue a regra (½ ND + atributo + treino + extra): muda ND, atributo ou tamanho, o valor acompanha mantendo treino e extra
function recalcularPericias(ndAntes, atrAntes, tamAntes = A.tamanho) {
  for (const p of A.pericias) {
    if (!ablDe(p.nome)) continue;
    const e = estadoPer(p, ndAntes, atrAntes, tamAntes);
    p.treinado = e.treinado; p.valor = valorPer(p.nome, e.treinado, e.extra);
  }
}
// a CD da ficha mudou: as habilidades que citavam a antiga acompanham
function trocarCdTextos(de, para) {
  if (de == null || para == null || de === para) return;
  for (const h of A.habilidades) h.desc = h.desc.replace(new RegExp(`\\bCD ${de}\\b`, "g"), `CD ${para}`);
}
function trocarBase(nd, papel) {
  const antes = { nd: A.nd, papel: A.papel, cd: A.cd, atr: { ...A.atributos } };
  if (linhaT(antes.papel, antes.nd) && linhaT(papel, nd)) {
    for (const [k, , campo] of STATS) {
      const a = tab(campo(), antes.papel, antes.nd), d = tab(campo(), papel, nd);
      if (A[k] == null) A[k] = d; else if (a != null && d != null) A[k] = d + (A[k] - a);
    }
    for (const at of A.ataques) {
      const ndA = at.complementar ? ndMais(antes.nd, -2) : antes.nd, ndD = at.complementar ? ndMais(nd, -2) : nd;
      at.bonus += (tab("atq", papel, ndD) ?? 0) - (tab("atq", antes.papel, ndA) ?? 0);
      const dA = tab("dano", antes.papel, ndA), dD = tab("dano", papel, ndD), m = danoMedio(at);
      if (dA && dD && m > 0) at.bonusDano += Math.round((m * dD) / dA) - m;
    }
  }
  A.nd = nd; A.papel = papel;
  recalcularPericias(antes.nd, antes.atr);
  trocarCdTextos(antes.cd, A.cd);
}
function trocarRes(k, col) {
  const outro = Object.keys(A.res).find((x) => x !== k && A.res[x] === col);
  if (outro) { A.res[outro] = A.res[k]; A[outro] = tab(A.res[outro]) ?? A[outro]; }
  A.res[k] = col; A[k] = tab(col) ?? A[k];
  render();
}
// passos de dano: anda na "escada" da linha em que o dado está (LB Tabela 3-2); passou do fim, soma ou tira um dado
function passo(dados, n) {
  if (!n) return dados; // 2d6 também está na escada do 1d12: passo 0 não troca o dado
  const P = R.passos || [];
  let r = -1, c = 2; // escada em que o dado fica mais perto do "Normal" (4d10 sobe pra 4d12, não pra 5d10)
  P.forEach((l, i) => l.forEach((cel, j) => { if (cel.includes(dados) && (r < 0 || Math.abs(j - 2) < Math.abs(c - 2))) { r = i; c = j; } }));
  if (r >= 0 && c + n >= 0 && c + n < P[r].length) return P[r][c + n][0];
  const m = String(dados).match(/^(\d+)d(\d+)$/);
  return m ? `${Math.max(1, +m[1] + Math.sign(n))}d${m[2]}` : dados;
}
const PASSO_TAM = { "Minúsculo": -1, Pequeno: 0, "Médio": 0, Grande: 1, Enorme: 1, Colossal: 2 }; // arma natural: 1d6 em Pequeno/Médio
const alvoDe = (at) => {
  if (at.complementar) return (tab("dano", A.papel, ndMais(A.nd, -2)) ?? 0) / Math.max(1, at.qtd);
  const qtd = A.ataques.filter((x) => !x.complementar).reduce((s, x) => s + (x.qtd || 1), 0) || 1;
  return (A.danoAlvo ?? tab("dano") ?? 0) / qtd;
};
const TRACOS_TIPO = { Construto: ["visão no escuro", "imunidade a cansaço, metabolismo e veneno"], "Morto-vivo": ["visão no escuro", "imunidade a cansaço, metabolismo, trevas e veneno"] };
const DICA_TIPO = {
  Animal: "Fera real ou fantástica: Int –5 ou –4 e nada sobrenatural (animal inteligente ou mágico é monstro).",
  Construto: "Fabricado ou animado: visão no escuro, imune a cansaço, metabolismo e veneno; não cura por descanso (Ofício artesão faz as vezes de Cura).",
  "Espírito": "Nativo de outro plano (elementais, abissais, celestiais, fadas, gênios). Visão no escuro é comum, mas não vem do tipo.",
  Humanoide: "Anatomia humana e cultura própria; sempre tem raça ou subtipo.",
  Monstro: "Anatomia estranha ou poderes mágicos: dragões, lefeu, aberrações.",
  "Morto-vivo": "Visão no escuro, imune a cansaço, metabolismo, trevas e veneno; cura de luz fere e dano de trevas cura.",
};
// subtipo elemental: o bloco que as fichas de elemental do livro repetem (imune ao próprio elemento, vulnerável ao oposto)
const ELEMENTOS = { fogo: ["fogo", "frio"], agua: ["frio", "fogo"], ar: ["eletricidade e caído", "ácido"], terra: ["ácido", "eletricidade"] };
function sugestaoElemental() {
  if (!/\belemental\b/.test(norm(A.subtipo))) return [];
  const texto = norm([A.subtipo, A.nome, A.conceito].join(" ")), el1 = Object.keys(ELEMENTOS).find((e) => new RegExp(`\\b${e}\\b`).test(texto));
  const [imune, vulner] = ELEMENTOS[el1] || [];
  const tr = tracosDe(A.defesas);
  const falta = [!/visao no escuro/.test(norm(A.sentidos)) && ["sentidos", "visão no escuro"],
    !tr.ic.includes("atordoado") && ["defesas", `imunidade a acertos críticos, atordoamento, cansaço, efeitos de metabolismo, paralisia${imune && !tr.resistencias[norm(imune).split(" ")[0]]?.imunidade ? ` e ${imune}` : ""}`],
    vulner && !tr.resistencias[norm(vulner)]?.vulnerabilidade && ["defesas", `vulnerabilidade a ${vulner}`]].filter(Boolean);
  if (!falta.length) return [];
  return [botao(`+ traços de elemental${el1 ? ` do ${el1 === "agua" ? "água" : el1}` : ""} (o padrão das fichas do livro)`, () => { for (const [k, t] of falta) acrescentar(A, k, t); render(); },
    { title: falta.map(([, t]) => t).join("; ") }), el1 ? null : el("small", { className: "a-conta", textContent: "diga o elemento (fogo, água, ar, terra) no subtipo ou no nome pra incluir a imunidade e a vulnerabilidade" })].filter(Boolean);
}
const DICA_PAPEL = { solo: "Enfrenta o grupo sozinha: muitos PV, combate de 3 a 5 rodadas.", lacaio: "Vem em quantidade, de ND menor que o grupo: ataque e dano altos, poucos PV.",
  especial: "Habilidades acima de tudo (conjurador, líder, trapaceiro): ataque e Defesa menores, CD maior, mais habilidades." };

// ---------------------------------------------------------------- estado
function nova() {
  const l = linhaT("solo", "1") || {};
  const at = { nome: "Garra", qtd: 1, tipo: "cac", bonus: l.atq ?? 0, dados: "1d6", bonusDano: 0, tipoDano: "corte" };
  at.bonusDano = bonusPraMedia(at, l.dano ?? 0);
  return normalizar({ nome: "Nova ameaça", nd: "1", papel: "solo", tipo: "Monstro", tamanho: "Médio", defesa: l.defesa, pv: l.pv, cd: l.cd, atq: l.atq, danoAlvo: l.dano,
    fort: l.forte, ref: l.media, von: l.fraca, desl: { terrestre: 9 }, atributos: { for: 0, des: 0, con: 0, int: 0, sab: 0, car: 0 },
    pericias: [{ nome: "Iniciativa", valor: 0 }, { nome: "Percepção", valor: 0 }], ataques: [at], tesouro: "Padrão" });
}
// ficha do bestiário ou importada: completa o que o criador usa como referência
function completar(x) {
  const a = normalizar(x);
  if (a.cd == null) a.cd = linhaT(a.papel, a.nd)?.cd ?? null;
  if (a.atq == null) a.atq = a.ataques[0]?.bonus ?? linhaT(a.papel, a.nd)?.atq ?? null;
  if (a.danoAlvo == null) a.danoAlvo = a.ataques.filter((t) => !t.complementar).reduce((s, t) => s + danoMedio(t) * t.qtd, 0) || linhaT(a.papel, a.nd)?.dano || null;
  for (const n of ["Percepção", "Iniciativa"]) if (!a.pericias.some((p) => p.nome === n)) a.pericias.unshift({ nome: n, valor: meioNd(a.nd) + (a.atributos[n === "Iniciativa" ? "des" : "sab"] ?? 0), obs: "" });
  return a;
}
const sujo = () => JSON.stringify(A) !== salvo;
function guardarRascunho() { try { localStorage.setItem(RASCUNHO, JSON.stringify({ id, A, salvo })); } catch {} }
function lerRascunho() { try { return JSON.parse(localStorage.getItem(RASCUNHO) || "null"); } catch { return null; } }
let pendente = null; // aviso que chegou antes da barra existir (primeira carga)
function msg(t, erro) { const m = document.querySelector("#a-msg"); if (m) { m.textContent = t; m.classList.toggle("erro-txt", !!erro); } else pendente = [t, erro]; }

async function listarMinhas() { try { minhas = await (await fetch("/api/criador/ameacas")).json(); } catch { minhas = []; } }
async function abrir(novoId) {
  const r = await fetch(`/api/criador/ameacas/${encodeURIComponent(novoId)}`);
  if (!r.ok) { msg("essa ameaça não existe mais", true); return false; }
  const j = await r.json();
  A = completar(j.ameaca); id = novoId; salvo = JSON.stringify(A);
  history.replaceState(null, "", `/criar-ameaca?id=${id}`);
  return true;
}
async function doBestiario(bid) {
  const t = await (await fetch(`/api/c/ameacas/${encodeURIComponent(bid)}`)).json();
  if (!t?.dados) { msg(t?.erro ? "não achei essa ficha no bestiário" : "essa ficha do bestiário não tem dados estruturados (reimporte o bestiário)", true); return false; }
  A = completar(t.dados); id = null; salvo = "";
  history.replaceState(null, "", "/criar-ameaca");
  return true;
}
async function salvar() {
  id ||= (Math.random().toString(36).slice(2) + "00000000").slice(0, 8);
  try {
    const r = await fetch(`/api/criador/ameacas/${id}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ ameaca: A }) });
    const j = await r.json();
    if (!r.ok) throw new Error(j.erro || r.status);
    const abertas = A.habilidades.map((h) => mecAbertas.has(h)); // o modelo volta do servidor com objetos novos
    A = completar(j.ameaca); salvo = JSON.stringify(A);
    A.habilidades.forEach((h, i) => abertas[i] && mecAbertas.add(h));
    history.replaceState(null, "", `/criar-ameaca?id=${id}`);
    await listarMinhas();
    render(); msg("salvo ✓");
  } catch (e) { msg("não salvou: " + e.message, true); }
}
function baixar(nome, texto) {
  const a = el("a", { href: URL.createObjectURL(new Blob([texto], { type: "application/json" })), download: nome });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
const arquivo = () => (norm(A.nome).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "ameaca") + ".json";
async function copiar(texto, botao) {
  try { await navigator.clipboard.writeText(texto); }
  catch { const t = el("textarea", { value: texto }); document.body.append(t); t.select(); document.execCommand("copy"); t.remove(); }
  const antes = botao.textContent; botao.textContent = "✓ copiado"; setTimeout(() => (botao.textContent = antes), 1400);
}

// ---------------------------------------------------------------- campos (ligados direto no modelo)
const vivo = (fn) => { vivos.push(fn); };
function atualizar() { for (const f of vivos) f(); guardarRascunho(); }
const campo = (rotulo, ...filhos) => el("label", { className: "campo" }, el("span", { textContent: rotulo }), ...filhos);
const linhaC = (...filhos) => el("div", { className: "campo-linha" }, ...filhos);
function txt(obj, k, props = {}) { const i = el("input", { type: "text", value: obj[k] ?? "", ...props }); i.oninput = () => { obj[k] = i.value; atualizar(); }; return i; }
function area(obj, k, props = {}) {
  const t = el("textarea", { value: obj[k] ?? "", rows: 3, ...props });
  t.oninput = () => { obj[k] = t.value; atualizar(); };
  vivo(() => { if (document.activeElement !== t && t.value !== (obj[k] ?? "")) t.value = obj[k] ?? ""; }); // a CD trocada em outro lugar aparece aqui
  return t;
}
function numero(obj, k, props = {}, depois) {
  const i = el("input", { type: "number", value: obj[k] ?? "", ...props });
  i.oninput = () => {
    const v = i.value.trim() === "" ? (props.vazio === undefined ? 0 : props.vazio) : Math.trunc(Number(i.value));
    if (v !== null && !Number.isFinite(v)) return;
    const antes = obj[k]; obj[k] = v; depois?.(antes); atualizar();
  };
  return i;
}
function lista(obj, k, opcoes, { num = false, depois } = {}) {
  const s = el("select", {}, ...opcoes.map(([v, r]) => el("option", { value: String(v), textContent: r })));
  s.value = String(obj[k] ?? "");
  s.onchange = () => { obj[k] = num ? Number(s.value) : s.value; depois ? depois() : atualizar(); };
  return s;
}
const marcar = (obj, k, depois) => el("input", { type: "checkbox", checked: !!obj[k], onchange: (e) => { obj[k] = e.target.checked; depois ? depois() : atualizar(); } });
function segmentos(atual, opcoes, ao) {
  const box = el("div", { className: "g-abas g-seg a-seg" });
  for (const [v, r, t] of opcoes) box.append(el("button", { type: "button", className: "chip g-aba" + (v === atual ? " on" : ""), textContent: r, title: t || "", onclick: () => ao(v) }));
  return box;
}
const botao = (texto, onclick, props = {}) => el("button", { type: "button", className: "bt mini", textContent: texto, onclick, ...props });
// acrescenta um termo num campo de texto separado por vírgula (sem repetir)
function acrescentar(obj, k, t) {
  if (!String(obj[k] || "").split(/,\s*/).some((x) => norm(x) === norm(t))) obj[k] = [obj[k], t].filter(Boolean).join(", ");
}
// opções comuns do campo: clique acrescenta; "{5}" marca o número sugerido, que fica selecionado no campo pra trocar
function opcoes(obj, k, input, lista) {
  return el("div", { className: "a-chips a-opcoes" }, ...lista.map((t) => {
    const limpo = t.replace(/[{}]/g, "");
    return el("button", { type: "button", className: "chip a-op", textContent: `+ ${limpo}`, onclick: () => {
      acrescentar(obj, k, limpo);
      input.value = obj[k]; atualizar();
      const i = t.indexOf("{"), pos = obj[k].lastIndexOf(limpo);
      if (i >= 0 && pos >= 0) { input.focus(); input.setSelectionRange(pos + i, pos + t.indexOf("}") - 1); }
    } });
  }));
}
// campo de busca com lista de sugestões embaixo: buscar(q) → [{nome, linha, ...}], escolher → ao(item)
function sugestao(placeholder, buscar, ao, className = "a-base") {
  const entrada = el("input", { type: "search", className, placeholder });
  const sug = el("div", { className: "a-sugestoes", hidden: true });
  let timer;
  entrada.oninput = () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const q = entrada.value.trim();
      let itens = [];
      if (q) try { itens = await buscar(q); } catch {}
      if (entrada.value.trim() !== q || document.activeElement !== entrada) return; // resposta de uma busca velha, ou o campo já perdeu o foco
      sug.replaceChildren(...itens.map((it) => el("button", { type: "button", className: "a-sug", onmousedown: (e) => e.preventDefault(),
        onclick: () => { sug.hidden = true; entrada.value = ""; ao(it); } }, el("b", { textContent: it.nome }), el("small", { textContent: ` ${it.linha || ""}` }))));
      sug.hidden = !itens.length;
    }, 250);
  };
  entrada.onblur = () => { sug.hidden = true; };
  return el("div", { className: "a-base-box" }, entrada, sug);
}
const buscarColecao = (col, filtro = () => true) => async (q) =>
  ((await (await fetch(`/api/c/${col}?q=${encodeURIComponent(q)}`)).json()).itens || []).filter(filtro).sort((a, b) => (b.rel || 0) - (a.rel || 0)).slice(0, 10);
// "Dano: 1d8; Crítico: 19/x2; …" da ficha do item → { dano: "1d8", critico: "19/x2", … }
async function statsItem(itemId) {
  const it = await (await fetch(`/api/c/itens/${encodeURIComponent(itemId)}`)).json();
  return { ...Object.fromEntries([...String(it.html || "").matchAll(/<b>([^<]+):<\/b>\s*([^;<]+)/g)].map((m) => [norm(m[1]).trim(), m[2].trim()])),
    desc: String(it.html || "").replace(/<[^>]+>/g, " ") };
}
const minuscula = (s) => s.charAt(0).toLowerCase() + s.slice(1);
const secao = (n, titulo, dica, ...filhos) => el("section", { className: "painel a-passo" },
  el("h2", { className: "pergunta" }, el("span", { className: "a-num", textContent: `Passo ${n}` }), ` ${titulo}`),
  dica ? el("p", { className: "explica", textContent: dica }) : null, ...filhos);

// número de combate com os valores da Tabela 2-3 do ND−2 ao ND+2
function estatistica(k, rotulo, campoTab) {
  const mudar = (v, digitando) => {
    const antes = A[k];
    A[k] = v;
    if (k === "atq" && antes != null && v != null) for (const at of A.ataques) if (!at.complementar) at.bonus += v - antes;
    if (k === "cd" && !digitando) trocarCdTextos(antes, v);
    atualizar();
  };
  const i = el("input", { type: "number", className: "a-n", value: A[k] ?? "" });
  i.oninput = () => { const v = i.value.trim() === "" ? (k === "cd" ? null : 0) : Math.trunc(Number(i.value)); if (v === null || Number.isFinite(v)) mudar(v, true); };
  // CD digitada: os textos acompanham quando sai do campo (no meio da digitação a CD passa por valores que não são ela)
  if (k === "cd") { i.onfocus = () => { i.dataset.antes = A.cd ?? ""; }; i.onchange = () => { trocarCdTextos(num(i.dataset.antes), A.cd); i.dataset.antes = A.cd ?? ""; atualizar(); }; }
  const chips = el("div", { className: "a-chips" });
  vivo(() => {
    if (document.activeElement !== i) i.value = A[k] ?? "";
    chips.replaceChildren(...vizinhos().map((nd) => {
      const v = tab(campoTab(), A.papel, nd);
      if (v == null) return null;
      return el("button", { type: "button", className: "chip a-chip" + (v === A[k] ? " on" : "") + (nd === A.nd ? " a-nd" : ""), title: `Tabela 2-3, ${A.papel}, ND ${nd}`,
        onclick: () => mudar(v) }, el("small", { textContent: `ND ${nd}` }), ` ${COM_SINAL.has(k) ? sinal(v) : v}`);
    }));
    i.classList.toggle("a-fora", !!foraDaFaixa(k, campoTab()));
  });
  return el("div", { className: "a-stat" }, el("span", { className: "a-rot", textContent: rotulo }), i, chips);
}

// ---------------------------------------------------------------- passos
function passo0() {
  const img = el("img", { className: "a-retrato", alt: "", referrerPolicy: "no-referrer" });
  vivo(() => { img.hidden = !/^https?:\/\//.test(A.img); if (!img.hidden && img.src !== A.img) img.src = A.img; });
  return secao(0, "Conceito e nome", "Uma boa ameaça se descreve em poucas palavras. Ela aparece em poucas cenas: qualidade vale mais que quantidade.",
    campo("Nome", txt(A, "nome", { maxLength: 80 })),
    campo("Conceito (vai pra biografia no Foundry)", area(A, "conceito", { rows: 2, placeholder: "ex.: réptil alado que cospe fogo e guarda um tesouro antigo" })),
    linhaC(campo("Imagem (link https, opcional)", txt(A, "img", { placeholder: "https://i.imgur.com/….png" })), img));
}
function passo1() {
  const porte = A.tamanho === "Minúsculo" || A.tamanho === "Pequeno" ? "peq" : A.tamanho === "Médio" ? "med" : "gra";
  const corpo = { forma: passo1.forma || "bipede" };
  const desl = el("div", { className: "a-desl" });
  const linhaDesl = (k, rotulo, faixa) => {
    const i = numero(A.desl, k, { className: "a-n", step: 1.5, min: 0 });
    i.oninput = () => { A.desl[k] = Math.max(0, Number(i.value.replace(",", ".")) || 0); atualizar(); };
    const chips = faixa ? faixa.map((v, j) => el("button", { type: "button", className: "chip a-chip" + (A.desl[k] === v ? " on" : ""), title: "Tabela 2-2",
      onclick: () => { A.desl[k] = v; render(); } }, el("small", { textContent: ["lento", "normal", "rápido"][j] }), ` ${String(v).replace(".", ",")}m`)) : [];
    return el("div", { className: "a-stat" }, el("span", { className: "a-rot", textContent: rotulo }), i, el("div", { className: "a-chips" }, ...chips));
  };
  desl.append(
    linhaDesl("terrestre", "Terrestre", R.desl?.[corpo.forma]?.[porte]),
    el("div", { className: "a-forma" }, segmentos(corpo.forma, [["bipede", "Bípede"], ["quadrupede", "Quadrúpede"]], (v) => { passo1.forma = v; render(); })),
    linhaDesl("voo", "Voo", R.desl?.voo?.[porte]), linhaDesl("natacao", "Natação", R.desl?.natacao),
    linhaDesl("escalada", "Escalada", R.desl?.escalada), linhaDesl("escavacao", "Escavação", R.desl?.escavacao));
  const obs = txt(A.desl, "obs", { placeholder: "ex.: sem redução por terreno difícil" });
  desl.append(campo("Observação de deslocamento", obs),
    opcoes(A.desl, "obs", obs, ["sem redução por terreno difícil", "pairar", "teleporte {9}m"]),
    el("p", { className: "explica", textContent: "\"pairar\" liga o pairar do Foundry (fica no ar sem gastar movimento)." }));
  const dicaTipo = el("p", { className: "explica" }), tamInfo = el("p", { className: "explica" }), elemental = el("div", { className: "a-pe" });
  vivo(() => {
    dicaTipo.textContent = DICA_TIPO[A.tipo] || "";
    const [esp, furt, man] = TAM_INFO[A.tamanho] || [];
    tamInfo.textContent = esp ? `${A.tamanho}: espaço e alcance natural ${esp} · Furtividade ${sinal(furt)} (já somado na perícia) · manobras (agarrar, derrubar) ${sinal(man)} · arma natural ${passo("1d6", PASSO_TAM[A.tamanho] || 0)}` : "";
    elemental.replaceChildren(...sugestaoElemental());
  });
  const tamAntes = A.tamanho;
  return secao(1, "Tipo, tamanho e papel", null,
    linhaC(campo("Tipo", lista(A, "tipo", Object.keys(TIPOS).map((t) => [t, t]), { depois: () => {
      for (const [k, t] of [["sentidos", TRACOS_TIPO[A.tipo]?.[0]], ["defesas", TRACOS_TIPO[A.tipo]?.[1]]]) if (t && !norm(A[k]).includes(norm(t))) A[k] = [A[k], t].filter(Boolean).join(", ");
      render();
    } })), campo("Subtipo / raça", txt(A, "subtipo", { placeholder: "ex.: goblin, elemental, lefeu" })),
    campo("Tamanho", lista(A, "tamanho", Object.keys(TAMANHOS).map((t) => [t, t]), { depois: () => { recalcularPericias(A.nd, A.atributos, tamAntes); render(); } }))),
    dicaTipo, tamInfo, elemental,
    el("div", { className: "a-linha-seg" }, el("span", { className: "a-rot", textContent: "Papel" }),
      segmentos(A.papel, [["solo", "Solo", DICA_PAPEL.solo], ["lacaio", "Lacaio", DICA_PAPEL.lacaio], ["especial", "Especial", DICA_PAPEL.especial]], (v) => { trocarBase(A.nd, v); render(); })),
    el("p", { className: "explica", textContent: DICA_PAPEL[A.papel] }),
    el("div", { className: "a-linha-seg" }, el("span", { className: "a-rot", textContent: "Grupo" }),
      segmentos(A.grupo, [["", "Indivíduo"], ["bando", "Bando", "grupo de criaturas: dano em dobro se o ataque passar a Defesa por 10, metade se errar; vulnerável a área"],
        ["enxame", "Enxame", "aglomerado que entra no espaço dos outros; metade do dano de armas, vulnerável a área"]], (v) => { A.grupo = v; render(); })),
    el("h3", { className: "sub-perg", textContent: "Deslocamento (Tabela 2-2)" }),
    el("p", { className: "explica", textContent: "Abaixo de 6m a ameaça fica fraca; acima de 18m ganha vantagem tática grande. Deslocamento extra que não é o principal: uns 3m a menos que o base." }),
    desl);
}
function passo2() {
  const info = el("p", { className: "explica" });
  vivo(() => {
    const pat = ["", "iniciante (ND ¼–4)", "veterano (ND 5–10)", "campeão (ND 11–16)", "lenda (ND 17–20)"][patamarDoNd(A.nd)];
    info.textContent = `Patamar ${pat} · ${A.chefe ? `chefe final: XP e tesouro de ND ${ndRecompensa(A)} (${Number(ndRecompensa(A)) * 1000} XP)` : `${({ "1/4": 250, "1/2": 500 })[A.nd] ?? nivelDoNd(A.nd) * 1000} XP pro grupo`}`
      + (A.nd.startsWith("S") ? " · S/S+ contam como ND 20 pra tudo que não está na ficha e têm Maior que a Morte" : "");
  });
  const nd = el("select", {}, ...ND_ORDEM.map((n) => el("option", { value: n, textContent: n })));
  nd.value = A.nd;
  nd.onchange = () => { trocarBase(nd.value, A.papel); render(); };
  return secao(2, "Nível de desafio", "O ND é o nível de grupo pra qual a ameaça é um desafio justo (grupo de 4). Trocar o ND reajusta os números mantendo a diferença de cada um pra tabela.",
    el("div", { className: "a-linha-seg" }, el("span", { className: "a-rot", textContent: "ND" }), nd), info);
}
function passo3() {
  const saldo = el("p", { className: "explica a-saldo" });
  vivo(() => {
    const ajustes = STATS.map(([k, r, c]) => [r, deslocamento(k, c())]).filter(([, d]) => d);
    const fora = STATS.map(([k, r, c]) => [r, foraDaFaixa(k, c())]).filter(([, f]) => f);
    const soma = ajustes.reduce((s, [, d]) => s + d, 0);
    saldo.textContent = semRegras ? "Tabela 2-3 não instalada no servidor: os números ficam livres."
      : ajustes.length || fora.length ? [ajustes.length && `Ajustes de ND: ${ajustes.map(([r, d]) => `${r} ${d > 0 ? "+" : ""}${d}`).join(", ")} · saldo ${soma > 0 ? "+" : ""}${soma}${soma ? " — o livro pede compensar aumento com redução" : fora.length ? "" : " ✓"}`,
        fora.length && `Fora da faixa de 2 NDs (não entra no saldo): ${fora.map(([r, f]) => `${r} (vai de ${f.min} a ${f.max})`).join(", ")}`].filter(Boolean).join(" · ")
        : "Tudo na linha do ND. Cada número pode usar o valor de até 2 NDs acima ou abaixo, compensando um aumento com uma redução.";
  });
  const notaChefe = el("p", { className: "explica a-saldo" });
  vivo(() => { notaChefe.hidden = !A.chefe; notaChefe.textContent = A.chefe ? `👑 Chefe final (passo 8): estes são os números da criatura-base; a ficha usa ${comoChefe(A).pv} PV${A.pm ? ` e ${comoChefe(A).pm} PM` : ""}.` : ""; });
  const res = RES.map(([k, r]) => el("div", { className: "a-res" }, el("span", { className: "a-rot", textContent: r }),
    lista(A.res, k, COL_RES, { depois: () => trocarRes(k, A.res[k]) }), estatistica(k, "", () => A.res[k])));
  return secao(3, "Estatísticas de combate", "Pegue a linha do ND no papel da ameaça. Valor em laranja está fora da faixa ND−2…ND+2.",
    estatistica("defesa", "Defesa", () => "defesa"), estatistica("pv", "Pontos de Vida", () => "pv"), notaChefe, estatistica("cd", "CD das habilidades", () => "cd"),
    estatistica("atq", "Ataque (referência)", () => "atq"), estatistica("danoAlvo", "Dano médio por rodada", () => "dano"),
    el("h3", { className: "sub-perg", textContent: "Resistências" }),
    el("p", { className: "explica", textContent: "Grande e vigorosa → Fortitude forte; pequena e ágil → Reflexos; mental, mágica ou de intriga → Vontade." }),
    ...res, el("h3", { className: "sub-perg", textContent: "Pontos de mana" }),
    linhaC(campo("PM", numero(A, "pm", { min: 0, className: "a-n" })), el("p", { className: "explica", textContent: `Evite: prefira habilidade com recarga ou 1×/cena. Se o conceito pedir, 3 por ND (${nivelDoNd(A.nd) * 3}).` })),
    saldo);
}
function linhaAtaque(at, i) {
  const media = el("span", { className: "a-media" });
  const dados = el("input", { type: "text", value: at.dados, size: 9, placeholder: "1d8" });
  dados.onchange = () => { at.dados = (dados.value.replace(/\s+/g, "").match(/^\d+d\d+(?:\+\d+d\d+)*$/) || [""])[0]; dados.value = at.dados; atualizar(); };
  const passoBt = (n, r) => botao(r, () => { at.dados = passo(at.dados || "1d6", n); dados.value = at.dados; atualizar(); }, { title: n > 0 ? "sobe um passo de dano" : "desce um passo de dano" });
  const bonusDano = numero(at, "bonusDano", { className: "a-n" });
  const bonus = numero(at, "bonus", { className: "a-n" });
  const ref = el("div", { className: "a-chips" });
  vivo(() => {
    const v = at.complementar ? tab("atq", A.papel, ndMais(A.nd, -2)) : A.atq;
    if (document.activeElement !== bonus) bonus.value = at.bonus;
    if (document.activeElement !== bonusDano) bonusDano.value = at.bonusDano;
    ref.replaceChildren(v == null ? "" : el("button", { type: "button", className: "chip a-chip" + (v === at.bonus ? " on" : ""), title: at.complementar ? "ataque complementar: linha de 2 NDs abaixo" : "o Ataque do passo 3",
      onclick: () => { at.bonus = v; atualizar(); } }, el("small", { textContent: at.complementar ? `ND ${ndMais(A.nd, -2)}` : "ataque" }), ` ${sinal(v)}`));
    const m = danoMedio(at);
    media.textContent = `média ${m}${at.qtd > 1 ? ` × ${at.qtd} = ${m * at.qtd}` : ""} · alvo ${Math.round(alvoDe(at))}${at.qtd > 1 ? " cada" : ""}`;
  });
  const nome = txt(at, "nome", { placeholder: "ex.: Garra, Mordida, Espada longa" });
  nome.setAttribute("list", "a-armas-naturais"); // propriedade "list" do input é só leitura
  const extra = txt(at, "extra", { placeholder: "ex.: 1d8 ácido" }), resto = txt(at, "resto", { placeholder: "ex.: alcance 3m, agarrar" });
  nome.onchange = () => { if (!at.tipoDano && tipoPorArma(at.nome)) { at.tipoDano = tipoPorArma(at.nome); render(); } };
  return el("div", { className: "a-item" },
    linhaC(campo("Arma", nome), campo("Quantos", numero(at, "qtd", { min: 1, max: 20, className: "a-n" })),
      campo("Tipo", lista(at, "tipo", [["cac", "Corpo a corpo"], ["dist", "À distância"]])), campo("Ataque", el("div", { className: "a-dados" }, bonus, ref))),
    linhaC(campo("Dados", el("div", { className: "a-dados" }, passoBt(-1, "−"), dados, passoBt(1, "+"))), campo("Bônus de dano", bonusDano),
      campo("Tipo de dano", lista(at, "tipoDano", [["", "—"], ...TIPOS_DANO.map((t) => [t, t])])),
      campo("Crítico", el("div", { className: "a-dados" }, lista(at, "margem", [20, 19, 18, 17, 16, 15].map((n) => [n, n === 20 ? "20" : `${n}–20`]), { num: true }),
        lista(at, "mult", [2, 3, 4, 5].map((n) => [n, `x${n}`]), { num: true })))),
    linhaC(el("div", { className: "a-col" }, campo("Mais (dano extra)", extra), opcoes(at, "extra", extra, ["{1d6} fogo", "{1d6} ácido", "{1d6} frio", "{1d6} eletricidade", "{1d6} trevas", "veneno", "doença"])),
      el("div", { className: "a-col" }, campo("Observação", resto), opcoes(at, "resto", resto, ["alcance {3}m", "alcance curto", "alcance médio", "agarrar", "não letal"]))),
    el("label", { className: "a-check" }, marcar(at, "complementar", render), " ataque complementar (só dá cor: usa a linha de 2 NDs abaixo e não conta como habilidade)"),
    el("div", { className: "a-pe" }, media, botao("⚖ fechar a média", () => { at.bonusDano = bonusPraMedia(at, alvoDe(at)); bonusDano.value = at.bonusDano; atualizar(); },
      { title: "acerta o bônus fixo pro dano médio deste ataque bater com o alvo (dano médio ÷ número de ataques)" }),
      botao("✕ remover", () => { A.ataques.splice(i, 1); render(); })));
}
function passo4() {
  const resumo = el("p", { className: "explica a-saldo" });
  vivo(() => {
    const principais = A.ataques.filter((x) => !x.complementar), n = principais.reduce((s, x) => s + x.qtd, 0);
    const total = principais.reduce((s, x) => s + danoMedio(x) * x.qtd, 0);
    resumo.textContent = `Dano médio por rodada: ${total} (alvo ${A.danoAlvo ?? "—"}, tabela ${tab("dano") ?? "—"})`
      + (n > 3 ? " · mais de 3 ataques deixa o encontro lento (o livro só aceita em chefão)" : "");
  });
  const novoAtaque = (natural) => {
    const at = { nome: natural ? "Garra" : "", qtd: 1, tipo: "cac", bonus: A.atq ?? tab("atq") ?? 0, dados: natural ? passo("1d6", PASSO_TAM[A.tamanho] || 0) : "1d8",
      bonusDano: 0, tipoDano: natural ? "corte" : "", margem: 20, mult: 2, extra: "", resto: "", complementar: false, desc: "" };
    A.ataques.push(at); at.bonusDano = bonusPraMedia(at, alvoDe(at)); render();
  };
  // arma da coleção de itens: dado, crítico e tipo de dano do livro, um passo por tamanho (como a arma natural)
  const doArsenalItens = sugestao("✚ arma do arsenal (espada longa, arco…)", buscarColecao("itens", (it) => it.grupo === "Armas"), async (it) => {
    const st = await statsItem(it.id).catch(() => ({}));
    const cr = String(st.critico || ""), alcance = norm(st.alcance || "");
    const tipoDano = TIPOS_DANO.find((t) => norm(st["tipo de dano"] || "").startsWith(norm(t))) || tipoPorArma(it.nome);
    // à distância = tem alcance e não é arma de corpo a corpo que só "pode ser arremessada" (adaga, lança, machadinha)
    const d = norm(st.desc), dist = alcance && alcance !== "—" && !/corpo a corpo/.test(alcance) && !(/pode ser arremessad|arremessavel/.test(d) && !/-5 em ataques corpo a corpo/.test(d));
    const dado = String(st.dano || "").match(/\d+d\d+/)?.[0]; // rede, desmontador: sem dano, sem inventar
    const at = { nome: it.nome, qtd: 1, tipo: dist ? "dist" : "cac", bonus: A.atq ?? tab("atq") ?? 0,
      dados: dado ? passo(dado, PASSO_TAM[A.tamanho] || 0) : "", bonusDano: 0, tipoDano,
      margem: Number((cr.match(/^(\d{2})/) || [])[1]) || 20, mult: Number((cr.match(/x(\d+)/i) || [])[1]) || 2, extra: "", resto: "", complementar: false, desc: "" };
    A.ataques.push(at); at.bonusDano = bonusPraMedia(at, alvoDe(at));
    acrescentar(A, "equipamento", minuscula(it.nome));
    render();
  }, "a-base a-arma");
  return secao(4, "Ataques", "Divida o dano médio entre os ataques (ou concentre num golpe só) e complete com bônus fixo. Arma natural: 1d6 em Pequeno/Médio, um passo a menos em Minúsculo, um a mais em Grande/Enorme, dois em Colossal.",
    ...A.ataques.map(linhaAtaque),
    el("div", { className: "a-pe" }, botao("✚ arma natural", () => novoAtaque(true)), botao("✚ outra arma", () => novoAtaque(false)), doArsenalItens,
      A.ataques.length > 1 ? botao("⚖ fechar a média em todos", () => { for (const at of A.ataques) at.bonusDano = bonusPraMedia(at, alvoDe(at)); atualizar(); }) : null), resumo);
}
const vazioH = (v) => v == null || v === "" || v === 0 || (Array.isArray(v) && !v.length);
const USOS = ["recarga (movimento)", "uma vez por rodada", "uma vez por cena", "sustentada"];
const ALVOS = ["uma criatura", "criaturas escolhidas", "todas as criaturas na área", "aliados", "você"];
// medido nas 620 fichas do bestiário: dano de uma habilidade ÷ dano por rodada da linha do ND, por patamar (não é tabela do livro)
const FRACAO_HAB = { area: [0.59, 0.5, 0.31, 0.19], alvo: [0.44, 0.32, 0.19, 0.18] };
const mecAbertas = new WeakSet(); // habilidades com a caixa de mecânica aberta (sobrevive ao render)
// "Cone 12m · 3d6+10 fogo · Reflexos reduz à metade (CD 22) · em chamas por 1 rodada" = o que o Foundry vai receber
function resumoMecanica(h) {
  const c = mecanicaEfetiva(h);
  const partes = [h.acao || "passiva", c.forma && `${c.forma} ${String(c.metros || 0).replace(".", ",")}m`, c.alcance && `alcance ${c.alcance}`, c.alvo,
    c.danos?.length && c.danos.map((d) => [d.formula, d.tipo].filter(Boolean).join(" ")).join(" + "),
    c.teste && `${TESTES[c.teste][1]} ${c.efeitoTeste || ""} (CD ${A.cd ?? "—"})`.replace("  ", " "),
    c.condicoes?.length && `${c.condicoes.join(", ")}${c.duracao === "rodadas" ? ` por ${c.duracaoN || 1} rodada(s)` : c.duracao === "cena" ? " na cena" : ""}`,
    !c.condicoes?.length && c.duracao && c.duracao !== "instantânea" && `duração: ${c.duracao}${c.duracao === "rodadas" ? ` ${c.duracaoN || 1}` : ""}`].filter(Boolean);
  return `→ no Foundry: ${partes.join(" · ")}${c.doTexto.length ? ` (${c.doTexto.filter((k) => !["metros", "duracaoN", "efeitoTeste"].includes(k)).join(", ")} lido do texto)` : ""}`;
}
function mecanicaHab(h) {
  const box = el("details", { className: "a-mec", open: mecAbertas.has(h), ontoggle: (e) => (e.target.open ? mecAbertas.add(h) : mecAbertas.delete(h)) });
  // select ligado num campo opcional: vazio apaga o campo (o modelo só guarda a mecânica preenchida)
  const sel = (k, opcoesSel, depois = render) => {
    const s = el("select", {}, ...opcoesSel.map(([v, r]) => el("option", { value: v, textContent: r })));
    s.value = h[k] ?? "";
    s.onchange = () => { if (s.value) h[k] = s.value; else delete h[k]; depois(); };
    return s;
  };
  const forma = sel("forma", [["", "— sem área"], ...FORMAS.map((f) => [f, f === "raio" ? "raio (em volta dela)" : f])], () => { if (h.forma) h.metros ||= 6; else delete h.metros; render(); });
  const metros = el("input", { type: "number", className: "a-n", step: 1.5, min: 0, value: h.metros ?? "", disabled: !h.forma, title: "tamanho da área em metros" });
  metros.oninput = () => { h.metros = Math.max(0, Number(metros.value) || 0); atualizar(); };
  const alvo = txt(h, "alvo", { placeholder: "ex.: uma criatura" });
  alvo.oninput = () => { if (alvo.value.trim()) h.alvo = alvo.value; else delete h.alvo; atualizar(); };
  // danos: fórmula + tipo, como as partes de dano do Foundry
  const linhaDano = (d, j) => {
    const f = el("input", { type: "text", value: d.formula, placeholder: "3d6+10", className: "a-formula" });
    f.onchange = () => { const v = formulaOk(f.value); if (v) d.formula = v; f.value = d.formula; atualizar(); }; // "6d6 fogo" não é fórmula: volta o valor anterior
    const passoF = (n, r) => botao(r, () => { const m = d.formula.match(/^(\d+d\d+)(.*)$/); d.formula = m ? passo(m[1], n) + m[2] : passo("1d6", 0); f.value = d.formula; atualizar(); },
      { title: n > 0 ? "sobe um passo de dano" : "desce um passo de dano" });
    const tipo = el("select", {}, el("option", { value: "", textContent: "— tipo" }), ...TIPOS_HAB.map((t) => el("option", { value: t, textContent: t })));
    tipo.value = d.tipo || "";
    tipo.onchange = () => { d.tipo = tipo.value; atualizar(); };
    return el("div", { className: "a-dados" }, passoF(-1, "−"), f, passoF(1, "+"), tipo, botao("✕", () => { h.danos.splice(j, 1); if (!h.danos.length) delete h.danos; render(); }, { title: "tirar" }));
  };
  const refDano = el("small", { className: "a-conta" });
  vivo(() => {
    const total = (h.danos || []).filter((d) => d.tipo !== "cura").reduce((s, d) => { const x = danoDoTexto(d.formula); return s + danoMedio({ dados: x.dados, bonusDano: x.bonusDano }); }, 0);
    const fr = FRACAO_HAB[h.forma ? "area" : "alvo"][patamarDoNd(A.nd) - 1], linha = tab("dano");
    refDano.textContent = (total ? `média ${total} · ` : "") + (linha ? `nas fichas do livro, dano de habilidade ${h.forma ? "em área" : "de alvo único"} nesse patamar fica perto de ${Math.round(fr * linha)} (${Math.round(fr * 100)}% do dano por rodada da linha; sopro ~60%)` : "");
  });
  const efeito = sel("efeitoTeste", [["", "— efeito"], ...EFEITOS_TESTE.map((e) => [e, e])], atualizar);
  efeito.disabled = !h.teste;
  const teste = sel("teste", [["", "sem teste"], ...Object.entries(TESTES).map(([k, [, nome]]) => [k, nome])], () => { if (!h.teste) delete h.efeitoTeste; else h.efeitoTeste ||= "evita"; render(); });
  const conds = el("div", { className: "a-chips" }, ...(h.condicoes || []).map((c, j) => el("button", { type: "button", className: "chip a-chip on", textContent: `${c} ✕`, title: "tirar",
    onclick: () => { h.condicoes.splice(j, 1); if (!h.condicoes.length) delete h.condicoes; render(); } })));
  const addCond = el("select", {}, el("option", { value: "", textContent: "✚ condição…" }), ...CONDICOES_NOMES.filter((c) => !(h.condicoes || []).includes(c)).map((c) => el("option", { value: c, textContent: c })));
  addCond.onchange = () => { if (addCond.value) { (h.condicoes ||= []).push(addCond.value); render(); } };
  const dur = sel("duracao", Object.keys(DURACOES).map((k) => [k, k || "— duração"]), () => { if (h.duracao === "rodadas") h.duracaoN ||= "1"; else delete h.duracaoN; render(); });
  const durN = el("input", { type: "text", value: h.duracaoN ?? "", size: 4, placeholder: "1d4", hidden: h.duracao !== "rodadas", title: "quantas rodadas (número ou dado)" });
  durN.onchange = () => { const v = durN.value.replace(/\s+/g, ""); if (/^\d{1,3}(?:d\d{1,3})?$/.test(v)) h.duracaoN = v; durN.value = h.duracaoN || ""; atualizar(); };
  const resumo = el("small", { className: "a-ro" });
  vivo(() => { resumo.textContent = resumoMecanica(h); });
  const lerTexto = () => { for (const [k, v] of Object.entries(camposDoTexto(h.desc))) if (vazioH(h[k])) h[k] = v; mecAbertas.add(h); render(); };
  const ROT_CAMPO = { teste: "teste", danos: "dano", forma: "área", alcance: "alcance", duracao: "duração", condicoes: "condições" };
  const lidos = mecanicaEfetiva(h).doTexto.map((k) => ROT_CAMPO[k]).filter(Boolean);
  const escrever = () => {
    const t = descDosCampos(mecanicaEfetiva(h), A.cd);
    if (!t || (h.desc && h.desc !== t && !confirm("Trocar o texto atual pelo texto montado dos campos?"))) return;
    h.desc = t; render();
  };
  box.append(el("summary", { textContent: "⚙ mecânica: área, dano, teste e condição (o que vira campo no Foundry)" }),
    linhaC(campo("Área", el("div", { className: "a-dados" }, forma, metros, el("span", { className: "a-mais", textContent: "m" }))),
      campo("Alcance", sel("alcance", Object.keys(ALCANCES).map((k) => [k, k || "—"]), atualizar))),
    campo("Alvo", alvo), opcoes(h, "alvo", alvo, ALVOS),
    el("div", { className: "campo" }, el("span", { textContent: "Dano ou cura" }), ...(h.danos || []).map(linhaDano),
      el("div", { className: "a-pe" }, botao("✚ dano", () => { (h.danos ||= []).push({ formula: passo("1d6", 0), tipo: "" }); render(); }), refDano)),
    campo("Teste de resistência", el("div", { className: "a-dados a-quebra" }, teste, efeito),
      el("small", { className: "a-conta", textContent: `CD ${A.cd ?? "—"}, a da ficha (no Foundry toda habilidade de NPC usa ela)` })),
    el("div", { className: "campo" }, el("span", { textContent: "Condições que impõe" }), conds, addCond),
    campo("Duração", el("div", { className: "a-dados" }, dur, durN, h.duracao === "rodadas" ? el("span", { className: "a-mais", textContent: "rodadas" }) : null)),
    el("div", { className: "a-pe" }, botao(lidos.length ? `🔎 preencher pelo texto (${lidos.join(", ")})` : "🔎 ler do texto", lerTexto,
      { title: "preenche os campos vazios com o que achar no texto (área, dano, teste, condições, duração)" }),
      botao("✍ escrever o texto pelos campos", escrever, { title: "monta o 'O que faz' no formato do livro a partir dos campos" })));
  return [box, resumo];
}
function linhaHab(h, i) {
  const uso = txt(h, "extra", { placeholder: "ex.: recarga (movimento)" });
  return el("div", { className: "a-item" },
    linhaC(campo("Habilidade", txt(h, "nome", { placeholder: "ex.: Sopro de fogo" })), campo("Ação", lista(h, "acao", Object.keys(ACOES).map((a) => [a, a || "passiva"]))),
      campo("PM", numero(h, "custo", { min: 0, className: "a-n" })),
      el("label", { className: "a-check", title: "habilidade mágica: suprimida por Campo Antimagia e o dano dela ignora RD/mágico" }, marcar(h, "magica"), " mágica ⚝")),
    campo("Uso e limite", uso), opcoes(h, "extra", uso, USOS),
    campo("O que faz", area(h, "desc", { rows: 3, placeholder: "ex.: Cone de 9m. 6d6 fogo (Ref CD 20 reduz à metade)." })),
    ...mecanicaHab(h),
    el("div", { className: "a-pe" }, i ? botao("↑", () => { A.habilidades.splice(i - 1, 0, ...A.habilidades.splice(i, 1)); render(); }, { title: "subir" }) : null,
      botao("✕ remover", () => { A.habilidades.splice(i, 1); render(); })));
}
function passo5() {
  const conta = el("p", { className: "explica a-saldo" });
  vivo(() => {
    const p = patamarDoNd(A.nd), [min, max] = A.papel === "especial" ? [2 * p, 3 * p] : [p, 2 * p];
    const ataqueImportante = new Set(A.ataques.filter((x) => !x.complementar).map((x) => x.tipo)).size > 1 ? 1 : 0; // 2º tipo de ataque importante conta
    const n = A.habilidades.length + ataqueImportante;
    conta.textContent = `${n} habilidade${n === 1 ? "" : "s"}${ataqueImportante ? " (conta o 2º tipo de ataque)" : ""} · o livro sugere ${min} a ${max} pra ${A.papel} desse patamar`
      + (n < min ? " — dá pra pôr mais" : n > max ? " — passou; tudo bem se várias forem passivas simples" : " ✓")
      + `. Resistência com CD ${A.cd ?? "—"}.`;
  });
  const busca = el("input", { type: "search", className: "g-busca", placeholder: "biblioteca: habilidades das 620 fichas do bestiário (agarrar, sopro, faro, veneno…)" });
  const achados = el("div", { className: "a-biblio" });
  let timer;
  const procurar = async () => {
    try {
      const r = await (await fetch(`/api/criador/ameacas-habilidades?q=${encodeURIComponent(busca.value)}`)).json();
      achados.replaceChildren(...r.slice(0, busca.value ? 20 : 12).map((g) => el("div", { className: "a-biblio-item" },
        el("div", {}, el("b", { textContent: g.nome }), el("small", { textContent: ` ${[g.acao || "passiva", g.custo ? `${g.custo} PM` : "", g.extra].filter(Boolean).join(", ")} · ${g.n} ficha${g.n === 1 ? "" : "s"}` })),
        el("div", { className: "a-biblio-desc", textContent: g.desc }), el("small", { className: "a-biblio-de", textContent: `exemplo: ${g.de}` }),
        botao("✚ usar", () => {
          const desc = A.cd ? g.desc.replace(/\bCD \d+\b/g, `CD ${A.cd}`) : g.desc, n = norm(desc);
          const uso = g.extra || (n.match(/\brecarga \((\w+)\)/) ? `recarga (${n.match(/\brecarga \((\w+)\)/)[1]})` : /\buma vez por rodada\b/.test(n) ? "uma vez por rodada" : /\buma vez por cena\b/.test(n) ? "uma vez por cena" : "");
          const h = { nome: g.nome, acao: g.acao || "", custo: g.custo || 0, magica: !!g.magica, extra: uso, desc, ...camposDoTexto(desc) };
          A.habilidades.push(h); mecAbertas.add(h);
          render();
        }))));
    } catch { achados.textContent = "biblioteca indisponível"; }
  };
  busca.oninput = () => { clearTimeout(timer); timer = setTimeout(procurar, 250); };
  const biblio = el("details", { className: "a-biblio-box", ontoggle: (e) => { if (e.target.open && !achados.childElementCount) procurar(); } },
    el("summary", { textContent: "📚 pegar de uma ficha do bestiário (a CD do texto vira a desta ameaça)" }), busca, achados);
  return secao(5, "Habilidades", "Na ordem do livro: ataque, defesa, percepção e movimento, variadas. Misture passivas e ativadas; prefira recarga e 1×/cena a PM. Solo e chefão precisam de área ou vários ataques. Habilidade nova: baseie numa magia parecida.",
    el("p", { className: "explica", textContent: "Em ⚙ mecânica ficam a área, o dano, o teste e as condições: é o que vira campo de verdade no Foundry (molde de área no mapa, rolagem de dano com tipo, botão de aplicar condição). Campo vazio é lido do texto; dá pra montar o texto a partir dos campos." }),
    ...A.habilidades.map(linhaHab), el("div", { className: "a-pe" }, botao("✚ habilidade", () => { const h = { nome: "", acao: "", custo: 0, magica: false, extra: "", desc: "" }; A.habilidades.push(h); mecAbertas.add(h); render(); })),
    biblio, conta);
}
function linhaPer(p, i, fixa) {
  const e = estadoPer(p), st = { ...e };
  const valor = el("b", { className: "a-valor" });
  const aplica = () => { p.treinado = st.treinado; p.valor = valorPer(p.nome, st.treinado, st.extra); atualizar(); };
  const ex = el("input", { type: "number", value: st.extra, className: "a-n", title: "especialidade: +2 hábil, +5 racial ou muito hábil, +10 excepcional ou mágica",
    oninput: () => { st.extra = Math.trunc(Number(ex.value)) || 0; aplica(); } });
  const conta = el("small", { className: "a-conta" });
  vivo(() => {
    valor.textContent = sinal(p.valor);
    const abl = ablDe(p.nome), atr = A.atributos[abl];
    conta.textContent = abl ? `= ½ ND ${meioNd(A.nd)} + ${abl[0].toUpperCase() + abl.slice(1)} ${atr == null ? "–" : sinal(atr)}${norm(p.nome) === "furtividade" && TAM_INFO[A.tamanho]?.[1] ? ` + tamanho ${sinal(TAM_INFO[A.tamanho][1])}` : ""}${st.treinado ? ` + treino ${treinoDoNd(A.nd)}` : ""}${st.extra ? ` + ${st.extra}` : ""}` : "";
  });
  return el("div", { className: "a-per" }, el("span", { className: "a-rot", textContent: p.nome }),
    el("label", { className: "a-check" }, el("input", { type: "checkbox", checked: st.treinado, onchange: (ev) => { st.treinado = ev.target.checked; aplica(); } }), " treinada"),
    el("span", { className: "a-mais", textContent: "especialidade" }), ex, el("span", { className: "a-mais", textContent: "→" }), valor, conta,
    txt(p, "obs", { placeholder: "ex.: +5 para escalar" }), fixa ? el("span") : botao("✕", () => { A.pericias.splice(i, 1); render(); }, { title: "tirar" }));
}
function mudarAtributos(novos) {
  const antes = { ...A.atributos };
  Object.assign(A.atributos, novos);
  recalcularPericias(A.nd, antes);
}
// fichas do bestiário mais parecidas (tipo, subtipo, tamanho, ND): referência pros atributos, sentidos e defesas
const cacheParecidas = new Map();
function parecidas() {
  const q = new URLSearchParams({ tipo: A.tipo, subtipo: A.subtipo, tamanho: A.tamanho, nd: A.nd }).toString();
  if (!cacheParecidas.has(q)) cacheParecidas.set(q, fetch(`/api/criador/ameacas-parecidas?${q}`).then((r) => (r.ok ? r.json() : [])).catch(() => []));
  return cacheParecidas.get(q);
}
const atrLinha = (atr) => ATRIBUTOS.map((k) => `${k[0].toUpperCase() + k.slice(1)} ${atr?.[k] == null ? "–" : sinal(atr[k]).replace("+", "")}`).join(" · ");
function passo6() {
  const cats = R.categorias || [];
  const faixaCat = (c) => (c.max >= 99 ? `${c.min}+` : c.min === c.max ? sinal(c.min) : `${sinal(c.min)} a ${sinal(c.max)}`);
  const atrs = ATRIBUTOS.map((k) => {
    const i = el("input", { type: "number", className: "a-n", value: A.atributos[k] ?? "", placeholder: "–", title: "vazio = atributo nulo (–): a criatura não tem e não pode usar. No Foundry vira 0 (o sistema não tem atributo nulo); aqui o nulo fica guardado" });
    i.oninput = () => {
      const v = i.value.trim() === "" ? null : Math.trunc(Number(i.value));
      if (v !== null && !Number.isFinite(v)) return;
      mudarAtributos({ [k]: v }); atualizar();
    };
    // Tabela 2-4: escolher a categoria põe o menor valor dela (Excelente = 4); dá pra subir 1 no número
    const cat = el("select", { className: "a-cat", title: "Tabela 2-4: categoria do atributo" }, el("option", { value: "nulo", textContent: "nulo (–)" }),
      ...cats.map((c, j) => el("option", { value: String(j), textContent: `${c.nome} (${faixaCat(c)})` })));
    cat.onchange = () => { mudarAtributos({ [k]: cat.value === "nulo" ? null : cats[cat.value].min }); atualizar(); };
    vivo(() => {
      const v = A.atributos[k];
      if (document.activeElement !== i) i.value = v ?? "";
      cat.value = v == null ? "nulo" : String(Math.max(0, cats.findIndex((c) => v >= c.min && v <= c.max)));
    });
    return el("label", { className: "campo a-atr" }, el("span", { textContent: k[0].toUpperCase() + k.slice(1) }), i, cat);
  });
  const ref = el("div", { className: "a-biblio" });
  parecidas().then((lista) => ref.replaceChildren(...lista.map((p) => el("div", { className: "a-biblio-item a-parecida" },
    el("div", {}, el("b", { textContent: p.nome }), el("small", { textContent: ` ND ${p.nd} · ${p.linha}` })),
    el("div", { className: "a-biblio-desc", textContent: atrLinha(p.atributos) }),
    p.sentidos || p.defesas ? el("small", { className: "a-biblio-de", textContent: [p.sentidos, p.defesas].filter(Boolean).join(" · ") }) : null,
    botao("usar estes atributos", () => { mudarAtributos({ ...p.atributos }); render(); })))));
  const parecidasBox = el("details", { className: "a-biblio-box" }, el("summary", { textContent: "📚 atributos de fichas parecidas no bestiário (mesmo tipo, tamanho e ND por perto)" }), ref);
  const usadas = new Set(A.pericias.map((p) => p.nome));
  const novas = Object.keys(PERICIAS).filter((n) => !usadas.has(n) && !["Fortitude", "Reflexos", "Vontade", "Luta", "Pontaria"].includes(n));
  const add = el("select", {}, el("option", { value: "", textContent: "✚ perícia…" }), ...novas.map((n) => el("option", { value: n, textContent: n })));
  add.onchange = () => { if (add.value) { A.pericias.push({ nome: add.value, valor: valorPer(add.value, true, 0), obs: "", treinado: true }); render(); } };
  const sentidos = txt(A, "sentidos", { placeholder: "ex.: visão no escuro, faro" }), defesas = txt(A, "defesas", { placeholder: "ex.: imunidade a fogo, redução de dano 10, vulnerabilidade a frio" });
  const p = patamarDoNd(A.nd) - 1; // valores típicos por patamar medidos no bestiário (RD, resistência a magia, cura acelerada)
  // montador de defesas: "+ imunidade a…", "+ vulnerabilidade a…", "+ redução de…" acrescentam a frase no formato que o export entende
  const montar = (rotulo, grupos, frase) => {
    const s = el("select", {}, el("option", { value: "", textContent: rotulo }),
      ...grupos.map(([g, xs]) => el("optgroup", { label: g }, ...xs.map((x) => el("option", { value: x, textContent: x })))));
    s.onchange = () => {
      if (!s.value) return;
      const t = frase(s.value), limpo = t.replace(/[{}]/g, "");
      acrescentar(A, "defesas", limpo); defesas.value = A.defesas; atualizar();
      const i = t.indexOf("{"), pos = A.defesas.lastIndexOf(limpo);
      if (i >= 0 && pos >= 0) { defesas.focus(); defesas.setSelectionRange(pos + i, pos + t.indexOf("}") - 1); }
      s.value = "";
    };
    return s;
  };
  const IMUNES = ["medo", "paralisia", "atordoamento", "acertos críticos", "veneno", "doenças", "cansaço", "efeitos de metabolismo", "efeitos mentais", "encantamento",
    "metamorfose", "efeitos de movimento", "efeitos de sentidos", "caído", "sangrando"];
  const RD = [5, 5, 10, 20][p], RM = [2, 2, 4, 5][p], CURA = [5, 10, 20, 50][p];
  const construtor = el("div", { className: "a-pe" },
    montar("+ imunidade a…", [["tipo de dano", TIPOS_DANO], ["condição ou efeito", IMUNES]], (x) => `imunidade a ${x}`),
    montar("+ redução de dano…", [["geral", ["dano"]], ["só de um tipo", TIPOS_DANO]], (x) => `redução de ${x} {${RD}}`),
    montar("+ vulnerabilidade a…", [["tipo de dano", TIPOS_DANO]], (x) => `vulnerabilidade a ${x}`));
  const leitura = (fn) => { const t = el("small", { className: "a-ro" }); vivo(() => { t.textContent = fn(); }); return t; };
  const lerDefesas = () => {
    const tr = tracosDe(A.defesas), R2 = tr.resistencias, ks = Object.keys(R2);
    const partes = [ks.filter((k) => R2[k].imunidade).length && `imune a ${ks.filter((k) => R2[k].imunidade).join(", ")}`,
      R2.dano?.base && `RD ${R2.dano.base}`, ...ks.filter((k) => k !== "dano" && R2[k].base).map((k) => `RD ${R2[k].base} contra ${k}`),
      ks.filter((k) => R2[k].vulnerabilidade).length && `vulnerável a ${ks.filter((k) => R2[k].vulnerabilidade).join(", ")}`,
      tr.ic.length && `imune às condições/efeitos ${tr.ic.join(", ")}`, tr.magia && `resistência a magia +${tr.magia} (caixinha nos testes)`].filter(Boolean);
    return A.defesas ? `→ no Foundry: ${partes.join(" · ") || "nada vira campo"}${tr.resto ? ` · fica como texto na ficha: ${tr.resto}` : ""}` : "";
  };
  const lerSentidos = () => {
    const sd = sentidosDe(A.sentidos), luz = luzDe(A), rot = { penumbra: "visão na penumbra", escuro: "visão no escuro", cegas: "percepção às cegas", faro: "faro" };
    return A.sentidos ? `→ no Foundry: ${[sd.value.map((k) => rot[k]).join(", "), luz && `luz do token ${luz}m (penumbra ${luz * 2}m)`, sd.custom && `texto: ${sd.custom}`].filter(Boolean).join(" · ") || "só texto"}` : "";
  };
  return secao(6, "Atributos, perícias e sentidos", `Atributos vêm do conceito e não mexem nos números de combate. Perícia = metade do ND + atributo + treino (+${treinoDoNd(A.nd)} neste ND); perícia que não estiver na lista vale metade do ND + atributo. Luta e Pontaria são o próprio ataque.`,
    el("div", { className: "a-atrs" }, ...atrs), parecidasBox,
    el("h3", { className: "sub-perg", textContent: "Perícias" }),
    ...A.pericias.map((p, i) => linhaPer(p, i, i < 2 && ["Iniciativa", "Percepção"].includes(p.nome))), add,
    el("h3", { className: "sub-perg", textContent: "Sentidos e defesas especiais" }),
    campo("Sentidos (vão junto da Percepção)", sentidos),
    opcoes(A, "sentidos", sentidos, ["visão no escuro", "visão na penumbra", "faro", "percepção às cegas", "sensibilidade a luz", "emite luz em {6}m"]), leitura(lerSentidos),
    campo("RD, imunidades, resistências e vulnerabilidades", defesas), construtor,
    opcoes(A, "defesas", defesas, [`resistência a magia +{${RM}}`, "evasão", "evasão aprimorada", "incorpóreo", "fortificação {25}%", `cura acelerada {${CURA}}`, "maior que a morte"]),
    leitura(lerDefesas));
}
function passo7() {
  const cd = el("p", { className: "explica" });
  vivo(() => { cd.textContent = `Recurso extraível (couro, veneno, éter…): 1 hora e Sobrevivência ou Ofício CD ${15 + (A.nd.includes("/") ? 0 : nivelDoNd(A.nd))}.`; });
  const tesouro = txt(A, "tesouro", { placeholder: "ex.: Padrão, 1d4 doses de veneno" });
  const atual = ["Nenhum", "Metade", "Padrão", "Dobro"].find((t) => norm(A.tesouro).startsWith(norm(t))) || "";
  const equip = txt(A, "equipamento", { placeholder: "ex.: espada longa, couraça" }), nota = el("p", { className: "explica a-saldo" });
  const porItem = sugestao("🔎 procurar nos itens (armas, armaduras, poções, itens mágicos…)", buscarColecao("itens"), async (it) => {
    acrescentar(A, "equipamento", minuscula(it.nome)); equip.value = A.equipamento; atualizar();
    const st = await statsItem(it.id).catch(() => ({}));
    const bonus = num(st["bonus defesa"]);
    nota.textContent = bonus ? `${it.nome}: +${bonus} na Defesa. A Defesa da ficha (${A.defesa}) é o total e já deve contar a armadura — no Foundry ela vai só como texto, sem somar de novo.`
      : st.dano ? `${it.nome}: ${st.dano}${st.critico ? `, ${st.critico}` : ""}. Pra virar ataque, use "✚ arma do arsenal" no passo 4.` : "";
  });
  const noTesouro = sugestao("🔎 item no tesouro…", buscarColecao("itens"), (it) => { acrescentar(A, "tesouro", minuscula(it.nome)); tesouro.value = A.tesouro; atualizar(); });
  const extraivel = el("div", { className: "a-pe" });
  vivo(() => {
    const cdx = 15 + (A.nd.includes("/") ? 0 : nivelDoNd(A.nd)), qtd = { "Minúsculo": 0, Pequeno: 1, "Médio": 1, Grande: 2, Enorme: 2, Colossal: 5 }[A.tamanho] ?? 1;
    const valor = ["T$ 20 (pra itens normais)", "T$ 100 (superiores)", "T$ 500 (mágicos)", "T$ 2.500"][patamarDoNd(A.nd) - 1], q = Math.max(1, qtd);
    const RECURSOS = [["peça de couro", "peças de couro"], ["dose de peçonha", "doses de peçonha"], ["dose de sangue", "doses de sangue"], ["presa", "presas"],
      ...(/\belemental\b/.test(norm(A.subtipo)) ? [["dose de éter elemental", "doses de éter elemental"]] : [])];
    extraivel.replaceChildren(el("small", { className: "a-conta", textContent: `${A.tamanho}: ${qtd || "nenhum"} recurso${qtd === 1 ? "" : "s"} pelo livro${qtd ? "" : " (mas há fichas Minúsculas que dão 1)"}; cada um vale ${valor}` }),
      ...RECURSOS.map(([um, varios]) => botao(`+ ${q} ${q === 1 ? um : varios}`, () => {
        acrescentar(A, "tesouro", `${q} ${q === 1 ? um : varios} (CD ${cdx} para extrair)`); tesouro.value = A.tesouro; atualizar();
      }, { title: `recurso extraível do corpo: 1 hora e Sobrevivência ou Ofício CD ${cdx}` })));
  });
  return secao(7, "Equipamento e tesouro", "Equipamento é cosmético (os números já existem), mas não pode contradizer a ficha: Defesa baixa não combina com armadura completa.",
    campo("Equipamento", equip), porItem, nota,
    el("div", { className: "a-linha-seg" }, el("span", { className: "a-rot", textContent: "Tesouro" }),
      segmentos(atual, ["Nenhum", "Metade", "Padrão", "Dobro"].map((t) => [t, t]), (v) => { A.tesouro = [v, A.tesouro.replace(/^(nenhum|metade|padr[aã]o|dobro)\.?,?\s*/i, "")].filter(Boolean).join(", "); render(); })),
    campo("Detalhe do tesouro", tesouro), noTesouro, cd, extraivel);
}

// chefe final: a criatura dos passos acima continua sendo a base; o ajuste (PV ×2, PM +2/ND, Maior que a Morte, RD) sai na ficha
let chefeGuardado = null; // desligar e religar não perde arena e recursos — só da mesma ameaça (pelo id, ou pelo objeto se não foi salva)
function passo8() {
  const PAT = ["", "iniciante", "veterano", "campeão", "lenda"], p = patamarDoNd(A.nd);
  const liga = el("label", { className: "a-check" }, el("input", { type: "checkbox", checked: !!A.chefe, onchange: (e) => {
    if (e.target.checked) A.chefe = chefeGuardado?.de === (id ?? A) ? chefeGuardado.c : { arena: "", efeitoArena: "", recursos: [] };
    else { chefeGuardado = { de: id ?? A, c: A.chefe }; A.chefe = null; }
    render();
  } }), " 👑 esta ameaça é o chefe final da aventura");
  const dica = "Não é só uma criatura mais forte (pra isso basta ND maior): é o confronto marcante da última batalha, com ataques amplos que desafiam o grupo todo. Melhor solo ou especial; lacaio não serve.";
  if (!A.chefe) return secao(8, "Chefe final (opcional)", dica, liga);
  const c = A.chefe, cat = R.chefe || { arenas: [], recursos: [] };
  const resumo = el("p", { className: "explica a-saldo" });
  vivo(() => {
    const f = comoChefe(A), rd = RD_CHEFE[patamarDoNd(A.nd)], n = c.recursos.length, quer = 2 * patamarDoNd(A.nd);
    resumo.textContent = `Na ficha: PV ${A.pv} → ${f.pv}${A.pm ? ` · PM ${A.pm} → ${f.pm}` : ""} · Maior que a Morte · ${rd ? `RD +${rd} (${PAT[patamarDoNd(A.nd)]})` : "sem RD (iniciante)"}`
      + ` · XP e tesouro de ND ${ndRecompensa(A)}` + (c.arena || n ? ` · ${n} recurso${n === 1 ? "" : "s"} (o livro pede ${quer}: 2 por patamar)${n === quer ? " ✓" : ""}` : "");
  });
  const previa = (texto) => { const t = el("small", { className: "a-conta" }); vivo(() => { const r = porPatamar(texto(), patamarDoNd(A.nd)); t.textContent = r !== texto() ? `neste patamar (${PAT[patamarDoNd(A.nd)]}): ${r}` : ""; }); return t; };
  const arenaSel = el("select", {}, el("option", { value: "", textContent: "— sem arena / escolher…" }), ...cat.arenas.map((x) => el("option", { value: x.nome, textContent: x.nome })),
    el("option", { value: "*", textContent: "arena própria…" }));
  const propria = (c.arena || c.efeitoArena) && !cat.arenas.some((x) => x.nome === c.arena);
  arenaSel.value = cat.arenas.some((x) => x.nome === c.arena) ? c.arena : propria ? "*" : "";
  arenaSel.onchange = () => {
    const x = cat.arenas.find((y) => y.nome === arenaSel.value);
    if (x) Object.assign(c, { arena: x.nome, efeitoArena: x.efeito });
    else if (arenaSel.value === "*") Object.assign(c, { arena: c.arena && !cat.arenas.some((y) => y.nome === c.arena) ? c.arena : "Arena", efeitoArena: "" });
    else Object.assign(c, { arena: "", efeitoArena: "" });
    render();
  };
  const linhaRec = (r, i) => el("div", { className: "a-item" },
    linhaC(campo("Recurso", txt(r, "nome", { maxLength: 60 })), el("div", { className: "a-pe" }, botao("✕ remover", () => { c.recursos.splice(i, 1); render(); }))),
    campo("Efeito (valores a/b/c/d = iniciante/veterano/campeão/lenda)", area(r, "efeito", { rows: 2 })), previa(() => r.efeito));
  const usados = new Set(c.recursos.map((r) => r.nome));
  const addRec = el("select", {}, el("option", { value: "", textContent: "✚ recurso…" }), ...cat.recursos.filter((x) => !usados.has(x.nome)).map((x) => el("option", { value: x.nome, textContent: x.nome, title: x.efeito })),
    el("option", { value: "*", textContent: "recurso próprio" }));
  addRec.onchange = () => {
    const x = cat.recursos.find((y) => y.nome === addRec.value);
    if (addRec.value) { c.recursos.push(x ? { nome: x.nome, efeito: x.efeito } : { nome: "", efeito: "" }); render(); }
  };
  return secao(8, "Chefe final (opcional)", dica, liga, resumo,
    el("h3", { className: "sub-perg", textContent: "Arquétipo: Rei da Arena" }),
    el("p", { className: "explica", textContent: `No domínio dele o chefe é quase invencível. A arena tem um efeito em toda a área (só em quem o chefe escolher); os recursos são objetos, mecanismos ou criaturas que dão habilidades a ele e podem ser sabotados. No fim do turno de cada personagem ele ganha uma ação de movimento só pra ativar um recurso. CD de tudo = CD da ficha (${A.cd ?? "—"}); identificar um recurso: CD ${15 + nivelDoNd(A.nd)}.` }),
    linhaC(campo("Arena", arenaSel), propria ? campo("Nome da arena", txt(c, "arena", { maxLength: 60 })) : null),
    c.arena || c.efeitoArena ? campo("Efeito da arena", area(c, "efeitoArena", { rows: 2 })) : null, c.arena || c.efeitoArena ? previa(() => c.efeitoArena) : null,
    el("p", { className: "explica", textContent: "Efeito que melhora os números do próprio chefe (Templo, Anfiteatro, Linhas de Mana, Coração de Gigante) fica como texto; o exemplo do livro já soma na ficha — se quiser igual, ajuste os passos acima." }),
    el("h3", { className: "sub-perg", textContent: `Recursos (${2 * p} pra um chefe ${PAT[p]})` }),
    ...c.recursos.map(linhaRec), addRec);
}

// ---------------------------------------------------------------- barra, lado e montagem
function montarBarra() {
  const estado = el("span", { className: "a-sujo" });
  vivo(() => { estado.textContent = sujo() ? "● não salvo" : id ? "✓ salvo" : ""; });
  const escolher = el("select", { title: "abrir uma ameaça sua" }, el("option", { value: "", textContent: `📂 minhas ameaças (${minhas.length})` }),
    ...minhas.map((m) => el("option", { value: m.id, textContent: `${m.nome} · ND ${m.nd} · ${m.papel}`, selected: m.id === id })));
  escolher.onchange = async () => { if (escolher.value && (!sujo() || confirm("Trocar de ameaça e perder o que não foi salvo?")) && (await abrir(escolher.value))) render(); else escolher.value = id || ""; };
  const base = sugestao("🐉 partir de uma do bestiário…", buscarColecao("ameacas"), async (it) => {
    if (sujo() && !confirm("Começar da ficha do bestiário e perder o que não foi salvo?")) return;
    if (await doBestiario(it.id)) render();
  });
  const entradaArq = el("input", { type: "file", accept: ".json,application/json", hidden: true });
  entradaArq.onchange = async () => {
    const f = entradaArq.files[0];
    entradaArq.value = "";
    if (!f) return;
    try {
      const info = {};
      A = completar(deFoundry(JSON.parse(await f.text()), info)); id = null; salvo = ""; history.replaceState(null, "", "/criar-ameaca"); render();
      msg(`importado de ${f.name}${info.editado ? ` — mudou no Foundry depois de exportar (${info.editado.join(", ")}): usei o que está lá` : ""} — salve pra guardar`);
    }
    catch (e) { msg("não deu pra importar: " + e.message, true); }
  };
  barra.replaceChildren(...[
    botao("✦ nova", () => { if (!sujo() || confirm("Começar outra e perder o que não foi salvo?")) { A = nova(); id = null; salvo = ""; history.replaceState(null, "", "/criar-ameaca"); render(); } }),
    escolher, base,
    botao("📥 importar .json", () => entradaArq.click(), { title: "ator NPC exportado do Foundry (ou baixado daqui)" }), entradaArq,
    botao("💾 salvar", salvar, { className: "bt destaque", title: "Ctrl+S" }),
    id ? botao("🗑", async () => {
      if (!confirm(`Apagar "${A.nome}" do servidor?`)) return;
      await fetch(`/api/criador/ameacas/${id}`, { method: "DELETE" });
      await listarMinhas(); id = null; salvo = ""; history.replaceState(null, "", "/criar-ameaca"); render(); msg("apagada (continua aberta aqui como nova)");
    }, { title: "apagar do servidor" }) : null,
    estado, el("span", { id: "a-msg", role: "status" })].filter(Boolean));
}
const MACRO = `// Hub T20 — importa ameaças (um ou vários .json baixados do hub) na pasta "Hub T20"
const entrada = Object.assign(document.createElement("input"), { type: "file", accept: ".json", multiple: true });
entrada.onchange = async () => {
  const dados = [];
  for (const f of entrada.files) { const j = JSON.parse(await f.text()); dados.push(...(Array.isArray(j) ? j : [j])); }
  const pasta = game.folders.find((f) => f.type === "Actor" && f.name === "Hub T20") ?? await Folder.create({ name: "Hub T20", type: "Actor" });
  const criados = await Actor.createDocuments(dados.map((d) => ({ ...d, folder: pasta.id })));
  ui.notifications.info(\`\${criados.length} ameaça(s) importada(s) em Hub T20\`);
};
entrada.click();`;
function montarLado() {
  const carta = el("article", { className: "carta a-ficha" }), avisos = el("ul", { className: "a-avisos" });
  vivo(() => {
    carta.innerHTML = fichaHtml(A);
    const lista = [];
    if (!A.ataques.length) lista.push("Sem ataque: ameaça está ali pra lutar (a menos que seja um trapaceiro social).");
    if (A.papel !== "lacaio" && A.pv && tab("pv") && A.pv < tab("pv", A.papel, ndMais(A.nd, -2))) lista.push("PV abaixo da faixa do livro: cai rápido demais.");
    if (A.desl.terrestre && A.desl.terrestre < 6 && !A.desl.voo && !A.desl.natacao) lista.push("Deslocamento abaixo de 6m deixa a ameaça fraca (o grupo foge ou se mantém longe).");
    if (A.papel === "solo" && !A.habilidades.some((h) => mecanicaEfetiva(h).forma || /área|cone|esfera|linha|todas as criaturas/i.test(h.desc)) && A.ataques.filter((x) => !x.complementar).reduce((s, x) => s + x.qtd, 0) < 2)
      lista.push("Solo sem área nem vários ataques: o grupo põe um tanque na frente e anula a ameaça.");
    const fmt = (k, v) => (COM_SINAL.has(k) ? sinal(v) : v);
    for (const [k, r, c] of STATS) {
      const f = foraDaFaixa(k, c());
      if (f) lista.push(`${r} ${fmt(k, A[k])} fora da faixa do livro (${fmt(k, f.min)} a ${fmt(k, f.max)} de ND ${vizinhos()[0]} a ${vizinhos().at(-1)}; a linha do ND ${A.nd} é ${fmt(k, f.linha)}).`);
    }
    const principais = A.ataques.filter((x) => !x.complementar), total = principais.reduce((s, x) => s + danoMedio(x) * x.qtd, 0);
    if (principais.length && A.danoAlvo && Math.abs(total - A.danoAlvo) > Math.max(2, A.danoAlvo * 0.15))
      lista.push(`Os ataques somam ${total} de dano médio por rodada e o alvo do passo 3 é ${A.danoAlvo}: use ⚖ fechar a média, ou mude o alvo.`);
    const cds = A.habilidades.flatMap((h) => [...String(h.desc).matchAll(/\bCD (\d+)/g)].map((m) => [h.nome || "habilidade", Number(m[1])])).filter(([, c]) => c !== A.cd);
    if (A.cd != null && cds.length) lista.push([`CD no texto diferente da CD da ficha (${A.cd}): ${cds.map(([n, c]) => `${n} CD ${c}`).join(", ")}. O livro usa uma CD só pra ameaça, e no Foundry toda habilidade de NPC usa a da ficha. `,
      botao(`unificar em CD ${A.cd}`, () => { for (const h of A.habilidades) h.desc = h.desc.replace(/\bCD \d+\b/g, `CD ${A.cd}`); render(); })]);
    for (const p of A.pericias) { const e = ablDe(p.nome) && estadoPer(p); if (e && e.extra > 10) lista.push(`${p.nome}: especialidade +${e.extra} passa do +10 que o livro dá pra uma perícia excepcional ou mágica.`); }
    if (A.chefe && A.papel === "lacaio") lista.push("Chefe final lacaio: o livro pede solo ou especial (lacaio cai rápido demais pra ser a última batalha).");
    avisos.replaceChildren(...lista.map((t) => el("li", {}, ...[].concat(t))));
  });
  const texto = botao("📋 copiar ficha em texto", (e) => copiar(fichaTexto(A), e.currentTarget), { title: "pra colar no chat, num documento ou no 'Importar ficha' do sistema no Foundry" });
  lado.replaceChildren(el("div", { className: "a-lado-acoes" },
      botao("⬇ baixar pro Foundry", () => baixar(arquivo(), JSON.stringify(paraFoundry(normalizar(A)), null, 1)), { className: "bt destaque" }), texto),
    carta, avisos,
    el("details", { className: "a-ajuda" }, el("summary", { textContent: "Como pôr no Foundry" }),
      el("ol", {},
        el("li", { textContent: "Baixe o .json (aqui ou no ⬇ Foundry de qualquer ficha do bestiário)." }),
        el("li", { textContent: "Um por vez: na aba Atores, crie um ator do tipo Ameaça (NPC), clique com o botão direito nele → Importar Dados → escolha o arquivo." }),
        el("li", { textContent: "Vários de uma vez: crie uma macro do tipo Script com o código abaixo, rode e escolha todos os arquivos." })),
      el("pre", { className: "a-macro", textContent: MACRO }), botao("📋 copiar macro", (e) => copiar(MACRO, e.currentTarget)),
      el("p", { className: "explica", textContent: "Ataques viram armas com rolagem de ataque e dano; habilidades viram poderes com área (molde no mapa), dano com tipo, teste de resistência e as condições pra aplicar; RD, imunidades, vulnerabilidades e sentidos viram os campos do sistema, e o que não tem campo vai como texto. Importar de volta aqui (📥) recupera a ameaça inteira — e se ela foi editada no Foundry, o que mudou lá é mantido." })));
}
function render() {
  vivos.length = 0;
  montarBarra();
  form.replaceChildren(passo0(), passo1(), passo2(), passo3(), passo4(), passo5(), passo6(), passo7(), passo8(),
    el("datalist", { id: "a-armas-naturais" }, ...["Garra", "Garras", "Mordida", "Chifres", "Cauda", "Cascos", "Pancada", "Pancadas", "Tentáculos", "Pinças", "Ferrão", "Presas",
      "Marrada", "Tromba", "Pseudópode"].map((n) => el("option", { value: n }))));
  montarLado();
  atualizar();
}

const atalho = (e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") { e.preventDefault(); salvar(); } };
document.addEventListener("keydown", atalho);
aoSair(() => document.removeEventListener("keydown", atalho));

(async () => {
  try {
    const r = await fetch("/api/criador/ameacas-regras");
    if (!r.ok) throw new Error();
    R = await r.json();
  } catch { semRegras = true; }
  await listarMinhas();
  const rasc = lerRascunho();
  if (params.get("id") && (await abrir(params.get("id")))) { /* aberta */ }
  else if (params.get("base") && (await doBestiario(params.get("base")))) { /* do bestiário */ }
  else if (rasc?.A) { A = completar(rasc.A); id = rasc.id || null; salvo = rasc.salvo || ""; }
  else A = nova();
  render();
  if (pendente) msg(...pendente);
  if (semRegras) msg("Tabela 2-3 não instalada no servidor — dá pra criar, mas sem os valores do livro", true);
})();
