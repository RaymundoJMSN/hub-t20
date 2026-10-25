// ameaca.mjs — modelo de ameaça do Hub T20 e a ponte com o Foundry (sistema Tormenta20 1.5, core v13).
// O MESMO módulo roda no criador (navegador), no servidor (download das fichas do bestiário) e no importador
// (ficha do arsenal → modelo). Só estrutura e nomes de campo: nenhum texto de livro mora aqui.
//
// Modelo (o que o criador edita e o servidor guarda):
//   { nome, nd, papel: solo|lacaio|especial, tipo, subtipo, tamanho, grupo: ""|bando|enxame, conceito, img,
//     defesa, fort, ref, von, res: {fort,ref,von → forte|media|fraca}, pv, pm, cd, atq, danoAlvo,
//     sentidos, defesas (RD/imunidades/vulnerabilidades em texto), desl: {terrestre,voo,natacao,escalada,escavacao,obs},
//     atributos: {for..car → número | null (atributo nulo "–")}, pericias: [{nome, valor, obs}] (Iniciativa e Percepção inclusas),
//     ataques: [{nome, qtd, tipo: cac|dist, bonus, dados, bonusDano, tipoDano, margem, mult, extra, resto, complementar, desc}],
//     habilidades: [{nome, acao, custo, magica, extra (uso: recarga, 1×/cena…), desc,
//       mecânica pro Foundry, toda opcional: alcance, forma + metros (área), alvo, duracao + duracaoN, teste + efeitoTeste,
//       danos: [{formula, tipo}], condicoes: [nome]}], equipamento, tesouro, fonte, obs,
//     chefe: null | { arena, efeitoArena, recursos: [{nome, efeito}] } }
//   O modelo guarda a criatura-base; chefe final (PV ×2, Maior que a Morte, RD...) é aplicado na saída por comoChefe().

export const ND_ORDEM = ["1/4", "1/2", ...Array.from({ length: 20 }, (_, i) => String(i + 1)), "S", "S+"];
export const TIPOS = { Animal: "ani", Construto: "con", "Espírito": "esp", Humanoide: "hum", Monstro: "mon", "Morto-vivo": "mor" };
export const TAMANHOS = { "Minúsculo": "min", Pequeno: "peq", "Médio": "med", Grande: "gra", Enorme: "eno", Colossal: "col" };
const QUADRADOS = { min: 0.5, peq: 1, med: 1, gra: 2, eno: 3, col: 6 }; // lado do token em quadrados de 1,5m (o sistema usa 0,5 no Minúsculo)
export const PAPEIS = { solo: "solo", lacaio: "lackey", especial: "special" };
export const ACOES = { "": "", Livre: "free", Movimento: "move", "Padrão": "action", Completa: "full", "Reação": "reaction" };
export const ATRIBUTOS = ["for", "des", "con", "int", "sab", "car"];
export const TIPOS_DANO = ["ácido", "corte", "eletricidade", "essência", "fogo", "frio", "impacto", "luz", "perfuração", "psíquico", "trevas"];
// mecânica das habilidades: rótulo do criador → chave do sistema tormenta20
export const ALCANCES = { "": "none", pessoal: "self", "toque/adjacente": "touch", curto: "short", "médio": "medium", longo: "long" };
export const FORMAS = ["cone", "linha", "quadrado", "esfera", "raio"]; // raio = emanação em volta da criatura
export const DURACOES = { "": "", "instantânea": "inst", rodadas: "round", cena: "scene", sustentada: "sust", permanente: "perm", dia: "day" };
export const EFEITOS_TESTE = ["evita", "reduz à metade", "reduz à metade e evita", "parcial", "anula", "desacredita"];
export const TIPOS_HAB = [...TIPOS_DANO, "perda de vida", "cura"];
const TIPO_HAB_CHAVE = { "perda de vida": "perda", cura: "curapv" }; // o resto é o tipo de dano sem acento
export const CONDICOES_NOMES = ["abalado", "agarrado", "alquebrado", "apavorado", "atordoado", "caído", "cego", "confuso", "debilitado", "desprevenido", "doente", "em chamas",
  "enfeitiçado", "enjoado", "enredado", "envenenado", "esmorecido", "exausto", "fascinado", "fatigado", "fraco", "frustrado", "imóvel", "inconsciente", "indefeso", "lento",
  "ofuscado", "paralisado", "pasmo", "petrificado", "sangrando", "surdo", "surpreendido", "vulnerável"];
export const TESTES = { fort: ["fort", "Fortitude", "Fort"], ref: ["refl", "Reflexos", "Ref"], von: ["vont", "Vontade", "Von"] };
// perícia → [chave no sistema, atributo-chave]
export const PERICIAS = {
  Acrobacia: ["acro", "des"], Adestramento: ["ades", "car"], Atletismo: ["atle", "for"], "Atuação": ["atua", "car"], Cavalgar: ["cava", "des"],
  Conhecimento: ["conh", "int"], Cura: ["cura", "sab"], Diplomacia: ["dipl", "car"], "Enganação": ["enga", "car"], Fortitude: ["fort", "con"],
  Furtividade: ["furt", "des"], Guerra: ["guer", "int"], Iniciativa: ["inic", "des"], "Intimidação": ["inti", "car"], "Intuição": ["intu", "sab"],
  "Investigação": ["inve", "int"], Jogatina: ["joga", "car"], Ladinagem: ["ladi", "des"], Luta: ["luta", "for"], Misticismo: ["mist", "int"],
  Nobreza: ["nobr", "int"], "Percepção": ["perc", "sab"], Pilotagem: ["pilo", "des"], Pontaria: ["pont", "des"], Reflexos: ["refl", "des"],
  "Religião": ["reli", "sab"], "Sobrevivência": ["sobr", "sab"], Vontade: ["vont", "sab"],
};
const OFICIOS = { alfaiate: "alfa", alquimista: "alqu", alquimia: "alqu", armeiro: "arme", artesao: "arte", cozinheiro: "cozi", culinaria: "cozi", engenhoqueiro: "enge" };
export const SENTIDOS = { "visão na penumbra": "penumbra", "visão no escuro": "escuro", "percepção às cegas": "cegas", faro: "faro" };
// imunidades que o sistema entende (condições + tipos de efeito); o resto fica só no texto
const CONDICOES = new Set(("abalado agarrado alquebrado apavorado atordoado caido cego confuso debilitado desprevenido doente emchamas enfeiticado enjoado " +
  "enredado envenenado esmorecido exausto fascinado fatigado fraco frustrado imovel inconsciente indefeso invisivel lento ofuscado paralisado pasmo " +
  "petrificado sangrando surdo surpreendido vulneravel arcano cansaco climatico divino luz magico medo mental metabolismo metamorfose movimento sentidos trevas veneno").split(" "));
const SIN_CONDICAO = { atordoamento: "atordoado", paralisia: "paralisado", doenca: "doente", doencas: "doente", venenos: "veneno", cegueira: "cego", surdez: "surdo", petrificacao: "petrificado", mentais: "mental" };
// arma (natural ou empunhada) → tipo de dano quando a ficha não diz
const TIPO_POR_ARMA = {
  garra: "corte", garras: "corte", pinca: "corte", pincas: "corte", espada: "corte", machado: "corte", alfange: "corte", cimitarra: "corte", foice: "corte", katana: "corte", lamina: "corte",
  mordida: "perfuração", presas: "perfuração", chifre: "perfuração", chifres: "perfuração", ferrao: "perfuração", adaga: "perfuração", punhal: "perfuração", lanca: "perfuração",
  tridente: "perfuração", rapieira: "perfuração", florete: "perfuração", arco: "perfuração", besta: "perfuração", flecha: "perfuração", virote: "perfuração", azagaia: "perfuração",
  dardo: "perfuração", pique: "perfuração", cauda: "impacto", cascos: "impacto", pancada: "impacto", marrada: "impacto", tentaculo: "impacto", tentaculos: "impacto", tromba: "impacto",
  tacape: "impacto", clava: "impacto", maca: "impacto", martelo: "impacto", mangual: "impacto", bordao: "impacto", funda: "impacto", pedra: "impacto", rocha: "impacto", soco: "impacto",
  chute: "impacto", pseudopode: "impacto", pseudopodes: "impacto", desarmado: "impacto",
};

