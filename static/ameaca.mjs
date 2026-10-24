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
//     habilidades: [{nome, acao, custo, magica, extra, desc}], equipamento, tesouro, fonte, obs }

export const ND_ORDEM = ["1/4", "1/2", ...Array.from({ length: 20 }, (_, i) => String(i + 1)), "S", "S+"];
export const TIPOS = { Animal: "ani", Construto: "con", "Espírito": "esp", Humanoide: "hum", Monstro: "mon", "Morto-vivo": "mor" };
export const TAMANHOS = { "Minúsculo": "min", Pequeno: "peq", "Médio": "med", Grande: "gra", Enorme: "eno", Colossal: "col" };
const QUADRADOS = { min: 1, peq: 1, med: 1, gra: 2, eno: 3, col: 6 }; // lado do token em quadrados de 1,5m
export const PAPEIS = { solo: "solo", lacaio: "lackey", especial: "special" };
export const ACOES = { "": "", Livre: "free", Movimento: "move", "Padrão": "action", Completa: "full", "Reação": "reaction" };
export const ATRIBUTOS = ["for", "des", "con", "int", "sab", "car"];
export const TIPOS_DANO = ["ácido", "corte", "eletricidade", "essência", "fogo", "frio", "impacto", "luz", "perfuração", "psíquico", "trevas"];
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
const SIN_CONDICAO = { atordoamento: "atordoado", paralisia: "paralisado", doenca: "doente", doencas: "doente", venenos: "veneno", cegueira: "cego", surdez: "surdo", petrificacao: "petrificado" };
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
const atrTexto = (n) => (n == null ? "–" : n < 0 ? `–${Math.abs(n)}` : String(n));
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

// ---------------------------------------------------------------- normalizar (fronteira: o servidor guarda só isto)
export function normalizar(x) {
  const a = x && typeof x === "object" ? x : {};
  const lista = (v, n) => (Array.isArray(v) ? v.slice(0, n) : []);
  const ordem = ["forte", "media", "fraca"];
  return {
    nome: str(a.nome, 80).trim() || "Nova ameaça", nd: ndCanon(a.nd), papel: PAPEIS[a.papel] ? a.papel : "solo",
    tipo: TIPOS[a.tipo] ? a.tipo : "Monstro", subtipo: str(a.subtipo, 60).trim(), tamanho: TAMANHOS[a.tamanho] ? a.tamanho : "Médio",
    grupo: ["bando", "enxame"].includes(a.grupo) ? a.grupo : "", conceito: str(a.conceito, 4000), img: /^https?:\/\/\S+$/.test(a.img || "") ? str(a.img, 500) : "",
    defesa: int(a.defesa, 10), fort: int(a.fort), ref: int(a.ref), von: int(a.von),
    res: Object.fromEntries(["fort", "ref", "von"].map((k, i) => [k, ordem.includes(a.res?.[k]) ? a.res[k] : ordem[i]])),
    pv: Math.max(1, int(a.pv, 1)), pm: Math.max(0, int(a.pm)), cd: num(a.cd), atq: num(a.atq), danoAlvo: num(a.danoAlvo),
    sentidos: str(a.sentidos, 300).trim(), defesas: str(a.defesas, 600).trim(),
    desl: { ...Object.fromEntries(["terrestre", "voo", "natacao", "escalada", "escavacao"].map((k) => [k, entre(Number(String(a.desl?.[k] ?? 0).replace(",", ".")) || 0, 0, 300)])), obs: str(a.desl?.obs, 200).trim() },
    atributos: Object.fromEntries(ATRIBUTOS.map((k) => [k, a.atributos?.[k] == null || a.atributos[k] === "" ? null : num(a.atributos[k])])),
    pericias: lista(a.pericias, 40).map((p) => ({ nome: str(p?.nome, 40).trim(), valor: int(p?.valor), obs: str(p?.obs, 120).trim() })).filter((p) => p.nome),
    ataques: lista(a.ataques, 12).map((t) => ({
      nome: str(t?.nome, 60).trim(), qtd: entre(int(t?.qtd, 1), 1, 20), tipo: t?.tipo === "dist" ? "dist" : "cac", bonus: int(t?.bonus),
      dados: (String(t?.dados ?? "").replace(/\s+/g, "").match(/^\d+d\d+(?:\+\d+d\d+)*$/) || [""])[0], bonusDano: int(t?.bonusDano),
      tipoDano: TIPOS_DANO.includes(t?.tipoDano) ? t.tipoDano : "", margem: entre(int(t?.margem, 20), 2, 20), mult: entre(int(t?.mult, 2), 2, 10),
      extra: str(t?.extra, 120).trim(), resto: str(t?.resto, 120).trim(), complementar: !!t?.complementar, desc: str(t?.desc, 1000).trim(),
    })),
    habilidades: lista(a.habilidades, 40).map((h) => ({ nome: str(h?.nome, 80).trim(), acao: ACOES[h?.acao] !== undefined ? h.acao : "",
      custo: Math.max(0, int(h?.custo)), magica: !!h?.magica, extra: str(h?.extra, 80).trim(), desc: str(h?.desc, 3000).trim() })),
    equipamento: str(a.equipamento, 600).trim(), tesouro: str(a.tesouro, 300).trim(), fonte: str(a.fonte, 60).trim(), obs: str(a.obs, 1000).trim(),
  };
}

