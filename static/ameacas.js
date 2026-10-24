// ameacas.js — criador de ameaças: os passos 0–7 do manual do Ameaças de Arton numa tela só, com a ficha ao vivo do lado.
// Números de combate = linha do ND/papel na Tabela 2-3; cada um mostra os valores de ND−2…ND+2 (a margem que o livro dá
// pra personalizar). Trocar ND ou papel mantém a diferença de cada número pra tabela ("Como modificar criaturas").
// Salva por conta no servidor (rascunho no navegador enquanto não salva) e exporta o ator NPC pro Foundry (sistema tormenta20).
import { el, aoSair } from "/hub.js";
import { ND_ORDEM, TIPOS, TAMANHOS, ACOES, ATRIBUTOS, TIPOS_DANO, PERICIAS, normalizar, paraFoundry, deFoundry, fichaHtml, fichaTexto,
  danoMedio, bonusPraMedia, nivelDoNd, meioNd, treinoDoNd, patamarDoNd, chavePericia, tipoPorArma, norm, sinal } from "/ameaca.mjs";

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
// quantos NDs o valor está acima/abaixo do ND da ameaça (null = fora da tabela)
function deslocamento(k, campo) {
  const i0 = ND_ORDEM.indexOf(A.nd);
  let melhor = null;
  for (const nd of vizinhos()) if (tab(campo, A.papel, nd) === A[k]) { const d = ND_ORDEM.indexOf(nd) - i0; if (melhor == null || Math.abs(d) < Math.abs(melhor)) melhor = d; }
  return melhor;
}
const ablDe = (nome) => chavePericia(nome)?.[1];
const basePer = (nome, nd = A.nd, atr = A.atributos) => meioNd(nd) + (atr[ablDe(nome)] ?? 0);
function estadoPer(p, nd = A.nd, atr = A.atributos) {
  const d = p.valor - basePer(p.nome, nd, atr), t = treinoDoNd(nd), treinado = d >= t;
  return { treinado, extra: d - (treinado ? t : 0) };
}
const valorPer = (nome, treinado, extra) => basePer(nome) + (treinado ? treinoDoNd(A.nd) : 0) + extra;
// perícia segue a regra (½ ND + atributo + treino + extra): muda ND ou atributo, o valor acompanha mantendo treino e extra
function recalcularPericias(ndAntes, atrAntes) {
  for (const p of A.pericias) { if (!ablDe(p.nome)) continue; const e = estadoPer(p, ndAntes, atrAntes); p.valor = valorPer(p.nome, e.treinado, e.extra); }
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
  if (antes.cd != null && A.cd != null && A.cd !== antes.cd) for (const h of A.habilidades) h.desc = h.desc.replace(new RegExp(`\\bCD ${antes.cd}\\b`, "g"), `CD ${A.cd}`);
}
function trocarRes(k, col) {
  const outro = Object.keys(A.res).find((x) => x !== k && A.res[x] === col);
  if (outro) { A.res[outro] = A.res[k]; A[outro] = tab(A.res[outro]) ?? A[outro]; }
  A.res[k] = col; A[k] = tab(col) ?? A[k];
  render();
}
// passos de dano: anda na "escada" da linha em que o dado está (LB Tabela 3-2); passou do fim, soma ou tira um dado
function passo(dados, n) {
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
    A = completar(j.ameaca); salvo = JSON.stringify(A);
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
function area(obj, k, props = {}) { const t = el("textarea", { value: obj[k] ?? "", rows: 3, ...props }); t.oninput = () => { obj[k] = t.value; atualizar(); }; return t; }
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
const secao = (n, titulo, dica, ...filhos) => el("section", { className: "painel a-passo" },
  el("h2", { className: "pergunta" }, el("span", { className: "a-num", textContent: `Passo ${n}` }), ` ${titulo}`),
  dica ? el("p", { className: "explica", textContent: dica }) : null, ...filhos);

// número de combate com os valores da Tabela 2-3 do ND−2 ao ND+2
function estatistica(k, rotulo, campoTab) {
  const mudar = (v) => {
    const antes = A[k];
    A[k] = v;
    if (k === "atq" && antes != null && v != null) for (const at of A.ataques) if (!at.complementar) at.bonus += v - antes;
    atualizar();
  };
  const i = el("input", { type: "number", className: "a-n", value: A[k] ?? "" });
  i.oninput = () => { const v = i.value.trim() === "" ? (k === "cd" ? null : 0) : Math.trunc(Number(i.value)); if (v === null || Number.isFinite(v)) mudar(v); };
  const chips = el("div", { className: "a-chips" });
  vivo(() => {
    if (document.activeElement !== i) i.value = A[k] ?? "";
    chips.replaceChildren(...vizinhos().map((nd) => {
      const v = tab(campoTab(), A.papel, nd);
      if (v == null) return null;
      return el("button", { type: "button", className: "chip a-chip" + (v === A[k] ? " on" : "") + (nd === A.nd ? " a-nd" : ""), title: `Tabela 2-3, ${A.papel}, ND ${nd}`,
        onclick: () => mudar(v) }, el("small", { textContent: `ND ${nd}` }), ` ${COM_SINAL.has(k) ? sinal(v) : v}`);
    }));
    i.classList.toggle("a-fora", tab(campoTab()) != null && deslocamento(k, campoTab()) == null);
  });
  return el("div", { className: "a-stat" }, el("span", { className: "a-rot", textContent: rotulo }), i, chips);
}

// ---------------------------------------------------------------- passos
function passo0() {
  const img = el("img", { className: "a-retrato", alt: "", referrerPolicy: "no-referrer" });
  vivo(() => { img.hidden = !/^https?:\/\//.test(A.img); if (!img.hidden && img.src !== A.img) img.src = A.img; });
  return secao(0, "Conceito e nome", "Uma boa ameaça se descreve em poucas palavras. Ela aparece em poucas cenas: qualidade vale mais que quantidade.",
    campo("Nome", txt(A, "nome", { maxLength: 80 })),
    campo("Conceito (vai pra biografia no Foundry)", area(A, "conceito", { rows: 2, placeholder: "réptil alado que cospe fogo e guarda um tesouro antigo…" })),
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
    linhaDesl("escalada", "Escalada", R.desl?.escalada), linhaDesl("escavacao", "Escavação", R.desl?.escavacao),
    campo("Observação de deslocamento", txt(A.desl, "obs", { placeholder: "sem redução por terreno difícil, teleporte 9m…" })));
  const dicaTipo = el("p", { className: "explica" });
  vivo(() => { dicaTipo.textContent = DICA_TIPO[A.tipo] || ""; });
  return secao(1, "Tipo, tamanho e papel", null,
    linhaC(campo("Tipo", lista(A, "tipo", Object.keys(TIPOS).map((t) => [t, t]), { depois: () => {
      for (const [k, t] of [["sentidos", TRACOS_TIPO[A.tipo]?.[0]], ["defesas", TRACOS_TIPO[A.tipo]?.[1]]]) if (t && !norm(A[k]).includes(norm(t))) A[k] = [A[k], t].filter(Boolean).join(", ");
      render();
    } })), campo("Subtipo / raça", txt(A, "subtipo", { placeholder: "goblin, elemental, lefeu…" })), campo("Tamanho", lista(A, "tamanho", Object.keys(TAMANHOS).map((t) => [t, t]), { depois: render }))),
    dicaTipo,
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
    info.textContent = `Patamar ${pat} · ${({ "1/4": 250, "1/2": 500 })[A.nd] ?? nivelDoNd(A.nd) * 1000} XP pro grupo`
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
    const soma = ajustes.reduce((s, [, d]) => s + d, 0);
    saldo.textContent = semRegras ? "Tabela 2-3 não instalada no servidor: os números ficam livres."
      : ajustes.length ? `Ajustes de ND: ${ajustes.map(([r, d]) => `${r} ${d > 0 ? "+" : ""}${d}`).join(", ")} · saldo ${soma > 0 ? "+" : ""}${soma}${soma ? " — o livro pede compensar aumento com redução" : " ✓"}`
        : "Tudo na linha do ND. Cada número pode usar o valor de até 2 NDs acima ou abaixo, compensando um aumento com uma redução.";
  });
  const res = RES.map(([k, r]) => el("div", { className: "a-res" }, el("span", { className: "a-rot", textContent: r }),
    lista(A.res, k, COL_RES, { depois: () => trocarRes(k, A.res[k]) }), estatistica(k, "", () => A.res[k])));
  return secao(3, "Estatísticas de combate", "Pegue a linha do ND no papel da ameaça. Valor em laranja está fora da faixa ND−2…ND+2.",
    estatistica("defesa", "Defesa", () => "defesa"), estatistica("pv", "Pontos de Vida", () => "pv"), estatistica("cd", "CD das habilidades", () => "cd"),
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
  const nome = txt(at, "nome", { placeholder: "Garra, Mordida, Espada longa…" });
  nome.onchange = () => { if (!at.tipoDano && tipoPorArma(at.nome)) { at.tipoDano = tipoPorArma(at.nome); render(); } };
  return el("div", { className: "a-item" },
    linhaC(campo("Arma", nome), campo("Quantos", numero(at, "qtd", { min: 1, max: 20, className: "a-n" })),
      campo("Tipo", lista(at, "tipo", [["cac", "Corpo a corpo"], ["dist", "À distância"]])), campo("Ataque", el("div", { className: "a-dados" }, bonus, ref))),
    linhaC(campo("Dados", el("div", { className: "a-dados" }, passoBt(-1, "−"), dados, passoBt(1, "+"))), campo("Bônus de dano", bonusDano),
      campo("Tipo de dano", lista(at, "tipoDano", [["", "—"], ...TIPOS_DANO.map((t) => [t, t])])),
      campo("Crítico", el("div", { className: "a-dados" }, lista(at, "margem", [20, 19, 18, 17, 16, 15].map((n) => [n, n === 20 ? "20" : `${n}–20`]), { num: true }),
        lista(at, "mult", [2, 3, 4, 5].map((n) => [n, `x${n}`]), { num: true })))),
    linhaC(campo("Mais (dano extra)", txt(at, "extra", { placeholder: "1d8 ácido" })), campo("Observação", txt(at, "resto", { placeholder: "alcance médio" }))),
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
  return secao(4, "Ataques", "Divida o dano médio entre os ataques (ou concentre num golpe só) e complete com bônus fixo. Arma natural: 1d6 em Pequeno/Médio, um passo a menos em Minúsculo, um a mais em Grande/Enorme, dois em Colossal.",
    ...A.ataques.map(linhaAtaque),
    el("div", { className: "a-pe" }, botao("✚ arma natural", () => novoAtaque(true)), botao("✚ outra arma", () => novoAtaque(false)),
      A.ataques.length > 1 ? botao("⚖ fechar a média em todos", () => { for (const at of A.ataques) at.bonusDano = bonusPraMedia(at, alvoDe(at)); atualizar(); }) : null), resumo);
}
function linhaHab(h, i) {
  return el("div", { className: "a-item" },
    linhaC(campo("Habilidade", txt(h, "nome", { placeholder: "Sopro de fogo" })), campo("Ação", lista(h, "acao", Object.keys(ACOES).map((a) => [a, a || "passiva"]))),
      campo("PM", numero(h, "custo", { min: 0, className: "a-n" })),
      el("label", { className: "a-check", title: "habilidade mágica: suprimida por Campo Antimagia e o dano dela ignora RD/mágico" }, marcar(h, "magica"), " mágica ⚝")),
    campo("Uso e limite", txt(h, "extra", { placeholder: "recarga (movimento), 1×/cena, sustentada…" })),
    campo("O que faz", area(h, "desc", { rows: 3, placeholder: "Todas as criaturas num cone de 9m sofrem 6d6 de fogo (Ref CD 20 reduz à metade)." })),
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
          A.habilidades.push({ nome: g.nome, acao: g.acao || "", custo: g.custo || 0, magica: !!g.magica, extra: g.extra || "", desc: A.cd ? g.desc.replace(/\bCD \d+\b/g, `CD ${A.cd}`) : g.desc });
          render();
        }))));
    } catch { achados.textContent = "biblioteca indisponível"; }
  };
  busca.oninput = () => { clearTimeout(timer); timer = setTimeout(procurar, 250); };
  const biblio = el("details", { className: "a-biblio-box", ontoggle: (e) => { if (e.target.open && !achados.childElementCount) procurar(); } },
    el("summary", { textContent: "📚 pegar de uma ficha do bestiário (a CD do texto vira a desta ameaça)" }), busca, achados);
  return secao(5, "Habilidades", "Na ordem do livro: ataque, defesa, percepção e movimento, variadas. Misture passivas e ativadas; prefira recarga e 1×/cena a PM. Solo e chefão precisam de área ou vários ataques. Habilidade nova: baseie numa magia parecida.",
    ...A.habilidades.map(linhaHab), el("div", { className: "a-pe" }, botao("✚ habilidade", () => { A.habilidades.push({ nome: "", acao: "", custo: 0, magica: false, extra: "", desc: "" }); render(); })),
    biblio, conta);
}
function linhaPer(p, i, fixa) {
  const e = estadoPer(p), st = { ...e };
  const valor = el("b", { className: "a-valor" });
  const aplica = () => { p.valor = valorPer(p.nome, st.treinado, st.extra); atualizar(); };
  const ex = el("input", { type: "number", value: st.extra, className: "a-n", title: "especialidade: +2/+5 hábil ou racial, +10 excepcional ou mágico",
    oninput: () => { st.extra = Math.trunc(Number(ex.value)) || 0; aplica(); } });
  vivo(() => { valor.textContent = sinal(p.valor); });
  return el("div", { className: "a-per" }, el("span", { className: "a-rot", textContent: p.nome }),
    el("label", { className: "a-check" }, el("input", { type: "checkbox", checked: st.treinado, onchange: (ev) => { st.treinado = ev.target.checked; aplica(); } }), " treinada"),
    el("span", { className: "a-mais", textContent: "extra" }), ex, el("span", { className: "a-mais", textContent: "=" }), valor,
    txt(p, "obs", { placeholder: "(+15 para nadar)" }), fixa ? el("span") : botao("✕", () => { A.pericias.splice(i, 1); render(); }, { title: "tirar" }));
}
function passo6() {
  const atrs = ATRIBUTOS.map((k) => {
    const cat = el("small", { className: "a-cat" });
    const i = el("input", { type: "number", className: "a-n", value: A.atributos[k] ?? "", placeholder: "–", title: "vazio = atributo nulo (–): a criatura não tem e não pode usar" });
    i.oninput = () => {
      const v = i.value.trim() === "" ? null : Math.trunc(Number(i.value));
      if (v !== null && !Number.isFinite(v)) return;
      const antes = { ...A.atributos }; A.atributos[k] = v; recalcularPericias(A.nd, antes); atualizar();
    };
    vivo(() => { const v = A.atributos[k]; cat.textContent = v == null ? "nulo" : R.categorias?.find((c) => v >= c.min && v <= c.max)?.nome || ""; });
    return el("label", { className: "campo a-atr" }, el("span", { textContent: k[0].toUpperCase() + k.slice(1) }), i, cat);
  });
  const usadas = new Set(A.pericias.map((p) => p.nome));
  const novas = Object.keys(PERICIAS).filter((n) => !usadas.has(n) && !["Fortitude", "Reflexos", "Vontade", "Luta", "Pontaria"].includes(n));
  const add = el("select", {}, el("option", { value: "", textContent: "✚ perícia…" }), ...novas.map((n) => el("option", { value: n, textContent: n })));
  add.onchange = () => { if (add.value) { A.pericias.push({ nome: add.value, valor: valorPer(add.value, true, 0), obs: "" }); render(); } };
  const sentidos = txt(A, "sentidos", { placeholder: "visão no escuro, faro" }), defesas = txt(A, "defesas", { placeholder: "imunidade a fogo, redução de dano 10, resistência a magia +2, vulnerabilidade a frio" });
  const rapido = (alvo, input, opcoes) => el("div", { className: "a-chips" }, ...opcoes.map((t) => botao(`+ ${t}`, () => {
    if (!norm(A[alvo]).includes(norm(t))) { A[alvo] = [A[alvo], t].filter(Boolean).join(", "); input.value = A[alvo]; atualizar(); }
  })));
  return secao(6, "Atributos, perícias e sentidos", `Atributos vêm do conceito e não mexem nos números de combate. Perícia = metade do ND + atributo + treino (+${treinoDoNd(A.nd)} neste ND); perícia que não estiver na lista vale metade do ND + atributo. Luta e Pontaria são o próprio ataque.`,
    el("div", { className: "a-atrs" }, ...atrs),
    el("h3", { className: "sub-perg", textContent: "Perícias" }),
    ...A.pericias.map((p, i) => linhaPer(p, i, i < 2 && ["Iniciativa", "Percepção"].includes(p.nome))), add,
    el("h3", { className: "sub-perg", textContent: "Sentidos e defesas especiais" }),
    campo("Sentidos (vão junto da Percepção)", sentidos), rapido("sentidos", sentidos, ["visão na penumbra", "visão no escuro", "faro", "percepção às cegas"]),
    campo("RD, imunidades, resistências e vulnerabilidades (no Foundry viram os campos de verdade)", defesas));
}
function passo7() {
  const cd = el("p", { className: "explica" });
  vivo(() => { cd.textContent = `Recurso extraível (couro, veneno, éter…): 1 hora e Sobrevivência ou Ofício CD ${15 + (A.nd.includes("/") ? 0 : nivelDoNd(A.nd))}.`; });
  const tesouro = txt(A, "tesouro", { placeholder: "Padrão, 1d6 doses de ácido (CD 21 para extrair)" });
  const atual = ["Nenhum", "Metade", "Padrão", "Dobro"].find((t) => norm(A.tesouro).startsWith(norm(t))) || "";
  return secao(7, "Equipamento e tesouro", "Equipamento é cosmético (os números já existem), mas não pode contradizer a ficha: Defesa baixa não combina com armadura completa.",
    campo("Equipamento", txt(A, "equipamento", { placeholder: "tacape aumentado, couraça" })),
    el("div", { className: "a-linha-seg" }, el("span", { className: "a-rot", textContent: "Tesouro" }),
      segmentos(atual, ["Nenhum", "Metade", "Padrão", "Dobro"].map((t) => [t, t]), (v) => { A.tesouro = [v, A.tesouro.replace(/^(nenhum|metade|padr[aã]o|dobro)\.?,?\s*/i, "")].filter(Boolean).join(", "); render(); })),
    campo("Detalhe do tesouro", tesouro), cd);
}