export const norm = (s) => String(s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const DANO_CHAVE = Object.fromEntries(TIPOS_DANO.map((t) => [norm(t), t])); // "acido" → "ácido" (a chave do sistema é o norm)
const NUMERAIS = { dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8 };
const RE_QTD = /^(dois|duas|tr[eê]s|quatro|cinco|seis|sete|oito)\b|[×x]\s*\d+\s*$/i;

// "+16", "–5", "—1", "1.020", 7 → número; "–", "—", "" → null
export function num(v) {
  if (typeof v === "number") return Number.isFinite(v) ? Math.trunc(v) : null;
  const s = String(v ?? "").trim().replace(/[–—−]/g, "-").replace(/\s+/g, "").replace(/\.(?=\d{3}\b)/g, "");
  const m = s.match(/^[+-]?\d+/);
  return m ? Number(m[0]) : null;
}
export const sinal = (n) => (n == null ? "–" : n < 0 ? `–${Math.abs(n)}` : `+${n}`);
const atrTexto = (n) => (n == null ? "—" : n < 0 ? `–${Math.abs(n)}` : String(n));
const str = (v, max = 200) => String(v ?? "").slice(0, max);
const int = (v, d = 0) => num(v) ?? d;
const entre = (n, a, b) => Math.max(a, Math.min(b, n));
export function ndCanon(v) {
  const s = String(v ?? "").trim().replace("¼", "1/4").replace("½", "1/2").toUpperCase();
  return ND_ORDEM.includes(s) ? s : "1";
}
// ND como nível (Foundry e regra de perícias): ¼ e ½ contam 1, S e S+ contam 20
export const nivelDoNd = (nd) => (nd === "S" || nd === "S+" ? 20 : Math.max(1, Math.floor(Number(nd)) || 1));
export const treinoDoNd = (nd) => { const n = nivelDoNd(nd); return n > 14 ? 6 : n > 6 ? 4 : 2; };
export const meioNd = (nd) => Math.floor(nivelDoNd(nd) / 2);
export const patamarDoNd = (nd) => { const n = nivelDoNd(nd); return n <= 4 ? 1 : n <= 10 ? 2 : n <= 16 ? 3 : 4; };
export const chavePericia = (nome) => {
  const k = Object.keys(PERICIAS).find((p) => norm(p) === norm(nome));
  if (k) return PERICIAS[k];
  const of = norm(nome).match(/^oficio\s*\(?\s*([a-z]+)/);
  return of && OFICIOS[of[1]] ? [OFICIOS[of[1]], "int"] : null;
};
export const tipoPorArma = (nome) => { for (const w of norm(nome).split(/[^a-z]+/)) if (TIPO_POR_ARMA[w]) return TIPO_POR_ARMA[w]; return ""; };

// ---------------------------------------------------------------- dano
// "1d8+10 impacto, x2, mais 1d8 ácido" ⇄ {dados, bonusDano, tipoDano, margem, mult, extra, resto}
export function danoDoTexto(s) {
  const r = { dados: "", bonusDano: 0, tipoDano: "", margem: 20, mult: 2, extra: "", resto: "" };
  let t = String(s ?? "").replace(/[–—−]/g, "-").trim();
  if (!t || t === "undefined") return r;
  const m = t.match(/^(\d+d\d+(?:\s*\+\s*\d+d\d+)*)(\s*[+-]\s*\d+(?!\s*d))?|^(\d+)(?![\dd])/i);
  if (!m) { r.resto = t; return r; }
  if (m[3]) r.bonusDano = Number(m[3]);
  else { r.dados = m[1].replace(/\s+/g, ""); r.bonusDano = m[2] ? Number(m[2].replace(/\s+/g, "")) : 0; }
  const resto = [];
  for (let seg of t.slice(m[0].length).replace(/^\s*,/, "").split(/,\s+/)) {
    seg = seg.trim();
    if (!seg) continue;
    const tp = seg.match(/^(\p{L}+)(.*)$/u);
    if (!r.tipoDano && tp && DANO_CHAVE[norm(tp[1])]) { r.tipoDano = DANO_CHAVE[norm(tp[1])]; seg = tp[2].trim(); if (!seg) continue; }
    seg = seg.replace(/^dano\b\s*/i, "");
    const cr = seg.match(/^(\d{2})?\s*(?:\/?\s*x\s*(\d+))?$/i);
    if (cr && (cr[1] || cr[2])) { if (cr[1]) r.margem = Number(cr[1]); if (cr[2]) r.mult = Number(cr[2]); continue; }
    const mais = seg.match(/^(.*?)\bmais\s+(.+)$/i);
    if (mais) { if (mais[1].trim()) resto.push(mais[1].trim()); r.extra = r.extra ? `${r.extra}, ${mais[2]}` : mais[2]; continue; }
    if (seg) resto.push(seg);
  }
  r.resto = resto.join(", ");
  return r;
}
export function danoTexto(at) {
  const b = at.bonusDano || 0;
  const base = at.dados ? at.dados + (b ? (b > 0 ? "+" : "") + b : "") : b ? String(b) : "";
  const margem = at.margem && at.margem < 20 ? String(at.margem) : "", mult = at.mult && at.mult !== 2 ? `x${at.mult}` : "";
  return [[base, at.tipoDano].filter(Boolean).join(" "), [margem, mult].filter(Boolean).join("/"), at.extra && `mais ${at.extra}`, at.resto].filter(Boolean).join(", ");
}
const faixa = (f) => { let min = 0, max = 0; for (const [, q, d] of String(f || "").matchAll(/(\d+)d(\d+)/g)) { min += +q; max += q * d; } return [min, max]; };
const formulaDoExtra = (extra) => String(extra || "").match(/^\s*(\d+d\d+(?:\s*\+\s*\d+d\d+)*)\s*([+-]\s*\d+(?!\s*d))?/);
// dano médio pela regra do livro: (mínimo + máximo) ÷ 2, arredondando pra baixo (conta o "mais 1d8 ácido" também)
export function danoMedio(at) {
  const [a, b] = faixa(at.dados), ex = formulaDoExtra(at.extra), [c, d] = faixa(ex?.[1]);
  return Math.floor((a + b + c + d) / 2) + (at.bonusDano || 0) + (ex?.[2] ? Number(ex[2].replace(/\s+/g, "")) : 0);
}
// bônus fixo pra esse ataque chegar no dano médio alvo
export function bonusPraMedia(at, alvo) { return Math.round(alvo) - danoMedio({ ...at, bonusDano: 0 }); }

// ---------------------------------------------------------------- arsenal → modelo
const TAM_ALIAS = { min: "Minúsculo", minusculo: "Minúsculo", minuscula: "Minúsculo", peq: "Pequeno", pequeno: "Pequeno", pequena: "Pequeno", med: "Médio", medio: "Médio",
  media: "Médio", gra: "Grande", grande: "Grande", eno: "Enorme", enorme: "Enorme", col: "Colossal", colossal: "Colossal" };
const tipoCanon = (t) => Object.keys(TIPOS).find((k) => norm(k) === norm(t)) || "Monstro";
const tamCanon = (t) => TAM_ALIAS[norm(t).split(/\s+/)[0]] || "Médio";
const moda = (xs) => { const c = {}; let m = null; for (const x of xs) { c[x] = (c[x] || 0) + 1; if (m == null || c[x] > c[m]) m = x; } return m == null ? null : Number(m); };
const DESL = { voo: "voo", natacao: "natacao", escalada: "escalada", escalar: "escalada", escavacao: "escavacao", escavar: "escavacao" };
export function deslDoTexto(s) {
  const d = { terrestre: 0, voo: 0, natacao: 0, escalada: 0, escavacao: 0, obs: "" };
  let t = String(s ?? ""), terrestre = false;
  const usados = [];
  for (const m of t.matchAll(/(?:(\p{L}+)\s+)?(\d+(?:,\d+)?)\s*m\b(?:\s*\(\d+q\))?/gu)) {
    const n = Number(m[2].replace(",", ".")), tipo = DESL[norm(m[1])];
    if (tipo && !d[tipo]) { d[tipo] = n; usados.push(m[0]); }
    else if (!m[1] && !terrestre && m.index === t.search(/\d/)) { d.terrestre = n; terrestre = true; usados.push(m[0]); }
  }
  for (const u of usados) t = t.replace(u, "");
  d.obs = t.replace(/^[\s,;]+|[\s,;]+$/g, "").replace(/,\s*(,\s*)+/g, ", ").trim();
  return d;
}
const metros = (n) => `${String(n).replace(".", ",")}m (${Math.round(n / 1.5)}q)`;
export function deslTexto(d = {}) {
  const p = [d.terrestre ? metros(d.terrestre) : "", ...[["voo", "voo"], ["natacao", "natação"], ["escalada", "escalada"], ["escavacao", "escavação"]].map(([k, r]) => d[k] ? `${r} ${metros(d[k])}` : "")].filter(Boolean);
  return [p.join(", ") || "0m", d.obs].filter(Boolean).join(", ");
}
function ataqueDoArsenal(x) {
  const nome = String(x.nome || "").trim();
  const qtd = NUMERAIS[norm(nome).split(/\s+/)[0]] || num((nome.match(/[×x]\s*(\d+)\s*$/) || [])[1]) || 1;
  const d = danoDoTexto(x.dano);
  return { nome, qtd, tipo: /dist/.test(norm(x.tipo)) ? "dist" : "cac", bonus: num(x.bonus) ?? 0, ...d, tipoDano: d.tipoDano || tipoPorArma(nome),
    complementar: false, desc: String(x.desc || "").trim() };
}
function habDoArsenal(h) {
  if (typeof h === "string") return { nome: "", acao: "", custo: 0, magica: false, extra: "", desc: h };
  let nome = String(h.nome || "").trim();
  const partes = String(h.tipo ?? "").split(",");
  const mn = nome.match(/\s*\(([^)]*)\)\s*$/);
  if (mn && /^(livre|padr[aã]o|movimento|completa|rea[cç][aã]o)/i.test(mn[1])) { nome = nome.slice(0, mn.index).trim(); partes.push(...mn[1].split(",")); }
  let acao = "", custo = 0;
  const extra = [];
  for (let p of partes) {
    p = p.trim();
    if (!p || p === "undefined") continue;
    const a = Object.keys(ACOES).find((k) => k && norm(k) === norm(p));
    if (a) acao = a;
    else if (/^\+?\d+\s*PM$/i.test(p)) custo = num(p);
    else if (!/^(qualidade|habilidade)$/i.test(p)) extra.push(p);
  }
  return { nome: nome.replace(/\s*⚝\s*/g, "").trim(), acao, custo, magica: /⚝/.test(nome), extra: extra.join(", "), desc: String(h.desc || "").trim() };
}
function periciaDoArsenal(p) {
  const s = typeof p === "string" ? p : `${p?.nome ?? ""} ${p?.valor ?? ""}`;
  const m = s.trim().match(/^(.+?)\s+([+–—−-]\s*\d+)\s*(.*)$/);
  return m ? { nome: m[1].trim(), valor: num(m[2]) ?? 0, obs: m[3].trim() } : null;
}
// papelArena: papéis da Arena Imperial (["Solo"], ["Lacaio","Bando"]...) — o arsenal não traz o papel
export function doArsenal(a, papelArena = []) {
  const m = String(a.tipo || "").trim().match(/^([\p{L}-]+)\s*(?:\(([^)]*)\))?\s*(.*)$/u) || [];
  const subs = String(m[2] || "").split(/\s*,\s*/).filter(Boolean);
  const papeis = papelArena.map(norm);
  const fort = num(a.fort) ?? 0, ref = num(a.ref) ?? 0, von = num(a.von) ?? 0;
  const ordem = [["fort", fort], ["ref", ref], ["von", von]].sort((x, y) => y[1] - x[1]);
  const ataques = (a.ataques || []).filter((x) => x?.nome).map(ataqueDoArsenal);
  const habilidades = [...(a.habilidades || []), ...(a.habilities || [])].filter(Boolean).map(habDoArsenal);
  const cds = [...[...habilidades.map((h) => h.desc), ...ataques.map((x) => x.desc)].join(" ").matchAll(/\bCD (\d+)/g)].map((x) => x[1]);
  const equip = Array.isArray(a.equipamento) ? a.equipamento.map((e) => (typeof e === "string" ? e : e?.nome || "")).filter(Boolean).join(", ") : String(a.equipamento || "");
  return normalizar({
    nome: a.nome, nd: a.nd, papel: ["solo", "lacaio", "especial"].find((p) => papeis.includes(p)) || "solo",
    tipo: tipoCanon(m[1]), subtipo: subs.filter((s) => !/^(bando|enxame)$/i.test(s)).join(", "), tamanho: tamCanon(m[3] || ""),
    grupo: [...subs.map(norm), ...papeis].find((s) => s === "bando" || s === "enxame") || "",
    img: a.img || a.imagem || "", defesa: num(a.defesa) ?? 10, fort, ref, von, res: Object.fromEntries(ordem.map(([k], i) => [k, ["forte", "media", "fraca"][i]])),
    pv: num(a.pv) ?? 1, pm: num(a.pm) ?? 0, cd: moda(cds), atq: ataques[0]?.bonus ?? null,
    danoAlvo: ataques.reduce((s, x) => s + danoMedio(x) * x.qtd, 0) || null,
    sentidos: String(a.percepcaoObs || "").trim(), defesas: String(a.defesaObs || "").trim(), desl: deslDoTexto(a.desl),
    atributos: Object.fromEntries(ATRIBUTOS.map((k) => [k, num(a.atributos?.[k])])),
    pericias: [{ nome: "Iniciativa", valor: num(a.iniciativa) ?? 0 }, { nome: "Percepção", valor: num(a.percepcao) ?? 0 },
      ...(a.pericias || []).map(periciaDoArsenal).filter((p) => p && !["iniciativa", "percepcao"].includes(norm(p.nome)))],
    ataques, habilidades, equipamento: [equip, a.equipamentoObs].filter(Boolean).join(" "), tesouro: a.tesouro, fonte: a.fonte, obs: a.observacao,
  });
}

// escolha de lista fixa: só chave própria do objeto ("__proto__", "constructor" não passam)
const dono = (o, k) => typeof k === "string" && Object.hasOwn(o, k);
export const formulaOk = (f) => (String(f ?? "").replace(/\s+/g, "").match(/^(?:\d{1,3}d\d{1,3}(?:[+-]\d{1,3}d\d{1,3})*(?:[+-]\d{1,4})?|\d{1,4})$/) || [""])[0];
// campos de mecânica de uma habilidade (vazios quando não vieram): só o que tem valor entra no modelo
function mecanica(h) {
  const m = {};
  if (dono(ALCANCES, h?.alcance) && h.alcance) m.alcance = h.alcance;
  if (FORMAS.includes(h?.forma)) { m.forma = h.forma; m.metros = entre(Number(String(h.metros ?? 0).replace(",", ".")) || 0, 0, 999); }
  if (str(h?.alvo, 120).trim()) m.alvo = str(h.alvo, 120).trim();
  if (dono(DURACOES, h?.duracao) && h.duracao) {
    m.duracao = h.duracao;
    const n = (String(h.duracaoN ?? "").replace(/\s+/g, "").match(/^\d{1,3}(?:d\d{1,3})?$/) || [""])[0];
    if (n && h.duracao === "rodadas") m.duracaoN = n;
  }
  if (dono(TESTES, h?.teste)) { m.teste = h.teste; if (EFEITOS_TESTE.includes(h.efeitoTeste)) m.efeitoTeste = h.efeitoTeste; }
  const danos = (Array.isArray(h?.danos) ? h.danos.slice(0, 4) : []).map((d) => ({ formula: formulaOk(d?.formula), tipo: TIPOS_HAB.includes(d?.tipo) ? d.tipo : "" })).filter((d) => d.formula);
  if (danos.length) m.danos = danos;
  const cond = [...new Set((Array.isArray(h?.condicoes) ? h.condicoes : []).filter((c) => CONDICOES_NOMES.includes(c)))].slice(0, 6);
  if (cond.length) m.condicoes = cond;
  return m;
}

