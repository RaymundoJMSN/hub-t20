// Renderização da carta de magia — compartilhada entre o app (browser) e o
// server (página /m/<id>). Sem DOM: sanitização por regex.
import { circuloEfetivo } from "./custo.mjs";
import { tipoDePocao, tipoDePocaoDosEixos, nomeDoItem } from "./pocao.mjs";

/** Linha "vira granada de Bola de Fogo" — só aparece quando a magia pode virar item. */
function linhaPocao(tipo, nome) {
  return tipo ? `<div class="pocao">🧪 pode virar <b>${esc(nomeDoItem(tipo, nome))}</b></div>` : "";
}

export const ROTULOS = {
  execucao: { padrao: "padrão", movimento: "movimento", livre: "livre", reacao: "reação", completa: "completa", longa: "ritual (2+ rodadas)" },
  alcance: { pessoal: "pessoal", toque: "toque", curto: "curto (9m)", medio: "médio (30m)", longo: "longo (90m)", ilimitado: "ilimitado" },
  duracao: { instantanea: "instantânea", "1rodada": "1 rodada", sustentada: "sustentada", cena: "cena", "1dia": "1 dia", permanente: "permanente" },
  resistencia: { nenhuma: "nenhuma", desacredita: "desacredita", "reduz-metade": "reduz à metade", parcial: "parcial", anula: "anula" },
};
export const RESTRITO_SINGULAR = { humanoides: "humanoide", animais: "animal", objetos: "objeto" };
export const FORMAS = { p: { cone: 6, linha: 9, esfera: 3, cilindro: 3, nuvem: 3, quadrado: 3 },
                        m: { cone: 9, linha: 30, esfera: 6, cilindro: 9, nuvem: 6, quadrado: 9 } };

export const esc = (s) => (s || "").replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c]));

// só b/strong/i/em/u/br/div/p, sem atributos
export function sanitizarHtml(html) {
  return (html || "")
    .replace(/<(?!\/?(b|strong|i|em|u|br|div|p)\b)[^>]*>/gi, "")
    .replace(/<(\/?)(b|strong|i|em|u|br|div|p)\b[^>]*>/gi, "<$1$2>");
}

export function htmlParaTexto(html) {
  return (html || "")
    .replace(/<br\s*\/?>/gi, "\n").replace(/<\/(div|p)>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/&nbsp;/g, " ")
    .replace(/\n{3,}/g, "\n\n").trim();
}

export function tiposDe(d) { return d?.tipos?.length ? d.tipos : [d?.tipo].filter(Boolean); }
export function textoTipos(d) {
  const ts = tiposDe(d);
  if (ts.length < 2) return ts[0] || "";
  return `${ts.slice(0, -1).join(", ")} ou ${ts[ts.length - 1]}, à sua escolha`;
}
export function textoDano(m) { const d = m.efeitos.dano; return d ? `${d.n}d${d.faces}${d.fixo ? "+" + d.fixo : ""} de ${textoTipos(d)}` : "{dano?}"; }
export function textoCura(m) { const c = m.efeitos.cura; return c ? `${c.n}d${c.faces}${c.fixo ? "+" + c.fixo : ""} PV` : "{cura?}"; }
function listaNum(x, em, escopo) { return Array.isArray(x) ? x : x ? [{ valor: x, em, escopo }] : []; }
export function textoBonus(m) {
  const l = listaNum(m.efeitos.bonus, m.efeitos.bonusEm, m.efeitos.bonusEscopo).filter((b) => b.valor);
  return l.length ? l.map((b) => `+${b.valor} em ${b.em || "…"}`).join(", ") : "{bônus?}";
}
// as chaves vivem sem acento (o minerador normaliza o texto das oficiais); a carta mostra bonito
export const COND_ACENTO = { caido: "caído", imovel: "imóvel", vulneravel: "vulnerável", enfeiticado: "enfeitiçado" };
export const condNome = (c) => c ? (COND_ACENTO[c] || c) : "";
export function textoCond(m) { return m.efeitos.condicoes?.length ? m.efeitos.condicoes.map(condNome).join(" e ") : "{condição?}"; }
export function textoPenalidade(m) {
  const l = listaNum(m.efeitos.penalidade, m.efeitos.penalidadeEm, m.efeitos.penalidadeEscopo).filter((b) => b.valor);
  return l.length ? l.map((b) => `−${b.valor} em ${b.em || "…"}`).join(", ") : "{penalidade?}";
}