// ---------------------------------------------------------------- ficha (texto e html)
export const pericia = (a, nome) => a.pericias?.find((p) => norm(p.nome) === norm(nome))?.valor;
export const tipoLinha = (a) => { const sub = [a.subtipo, a.grupo].filter(Boolean).join(", "); return `${a.tipo}${sub ? ` (${sub})` : ""} ${a.tamanho}`; };
export const nomeAtaque = (at) => (at.qtd > 1 && !RE_QTD.test(at.nome || "") ? `${at.nome || "Ataque"} ×${at.qtd}` : at.nome || "Ataque");
export const ataqueTexto = (at) => { const d = danoTexto(at); return `${nomeAtaque(at)} ${sinal(at.bonus)}${d ? ` (${d})` : ""}`; };
const emLista = (xs) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} e ${xs.at(-1)}`);
const B = (s) => ({ b: s });
// linhas da ficha no formato do livro; cada linha = partes (texto ou {b} em negrito)
export function linhasFicha(a) {
  const P = (n) => pericia(a, n) ?? 0;
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
const papelRotulo = (p) => ({ solo: "solo", lacaio: "lacaio", especial: "especial" }[p] || p);
// texto colável (o "Importar ficha" do sistema no Foundry entende este formato)
export function fichaTexto(a) {
  return [a.nome, `ND ${a.nd}`, `${tipoLinha(a)} (${papelRotulo(a.papel)})`, ...linhasFicha(a).map((l) => l.map((p) => (typeof p === "string" ? p : p.b)).join(""))].join("\n");
}
export const escH = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
export function fichaHtml(a) {
  const linha = (l) => `<div class="l">${l.map((p) => (typeof p === "string" ? escH(p) : `<b>${escH(p.b)}</b>`)).join("")}</div>`;
  return `<h2>${escH(a.nome)}</h2><div class="tipo-linha">ND ${escH(a.nd)} · ${escH(tipoLinha(a))} · ${escH(papelRotulo(a.papel))}</div>`
    + `<div class="miolo generica ameaca-ficha">${a.img ? `<img class="a-img" src="${escH(a.img)}" alt="" referrerpolicy="no-referrer">` : ""}${linhasFicha(a).map(linha).join("")}</div>`;
}

// ---------------------------------------------------------------- modelo → Foundry (ator NPC, sistema tormenta20)
const ALFA = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const novoId = () => Array.from({ length: 16 }, () => ALFA[Math.floor(Math.random() * 62)]).join("");
const paragrafos = (s) => (s ? `<p>${escH(s).replace(/\n+/g, "</p><p>")}</p>` : "");
const RES_PERICIA = { fort: ["fort", "Fortitude"], ref: ["refl", "Reflexos"], von: ["vont", "Vontade"] };
function resistenciaDe(texto) {
  const t = String(texto || "");
  const m = t.match(/\b(Fort(?:itude)?|Ref(?:lexos)?|Von(?:tade)?)\s+(?:CD\s+\d+\s+)?(evita|anula|reduz(?:\s+(?:o\s+dano\s+)?[àa]\s+metade)?|parcial|metade)/i);
  if (!m) return null;
  const [chave, nome] = RES_PERICIA[norm(m[1]).slice(0, 3) === "for" ? "fort" : norm(m[1]).slice(0, 3)] || [];
  return chave ? { pericia: chave, txt: `${nome} ${m[2].toLowerCase()}` } : null;
}
function danoDaHabilidade(texto) {
  const m = String(texto || "").match(/(\d+d\d+(?:\s*[+-]\s*\d+)?)\s+(?:pontos\s+)?(?:de\s+)?(?:dano\s+)?(?:de\s+)?(\p{L}+)/u);
  if (!m) return null;
  const tipo = DANO_CHAVE[norm(m[2])];
  if (!tipo && !/^dano$/i.test(m[2]) && !/dano/i.test(m[0])) return null;
  return { formula: m[1].replace(/\s+/g, ""), tipo: tipo ? norm(tipo) : "" };
}
function sentidosDe(texto) {
  const value = new Set(), custom = [];
  for (const parte of String(texto || "").split(/,\s*/).map((s) => s.trim()).filter(Boolean)) {
    const k = Object.keys(SENTIDOS).find((s) => norm(parte).startsWith(norm(s)));
    if (k) value.add(SENTIDOS[k]);
    if (!k || norm(parte) !== norm(k)) custom.push(parte);
  }
  return { value: [...value], custom: custom.join(", ") };
}
// "imunidade a fogo, redução de dano 10, resistência a magia +3, vulnerabilidade a frio" → campos do sistema
export function tracosDe(texto) {
  const res = {}, ic = new Set();
  let magia = 0;
  const r = (k) => (res[k] ||= { base: 0, bonus: [], imunidade: false, vulnerabilidade: false });
  for (const cl of norm(texto).split(/(?=\bimun|\breducao de|\brd\s*\d|\bvulnerab|\bresistencia a)/)) {
    const palavras = cl.split(/[^a-z0-9]+/).filter(Boolean);
    if (cl.startsWith("imun")) {
      for (const w of palavras) {
        if (DANO_CHAVE[w]) r(w).imunidade = true;
        if (CONDICOES.has(w)) ic.add(w);
        else if (SIN_CONDICAO[w]) ic.add(SIN_CONDICAO[w]);
      }
    } else if (cl.startsWith("vulnerab")) for (const w of palavras) { if (DANO_CHAVE[w]) r(w).vulnerabilidade = true; }
    else if (/^(reducao de|rd)/.test(cl)) {
      const n = num((cl.match(/\d+/) || [])[0]);
      if (!n) continue;
      const tipos = palavras.filter((w) => DANO_CHAVE[w]);
      if (!tipos.length || /^(reducao de dano|rd)\b/.test(cl)) r("dano").base = n;
      else for (const w of tipos) r(w).base = n;
    } else if (/^resistencia a magia/.test(cl)) magia = num((cl.match(/\d+/) || [])[0]) || 0;
  }
  return { resistencias: res, ic: [...ic], magia };
}
const nomeItem = (at) => { const n = (at.nome || "Ataque").replace(RE_QTD, "").trim() || "Ataque"; return n[0].toUpperCase() + n.slice(1); };

export function paraFoundry(a) {
  const nivel = nivelDoNd(a.nd), meio = Math.floor(nivel / 2), treino = nivel > 14 ? 6 : nivel > 6 ? 4 : 2;
  const atr = (k) => a.atributos?.[k] ?? 0;
  const pericias = {};
  // o sistema soma ½ nível + treino (se treinada) + atributo + "outros": "outros" é o que falta pra dar o total da ficha
  const fixar = (chave, abl, total, treinado = total - meio - atr(abl) >= treino) => {
    pericias[chave] = { atributo: abl, treinado, outros: total - meio - atr(abl) - (treinado ? treino : 0), size: false };
  };
  fixar("inic", "des", pericia(a, "Iniciativa") ?? meio + atr("des"), false);
  fixar("perc", "sab", pericia(a, "Percepção") ?? meio + atr("sab"), false);
  fixar("fort", "con", a.fort, false); fixar("refl", "des", a.ref, false); fixar("vont", "sab", a.von, false);
  for (const p of a.pericias || []) { const k = chavePericia(p.nome); if (k && !["inic", "perc", "fort", "refl", "vont"].includes(k[0])) fixar(k[0], k[1], p.valor); }
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
      const ex = formulaDoExtra(at.extra), exTipo = DANO_CHAVE[norm((at.extra || "").slice(ex?.[0].length || 0).trim().split(/\s+/)[0])];
      if (ex) parts.push([ex[0].replace(/\s+/g, ""), exTipo ? norm(exTipo) : "", ""]);
      rolls.push({ name: "Dano", key: "dano1", type: "dano", parts, versatil: "" });
    }
    itens.push({ _id: novoId(), name: nomeItem(at), type: "arma", img: dist ? "icons/svg/target.svg" : "icons/svg/sword.svg",
      system: { description: { value: paragrafos([ataqueTexto(at), at.desc].filter(Boolean).join(". ")), chat: "", unidentified: "" },
        rolls, criticoM: at.margem || 20, criticoX: at.mult || 2, qtd: at.qtd || 1, equipado: 1 } });
  }
  for (const h of a.habilidades || []) {
    if (!h.nome && !h.desc) continue;
    const res = resistenciaDe(h.desc), dano = danoDaHabilidade(h.desc);
    itens.push({ _id: novoId(), name: `${h.nome || "Habilidade"}${h.magica ? " ⚝" : ""}`, type: "poder", img: h.magica ? "icons/svg/daze.svg" : "icons/svg/aura.svg",
      system: { description: { value: paragrafos([h.extra && `(${h.extra})`, h.desc].filter(Boolean).join(" ")), chat: "", unidentified: "" },
        tipo: "ability", ativacao: { execucao: ACOES[h.acao] ?? "", custo: h.custo || 0, qtd: "", condicao: "", special: "" },
        resistencia: { pericia: res?.pericia || "", atributo: "", bonus: 0, txt: res?.txt || "" },
        rolls: dano ? [{ name: "Dano", key: "dano0", type: "dano", parts: [[dano.formula, dano.tipo, ""]], versatil: "" }] : [] } });
  }

  const tr = tracosDe(a.defesas);
  // "resistência a magia +N" vira efeito de uso nas resistências, do jeito que o "Importar ficha" do próprio sistema faz
  const effects = tr.magia ? [{ _id: novoId(), name: "Resistência a Magia", img: "icons/svg/upgrade.svg", disabled: true, transfer: false,
    changes: [{ key: "roll", mode: 2, value: String(tr.magia), priority: null }], flags: { tormenta20: { onuse: true, skill: true, items: "Fortitude;Reflexos;Vontade" } } }] : [];
  const d = a.desl || {};
  const mov = (n) => ({ base: Number(n) || 0, bonus: [] });
  const tamanho = TAMANHOS[a.tamanho] || "med", img = a.img || "systems/tormenta20/icons/svg/orc-head.svg", lado = QUADRADOS[tamanho];
  const bio = [a.conceito, a.obs, a.fonte && `Fonte: ${a.fonte}`].filter(Boolean).join("\n");
  return {
    name: a.nome || "Ameaça", type: "npc", img,
    system: {
      atributos: Object.fromEntries(ATRIBUTOS.map((k) => [k, { base: atr(k) }])),
      attributes: {
        // o sistema soma Des (e armadura/escudo equipados, que não exportamos) na Defesa de NPC: a base é o que falta
        nd: a.nd, cd: a.cd ?? 10, pv: { value: a.pv, max: a.pv }, pm: { value: a.pm || 0, max: a.pm || 0 }, defesa: { base: a.defesa - atr("des"), atributo: "des" },
        movement: { walk: mov(d.terrestre), fly: mov(d.voo), swim: mov(d.natacao), climb: mov(d.escalada), burrow: mov(d.escavacao), hover: false, unit: "m" },
        sentidos: sentidosDe(a.sentidos),
      },
      detalhes: { biography: { value: paragrafos(bio), public: "" }, tipo: TIPOS[a.tipo] || "mon", raca: [a.subtipo, a.grupo].filter(Boolean).join(", "),
        role: PAPEIS[a.papel] || "solo", resistencias: a.defesas || "", equipamento: a.equipamento || "", tesouro: a.tesouro || "", movimento: d.obs || "",
        ataquescac: emLista(ataques.filter((x) => x.tipo !== "dist").map(ataqueTexto)), ataquesad: emLista(ataques.filter((x) => x.tipo === "dist").map(ataqueTexto)) },
      tracos: { tamanho, ic: { value: tr.ic, custom: "" }, resistencias: tr.resistencias },
      pericias,
    },
    items: itens, effects,
    prototypeToken: { name: a.nome || "Ameaça", width: lado, height: lado, texture: { src: img }, disposition: -1, actorLink: false, displayBars: 20,
      bar1: { attribute: "attributes.pv" }, bar2: { attribute: "attributes.pm" }, sight: { enabled: true } },
    // o modelo inteiro vai junto: importar de volta no criador não perde nada
    flags: { world: { hubT20: a } },
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
export function deFoundry(entrada) {
  const j = Array.isArray(entrada) ? entrada[0] : entrada;
  if (j?.flags?.world?.hubT20 && typeof j.flags.world.hubT20 === "object") return normalizar(j.flags.world.hubT20);
  if (!j || j.type !== "npc" || !j.system) throw new Error("o arquivo não é uma ameaça (ator NPC) exportada do Foundry");
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
    } else if (it.type === "poder" || it.type === "magia") {
      habilidades.push({ nome: String(it.name || "").replace(/\s*⚝\s*$/, ""), acao: inverso(ACOES)[d.ativacao?.execucao] || "", custo: Number(d.ativacao?.custo) || 0,
        magica: /⚝/.test(it.name || "") || it.type === "magia", extra: "", desc: textoDeHtml(d.description?.value) });
    }
  }
  const ja = new Set(["inic", "perc", "fort", "refl", "vont", "luta", "pont"]);
  const outras = Object.entries(PERICIAS).filter(([, [k]]) => !ja.has(k) && s.pericias?.[k] && (s.pericias[k].treinado || Number(s.pericias[k].outros))).map(([nome, [k]]) => ({ nome, valor: total(k) }));
  const sent = s.attributes?.sentidos || {};
  const bio = textoDeHtml(s.detalhes?.biography?.value), fonte = bio.match(/^Fonte: (.+)$/m)?.[1] || "";
  // Defesa como o prepareDefense do sistema: base + Des (limitada por armadura pesada) + armadura + escudo + acessórios + outros
  const eq = (j.items || []).filter((i) => i?.type === "equipamento" && i.system?.equipado);
  const arm = eq.find((i) => ["leve", "pesada"].includes(i.system.tipo)), esc = eq.find((i) => i.system.tipo === "escudo");
  const valorEq = (i) => Number(i?.system?.armadura?.value) || 0, dAtr = s.attributes?.defesa?.atributo || "des";
  const defesa = (Number(s.attributes?.defesa?.base) || 0) + (arm?.system.tipo === "pesada" ? entre(atr(dAtr), 0, Number(arm.system.armadura?.maxAtr) || 0) : atr(dAtr))
    + valorEq(arm) + valorEq(esc) + eq.filter((i) => !["escudo", "leve", "pesada"].includes(i.system.tipo)).reduce((t, i) => t + valorEq(i), 0) + (Number(s.attributes?.defesa?.outros) || 0);
  return normalizar({
    nome: j.name, nd, papel: inverso(PAPEIS)[s.detalhes?.role] || "solo", tipo: inverso(TIPOS)[s.detalhes?.tipo] || "Monstro", subtipo: s.detalhes?.raca || "",
    tamanho: inverso(TAMANHOS)[s.tracos?.tamanho] || "Médio", conceito: bio.replace(/^Fonte: .+$/m, "").trim(), fonte, img: /^https?:\/\//.test(j.img || "") ? j.img : "",
    defesa, fort: total("fort"), ref: total("refl"), von: total("vont"),
    pv: s.attributes?.pv?.max, pm: s.attributes?.pm?.max, cd: s.attributes?.cd,
    sentidos: [...[...(sent.value || [])].map((k) => inverso(SENTIDOS)[k] || k), sent.custom].filter(Boolean).join(", "), defesas: s.detalhes?.resistencias || "",
    desl: { terrestre: mov("walk"), voo: mov("fly"), natacao: mov("swim"), escalada: mov("climb"), escavacao: mov("burrow"), obs: s.detalhes?.movimento || "" },
    atributos: Object.fromEntries(ATRIBUTOS.map((k) => [k, atr(k)])),
    pericias: [{ nome: "Iniciativa", valor: total("inic") }, { nome: "Percepção", valor: total("perc") }, ...outras],
    ataques, habilidades, tesouro: s.detalhes?.tesouro || "",
    equipamento: [s.detalhes?.equipamento, ...(j.items || []).filter((i) => i.type === "equipamento").map((i) => i.name)].filter(Boolean).join(", "),
  });
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
  igual(resistenciaDe("fica enjoada (Fort CD 18 evita)"), { pericia: "fort", txt: "Fortitude evita" }, "resistência da habilidade");
  igual(danoDaHabilidade("o alvo sofre 3d6+4 de ácido"), { formula: "3d6+4", tipo: "acido" }, "dano da habilidade");
  igual(deFoundry(f), bruto, "ida e volta pelo Foundry");
  const semFlag = deFoundry({ ...f, flags: {} });
  igual([semFlag.pericias.find((p) => p.nome === "Atletismo")?.valor, semFlag.ataques[0].bonus, semFlag.fort, semFlag.defesa, semFlag.desl.terrestre], [11, 17, 15, 22, 9], "lendo ator do Foundry sem o modelo junto");
  igual(textoDeHtml("<p>Sofre -5 em testes de Intui&ccedil;&atilde;o</p>"), "Sofre -5 em testes de Intuição", "html do compêndio");
  igual([semFlag.conceito, semFlag.fonte], ["", ""], "biografia sem fonte");
  const comFonte = deFoundry({ ...paraFoundry({ ...bruto, conceito: "Gigante bruto.", fonte: "Livro Básico" }), flags: {} });
  igual([comFonte.conceito, comFonte.fonte], ["Gigante bruto.", "Livro Básico"], "a fonte volta pro campo dela");
  ok(fichaTexto(bruto).startsWith("Brutamontes\nND 5\nHumanoide (gigante) Grande (solo)\nIniciativa +4, Percepção +2, visão na penumbra"), "ficha em texto: " + fichaTexto(bruto).slice(0, 120));
  ok(fichaHtml({ ...bruto, nome: "<b>x</b>" }).includes("&lt;b&gt;x&lt;/b&gt;"), "ficha html escapa o nome");
  igual([normalizar({ nd: "¼" }).nd, normalizar({ papel: "chefe" }).papel, normalizar({ ataques: [{ dados: "1d6; alert(1)" }] }).ataques[0].dados], ["1/4", "solo", ""], "normalizar barra lixo");
  console.log("ameaca.mjs --check OK");
}