// ---------------------------------------------------------------- normalizar (fronteira: o servidor guarda só isto)
export function normalizar(x) {
  const a = x && typeof x === "object" ? x : {};
  const lista = (v, n) => (Array.isArray(v) ? v.slice(0, n) : []);
  const ordem = ["forte", "media", "fraca"];
  return {
    nome: str(a.nome, 80).trim() || "Nova ameaça", nd: ndCanon(a.nd), papel: dono(PAPEIS, a.papel) ? a.papel : "solo",
    tipo: dono(TIPOS, a.tipo) ? a.tipo : "Monstro", subtipo: str(a.subtipo, 60).trim(), tamanho: dono(TAMANHOS, a.tamanho) ? a.tamanho : "Médio",
    grupo: ["bando", "enxame"].includes(a.grupo) ? a.grupo : "", conceito: str(a.conceito, 4000), img: /^https?:\/\/\S+$/.test(a.img || "") ? str(a.img, 500) : "",
    defesa: int(a.defesa, 10), fort: int(a.fort), ref: int(a.ref), von: int(a.von),
    res: Object.fromEntries(["fort", "ref", "von"].map((k, i) => [k, ordem.includes(a.res?.[k]) ? a.res[k] : ordem[i]])),
    pv: Math.max(1, int(a.pv, 1)), pm: Math.max(0, int(a.pm)), cd: num(a.cd), atq: num(a.atq), danoAlvo: num(a.danoAlvo),
    sentidos: str(a.sentidos, 300).trim(), defesas: str(a.defesas, 600).trim(),
    desl: { ...Object.fromEntries(["terrestre", "voo", "natacao", "escalada", "escavacao"].map((k) => [k, entre(Number(String(a.desl?.[k] ?? 0).replace(",", ".")) || 0, 0, 300)])), obs: str(a.desl?.obs, 200).trim() },
    atributos: Object.fromEntries(ATRIBUTOS.map((k) => [k, a.atributos?.[k] == null || a.atributos[k] === "" ? null : num(a.atributos[k])])),
    pericias: lista(a.pericias, 40).map((p) => ({ nome: str(p?.nome, 40).trim(), valor: int(p?.valor), obs: str(p?.obs, 120).trim(),
      ...(typeof p?.treinado === "boolean" ? { treinado: p.treinado } : {}) })).filter((p) => p.nome),
    ataques: lista(a.ataques, 12).map((t) => ({
      nome: str(t?.nome, 60).trim(), qtd: entre(int(t?.qtd, 1), 1, 20), tipo: t?.tipo === "dist" ? "dist" : "cac", bonus: int(t?.bonus),
      dados: (String(t?.dados ?? "").replace(/\s+/g, "").match(/^\d+d\d+(?:\+\d+d\d+)*$/) || [""])[0], bonusDano: int(t?.bonusDano),
      tipoDano: TIPOS_DANO.includes(t?.tipoDano) ? t.tipoDano : "", margem: entre(int(t?.margem, 20), 2, 20), mult: entre(int(t?.mult, 2), 2, 10),
      extra: str(t?.extra, 120).trim(), resto: str(t?.resto, 120).trim(), complementar: !!t?.complementar, desc: str(t?.desc, 1000).trim(),
    })),
    habilidades: lista(a.habilidades, 40).map((h) => ({ nome: str(h?.nome, 80).trim(), acao: dono(ACOES, h?.acao) ? h.acao : "",
      custo: Math.max(0, int(h?.custo)), magica: !!h?.magica, extra: str(h?.extra, 80).trim(), desc: str(h?.desc, 3000).trim(), ...mecanica(h) })),
    equipamento: str(a.equipamento, 600).trim(), tesouro: str(a.tesouro, 300).trim(), fonte: str(a.fonte, 60).trim(), obs: str(a.obs, 1000).trim(),
    chefe: a.chefe && typeof a.chefe === "object" && !Array.isArray(a.chefe) ? { arena: str(a.chefe.arena, 60).trim(), efeitoArena: str(a.chefe.efeitoArena, 1000).trim(),
      recursos: lista(a.chefe.recursos, 12).map((r) => ({ nome: str(r?.nome, 60).trim(), efeito: str(r?.efeito, 1000).trim() })).filter((r) => r.nome || r.efeito) } : null,
  };
}