export function textoArea(a) {
  const forma = a.forma || "esfera";
  const metros = a.metros || FORMAS[a.tamanho || "p"]?.[forma] || 6;
  return forma === "esfera" || forma === "nuvem" || forma === "cilindro"
    ? `${forma} com ${metros}m de raio` : `${forma} de ${metros}m`;
}

export function textoAlvo(m) {
  const a = m.eixos.alvo;
  if (a.tipo === "pessoal") return "você";
  if (a.tipo === "area") return textoArea(a);
  const tipo = a.restrito ? (RESTRITO_SINGULAR[a.restrito] || a.restrito) : "criatura";
  const plural = a.restrito ? (a.restrito in RESTRITO_SINGULAR ? a.restrito : a.restrito + "s") : "criaturas";
  if (a.qtd === "escolhidas") return `${plural} escolhidas`;
  return `${a.qtd} ${a.qtd > 1 ? plural : tipo}`;
}

export function textoResistencia(m) {
  const r = m.eixos.resistencia;
  const cd = m.eixos.cdFixa ? ` (CD ${m.eixos.cdFixa})` : "";
  return r === "nenhuma" ? "nenhuma" : `${m.eixos.teste} ${ROTULOS.resistencia[r]}${cd}`;
}

export const textoDados = (d) => d ? `${d.n}d${d.faces}${d.fixo ? "+" + d.fixo : ""}` : "";
export const textoCd = (m) => m.eixos.cdFixa ? `CD ${m.eixos.cdFixa}` : "CD da magia";

export const PLACEHOLDERS = {
  dano: textoDano, cura: textoCura, bonus: textoBonus, condicao: textoCond,
  alvo: textoAlvo, alcance: (m) => ROTULOS.alcance[m.eixos.alcance].replace(/ \(.+\)/, ""),
  duracao: (m) => ROTULOS.duracao[m.eixos.duracao], teste: (m) => m.eixos.teste,
  penalidade: textoPenalidade,
  efeitoespecial: (m) => m.efeitos.custom?.texto ? htmlParaTexto(m.efeitos.custom.texto) : "{efeito especial?}",
  // v13: pedaços soltos, pra escrever o texto do jeito que a magia pede
  dano_dado: (m) => textoDados(m.efeitos.dano) || "{dano?}",
  tipo_dano: (m) => textoTipos(m.efeitos.dano) || "{tipo?}",
  cura_dado: (m) => textoDados(m.efeitos.cura) || "{cura?}",
  cd: textoCd,
  resistencia: (m) => textoResistencia(m),
  area: (m) => m.eixos.alvo?.tipo === "area" ? textoArea(m.eixos.alvo) : "{área?}",
  execucao: (m) => ROTULOS.execucao[m.eixos.execucao],
  escola: (m) => m.escola || "",
  circulo: (m) => `${m.circulo || 1}º círculo`,
  nome: (m) => m.nome || "esta magia",
  condicao1: (m) => condNome(m.efeitos.condicoes?.[0]) || "{condição 1?}",
  condicao2: (m) => condNome(m.efeitos.condicoes?.[1]) || "{condição 2?}",
  condicao3: (m) => condNome(m.efeitos.condicoes?.[2]) || "{condição 3?}",
  condicao4: (m) => condNome(m.efeitos.condicoes?.[3]) || "{condição 4?}",
};

export function substituir(textoHtml, m, negrito) {
  return textoHtml.replace(/\{(\w+)\}/g, (tudo, chave) => {
    const fn = PLACEHOLDERS[chave];
    if (!fn) return tudo;
    const v = esc(fn(m));
    // efeitoespecial é um trecho de texto corrido, não um valor técnico: fica branco normal
    return negrito && chave !== "efeitoespecial" ? `<b>${v}</b>` : v;
  });
}

