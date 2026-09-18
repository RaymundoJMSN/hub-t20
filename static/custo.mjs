// Motor de custo do Criador de Magias T20.
// Importado pelo browser (app.js) e pelo server (validação do PUT).
// Única fonte de preços: data/tabela-custos.json (passada em calcular()).

export const ORDEM_CIRCULO = [[1, 1], [3, 2], [6, 3], [10, 4], [15, 5]];

export function circuloEfetivo(pmTotal) {
  let c = 1;
  for (const [pm, circ] of ORDEM_CIRCULO) if (pmTotal >= pm) c = circ;
  return c;
}

function custoDados(d, porDado, fixoPorPonto) {
  if (!d || !d.n) return 0;
  return d.n * (porDado[String(d.faces)] ?? porDado["6"]) + (d.fixo || 0) * fixoPorPonto;
}

function tierCondicao(nome, tiers) {
  for (const [tier, lista] of Object.entries(tiers)) {
    if (lista.includes(nome)) return Number(tier);
  }
  return 2; // condição desconhecida: tier médio
}

export const semAcento = (x) => (x || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const temValor = (x) => Array.isArray(x) ? x.length > 0 : !!x;
export const ehOfensiva = (m) => !!m.efeitos?.dano || !!m.efeitos?.condicoes?.length ||
  temValor(m.efeitos?.penalidade) || !!m.efeitos?.resistenciaForcada;

// magia: ver README/spec. Retorna {total, partes, devolvido, orcamento, avisos, valido}.
export function calcular(magia, tabela) {
  const t = tabela, e = t.eixos, ef = t.efeitos;
  const eixos = magia.eixos || {};
  const efeitos = magia.efeitos || {};
  const travas = t.travas?.[String(magia.circulo || 1)] || {};
  const partes = {};
  const avisos = [];
  let bloqueada = false; // trava dura: inválida mesmo dentro do orçamento

  const alvo = eixos.alvo || { tipo: "alvos", qtd: 1 };

  partes.execucao = e.execucao[eixos.execucao] ?? 0;
  // alcance pessoal só faz sentido em você mesmo / área a partir de você
  let alcance = eixos.alcance;
  if (alcance === "pessoal" && alvo.tipo === "alvos") {
    alcance = "toque";
    avisos.push("Alcance pessoal com alvo externo não existe — cobrado como toque.");
  }
  partes.alcance = e.alcance[alcance] ?? 0;
  partes.duracao = e.duracao[eixos.duracao] ?? 0;

  if (alvo.tipo === "pessoal") partes.alvo = e.alvo.pessoal;
  else if (alvo.tipo === "area") partes.alvo = e.alvo["area_" + (alvo.tamanho || "p")];
  else if (alvo.qtd === "escolhidas") partes.alvo = e.alvo.escolhidas;
  else partes.alvo = e.alvo["1alvo"] + (Math.max(1, alvo.qtd || 1) - 1) * e.alvo.alvo_extra;
  if (alvo.tipo === "alvos" && alvo.restrito) partes.alvo += e.alvo.restrito ?? -1;

  const condicoes = efeitos.condicoes || [];
  const ofensiva = ehOfensiva(magia);
  const res = eixos.resistencia || "nenhuma";
  partes.resistencia = ofensiva ? (e.resistencia[res] ?? 0) : 0;
  if (!ofensiva && res !== "nenhuma") {
    avisos.push("Resistência só se aplica a magia ofensiva (com dano, condição ou penalidade).");
  }

  // CD fixa: não escala com o nível (a normal é 10 + metade do nível + atributo).
  // Oficiais com CD escrita na magia: Área Escorregadia 10, Armadura Gélida 20 (padroes-corpus.json).
  const cdEscrita = Number(eixos.cdFixa) || 0;
  if (cdEscrita) {
    const c = t.cd_fixa || {};
    const cd = Math.min(Math.max(cdEscrita, c.min ?? 2), c.max ?? 30);
    if (!ofensiva || res === "nenhuma") {
      avisos.push("CD fixa só faz sentido com teste de resistência — escolha um teste.");
    } else {
      partes.cd = (cd - (c.neutra ?? 15)) * (c.por_ponto ?? 0.5);
      if (partes.cd) avisos.push(`CD fixa ${cd} (a normal cresce: 10 + metade do nível + atributo): ${partes.cd > 0 ? "+" : ""}${partes.cd} pt.`);
    }
  }

  let tiposDano = [];
  if (efeitos.dano) {
    partes.dano = custoDados(efeitos.dano, ef.dano_por_dado, ef.dano_fixo_por_ponto);
    // dano com duração = repetível toda rodada (estilo Açoite Flamejante)
    if (["sustentada", "cena", "1dia"].includes(eixos.duracao)) {
      partes.dano *= ef.dano_repetivel_mult ?? 1.5;
      avisos.push(`Dano com duração ${eixos.duracao} repete a cada rodada — custo do dano ×${ef.dano_repetivel_mult ?? 1.5}.`);
    }
    // blast puro: dano é o ÚNICO efeito e instantâneo -> o círculo dá dados de bônus (Bola de Fogo)
    const puro = !efeitos.cura && !temValor(efeitos.bonus) && !temValor(efeitos.penalidade) && !condicoes.length &&
      !(efeitos.custom && efeitos.custom.texto) && eixos.duracao === "instantanea";
    const nBonus = Number(ef.dano_puro_bonus_dados?.[String(magia.circulo || 1)] || 0);
    if (puro && nBonus > 0) {
      const precoDado = ef.dano_por_dado[String(efeitos.dano.faces)] ?? ef.dano_por_dado["6"];
      const desconto = Math.min(Math.min(efeitos.dano.n, nBonus) * precoDado, partes.dano / 2);
      partes.dano -= desconto;
      avisos.push(`Blast puro: o ${magia.circulo || 1}º círculo desconta ${nBonus} dado(s) do dano (−${desconto} pts).`);
    }
    // tipo de dano: mundano e mais resistido (-1), luz/trevas +1, psiquico/essencia +2.
    // 2+ tipos = escolhido na hora (Armadura Elemental, Runa de Protecao): paga o mais caro.
    tiposDano = efeitos.dano.tipos?.length ? efeitos.dano.tipos : [efeitos.dano.tipo].filter(Boolean);
    const deltas = tiposDano.map((tp) => ef.custo_tipo_dano?.[semAcento(tp)] ?? 0);
    const delta = deltas.length ? Math.max(...deltas) : 0;
    if (delta) {
      partes.dano += delta;
      avisos.push(`Dano de ${tiposDano.join(" / ")}: ${delta > 0 ? "+" : ""}${delta} pt${tiposDano.length > 1 ? " — a lista paga o tipo mais caro" : " (raridade de resistencia)"}.`);
    }
  }
  if (efeitos.cura) partes.cura = custoDados(efeitos.cura, ef.cura_por_dado, ef.cura_fixa_por_ponto);
  if (efeitos.dano && efeitos.cura) {
    avisos.push("Dano E cura na mesma magia: os dois somam. Se são modos alternativos (como Infligir Ferimentos), o mestre pode cobrar só o maior.");
  }

  const custoBonus = (valor, escopo) => {
    const esc = ef.bonus_escalonado;
    const v = Math.min(Math.abs(valor), esc.length);
    const mult = ef.bonus_escopo_mult?.[escopo || "especifico"] ?? 1;
    return esc[v - 1] * mult;
  };
  // aceita o formato antigo (número) e o novo (lista de {valor, em, escopo})
  const comoLista = (x, emLegado, escopoLegado) =>
    Array.isArray(x) ? x : x ? [{ valor: x, em: emLegado, escopo: escopoLegado }] : [];
  const custoListaBonus = (lista) => {
    const custos = lista.filter((b) => b.valor).map((b) => custoBonus(b.valor, b.escopo)).sort((a, b) => b - a);
    // o mais caro paga cheio; extras pagam metade (mesma regra das condições)
    return custos.reduce((soma, c, i) => soma + (i === 0 ? c : c / 2), 0);
  };
  const bonusLista = comoLista(efeitos.bonus, efeitos.bonusEm, efeitos.bonusEscopo);
  if (bonusLista.length) {
    partes.bonus = custoListaBonus(bonusLista);
    if (bonusLista.some((b) => Math.abs(b.valor) > ef.bonus_escalonado.length)) avisos.push(`Bônus acima de +${ef.bonus_escalonado.length}: precifique como efeito custom.`);
  }
  const penLista = comoLista(efeitos.penalidade, efeitos.penalidadeEm, efeitos.penalidadeEscopo);
  if (penLista.length) partes.penalidade = custoListaBonus(penLista);

  if (condicoes.length) {
    const tiers = condicoes.map((c) => tierCondicao(c, ef.condicoes_tier)).sort((a, b) => b - a);
    const custoTier = (tier) => ef.condicao_custo_por_tier[String(tier)];
    // a mais cara paga cheio; extras pagam metade do próprio tier
    let custo = custoTier(tiers[0]) + tiers.slice(1).reduce((s, tr) => s + custoTier(tr) / 2, 0);
    // condição junto com dano é rider ("atordoado se falhar"): metade
    if (efeitos.dano) custo *= ef.condicao_rider_dano_mult ?? 0.5;
    partes.condicao = custo;

    // travas do círculo (do corpus oficial) — só pra condição SEM dano;
    // rider de dano em área é oficial (Detonação Congelante)
    if (!efeitos.dano && travas.tier4_exige && tiers[0] >= 4) {
      const ok = alvo.tipo === "alvos" && !(Number(alvo.qtd) > travas.tier4_exige.alvos_max) &&
        alvo.qtd !== "escolhidas" && res !== "nenhuma";
      if (!ok) {
        bloqueada = true;
        avisos.push(`Condição incapacitante no ${magia.circulo || 1}º círculo só como o Sono oficial: 1 alvo e com teste de resistência.`);
      }
    }
    if (!efeitos.dano && travas.tier_max_area && tiers[0] > travas.tier_max_area && (alvo.tipo === "area" || alvo.qtd === "escolhidas")) {
      bloqueada = true;
      avisos.push(`Condição forte (tier ${tiers[0]}) em área/escolhidas não existe no ${magia.circulo || 1}º círculo — nenhuma oficial faz isso.`);
    }
  }

  // permanente numérico não existe no 1º círculo
  // permanente com dano existe (Runa de Proteção, 2º: armadilha que explode) e paga o ×1.5 de
  // dano repetível; permanente que CURA, dá bônus ou impõe condição só do 3º círculo pra cima
  if (travas.permanente_so_custom && eixos.duracao === "permanente" &&
      (efeitos.cura || temValor(efeitos.bonus) || temValor(efeitos.penalidade) || condicoes.length)) {
    bloqueada = true;
    avisos.push(`Duração permanente no ${magia.circulo || 1}º círculo só para dano (armadilha, como a Runa de Proteção) ou efeito especial com aval do mestre — nunca cura/bônus/condição.`);
  }

  // limites que barateiam a magia (oficiais em data/padroes-corpus.json)
  const mods = t.modificadores || {};
  if (eixos.umaVezPorCena) {
    if (ofensiva) partes.limite = mods.uma_vez_por_cena ?? -1;
    else avisos.push("\"Uma vez por cena\" só desconta em magia que afeta alvos (dano, condição ou penalidade).");
  }
  if (eixos.componente) partes.componente = mods.componente_material ?? -1;

  if (efeitos.custom && (efeitos.custom.texto || efeitos.custom.pontos)) {
    partes.custom = Number(efeitos.custom.pontos) || 0;
    if (!efeitos.custom.texto) avisos.push("Efeito custom sem descrição.");
    if (partes.custom <= 0) avisos.push("Efeito custom sem preço: consulte a galeria de exemplos e combine com o mestre.");
  }

  // cap de devolução (anti-empilhar desvantagem), por círculo
  const maxDev = typeof t.max_devolvido === "object"
    ? (t.max_devolvido[String(magia.circulo || 1)] ?? 4) : t.max_devolvido;
  const devolvidoBruto = Object.values(partes).filter((v) => v < 0).reduce((a, b) => a + b, 0);
  let ajusteCap = 0;
  if (-devolvidoBruto > maxDev) {
    ajusteCap = -devolvidoBruto - maxDev;
    avisos.push(`Desvantagens devolvem no máximo ${maxDev} pontos (cortado ${ajusteCap}).`);
  }

  const total = Object.values(partes).reduce((a, b) => a + b, 0) + ajusteCap;
  const orcamento = t.orcamento[String(magia.circulo || 1)];

  // aprimoramentos: não gastam pontos; valida trilho de círculo
  const pmBase = { 1: 1, 2: 3, 3: 6, 4: 10, 5: 15 }[magia.circulo || 1];
  for (const ap of magia.aprimoramentos || []) {
    const pmTotal = pmBase + (Number(ap.pm) || 0);
    const circ = circuloEfetivo(pmTotal);
    if (circ > (magia.circulo || 1) && !ap.requerCirculo) {
      avisos.push(`Aprimoramento "+${ap.pm} PM" leva a magia ao poder de ${circ}º círculo — considere a trava "requer ${circ}º círculo".`);
    }
  }

  // coerência de escola — DERIVADA de data/perfil-escolas.json (pipeline permanente):
  // nível "bloqueio" = 0 casos nas oficiais e semântica clara; "aviso" = raro/fora do perfil
  const escola = t.escolas?.[magia.escola];
  if (escola && escola.n) {
    if (efeitos.dano) {
      if (escola.dano === "bloqueio") {
        bloqueada = true;
        avisos.push(`${magia.escola} não causa dano em NENHUMA das ${escola.n} oficiais — o perfil é ${escola.perfil}. Troque a escola (ex.: Evocação).`);
      } else if (escola.tiposDano?.length && !escola.tiposDano.some((td) => tiposDano.some((tp) => semAcento(td) === semAcento(tp)))) {
        avisos.push(`${magia.escola} oficial causa dano de ${escola.tiposDano.join("/")} — ${tiposDano.join("/")} foge do perfil.`);
      } else if (escola.dano === "aviso") {
        avisos.push(`Dano em ${magia.escola} é raríssimo nas oficiais (${escola.dano_n}/${escola.n}).`);
      }
    }
    if (efeitos.cura) {
      if (escola.cura === "bloqueio") {
        bloqueada = true;
        avisos.push(`Nenhuma das ${escola.n} oficiais de ${magia.escola} cura — cura é Evocação (luz) ou Necromancia (drenagem). Troque a escola.`);
      } else if (escola.cura === "aviso") {
        avisos.push(`Cura em ${magia.escola} é rara nas oficiais (drenagem vampírica).`);
      }
    }
    if (condicoes.length) {
      if (escola.condRaras) {
        avisos.push(`Condições em ${magia.escola} quase não existem nas oficiais — o perfil é ${escola.perfil}.`);
      } else if (escola.condCategorias?.length) {
        const catDe = (c) => {
          for (const [cat, lista] of Object.entries(t.condicao_categoria || {})) if (lista.includes(c)) return cat;
          return "outra";
        };
        const fora = [...new Set(condicoes.map(catDe))].filter((cat) => cat !== "outra" && !escola.condCategorias.includes(cat));
        if (fora.length) avisos.push(`${magia.escola} nunca impõe condição ${fora.join("/")} nas oficiais (categorias da escola: ${escola.condCategorias.join(", ")}).`);
      }
    }
    if (ofensiva && res !== "nenhuma" && escola.testeTipico && eixos.teste && eixos.teste !== escola.testeTipico) {
      avisos.push(`${magia.escola} quase sempre resiste com ${escola.testeTipico} nas oficiais — ${eixos.teste} é incomum.`);
    }
    if (alvo.tipo === "area" && escola.areas === "raro") {
      avisos.push(`Magia de área é rara em ${magia.escola} nas oficiais (${escola.areas_n}/${escola.n}).`);
    }
  }


  const limiteAval = orcamento + Math.max(1, Math.round(orcamento * (t.aval_mestre_pct ?? 0.15)));
  const precisaAval = !bloqueada && total > orcamento && total <= limiteAval;
  if (precisaAval) avisos.push(`Passou do orçamento em ${total - orcamento} pt(s) — dá pra publicar, mas precisa do aval do mestre.`);
  return {
    total, partes, orcamento, avisos, bloqueada, precisaAval, limiteAval,
    devolvido: Math.max(devolvidoBruto, -maxDev),
    valido: total <= orcamento && !bloqueada,
  };
}

// Sugestão de custo PM para um delta de aprimoramento, vinda das tarifas mineradas.
export function sugerirPm(chaveDelta, tarifas, circulo = 1) {
  const t = tarifas.tarifas[chaveDelta];
  if (t) return { pm: t.por_circulo?.[String(circulo)] ?? t.pm_mediana, n: t.n };
  const en = tarifas.efeito_novo_por_circulo[String(circulo)];
  return en ? { pm: en.pm_mediana, n: en.n, generico: true } : null;
}

// Detecta o delta de um texto de aprimoramento e devolve a tarifa oficial correspondente
// (pra alertar quando o PM escrito foge da régua). Retorna null se não reconhecer.
export function tarifaDoTexto(texto, magia, tarifas) {
  const n = (texto || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  if (!n) return null;
  const faces = magia?.efeitos?.dano?.faces || 6;
  const tenta = [];
  if (/aumenta o dano/.test(n)) tenta.push(`dano+:1d${faces}`, "dano+:1d6");
  if (/aumenta a cura/.test(n)) tenta.push("cura+:1d8");
  if (/(aumenta o numero de alvos|afeta todos)/.test(n)) tenta.push("alvos+:1");
  const alc = n.match(/muda o alcance para (\w+)/);
  if (alc) tenta.push(`alcance->:${alc[1]}`);
  if (/muda a duracao para permanente/.test(n)) tenta.push("duracao->:permanente");
  if (/muda a resistencia/.test(n)) tenta.push("resistencia->:reflexos");
  if (/(muda a area|aumenta a area|muda o alvo para (uma )?(esfera|cone|linha))/.test(n)) tenta.push("area->");
  for (const chave of tenta) {
    const s = sugerirPm(chave, tarifas, 1);
    if (s && !s.generico) return { ...s, chave };
  }
  return null;
}