// ---------------------------------------------------------------- chefe final (AdA, fim do cap. 1)
export const RD_CHEFE = [0, 0, 5, 10, 20]; // por patamar: veterano 5, campeão 10, lenda 20 (iniciante não ganha)
// ND que vale pra XP e tesouro: +2 (abaixo de 1 vira 2)
export const ndRecompensa = (a) => (a.chefe ? String(a.nd.includes("/") ? 2 : nivelDoNd(a.nd) + 2) : a.nd);
// "1d6/2d6/4d6/8d6" → o valor do patamar (1 iniciante … 4 lenda)
export const porPatamar = (texto, p) => String(texto ?? "").replace(/([+–-]?[\wº%]+)\/([+–-]?[\wº%]+)\/([+–-]?[\wº%]+)\/([+–-]?[\wº%]+)/g, (...m) => {
  const v = m[entre(p, 1, 4)];
  return v + (/%$/.test(m[4]) && !/%$/.test(v) ? "%" : ""); // "25/50/75/100%": o % só vem no último
});
export function comoChefe(a) {
  if (!a?.chefe) return a;
  const p = patamarDoNd(a.nd), nivel = nivelDoNd(a.nd), rd = RD_CHEFE[p], c = a.chefe;
  let defesas = a.defesas || "";
  if (!/maior que a morte/i.test(defesas)) defesas = [defesas, "maior que a morte"].filter(Boolean).join(", ");
  if (rd) {
    const m = defesas.match(/\b(redu[çc][ãa]o de dano|RD)\s+(\d+)(?![\d/]|\s*\(\s*exceto)/i); // RD geral que já existe soma com a do chefe (RD com exceção, não)
    defesas = m ? defesas.replace(m[0], `${m[1]} ${Number(m[2]) + rd}`) : `${defesas}, redução de dano ${rd}`;
  }
  const hab = [];
  if (c.arena || c.efeitoArena || c.recursos.length) {
    hab.push({ nome: "Rei da Arena", acao: "", custo: 0, magica: false, extra: "", desc: `No fim do turno de cada personagem jogador, ganha uma ação de movimento só para ativar um recurso `
      + `(não o mesmo duas vezes na rodada; vale mesmo se não puder agir). Arena e recursos usam CD ${a.cd ?? "das habilidades"}; identificar um recurso: CD ${15 + (a.nd.includes("/") ? 0 : nivel)} com a perícia ligada a ele.` });
    if (c.arena || c.efeitoArena) hab.push({ nome: `Arena${c.arena ? ` (${c.arena})` : ""}`, acao: "", custo: 0, magica: false, extra: "", desc: porPatamar(c.efeitoArena, p) });
    // recurso que se ativa gasta a ação de movimento extra; os passivos (Fonte Curativa, Orbe…) não têm ação
    for (const r of c.recursos) hab.push({ nome: `Recurso: ${r.nome || "recurso"}`, acao: /a[çc][ãa]o de movimento/i.test(r.efeito) ? "Movimento" : "", custo: 0, magica: false, extra: "", desc: porPatamar(r.efeito, p) });
  }
  return { ...a, pv: a.pv * 2, pm: a.pm ? a.pm + 2 * nivel : 0, defesas, habilidades: [...(a.habilidades || []), ...hab] };
}

// ---------------------------------------------------------------- ficha (texto e html)
export const pericia = (a, nome) => a.pericias?.find((p) => norm(p.nome) === norm(nome))?.valor;
export const tipoLinha = (a) => { const sub = [a.subtipo, a.grupo].filter(Boolean).join(", "); return `${a.tipo}${sub ? ` (${sub})` : ""} ${a.tamanho}`; };
export const nomeAtaque = (at) => (at.qtd > 1 && !RE_QTD.test(at.nome || "") ? `${at.nome || "Ataque"} ×${at.qtd}` : at.nome || "Ataque");
export const ataqueTexto = (at) => { const d = danoTexto(at); return `${nomeAtaque(at)} ${sinal(at.bonus)}${d ? ` (${d})` : ""}`; };
const emLista = (xs) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} e ${xs.at(-1)}`);
const B = (s) => ({ b: s });
// linhas da ficha no formato do livro; cada linha = partes (texto ou {b} em negrito)
export function linhasFicha(base) {
  const a = comoChefe(base), P = (n) => pericia(a, n) ?? 0;
  const L = [];
  L.push([B("Iniciativa"), ` ${sinal(P("Iniciativa"))}, `, B("Percepção"), ` ${sinal(P("Percepção"))}${a.sentidos ? `, ${a.sentidos}` : ""}`]);
  L.push([B("Defesa"), ` ${a.defesa}, `, B("Fort"), ` ${sinal(a.fort)}, `, B("Ref"), ` ${sinal(a.ref)}, `, B("Von"), ` ${sinal(a.von)}${a.defesas ? `, ${a.defesas}` : ""}`]);
  L.push([B("Pontos de Vida"), ` ${a.pv}`]);
  L.push([B("Deslocamento"), ` ${deslTexto(a.desl)}`]);
  if (a.pm) L.push([B("Pontos de Mana"), ` ${a.pm}`]);
  const cac = (a.ataques || []).filter((x) => x.tipo !== "dist").map(ataqueTexto), dist = (a.ataques || []).filter((x) => x.tipo === "dist").map(ataqueTexto);
  if (cac.length) L.push([B("Corpo a Corpo"), ` ${emLista(cac)}.`]);
  if (dist.length) L.push([B("À Distância"), ` ${emLista(dist)}.`]);
  for (const h of a.habilidades || []) {
    const par = [h.acao, h.custo ? `${h.custo} PM` : "", h.extra].filter(Boolean).join(", ");
    L.push([B(`${h.nome}${h.magica ? " ⚝" : ""}`), `${par ? ` (${par})` : ""}${h.desc ? ` ${h.desc}` : ""}`]);
  }
  L.push(ATRIBUTOS.flatMap((k, i) => [B(k[0].toUpperCase() + k.slice(1)), ` ${atrTexto(a.atributos?.[k])}${i < 5 ? ", " : ""}`]));
  const outras = (a.pericias || []).filter((p) => !["iniciativa", "percepcao", "luta", "pontaria"].includes(norm(p.nome))).map((p) => `${p.nome} ${sinal(p.valor)}${p.obs ? ` ${p.obs}` : ""}`);
  if (outras.length) L.push([B("Perícias"), ` ${outras.join(", ")}.`]);
  if (a.equipamento) L.push([B("Equipamento"), ` ${a.equipamento}`]);
  L.push([B("Tesouro"), ` ${a.tesouro || "Nenhum"}`]);
  return L;
}
const papelRotulo = (a) => ({ solo: "solo", lacaio: "lacaio", especial: "especial" }[a.papel] || a.papel) + (a.chefe ? ", chefe final" : "");
// texto colável (o "Importar ficha" do sistema no Foundry entende este formato)
export function fichaTexto(a) {
  return [a.nome, `ND ${a.nd}`, `${tipoLinha(a)} (${papelRotulo(a)})`, ...linhasFicha(a).map((l) => l.map((p) => (typeof p === "string" ? p : p.b)).join(""))].join("\n");
}
export const escH = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
export function fichaHtml(a) {
  const linha = (l) => `<div class="l">${l.map((p) => (typeof p === "string" ? escH(p) : `<b>${escH(p.b)}</b>`)).join("")}</div>`;
  return `<h2>${escH(a.nome)}</h2><div class="tipo-linha">ND ${escH(a.nd)} · ${escH(tipoLinha(a))} · ${escH(papelRotulo(a))}${a.chefe ? ` (XP e tesouro de ND ${escH(ndRecompensa(a))})` : ""}</div>`
    + `<div class="miolo generica ameaca-ficha">${a.img ? `<img class="a-img" src="${escH(a.img)}" alt="" referrerpolicy="no-referrer">` : ""}${linhasFicha(a).map(linha).join("")}</div>`;
}

// ---------------------------------------------------------------- mecânica das habilidades ⇄ texto
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const metrosTxt = (n) => `${String(n).replace(".", ",")}m`;
// "Ref CD 22 reduz à metade" → { teste: "ref", efeitoTeste: "reduz à metade" }
function testeDoTexto(texto) {
  const m = String(texto || "").match(/\b(Fort(?:itude)?|Ref(?:lexos)?|Von(?:tade)?)\.?\s+(?:CD\s+\d+\s+)?(evita|anula|desacredita|parcial|reduz(?:\s+(?:o\s+dano\s+)?[àa]\s+metade)?(?:\s+e\s+evita)?|metade)/i);
  if (!m) return null;
  const teste = { for: "fort", ref: "ref", von: "von" }[norm(m[1]).slice(0, 3)];
  const e = norm(m[2]);
  const efeitoTeste = /metade/.test(e) ? (/evita/.test(e) ? "reduz à metade e evita" : "reduz à metade") : e === "reduz" ? "parcial" : EFEITOS_TESTE.find((x) => norm(x) === e) || "";
  return teste ? { teste, efeitoTeste } : null;
}
const RE_FORMA = /\b(cone|linha|quadrado|cubo|esfera|c[ií]rculo|raio|explos[aã]o|emana[cç][aã]o|nuvem|cilindro)\s+(?:de\s+|com\s+)?(\d+(?:,\d+)?)\s*m\b/i;
const FORMA_ALIAS = { cubo: "quadrado", circulo: "esfera", explosao: "esfera", nuvem: "esfera", cilindro: "esfera", emanacao: "raio" };
const RE_CONDICAO = CONDICOES_NOMES.map((c) => [c, new RegExp(`\\b${norm(c).replace(/[oa]$/, "")}${/[oa]$/.test(norm(c)) ? "[oa]s?" : ""}\\b`)]);
// lê a mecânica de uma habilidade escrita em texto (biblioteca, bestiário, ator importado); só preenche o que achar
export function camposDoTexto(texto) {
  const t = String(texto || ""), n = norm(t), m = {};
  const te = testeDoTexto(t);
  if (te) Object.assign(m, te);
  const danos = [];
  for (const x of t.matchAll(/(\d+d\d+(?:\s*[+-]\s*\d+)?)\s+(?:pontos\s+)?(?:de\s+)?(?:dano\s+)?(?:de\s+)?(\p{L}+(?:\s+de\s+vida)?)/gu)) {
    const tp = norm(x[2]);
    const tipo = DANO_CHAVE[tp] || (/^perda de vida/.test(tp) ? "perda de vida" : /^pv\b/.test(tp) && /\b(cura|recupera)/.test(n.slice(Math.max(0, x.index - 40), x.index)) ? "cura" : "");
    if (tipo || /dano/.test(norm(x[0]))) danos.push({ formula: x[1].replace(/\s+/g, ""), tipo });
  }
  if (danos.length) m.danos = danos.slice(0, 4);
  const f = t.match(RE_FORMA);
  if (f) { m.forma = FORMA_ALIAS[norm(f[1])] || norm(f[1]); m.metros = Number(f[2].replace(",", ".")); }
  const al = n.match(/\balcance (curto|medio|longo)\b/);
  if (al) m.alcance = { curto: "curto", medio: "médio", longo: "longo" }[al[1]];
  else if (/\badjacente/.test(n)) m.alcance = "toque/adjacente";
  const du = n.match(/\bpor (\d+d\d+|\d+|uma) rodadas?\b/);
  if (du) { m.duracao = "rodadas"; m.duracaoN = du[1] === "uma" ? "1" : du[1]; }
  else if (/\b(ate o fim da|pela|pelo resto da|durante a) cena\b/.test(n)) m.duracao = "cena";
  else if (/\bsustentad/.test(n)) m.duracao = "sustentada";
  else if (/\bpermanente/.test(n)) m.duracao = "permanente";
  else if (/\bpor (um|1) dia\b/.test(n)) m.duracao = "dia";
  // condição só quando é imposta ("fica abalado", "deixando-o cego"), não quando é citada ("contra alvos desprevenidos")
  const impostas = [...n.matchAll(/(?<!\b(?:nao|nunca|sem)\s)\b(?:fica|ficam|ficar|fique|ficara|ficando|deixa|deixando|deixar|torna|tornando|tornar|cai|caindo|e derrubad[oa])\b[^.;()]{0,60}/g)]
    .map((x) => x[0]).join(" | "); // "não fica desprevenido" não impõe nada
  const cond = RE_CONDICAO.filter(([, re]) => re.test(impostas)).map(([c]) => c);
  if (cond.length) m.condicoes = cond.slice(0, 6);
  return m;
}
const temMecanica = (h) => !!(h.teste || h.forma || h.alcance || h.alvo || h.duracao || h.danos?.length || h.condicoes?.length);
const duracaoTxt = (h) => (h.duracao === "rodadas" ? `por ${h.duracaoN || 1} rodada${h.duracaoN === "1" || !h.duracaoN ? "" : "s"}` : h.duracao === "cena" ? "até o fim da cena"
  : h.duracao === "sustentada" ? "enquanto sustentar" : h.duracao === "dia" ? "por um dia" : h.duracao === "permanente" ? "permanentemente" : "");
const danoHabTxt = (d) => `${d.formula}${d.tipo === "cura" ? " PV de cura" : d.tipo === "perda de vida" ? " de perda de vida" : d.tipo ? ` ${d.tipo}` : ""}`;
// texto no formato do livro a partir da mecânica: "Cone de 12m. 3d6+10 fogo (Ref CD 22 reduz à metade)."
export function descDosCampos(h, cd) {
  const area = h.forma ? `${cap(h.forma)} de ${metrosTxt(h.metros || 0)}${h.forma === "esfera" ? " de raio" : ""}` : "";
  const onde = [area, h.alcance && h.alcance !== "pessoal" ? (h.alcance === "toque/adjacente" ? "adjacente" : `alcance ${h.alcance}`) : "", h.alvo].filter(Boolean).join(", ");
  const dano = (h.danos || []).map(danoHabTxt).join(" + ");
  const cond = h.condicoes?.length ? `${dano ? "e " : ""}fica ${emLista(h.condicoes)}${duracaoTxt(h) ? ` ${duracaoTxt(h)}` : ""}` : "";
  const teste = h.teste ? `${TESTES[h.teste][2]} CD ${cd ?? "?"}${h.efeitoTeste ? ` ${h.efeitoTeste}` : ""}` : "";
  const corpo = [dano, cond].filter(Boolean).join(" ");
  return [onde && `${cap(onde)}.`, corpo ? `${cap(corpo)}${teste ? ` (${teste})` : ""}.` : teste ? `${teste}.` : ""].filter(Boolean).join(" ");
}

// ---------------------------------------------------------------- modelo → Foundry (ator NPC, sistema tormenta20)
const ALFA = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const novoId = () => Array.from({ length: 16 }, () => ALFA[Math.floor(Math.random() * 62)]).join("");
const paragrafos = (s) => (s ? `<p>${escH(s).replace(/\n+/g, "</p><p>")}</p>` : "");
function sentidosDe(texto) {
  const value = new Set(), custom = [];
  for (const parte of String(texto || "").split(/,\s*/).map((s) => s.trim()).filter(Boolean)) {
    const k = Object.keys(SENTIDOS).find((s) => norm(parte).startsWith(norm(s)));
    if (k) value.add(SENTIDOS[k]);
    if (!k || norm(parte) !== norm(k)) custom.push(parte);
  }
  return { value: [...value], custom: custom.join(", ") };
}
export { sentidosDe };
const PALAVRA_LIGA = new Set(["a", "ao", "aos", "as", "e", "de", "do", "da", "dos", "das", "efeito", "efeitos", "imune", "imunidade", "imunidades", "vulnerabilidade", "vulnerabilidades", "contra", "tipo", "ou"]);
const PARA_FRASE = /\b(recupera|cura|com|sofre|quando|se|mas|ganha|exceto|enquanto|recebe)\b/;
// "imunidade a fogo, redução de dano 10, resistência a magia +3, vulnerabilidade a frio" → campos do sistema.
// Vai trecho por trecho (separados por vírgula): imunidade/vulnerabilidade continuam nos trechos seguintes que forem só lista
// ("imunidade a atordoado, metamorfose e paralisia"); o trecho que não for entendido inteiro fica em `resto` (texto da ficha).
// Imunidade que o sistema não tem como campo (acertos críticos, adivinhação…) mantém a lista viva e vai pro texto.
const SEM_CAMPO = new Set(["adivinhacao", "encantamento", "encantamentos", "confusao", "acertos", "criticos", "dano", "ilusao", "ilusoes", "mental", "magia", "magicos"]);
export function tracosDe(texto) {
  const res = {}, ic = new Set(), resto = [];
  let magia = 0, modo = null, pend = [], buf = [];
  const r = (k) => (res[k] ||= { base: 0, bonus: [], imunidade: false, vulnerabilidade: false });
  for (const original of String(texto || "").split(/\s*[,;]\s*/).filter((s) => s.trim())) {
    const s = norm(original).replace(/\([^()]*exceto[^()]*\)|\bexceto\s+\S+/g, " ").replace(/\bvulnerave(l|is)\b/g, "vulnerabilidade").replace(/\breducao a\b|\breduction de\b/g, "reducao de").trim();
    if (PARA_FRASE.test(s)) { modo = null; resto.push(...buf, original); pend = []; buf = []; continue; }
    if (/^imun/.test(s)) modo = "imun";
    else if (/^vulnerab/.test(s)) modo = "vuln";
    else if (/^(reducao de|rd\b)/.test(s)) modo = "rd";
    else if (/^resistencia a magia/.test(s)) modo = "rm";
    else if (/^resistencia\b/.test(s) || /^\p{Lu}/u.test(original.trim())) modo = null; // "resistência a veneno +5" e nome de habilidade encerram a lista
    else if ((modo === "rd" && !pend.length) || modo === "rm") modo = null;
    const palavras = s.split(/[^a-z0-9]+/).filter(Boolean);
    let entendeu = false, sobra = false;
    if (modo === "imun" || modo === "vuln") {
      let conhecida = false;
      for (const w of palavras) {
        if (DANO_CHAVE[w]) {
          r(w)[modo === "imun" ? "imunidade" : "vulnerabilidade"] = true; entendeu = true;
          if (modo === "imun" && CONDICOES.has(w)) ic.add(w); // luz e trevas: imune ao dano e à categoria de efeito
        } else if (modo === "imun" && (CONDICOES.has(w) || SIN_CONDICAO[w])) { ic.add(CONDICOES.has(w) ? w : SIN_CONDICAO[w]); entendeu = true; }
        else if (modo === "imun" && SEM_CAMPO.has(w)) { conhecida = true; sobra = true; }
        else if (!PALAVRA_LIGA.has(w)) sobra = true;
      }
      if (!entendeu && !conhecida && !/^(imun|vulnerab)/.test(s)) modo = null;
      else if (sobra && !/^(imun|vulnerab)/.test(s)) { resto.push(`${modo === "imun" ? "imunidade a" : "vulnerabilidade a"} ${original}`); continue; } // continuação vai pro texto com o prefixo
    } else if (modo === "rd") {
      const n = num((s.match(/\d+/) || [])[0]);
      const tipos = palavras.filter((w) => DANO_CHAVE[w]);
      // "redução de corte, frio e perfuração 5": os tipos sem número esperam o número do trecho seguinte
      if (!n && tipos.length && palavras.every((w) => DANO_CHAVE[w] || PALAVRA_LIGA.has(w) || ["reducao", "rd"].includes(w))) { pend.push(...tipos); buf.push(original); continue; }
      if (n) {
        const ex = s.match(/\/\s*([a-z]+)/);
        // "redução de dano 10/luz" = RD 10 contra tudo menos luz: é o "excecao" do sistema; o texto fica pra ficha dizer
        if (ex && DANO_CHAVE[ex[1]] && /^(reducao de dano|rd)\b/.test(s)) { r(ex[1]).excecao = n; sobra = true; }
        else if ((!tipos.length && !pend.length) || /^(reducao de dano|rd)\b/.test(s)) r("dano").base += n; // duas RD gerais somam (a do chefe final é uma delas)
        else for (const w of [...pend, ...tipos]) r(w).base = n;
        entendeu = true;
        sobra ||= /exceto/.test(norm(original)) || palavras.some((w) => !DANO_CHAVE[w] && !PALAVRA_LIGA.has(w) && !/^\d+$/.test(w) && !["reducao", "rd", "dano"].includes(w));
        if (sobra) resto.push(...buf);
      } else resto.push(...buf);
      pend = []; buf = [];
      if (!n) modo = null;
    } else if (modo === "rm") { magia = num((s.match(/\d+/) || [])[0]) || 0; sobra = true; } // o efeito de uso não aparece na ficha do Foundry: o texto fica
    if (buf.length && modo !== "rd") { resto.push(...buf); buf = []; pend = []; }
    if (!entendeu || sobra) resto.push(original);
  }
  resto.push(...buf);
  return { resistencias: res, ic: [...ic], magia, resto: resto.join(", ") };
}
// "ilumina em 9 metros", "emite luz (6m)" nos sentidos, defesas ou habilidades → luz do token (plena = o raio, penumbra = o dobro)
export function luzDe(a) {
  const t = [a.sentidos, a.defesas, ...(a.habilidades || []).map((h) => `${h.nome}. ${h.desc}`)].join(" | ");
  const m = t.match(/\b(?:ilumina\w*|emite\s+luz|brilha\w*|luz\s+(?:plena|forte))\b[^.|\d]{0,30}?(\d+(?:,\d+)?)\s*(?:m\b|metros)/i);
  return m ? Number(m[1].replace(",", ".")) : 0;
}
const nomeItem = (at) => { const n = (at.nome || "Ataque").replace(RE_QTD, "").trim() || "Ataque"; return n[0].toUpperCase() + n.slice(1); };
const vazio = (v) => v == null || v === "" || v === 0 || (Array.isArray(v) && !v.length);
// a mecânica que vai pro Foundry: o que foi preenchido no criador manda; o que ficou vazio é lido do texto (c.doTexto = quais)
export function mecanicaEfetiva(h) {
  const lido = camposDoTexto(h.desc), c = Object.fromEntries([...new Set([...Object.keys(lido), ...Object.keys(h)])].map((k) => [k, vazio(h[k]) ? lido[k] : h[k]]));
  if (vazio(h.forma) && lido.forma) c.metros = lido.metros;
  c.doTexto = Object.keys(lido).filter((k) => vazio(h[k]));
  return c;
}
// habilidade → item "poder"
function poderDe(h, cd) {
  const c = mecanicaEfetiva(h);
  const n = String(c.duracaoN || ""), dado = /d/.test(n);
  const duracao = c.duracao === "rodadas" && dado ? { units: "special", value: 0, special: `${n} rodadas` }
    : { units: DURACOES[c.duracao] || "inst", value: c.duracao === "rodadas" ? Number(n) || 1 : 0, special: "" };
  const cena = c.duracao === "cena", rodadas = c.duracao === "rodadas" && !dado ? Number(n) || 1 : 0;
  const efeitos = (c.condicoes || []).map((nome) => ({ _id: novoId(), name: cap(nome), img: "icons/svg/daze.svg", transfer: false, disabled: false, changes: [], statuses: [],
    duration: cena ? { rounds: 99 } : rodadas ? { rounds: rodadas } : {}, flags: { tormenta20: { onuse: false, durationScene: cena } } }));
  return { _id: novoId(), name: `${h.nome || "Habilidade"}${h.magica ? " ⚝" : ""}`, type: "poder", img: h.magica ? "icons/svg/daze.svg" : "icons/svg/aura.svg",
    system: { description: { value: paragrafos([h.extra && `(${h.extra})`, h.desc || descDosCampos(c, cd)].filter(Boolean).join(" ")), chat: "", unidentified: "" },
      tipo: "ability", ativacao: { execucao: h.acao ? ACOES[h.acao] : "passive", custo: h.custo || 0, qtd: "", condicao: "", special: "" },
      alcance: ALCANCES[c.alcance] || "none", area: c.forma ? `${cap(c.forma)} ${metrosTxt(c.metros || 0)}${c.forma === "esfera" ? " de raio" : ""}` : "", efeito: c.alvo || "", duracao,
      // num NPC a CD é sempre a do ator (attributes.cd); "pericia" não é usada pelo sistema, só serve pra ler de volta
      resistencia: { pericia: c.teste ? TESTES[c.teste][0] : "", atributo: "", bonus: 0, txt: c.teste ? [TESTES[c.teste][1], c.efeitoTeste].filter(Boolean).join(" ") : "" },
      rolls: c.danos?.length ? [{ name: "Dano", key: "dano0", type: "dano", parts: c.danos.map((d) => [d.formula, TIPO_HAB_CHAVE[d.tipo] || norm(d.tipo), ""]), versatil: "" }] : [] },
    effects: efeitos };
}

export function paraFoundry(base) {
  const a = comoChefe(base), nivel = nivelDoNd(a.nd), meio = Math.floor(nivel / 2), treino = nivel > 14 ? 6 : nivel > 6 ? 4 : 2;
  const atr = (k) => a.atributos?.[k] ?? 0;
  const pericias = {};
  // o sistema soma ½ nível + treino (se treinada) + atributo + "outros": "outros" é o que falta pra dar o total da ficha
  const furt = { min: 5, peq: 2, med: 0, gra: -2, eno: -5, col: -10 }[TAMANHOS[a.tamanho]] || 0; // a Furtividade da ficha já tem o tamanho
  const fixar = (chave, abl, total, treinado = total - meio - atr(abl) - (chave === "furt" ? furt : 0) >= treino) => {
    pericias[chave] = { atributo: abl, treinado, outros: total - meio - atr(abl) - (treinado ? treino : 0), size: false };
  };
  const per = (nome) => a.pericias?.find((p) => norm(p.nome) === norm(nome));
  fixar("inic", "des", per("Iniciativa")?.valor ?? meio + atr("des"), per("Iniciativa")?.treinado ?? false);
  fixar("perc", "sab", per("Percepção")?.valor ?? meio + atr("sab"), per("Percepção")?.treinado ?? false);
  fixar("fort", "con", a.fort, false); fixar("refl", "des", a.ref, false); fixar("vont", "sab", a.von, false);
  for (const p of a.pericias || []) { const k = chavePericia(p.nome); if (k && !["inic", "perc", "fort", "refl", "vont"].includes(k[0])) fixar(k[0], k[1], p.valor, p.treinado); }
  const ataques = a.ataques || [];
  const primeiro = { cac: ataques.find((x) => x.tipo !== "dist"), dist: ataques.find((x) => x.tipo === "dist") };
  if (primeiro.cac) fixar("luta", "for", primeiro.cac.bonus, true); // Luta = valor do ataque (o livro: ter o ataque = ser treinado)
  if (primeiro.dist) fixar("pont", "des", primeiro.dist.bonus, true);

  const itens = [];
  for (const at of ataques) {
    const dist = at.tipo === "dist", base = (dist ? primeiro.dist : primeiro.cac).bonus;
    const formula = at.dados ? at.dados + (at.bonusDano ? (at.bonusDano > 0 ? "+" : "") + at.bonusDano : "") : at.bonusDano ? String(at.bonusDano) : "";
    const rolls = [{ name: "Ataque", key: "ataque0", type: "ataque", parts: [["1d20", "", ""], [dist ? "pont" : "luta", "", ""], [String(at.bonus - base), "", ""]], versatil: "" }];
    if (formula) {
      const parts = [[formula, at.tipoDano ? norm(at.tipoDano) : "", "weapon"], ["", "", ""]];
      const ex = formulaDoExtra(at.extra), exTipo = DANO_CHAVE[(norm(String(at.extra || "").slice(ex?.[0].length || 0)).match(/[a-z]+/) || [])[0]];
      if (ex) parts.push([ex[0].replace(/\s+/g, ""), exTipo ? norm(exTipo) : "", ""]);
      rolls.push({ name: "Dano", key: "dano1", type: "dano", parts, versatil: "" });
    }
    itens.push({ _id: novoId(), name: nomeItem(at), type: "arma", img: dist ? "icons/svg/target.svg" : "icons/svg/sword.svg",
      system: { description: { value: paragrafos([ataqueTexto(at), at.desc].filter(Boolean).join(". ")), chat: "", unidentified: "" },
        rolls, criticoM: at.margem || 20, criticoX: at.mult || 2, qtd: at.qtd || 1, equipado: 1 } });
  }
  for (const h of a.habilidades || []) if (h.nome || h.desc || temMecanica(h)) itens.push(poderDe(h, a.cd));

  const tr = tracosDe(a.defesas);
  // "resistência a magia +N" vira efeito de uso nas resistências, do jeito que o "Importar ficha" do próprio sistema faz
  const effects = tr.magia ? [{ _id: novoId(), name: "Resistência a Magia", img: "icons/svg/upgrade.svg", disabled: true, transfer: false,
    changes: [{ key: "roll", mode: 2, value: String(tr.magia), priority: null }], flags: { tormenta20: { onuse: true, skill: true, items: "Fortitude;Reflexos;Vontade" } } }] : [];
  const d = a.desl || {};
  const mov = (n) => ({ base: Number(n) || 0, bonus: [] });
  const tamanho = TAMANHOS[a.tamanho] || "med", img = a.img || "systems/tormenta20/icons/svg/orc-head.svg", lado = QUADRADOS[tamanho], luz = luzDe(a);
  const bio = [a.conceito, a.obs, a.fonte && `Fonte: ${a.fonte}`].filter(Boolean).join("\n");
  return {
    name: a.nome || "Ameaça", type: "npc", img,
    system: {
      atributos: Object.fromEntries(ATRIBUTOS.map((k) => [k, { base: atr(k) }])),
      attributes: {
        // o sistema soma Des (e armadura/escudo equipados, que não exportamos) na Defesa de NPC: a base é o que falta
        nd: a.nd, cd: a.cd ?? 10, pv: { value: a.pv, max: a.pv }, pm: { value: a.pm || 0, max: a.pm || 0 }, defesa: { base: a.defesa - atr("des"), atributo: "des" },
        movement: { walk: mov(d.terrestre), fly: mov(d.voo), swim: mov(d.natacao), climb: mov(d.escalada), burrow: mov(d.escavacao), hover: /\bpaira/.test(norm(d.obs)), unit: "m" },
        sentidos: sentidosDe(a.sentidos),
      },
      // a ficha do sistema já escreve imunidades, RD e vulnerabilidades dos campos; o texto livre leva só o que sobrou
      detalhes: { biography: { value: paragrafos(bio), public: "" }, tipo: TIPOS[a.tipo] || "mon", raca: [a.subtipo, a.grupo].filter(Boolean).join(", "),
        role: PAPEIS[a.papel] || "solo", resistencias: tr.resto, equipamento: a.equipamento || "", tesouro: a.tesouro || "", movimento: d.obs || "",
        ataquescac: emLista(ataques.filter((x) => x.tipo !== "dist").map(ataqueTexto)), ataquesad: emLista(ataques.filter((x) => x.tipo === "dist").map(ataqueTexto)) },
      tracos: { tamanho, ic: { value: tr.ic, custom: "" }, resistencias: tr.resistencias },
      pericias,
    },
    items: itens, effects,
    prototypeToken: { name: a.nome || "Ameaça", width: lado, height: lado, texture: { src: img }, disposition: -1, actorLink: false, displayBars: 20,
      bar1: { attribute: "attributes.pv" }, bar2: { attribute: "attributes.pm" }, sight: { enabled: true }, ...(luz ? { light: { bright: luz, dim: luz * 2 } } : {}) },
    // o modelo inteiro vai junto: importar de volta no criador não perde nada (e o que for editado no Foundry é detectado)
    flags: { world: { hubT20: base, hubT20versao: VERSAO_EXPORT } },
    // sem _stats o Foundry acha que é dado pré-v10 e roda todas as migrações antigas
    _stats: { coreVersion: "13.345", systemId: "tormenta20", systemVersion: "1.5.015" },
  };
}

// ---------------------------------------------------------------- Foundry → modelo
const ENTIDADES = { aacute: "á", agrave: "à", acirc: "â", atilde: "ã", eacute: "é", ecirc: "ê", iacute: "í", oacute: "ó", ocirc: "ô", otilde: "õ", uacute: "ú", uuml: "ü", ccedil: "ç",
  Aacute: "Á", Agrave: "À", Acirc: "Â", Atilde: "Ã", Eacute: "É", Ecirc: "Ê", Iacute: "Í", Oacute: "Ó", Ocirc: "Ô", Otilde: "Õ", Uacute: "Ú", Ccedil: "Ç",
  nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', ndash: "–", mdash: "—", ordm: "º", ordf: "ª" };
export const textoDeHtml = (h) => String(h ?? "").replace(/<section class="secret">[\s\S]*?<\/section>/gi, "").replace(/<\/p>\s*<p[^>]*>|<br\s*\/?>/gi, "\n").replace(/<[^>]*>/g, "")
  .replace(/&(#\d+|[a-zA-Z]+);/g, (m, e) => (e[0] === "#" ? String.fromCharCode(Number(e.slice(1))) : ENTIDADES[e] ?? m)).replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").trim();
const inverso = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [v, k]));
const ROTULO_IC = { atordoado: "atordoamento", paralisado: "paralisia", doente: "doenças", cansaco: "cansaço", metabolismo: "efeitos de metabolismo", mental: "efeitos mentais",
  movimento: "efeitos de movimento", sentidos: "efeitos de sentidos", caido: "caído", emchamas: "em chamas" };
// tracos do sistema + texto livre → linha de defesas (o que o texto já diz não é repetido)
function defesasDoNpc(s) {
  const texto = String(s.detalhes?.resistencias || "").trim(), partes = [], ja = tracosDe(texto); // compêndio costuma ter tudo no texto também
  const res = s.tracos?.resistencias || {}, rotulo = (k) => TIPOS_DANO.find((x) => norm(x) === k) || k, rdDe = (k) => Number(res[k]?.base) || Number(res[k]?.value) || 0;
  const imun = [...Object.keys(res).filter((k) => res[k]?.imunidade && DANO_CHAVE[k] && !ja.resistencias[k]?.imunidade).map(rotulo),
    ...(s.tracos?.ic?.value || []).filter((k) => !ja.ic.includes(k)).map((k) => ROTULO_IC[k] || CONDICOES_NOMES.find((c) => norm(c).replace(/\s+/g, "") === k) || k)];
  if (imun.length) partes.push(`imunidade a ${emLista(imun)}`);
  if (rdDe("dano") && !ja.resistencias.dano?.base) partes.push(`redução de dano ${rdDe("dano")}`);
  const porN = {};
  for (const k of Object.keys(res)) if (k !== "dano" && DANO_CHAVE[k] && rdDe(k) && !ja.resistencias[k]?.base) (porN[rdDe(k)] ||= []).push(rotulo(k));
  for (const [n, tipos] of Object.entries(porN)) partes.push(`redução de ${emLista(tipos)} ${n}`);
  const vul = Object.keys(res).filter((k) => res[k]?.vulnerabilidade && DANO_CHAVE[k] && !ja.resistencias[k]?.vulnerabilidade).map(rotulo);
  if (vul.length) partes.push(`vulnerabilidade a ${emLista(vul)}`);
  return [...partes, texto].filter(Boolean).join(", ");
}
function habilidadeDoPoder(it) {
  const d = it.system || {};
  let desc = textoDeHtml(d.description?.value), extra = "";
  const ex = desc.match(/^\(((?:[^()]|\([^()]*\)){1,80})\)\s*/); // "(recarga (movimento)) …" = o uso que o export põe na frente
  if (ex) { extra = ex[1]; desc = desc.slice(ex[0].length); }
  const h = { nome: String(it.name || "").replace(/\s*⚝\s*$/, ""), acao: d.ativacao?.execucao === "passive" ? "" : inverso(ACOES)[d.ativacao?.execucao] || "",
    custo: Number(d.ativacao?.custo) || 0, magica: /⚝/.test(it.name || "") || it.type === "magia", extra, desc };
  if (inverso(ALCANCES)[d.alcance]) h.alcance = inverso(ALCANCES)[d.alcance];
  const f = String(d.area || "").match(RE_FORMA) || String(d.area || "").match(/^\s*(cone|linha|quadrado|esfera|raio)\s*(\d+(?:[.,]\d+)?)\s*m/i);
  if (f) { h.forma = FORMA_ALIAS[norm(f[1])] || norm(f[1]); h.metros = Number(f[2].replace(",", ".")); }
  if (d.efeito) h.alvo = String(d.efeito);
  const du = d.duracao || {}, rod = String(du.special || "").match(/^(\d+d\d+) rodadas$/);
  if (rod) { h.duracao = "rodadas"; h.duracaoN = rod[1]; }
  else if (du.units && du.units !== "inst" && inverso(DURACOES)[du.units]) { h.duracao = inverso(DURACOES)[du.units]; if (du.units === "round") h.duracaoN = String(du.value || 1); }
  const te = testeDoTexto(String(d.resistencia?.txt || "").replace(/^(Fortitude|Reflexos|Vontade)$/i, "$1 evita"));
  if (te) Object.assign(h, te);
  const danos = (d.rolls || []).filter((r) => r.type === "dano").flatMap((r) => r.parts || []).filter((p) => p?.[0])
    .map((p) => ({ formula: p[0], tipo: inverso(TIPO_HAB_CHAVE)[p[1]] || TIPOS_DANO.find((x) => norm(x) === p[1]) || "" }));
  if (danos.length) h.danos = danos;
  const cond = (it.effects || []).map((e) => CONDICOES_NOMES.find((c) => norm(c) === norm(e?.name))).filter(Boolean);
  if (cond.length) h.condicoes = cond;
  return h;
}
// o ator como está no Foundry (o que o mestre vê lá), sem olhar o modelo guardado na flag
function lerNpc(j) {
  const s = j.system, nd = ndCanon(s.attributes?.nd), meio = meioNd(nd), treino = treinoDoNd(nd);
  const atr = (k) => (Number(s.atributos?.[k]?.base) || 0) + (Number(s.atributos?.[k]?.racial) || 0);
  const abl = Object.fromEntries(Object.values(PERICIAS));
  const total = (k) => { const p = s.pericias?.[k]; return p ? meio + atr(p.atributo || abl[k]) + (p.treinado ? treino : 0) + (Number(p.outros) || 0) : meio + atr(abl[k]); };
  const mov = (k) => { const v = s.attributes?.movement?.[k]; return Number(v && typeof v === "object" ? v.base : v) || 0; };
  const rotuloDano = (k) => TIPOS_DANO.find((t) => norm(t) === k) || "";
  const ataques = [], habilidades = [];
  for (const it of j.items || []) {
    const d = it.system || {};
    if (it.type === "arma") {
      const atk = (d.rolls || []).find((r) => r.type === "ataque"), dn = (d.rolls || []).find((r) => r.type === "dano");
      const pk = atk?.parts?.[1]?.[0] === "pont" ? "pont" : "luta";
      const [f = "", tipo = ""] = dn?.parts?.[0] || [];
      const extra = (dn?.parts || []).slice(1).filter((p) => p?.[0]).map((p) => [p[0], rotuloDano(p[1])].filter(Boolean).join(" ")).join(" mais ");
      ataques.push({ ...danoDoTexto(f), nome: it.name, qtd: Number(d.qtd) > 1 ? Number(d.qtd) : 1, tipo: pk === "pont" ? "dist" : "cac",
        bonus: total(pk) + (num(atk?.parts?.[2]?.[0]) || 0), tipoDano: rotuloDano(tipo) || tipoPorArma(it.name), margem: Number(d.criticoM) || 20,
        mult: Number(d.criticoX) || 2, extra, complementar: false, desc: "" });
    } else if (it.type === "poder" || it.type === "magia") habilidades.push(habilidadeDoPoder(it));
  }
  const ja = new Set(["inic", "perc", "fort", "refl", "vont", "luta", "pont"]);
  const comTreino = (k) => (s.pericias?.[k] ? { treinado: !!s.pericias[k].treinado } : {});
  const outras = Object.entries(PERICIAS).filter(([, [k]]) => !ja.has(k) && s.pericias?.[k] && (s.pericias[k].treinado || Number(s.pericias[k].outros)))
    .map(([nome, [k]]) => ({ nome, valor: total(k), ...comTreino(k) }));
  const sent = s.attributes?.sentidos || {}, custom = String(sent.custom || "");
  const bio = textoDeHtml(s.detalhes?.biography?.value), fonte = bio.match(/^Fonte: (.+)$/m)?.[1] || "";
  // Defesa como o prepareDefense do sistema: base + Des (limitada por armadura pesada) + armadura + escudo + acessórios + outros
  const eq = (j.items || []).filter((i) => i?.type === "equipamento" && i.system?.equipado);
  const arm = eq.find((i) => ["leve", "pesada"].includes(i.system.tipo)), esc = eq.find((i) => i.system.tipo === "escudo");
  const valorEq = (i) => Number(i?.system?.armadura?.value) || 0, dAtr = s.attributes?.defesa?.atributo || "des";
  const defesa = (Number(s.attributes?.defesa?.base) || 0) + (arm?.system.tipo === "pesada" ? entre(atr(dAtr), 0, Number(arm.system.armadura?.maxAtr) || 0) : atr(dAtr))
    + valorEq(arm) + valorEq(esc) + eq.filter((i) => !["escudo", "leve", "pesada"].includes(i.system.tipo)).reduce((t, i) => t + valorEq(i), 0) + (Number(s.attributes?.defesa?.outros) || 0);
  const fort = total("fort"), ref = total("refl"), von = total("vont");
  const ordem = [["fort", fort], ["ref", ref], ["von", von]].sort((x, y) => y[1] - x[1]);
  const raca = String(s.detalhes?.raca || "").split(/\s*,\s*/).filter(Boolean);
  return normalizar({
    nome: j.name, nd, papel: inverso(PAPEIS)[s.detalhes?.role] || "solo", tipo: inverso(TIPOS)[s.detalhes?.tipo] || "Monstro",
    subtipo: raca.filter((x) => !/^(bando|enxame)$/i.test(x)).join(", "), grupo: raca.map(norm).find((x) => x === "bando" || x === "enxame") || "",
    tamanho: inverso(TAMANHOS)[s.tracos?.tamanho] || "Médio", conceito: bio.replace(/^Fonte: .+$/m, "").trim(), fonte, img: /^https?:\/\//.test(j.img || "") ? j.img : "",
    defesa, fort, ref, von, res: Object.fromEntries(ordem.map(([k], i) => [k, ["forte", "media", "fraca"][i]])),
    pv: s.attributes?.pv?.max, pm: s.attributes?.pm?.max, cd: s.attributes?.cd,
    sentidos: [...[...(sent.value || [])].map((k) => inverso(SENTIDOS)[k] || k).filter((x) => !norm(custom).includes(norm(x))), custom].filter(Boolean).join(", "),
    defesas: defesasDoNpc(s),
    desl: { terrestre: mov("walk"), voo: mov("fly"), natacao: mov("swim"), escalada: mov("climb"), escavacao: mov("burrow"), obs: s.detalhes?.movimento || "" },
    atributos: Object.fromEntries(ATRIBUTOS.map((k) => [k, atr(k)])),
    pericias: [{ nome: "Iniciativa", valor: total("inic"), ...comTreino("inic") }, { nome: "Percepção", valor: total("perc"), ...comTreino("perc") }, ...outras],
    ataques, habilidades, tesouro: s.detalhes?.tesouro || "",
    equipamento: [s.detalhes?.equipamento, ...(j.items || []).filter((i) => i.type === "equipamento").map((i) => i.name)].filter(Boolean).join(", "),
  });
}
// formato do export: v1 (sem versão na flag) não tinha a mecânica das habilidades nem as defesas separadas em campo + resto
const VERSAO_EXPORT = 2;
// o que comparar pra saber se o mestre editou no Foundry; entre versões diferentes do export, só o que os dois formatos têm igual
function comparavel(k, v, mesmaVersao) {
  if (k === "defesas") { const t = tracosDe(v); return [Object.entries(t.resistencias).sort(), [...t.ic].sort(), t.magia, t.resto.split(/\s*,\s*/).sort()]; }
  if (k === "habilidades" && !mesmaVersao) return v.map((h) => [h.nome, h.acao, h.custo, h.magica, h.desc]);
  return v;
}
// habilidades que o chefe final acrescenta na saída (não são da criatura-base)
const DERIVADA_CHEFE = (h) => h.nome === "Rei da Arena" || /^Arena(\s\(|$)/.test(h.nome) || /^Recurso: /.test(h.nome);
const CAMPOS_FOUNDRY = ["nome", "nd", "papel", "tipo", "subtipo", "grupo", "tamanho", "img", "defesa", "fort", "ref", "von", "pv", "pm", "cd", "sentidos", "defesas", "desl",
  "atributos", "pericias", "ataques", "habilidades", "equipamento", "tesouro", "conceito", "fonte"];
// info.editado = campos que o mestre mudou no Foundry depois de exportar (vêm de lá; o resto vem do modelo guardado na flag)
export function deFoundry(entrada, info = {}) {
  const j = Array.isArray(entrada) ? entrada[0] : entrada;
  const flag = j?.flags?.world?.hubT20 && typeof j.flags.world.hubT20 === "object" ? normalizar(j.flags.world.hubT20) : null;
  if (!j || j.type !== "npc" || !j.system) { if (flag) return flag; throw new Error("o arquivo não é uma ameaça (ator NPC) exportada do Foundry"); }
  const lido = lerNpc(j);
  if (!flag) return lido;
  // compara com o que o próprio export do modelo daria lido do mesmo jeito: diferença = edição feita no Foundry
  const ref = lerNpc(paraFoundry(flag));
  // os itens Rei da Arena / Arena / Recurso saem do chefe final: comparados à parte, e editados lá viram o chefe de novo
  const derivadas = (x) => x.habilidades.filter(DERIVADA_CHEFE).map((h) => [h.nome, h.desc]);
  const chefeLido = flag.chefe && JSON.stringify(derivadas(ref)) !== JSON.stringify(derivadas(lido)) ? lido.habilidades.filter(DERIVADA_CHEFE) : null;
  if (flag.chefe) for (const x of [ref, lido]) x.habilidades = x.habilidades.filter((h) => !DERIVADA_CHEFE(h));
  const mesma = j.flags.world.hubT20versao === VERSAO_EXPORT;
  const mudou = CAMPOS_FOUNDRY.filter((k) => JSON.stringify(comparavel(k, ref[k], mesma)) !== JSON.stringify(comparavel(k, lido[k], mesma)));
  if (chefeLido) mudou.push("chefe");
  if (!mudou.length) return flag;
  info.editado = mudou;
  const m = { ...flag };
  for (const k of mudou) if (k !== "chefe") m[k] = lido[k];
  if (mudou.includes("atributos")) for (const k of ATRIBUTOS) if (flag.atributos[k] == null && lido.atributos[k] === 0) m.atributos[k] = null; // nulo vira 0 lá
  // o item do Foundry tem o nome sem o numeral ("Duas adagas" → "Adagas"): casa pela posição, depois pelo nome do item
  const fx = (e) => formulaDoExtra(e)?.[0].replace(/\s+/g, "") || "";
  if (mudou.includes("ataques")) m.ataques = lido.ataques.map((at, i) => {
    const mesmo = (x) => x && norm(nomeItem(x)) === norm(at.nome), o = mesmo(flag.ataques[i]) ? flag.ataques[i] : flag.ataques.find(mesmo);
    return o ? { ...at, nome: o.nome, desc: o.desc, complementar: o.complementar, resto: o.resto || at.resto, extra: fx(o.extra) === fx(at.extra) ? o.extra : at.extra } : at;
  });
  // o Foundry não tem Ofício nem observação de perícia: o que só o modelo tem continua
  if (mudou.includes("pericias")) m.pericias = [...lido.pericias.map((p) => ({ ...p, obs: flag.pericias.find((q) => norm(q.nome) === norm(p.nome))?.obs || "" })),
    ...flag.pericias.filter((p) => !lido.pericias.some((q) => norm(q.nome) === norm(p.nome)) && !Object.keys(PERICIAS).some((n) => norm(n) === norm(p.nome)))];
  if (mudou.includes("conceito") && flag.obs && m.conceito.endsWith(flag.obs)) m.conceito = m.conceito.slice(0, -flag.obs.length).trim(); // a biografia leva conceito + obs
  if (flag.chefe) { // no Foundry estão os números de chefe: volta pra criatura-base
    const nivel = nivelDoNd(m.nd), rd = RD_CHEFE[patamarDoNd(m.nd)];
    let tirou = false;
    if (mudou.includes("pv")) m.pv = Math.max(1, Math.round(lido.pv / 2));
    if (mudou.includes("pm")) m.pm = Math.max(0, lido.pm - 2 * nivel);
    if (mudou.includes("defesas")) m.defesas = lido.defesas.split(/\s*,\s*/).filter((x) => !/^maior que a morte$/i.test(x) || /maior que a morte/i.test(flag.defesas))
      .map((x) => x.replace(/^(redu[çc][ãa]o de dano|RD)\s+(\d+)(?![\d/]|\s*\(\s*exceto)/i, (t, r, n) => {
        if (tirou || !rd) return t;
        tirou = true;
        return Number(n) - rd > 0 ? `${r} ${Number(n) - rd}` : "";
      })).filter(Boolean).join(", ");
    if (chefeLido) {
      const arena = chefeLido.find((h) => /^Arena(\s\(|$)/.test(h.nome));
      m.chefe = { ...flag.chefe, arena: arena ? (arena.nome.match(/^Arena \((.*)\)$/)?.[1] ?? "") : "", efeitoArena: arena?.desc || "",
        recursos: chefeLido.filter((h) => /^Recurso: /.test(h.nome)).map((h) => ({ nome: h.nome.slice(9), efeito: h.desc })) };
    }
  }
  return normalizar(m);
}

// ---------------------------------------------------------------- auto-teste: node static/ameaca.mjs --check
if (typeof process !== "undefined" && process.argv?.[1]?.endsWith("ameaca.mjs") && process.argv.includes("--check")) {
  const ok = (c, m) => { if (!c) { console.error("FALHOU:", m); process.exit(1); } };
  const igual = (x, y, m) => ok(JSON.stringify(x) === JSON.stringify(y), `${m}: ${JSON.stringify(x)} ≠ ${JSON.stringify(y)}`);
  const d1 = danoDoTexto("1d8+10 impacto, x2, mais 1d8 ácido");
  igual([d1.dados, d1.bonusDano, d1.tipoDano, d1.mult, d1.extra], ["1d8", 10, "impacto", 2, "1d8 ácido"], "dano com extra");
  igual(danoMedio(d1), 19, "dano médio com o extra: (1+8 + 1+8)/2 + 10");
  igual(danoMedio(danoDoTexto("2d6+2")), 9, "2d6+2 = (4+14)/2 = 9");
  const d2 = danoDoTexto("1d12+11, 19/x3");
  igual([d2.dados, d2.bonusDano, d2.margem, d2.mult], ["1d12", 11, 19, 3], "crítico 19/x3");
  igual(danoDoTexto("2d8+12,19").margem, 19, "crítico colado na vírgula");
  igual(danoDoTexto("2d6+5 dano mais 1d6 luz").extra, "1d6 luz", "'dano mais'");
  igual(danoDoTexto("3 impacto").bonusDano, 3, "dano fixo");
  igual(danoDoTexto("agarrar").resto, "agarrar", "dano que não é dano");
  igual(danoTexto(d1), "1d8+10 impacto, mais 1d8 ácido", "dano de volta pro texto");
  igual(bonusPraMedia({ dados: "1d8", extra: "1d8 ácido" }, 19), 10, "bônus que fecha a média");
  igual(deslDoTexto("9m (6q), voo 18m (12q)"), { terrestre: 9, voo: 18, natacao: 0, escalada: 0, escavacao: 0, obs: "" }, "deslocamento com voo");
  igual(deslDoTexto("voo 12m (8q)").terrestre, 0, "só voo");
  igual(deslDoTexto("4,5m (3q), escalar 4,5m (3q), sem redução por terreno difícil").obs, "sem redução por terreno difícil", "deslocamento com nota");
  igual(deslTexto({ terrestre: 4.5, escalada: 6 }), "4,5m (3q), escalada 6m (4q)", "deslocamento em texto");
  // criatura inventada (ND 5: ½ nível 2, treino 2). A mesma conta, feita na mão, bateu com os 83 NPCs do compêndio do sistema
  const bruto = doArsenal({ nome: "Brutamontes", tipo: "Humanoide (gigante) Grande", nd: "5", iniciativa: "+4", percepcao: "+2", percepcaoObs: "visão na penumbra",
    defesa: "22", fort: "+15", ref: "+9", von: "+1", pv: "150", desl: "9m (6q)", pm: "0", atributos: { for: "6", des: "1", con: "3", int: "-2", sab: "-1", car: "-1" },
    ataques: [{ nome: "Tacape", tipo: "Corpo a Corpo", bonus: "+17", dano: "1d12+20" }], habilidades: [{ nome: "Teimoso", tipo: "Qualidade", desc: "x" }],
    pericias: [{ nome: "Atletismo", valor: "+11" }, { nome: "Intuição", valor: "-4" }], tesouro: "Padrão" }, ["Solo"]);
  igual([bruto.tipo, bruto.subtipo, bruto.tamanho, bruto.papel, bruto.ataques[0].tipoDano, bruto.res.fort], ["Humanoide", "gigante", "Grande", "solo", "impacto", "forte"], "ficha do arsenal");
  const f = paraFoundry(bruto), P = f.system.pericias;
  igual([P.luta.outros, P.atle.outros, P.fort.outros, P.inic.outros, P.perc.outros, P.refl.outros, P.intu.outros, P.intu.treinado], [7, 1, 10, 1, 1, 6, -5, false], "\"outros\" das perícias");
  igual([f.system.tracos.tamanho, f.system.detalhes.tipo, f.system.detalhes.role, f.prototypeToken.width, f.system.attributes.sentidos.value, f.system.attributes.defesa.base],
    ["gra", "hum", "solo", 2, ["penumbra"], 21], "ator do Foundry");
  igual(f.items[0].system.rolls[1].parts[0], ["1d12+20", "impacto", "weapon"], "dano do tacape");
  igual(paraFoundry(normalizar({ defesa: 13, atributos: { des: 3 } })).system.attributes.defesa.base, 10, "Defesa: o sistema soma a Des por cima da base");
  igual(deFoundry({ type: "npc", name: "x", system: { attributes: { nd: "2", defesa: { base: 14 } }, atributos: { des: { base: 3 } } },
    items: [{ type: "equipamento", system: { tipo: "escudo", equipado: true, armadura: { value: 2 } } }] }).defesa, 19, "Defesa lida com escudo equipado");
  const tr = tracosDe("imunidade a fogo, atordoamento e paralisia, redução de dano 10/mágico, redução de corte e frio 5, resistência a magia +3, vulnerabilidade a luz");
  igual([tr.resistencias.fogo.imunidade, tr.resistencias.dano.base, tr.resistencias.corte.base, tr.resistencias.frio.base, tr.resistencias.luz.vulnerabilidade, tr.magia, tr.ic],
    [true, 10, 5, 5, true, 3, ["atordoado", "paralisado"]], "imunidades/RD/vulnerabilidade");
  igual(tr.resto, "redução de dano 10/mágico, resistência a magia +3", "o que fica como texto");
  const tv = tracosDe("imunidade a fogo, recupera vida com dano de frio, vulnerável a frio, evasão, redução de dano 5 (exceto mágico)");
  igual([tv.resistencias.fogo.imunidade, tv.resistencias.frio.imunidade, tv.resistencias.frio.vulnerabilidade, tv.ic, tv.resistencias.dano.base, tv.resto],
    [true, false, true, [], 5, "recupera vida com dano de frio, evasão, redução de dano 5 (exceto mágico)"], "frase depois da imunidade não vira imunidade");
  const te = tracosDe("imunidade a acertos críticos, atordoamento, cansaço, efeitos de metabolismo, paralisia e fogo, vulnerabilidade a frio");
  igual([te.ic, te.resistencias.fogo.imunidade, te.resistencias.frio.vulnerabilidade, te.resto], [["atordoado", "cansaco", "metabolismo", "paralisado"], true, true, "imunidade a acertos críticos"],
    "lista de imunidades que começa com uma sem campo");
  // achados da revisão de 2026-10-25 (cada um quebrava uma ficha real do bestiário)
  const rl = tracosDe("redução de corte, frio e perfuração 5");
  igual([rl.resistencias.corte?.base, rl.resistencias.frio?.base, rl.resistencias.perfuracao?.base, rl.resto], [5, 5, 5, ""], "RD com lista de tipos separada por vírgula");
  igual(tracosDe("evasão, imunidade a medo, resistência a efeitos de movimento +2").ic, ["medo"], "\"resistência a X\" encerra a lista de imunidades");
  igual(tracosDe("imunidade a fogo, Aura de Frio").resistencias.frio, undefined, "nome de habilidade encerra a lista");
  const ab = tracosDe("imunidade a ácido, adivinhação, efeitos mentais, fogo e veneno, maior que a morte");
  igual([ab.resistencias.acido.imunidade, ab.resistencias.fogo.imunidade, ab.ic, ab.resto], [true, true, ["mental", "veneno"], "imunidade a adivinhação, maior que a morte"], "item sem campo no meio da lista");
  const vp = tracosDe("cura acelerada 10, redução de dano 10/luz");
  igual([vp.resistencias.luz?.excecao, vp.resistencias.dano, vp.resto], [10, undefined, "cura acelerada 10, redução de dano 10/luz"], "RD N/tipo = exceção do sistema");
  igual(tracosDe("redução de dano 10, redução de dano 5").resistencias.dano.base, 15, "duas RD gerais somam");
  igual(comoChefe(normalizar({ nd: "8", defesas: "redução de dano 10/corte", chefe: {} })).defesas, "redução de dano 10/corte, maior que a morte, redução de dano 5", "RD do chefe não soma em RD com exceção");
  igual(camposDoTexto("Nunca fica desprevenido e não cai inconsciente.").condicoes, undefined, "condição negada não é imposta");
  igual([porPatamar("ignora 25/50/75/100% de um tipo", 2), porPatamar("cura 5/10/20/50", 3)], ["ignora 50% de um tipo", "cura 20"], "porPatamar mantém o %");
  igual(normalizar({ tamanho: "constructor", papel: "__proto__", habilidades: [{ acao: "constructor", alcance: "__proto__", teste: "toString" }] }),
    normalizar({ habilidades: [{}] }), "nomes do Object.prototype não passam como escolha");
  const t0 = Date.now(); tracosDe("(exceto ".repeat(3000)); ok(Date.now() - t0 < 300, "regex do 'exceto' sem backtracking: " + (Date.now() - t0) + " ms");
  igual(deFoundry({ ...paraFoundry(normalizar({ defesas: "imunidade a fogo e atordoamento, recupera vida com dano de fogo, vulnerabilidade a frio" })), flags: {} }).defesas,
    "imunidade a fogo e atordoamento, vulnerabilidade a frio, recupera vida com dano de fogo", "defesas lidas dos campos do Foundry + texto que sobrou");
  igual(camposDoTexto("Cone de 12m. 3d6+10 fogo (Ref CD 16 reduz à metade)."), { teste: "ref", efeitoTeste: "reduz à metade", danos: [{ formula: "3d6+10", tipo: "fogo" }], forma: "cone", metros: 12 },
    "mecânica lida do texto");
  igual(camposDoTexto("Uma criatura em alcance curto fica enjoada por 1d4 rodadas (Fort CD 18 evita). O alvo sofre 3d6+4 de ácido."),
    { teste: "fort", efeitoTeste: "evita", danos: [{ formula: "3d6+4", tipo: "ácido" }], alcance: "curto", duracao: "rodadas", duracaoN: "1d4", condicoes: ["enjoado"] }, "mecânica com condição e duração");
  igual(camposDoTexto("Sopro. 12d12 fogo + chama (Ref CD 32 reduz à metade e evita).").efeitoTeste, "reduz à metade e evita", "reduz à metade e evita");
  const jato = normalizar({ nome: "Jato", cd: 22, habilidades: [{ nome: "Jato de Chamas", acao: "Movimento", magica: true, extra: "recarga (movimento)", forma: "cone", metros: 12,
    danos: [{ formula: "3d6+10", tipo: "fogo" }, { formula: "1d6", tipo: "lixo" }], teste: "ref", efeitoTeste: "reduz à metade", condicoes: ["em chamas", "voando"], duracao: "rodadas", duracaoN: "1" }] });
  igual(jato.habilidades[0].danos, [{ formula: "3d6+10", tipo: "fogo" }, { formula: "1d6", tipo: "" }], "danos normalizados");
  igual(jato.habilidades[0].condicoes, ["em chamas"], "só condição que existe");
  const pj = paraFoundry(jato).items.find((i) => i.type === "poder");
  igual([pj.system.ativacao.execucao, pj.system.area, pj.system.resistencia.txt, pj.system.rolls[0].parts[0], pj.effects[0].name, pj.effects[0].duration.rounds, pj.system.duracao.units],
    ["move", "Cone 12m", "Reflexos reduz à metade", ["3d6+10", "fogo", ""], "Em chamas", 1, "round"], "habilidade estruturada no Foundry");
  ok(textoDeHtml(pj.system.description.value) === "(recarga (movimento)) Cone de 12m. 3d6+10 fogo + 1d6 e fica em chamas por 1 rodada (Ref CD 22 reduz à metade).", "texto montado dos campos: " + textoDeHtml(pj.system.description.value));
  const volta = deFoundry({ ...paraFoundry(jato), flags: {} }).habilidades[0];
  igual([volta.acao, volta.extra, volta.forma, volta.metros, volta.teste, volta.efeitoTeste, volta.duracao, volta.duracaoN, volta.condicoes, volta.danos.length, volta.magica],
    ["Movimento", "recarga (movimento)", "cone", 12, "ref", "reduz à metade", "rodadas", "1", ["em chamas"], 2, true], "habilidade estruturada lida do Foundry");
  const antigo = JSON.parse(JSON.stringify(paraFoundry(jato))), ia = {};
  delete antigo.flags.world.hubT20versao; for (const it of antigo.items) { delete it.effects; it.system.area = ""; it.system.duracao = { units: "inst" }; }
  igual([deFoundry(antigo, ia).habilidades[0].forma, ia.editado], ["cone", undefined], "export antigo (sem versão) não conta como editado no Foundry");
  igual(deFoundry(f), bruto, "ida e volta pelo Foundry");
  const editado = JSON.parse(JSON.stringify(f)), info = {};
  editado.system.attributes.pv.max = 99; editado.items[0].system.rolls[0].parts[2][0] = "3";
  const ed = deFoundry(editado, info);
  igual([ed.pv, ed.ataques[0].bonus, ed.res, ed.atq, info.editado], [99, 20, bruto.res, bruto.atq, ["pv", "ataques"]], "editado no Foundry: o que mudou vem de lá, o resto da flag");
  const comQtd = normalizar({ ...bruto, ataques: [{ nome: "Duas adagas", qtd: 2, bonus: 10, dados: "1d4", extra: "veneno", desc: "Ataques rápidos." }],
    pericias: [...bruto.pericias.map((p) => (p.nome === "Atletismo" ? { ...p, obs: "(+5 para nadar)" } : p)), { nome: "Ofício (alquimia)", valor: 9 }] });
  const eq = JSON.parse(JSON.stringify(paraFoundry(comQtd)));
  eq.items[0].system.criticoM = 19; eq.system.pericias.inic.outros += 1;
  const eqv = deFoundry(eq);
  igual([eqv.ataques[0].nome, eqv.ataques[0].desc, eqv.ataques[0].extra, eqv.ataques[0].margem, eqv.pericias.some((p) => p.nome === "Ofício (alquimia)"),
    eqv.pericias.find((p) => p.nome === "Atletismo")?.obs], ["Duas adagas", "Ataques rápidos.", "veneno", 19, true, "(+5 para nadar)"], "editar ataque e perícia no Foundry não apaga nome, desc, extra, Ofício nem obs");
  const pc = JSON.parse(JSON.stringify(paraFoundry({ ...bruto, chefe: { arena: "", efeitoArena: "", recursos: [{ nome: "Totem", efeito: "x" }] } }))), ic = {};
  pc.system.attributes.pv.max = 400;
  const vc = deFoundry(pc, ic);
  igual([vc.pv, vc.habilidades.length, ic.editado], [200, bruto.habilidades.length, ["pv"]], "chefe editado no Foundry volta pra criatura-base");
  const semFlag = deFoundry({ ...f, flags: {} });
  igual([semFlag.pericias.find((p) => p.nome === "Atletismo")?.valor, semFlag.ataques[0].bonus, semFlag.fort, semFlag.defesa, semFlag.desl.terrestre], [11, 17, 15, 22, 9], "lendo ator do Foundry sem o modelo junto");
  igual([luzDe({ sentidos: "visão no escuro, ilumina em 9 metros" }), luzDe({ habilidades: [{ nome: "Chamas", desc: "Emite luz num raio de 6m." }] }), luzDe({ sentidos: "faro" })], [9, 6, 0], "luz do token");
  igual(paraFoundry(normalizar({ sentidos: "ilumina em 4,5m" })).prototypeToken.light, { bright: 4.5, dim: 9 }, "luz no token do Foundry");
  igual(textoDeHtml("<p>Sofre -5 em testes de Intui&ccedil;&atilde;o</p>"), "Sofre -5 em testes de Intuição", "html do compêndio");
  igual([semFlag.conceito, semFlag.fonte], ["", ""], "biografia sem fonte");
  const comFonte = deFoundry({ ...paraFoundry({ ...bruto, conceito: "Gigante bruto.", fonte: "Livro Básico" }), flags: {} });
  igual([comFonte.conceito, comFonte.fonte], ["Gigante bruto.", "Livro Básico"], "a fonte volta pro campo dela");
  ok(fichaTexto(bruto).startsWith("Brutamontes\nND 5\nHumanoide (gigante) Grande (solo)\nIniciativa +4, Percepção +2, visão na penumbra"), "ficha em texto: " + fichaTexto(bruto).slice(0, 120));
  ok(fichaHtml({ ...bruto, nome: "<b>x</b>" }).includes("&lt;b&gt;x&lt;/b&gt;"), "ficha html escapa o nome");
  // chefe final: o modelo guarda a base; ficha e Foundry saem com PV ×2, PM +2/ND, Maior que a Morte e RD do patamar
  const chefe = normalizar({ ...bruto, nd: "10", pm: 30, defesas: "imunidade a medo, redução de dano 10", chefe: { arena: "Pântano", efeitoArena: "+1/+2/+5/+10 em tudo",
    recursos: [{ nome: "Totem", efeito: "cura 5/10/20/50" }] } });
  const cf = comoChefe(chefe);
  igual([cf.pv, cf.pm, cf.defesas, cf.habilidades.slice(-2).map((h) => h.desc)], [300, 50, "imunidade a medo, redução de dano 15, maior que a morte", ["+2 em tudo", "cura 10"]], "chefe final veterano");
  igual(comoChefe({ ...chefe, nd: "3", defesas: "" }).defesas, "maior que a morte", "chefe iniciante não ganha RD");
  igual([ndRecompensa(chefe), ndRecompensa({ ...chefe, nd: "1/2" }), ndRecompensa({ ...chefe, nd: "S" }), ndRecompensa(bruto)], ["12", "2", "22", "5"], "ND da recompensa");
  const fc = paraFoundry(chefe);
  igual([fc.system.attributes.pv.max, fc.system.tracos.resistencias.dano.base, fc.flags.world.hubT20.pv, deFoundry(fc).chefe.recursos[0].nome], [300, 15, 150, "Totem"], "chefe final no Foundry");
  ok(fichaTexto(chefe).includes("(solo, chefe final)") && fichaTexto(chefe).includes("Recurso: Totem cura 10"), "chefe final na ficha: " + fichaTexto(chefe));
  igual(normalizar({ chefe: [1] }).chefe, null, "chefe inválido");
  igual([normalizar({ nd: "¼" }).nd, normalizar({ papel: "chefe" }).papel, normalizar({ ataques: [{ dados: "1d6; alert(1)" }] }).ataques[0].dados], ["1/4", "solo", ""], "normalizar barra lixo");
  console.log("ameaca.mjs --check OK");
}