export function cartaHtml(m, r) {
  m = { efeitos: {}, aprimoramentos: [], ...m };
  const ef = [];
  if (m.efeitos.dano) ef.push(`<b>${textoDano(m)}</b>`);
  if (m.efeitos.cura) ef.push(`cura <b>${textoCura(m)}</b>`);
  if (textoBonus(m) !== "{bônus?}") ef.push(`<b>${esc(textoBonus(m))}</b>`);
  if (textoPenalidade(m) !== "{penalidade?}") ef.push(`<b>${esc(textoPenalidade(m))}</b>`);
  if (m.efeitos.condicoes?.length) ef.push(`condição: <b>${textoCond(m)}</b>`);
  const custom = m.efeitos.custom?.texto ? substituir(sanitizarHtml(m.efeitos.custom.texto), m, true) : "";
  const desc = m.descricao ? substituir(sanitizarHtml(m.descricao), m, true) : "";
  const aprs = m.aprimoramentos.filter((a) => a.texto).map((a) =>
    `<div><b>${a.truque ? "Truque" : "+" + a.pm + " PM"}:</b> ${esc(a.texto)}${a.requerCirculo ? ` <i>(requer ${a.requerCirculo}º círculo)</i>` : ""}</div>`).join("");
  return `
    <h2>${esc(m.nome) || "Sem Nome"}</h2>
    <div class="tipo-linha">${esc(m.escola)} (${esc(m.tipo)}) — ${m.circulo || 1}º círculo</div>
    <div class="miolo">
    <div class="stats">
      <b>Execução:</b> ${ROTULOS.execucao[m.eixos.execucao]}; <b>Alcance:</b> ${ROTULOS.alcance[m.eixos.alcance].replace(/ \(.+\)/, "")};
      <b>Alvo:</b> ${textoAlvo(m)}; <b>Duração:</b> ${ROTULOS.duracao[m.eixos.duracao]};
      <b>Resistência:</b> ${textoResistencia(m)}${m.eixos.umaVezPorCena ? "; <b>Limite:</b> uma vez por cena no mesmo alvo" : ""}${m.eixos.componente ? "; <b>Componente:</b> material consumido" : ""}
    </div>
    ${desc ? `<div class="desc">${desc}</div>` : ""}
    ${!desc && custom ? `<div class="desc">${custom}</div>` : ""}
    ${ef.length && !desc ? `<div class="efeitos-num">${ef.join("; ")}.</div>` : ""}
    ${aprs ? `<div class="apr">${aprs}</div>` : ""}
    ${linhaPocao(tipoDePocaoDosEixos(m.eixos?.alvo), m.nome || "esta magia")}
    <div class="assina">${r.total}/${r.orcamento} pontos${r.valido ? "" : r.precisaAval ? " — aval do mestre" : " — ESTOUROU"}${m.autor ? " · por " + esc(m.autor) : ""}</div>
    </div>`;
}

// Carta no MESMO estilo para um PODER oficial (dados de /api/poder/<slug>)
export function cartaPoderHtml(t) {
  const stats = [t.prereq && `<b>Pré-requisito:</b> ${esc(t.prereq)}`, t.custo && `<b>Custo:</b> ${esc(t.custo)}`].filter(Boolean);
  return `
    <h2>${esc(t.nome)}</h2>
    <div class="tipo-linha">${esc(t.linha)}</div>
    <div class="miolo">
    ${stats.length ? `<div class="stats">${stats.join("; ")}</div>` : ""}
    <div class="desc">${esc(t.descricao).replace(/\n/g, "<br>")}</div>
    <div class="assina">${esc(t.publicacao || "")}</div>
    </div>`;
}

// Carta no MESMO estilo para uma magia OFICIAL (dados de /api/texto/<slug>)
export function cartaOficialHtml(t) {
  const aprs = (t.aprimoramentos || []).map((a) =>
    `<div><b>${esc(a.custo)}:</b> ${esc(a.texto)}</div>`).join("");
  return `
    <h2>${esc(t.nome)}</h2>
    <div class="tipo-linha">${esc(t.linha)}</div>
    <div class="miolo">
    <div class="stats">${Object.entries(t.stats).map(([k, v]) => `<b>${esc(k)}:</b> ${esc(v)}`).join("; ")}</div>
    <div class="desc">${esc(t.descricao).replace(/\n/g, "<br>")}</div>
    ${aprs ? `<div class="apr">${aprs}</div>` : ""}
    ${linhaPocao(tipoDePocao(t.stats?.["Alvo/Área"]), t.nome)}
    <div class="assina">${esc(t.publicacao || "")}</div>
    </div>`;
}

// Carta de qualquer coleção (/api/c/<col>/<id>): o corpo já chega sanitizado pelo importador
export function cartaGenericaHtml(t) {
  return `
    <h2>${esc(t.nome)}</h2>
    <div class="tipo-linha">${esc(t.linha || "")}</div>
    <div class="miolo generica">${t.html || ""}</div>`;
}