// ---------------------------------------------------------------- barra, lado e montagem
function montarBarra() {
  const estado = el("span", { className: "a-sujo" });
  vivo(() => { estado.textContent = sujo() ? "● não salvo" : id ? "✓ salvo" : ""; });
  const escolher = el("select", { title: "abrir uma ameaça sua" }, el("option", { value: "", textContent: `📂 minhas ameaças (${minhas.length})` }),
    ...minhas.map((m) => el("option", { value: m.id, textContent: `${m.nome} · ND ${m.nd} · ${m.papel}`, selected: m.id === id })));
  escolher.onchange = async () => { if (escolher.value && (!sujo() || confirm("Trocar de ameaça e perder o que não foi salvo?")) && (await abrir(escolher.value))) render(); else escolher.value = id || ""; };
  const base = el("input", { type: "search", placeholder: "🐉 partir de uma do bestiário…", className: "a-base" });
  const sugestoes = el("div", { className: "a-sugestoes", hidden: true });
  let timer;
  base.oninput = () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      if (!base.value.trim()) { sugestoes.hidden = true; return; }
      const r = await (await fetch(`/api/c/ameacas?q=${encodeURIComponent(base.value)}`)).json();
      const itens = (r.itens || []).sort((a, b) => (b.rel || 0) - (a.rel || 0)).slice(0, 8);
      sugestoes.replaceChildren(...itens.map((it) => el("button", { type: "button", className: "a-sug", onclick: async () => {
        if (sujo() && !confirm("Começar da ficha do bestiário e perder o que não foi salvo?")) return;
        if (await doBestiario(it.id)) render();
      } }, el("b", { textContent: it.nome }), el("small", { textContent: ` ${it.linha || ""}` }))));
      sugestoes.hidden = !itens.length;
    }, 250);
  };
  const entradaArq = el("input", { type: "file", accept: ".json,application/json", hidden: true });
  entradaArq.onchange = async () => {
    const f = entradaArq.files[0];
    entradaArq.value = "";
    if (!f) return;
    try { A = completar(deFoundry(JSON.parse(await f.text()))); id = null; salvo = ""; history.replaceState(null, "", "/criar-ameaca"); render(); msg(`importado de ${f.name} — salve pra guardar`); }
    catch (e) { msg("não deu pra importar: " + e.message, true); }
  };
  barra.replaceChildren(...[
    botao("✦ nova", () => { if (!sujo() || confirm("Começar outra e perder o que não foi salvo?")) { A = nova(); id = null; salvo = ""; history.replaceState(null, "", "/criar-ameaca"); render(); } }),
    escolher, el("div", { className: "a-base-box" }, base, sugestoes),
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
    if (A.papel === "solo" && !A.habilidades.some((h) => /área|cone|esfera|linha|todas as criaturas/i.test(h.desc)) && A.ataques.filter((x) => !x.complementar).reduce((s, x) => s + x.qtd, 0) < 2)
      lista.push("Solo sem área nem vários ataques: o grupo põe um tanque na frente e anula a ameaça.");
    avisos.replaceChildren(...lista.map((t) => el("li", { textContent: t })));
  });
  const texto = botao("📋 copiar ficha em texto", (e) => copiar(fichaTexto(A), e.currentTarget), { title: "pra colar no chat, num documento ou no 'Importar ficha' do sistema no Foundry" });
  lado.replaceChildren(el("div", { className: "a-lado-acoes" },
      botao("⬇ baixar pro Foundry", () => baixar(arquivo(), JSON.stringify(paraFoundry(A), null, 1)), { className: "bt destaque" }), texto),
    carta, avisos,
    el("details", { className: "a-ajuda" }, el("summary", { textContent: "Como pôr no Foundry" }),
      el("ol", {},
        el("li", { textContent: "Baixe o .json (aqui ou no ⬇ Foundry de qualquer ficha do bestiário)." }),
        el("li", { textContent: "Um por vez: na aba Atores, crie um ator do tipo Ameaça (NPC), clique com o botão direito nele → Importar Dados → escolha o arquivo." }),
        el("li", { textContent: "Vários de uma vez: crie uma macro do tipo Script com o código abaixo, rode e escolha todos os arquivos." })),
      el("pre", { className: "a-macro", textContent: MACRO }), botao("📋 copiar macro", (e) => copiar(MACRO, e.currentTarget)),
      el("p", { className: "explica", textContent: "Ataques viram armas com rolagem de ataque e dano; habilidades viram poderes (com teste de resistência e dano quando o texto diz); RD, imunidades e sentidos viram os campos do sistema. Importar de volta aqui (📥) recupera a ameaça inteira." })));
}
function render() {
  vivos.length = 0;
  montarBarra();
  form.replaceChildren(passo0(), passo1(), passo2(), passo3(), passo4(), passo5(), passo6(), passo7());
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
