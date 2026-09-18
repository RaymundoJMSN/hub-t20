// Criador de Magias T20 — wizard passo a passo. Vanilla, sem build.
import { mesaGlobal, TIPO_ARRASTO } from "/quadro.js";
import { calcular, circuloEfetivo, ehOfensiva, tarifaDoTexto, semAcento } from "/custo.mjs";
import { ROTULOS, RESTRITO_SINGULAR, FORMAS, esc, sanitizarHtml, htmlParaTexto,
         textoDano, textoCura, textoBonus, textoCond, textoAlvo, textoResistencia,
         PLACEHOLDERS, substituir, cartaHtml, cartaOficialHtml, textoPenalidade, condNome } from "/carta.mjs";

const $ = (s) => document.querySelector(s);
const normNome = (n) => (n || "").trim().normalize("NFC").toLowerCase();
const el = (tag, props = {}, ...filhos) => {
  const n = Object.assign(document.createElement(tag), props);
  n.append(...filhos.filter((f) => f != null));
  return n;
};

let TABELA, TARIFAS, EXEMPLOS;
let magia = novaMagia();
let user = ""; // vem da sessão do hub (/api/eu), não mais digitado
let minhas = [];
let passoAtual = 0;
let msgTimer;

const EXPLICA = {
  execucao: {
    padrao: "uma ação padrão do seu turno — o normal",
    movimento: "gasta só a ação de movimento",
    livre: "quase de graça no turno",
    reacao: "conjura fora do seu turno, reagindo",
    completa: "consome o turno inteiro",
    longa: "2+ rodadas conjurando — execução de 1 rodada não existe: use completa",
  },
  alcance: {
    pessoal: "só em você / a partir de você",
    toque: "precisa encostar no alvo",
    curto: "9 metros — o padrão das magias",
    medio: "30 metros",
    longo: "90 metros",
    ilimitado: "qualquer distância",
  },
  duracao: {
    instantanea: "acontece e acabou (dano, cura...)",
    "1rodada": "dura só 1 rodada",
    sustentada: "você gasta ação pra manter e pode ser interrompido — devolve ponto",
    cena: "dura a cena inteira — padrão de buffs",
    "1dia": "dura um dia",
    permanente: "para sempre (caro!)",
  },
  resistencia: {
    nenhuma: "sem teste — sempre funciona (caro)",
    desacredita: "o alvo pode desconfiar da ilusão",
    "reduz-metade": "passou: metade do dano — modo do dano puro (Bola de Fogo)",
    parcial: "passou: metade do dano E escapa da condição — é o que as oficiais com dano+condição usam (Adaga Mental, Detonação Congelante)",
    anula: "passou: nada acontece (devolve ponto)",
  },
};
const TESTES = ["Fortitude", "Reflexos", "Vontade"];
const TIPOS_DANO = ["fogo", "frio", "eletricidade", "ácido", "veneno", "corte", "impacto", "perfuração", "luz", "trevas", "psíquico", "essência"];
const RESTRITOS = [
  [null, "qualquer criatura", "afeta tudo — o padrão"],
  ["humanoides", "só humanoides", "pessoas, orcs, goblins…"],
  ["animais", "só animais", "bichos naturais"],
  ["objetos", "só objetos", "itens, portas, armas…"],
];
const METROS_G = [9, 12, 15, 18, 30];

function chaveRascunho() { return "cm_rascunho:" + (normNome(user) || "anon"); }

function idNovo() { return [...crypto.getRandomValues(new Uint8Array(4))].map((b) => b.toString(16).padStart(2, "0")).join(""); }

function comecarNova() {
  const naoSalva = magia.nome && !minhas.some((x) => x.id === magia.id);
  if (naoSalva && !confirm(`Começar uma magia nova? "${magia.nome}" não foi salva e será descartada.`)) return;
  magia = novaMagia();
  passoAtual = 0;
  renderPasso(); atualizar();
  scrollTo({ top: 0, behavior: "smooth" });
}

function novaMagia() {
  return {
    id: idNovo(),
    nome: "", tipo: "Arcana", escola: "Evocação", circulo: 1, descricao: "",
    eixos: { execucao: "padrao", alcance: "curto", duracao: "instantanea", resistencia: "nenhuma", teste: "Reflexos", alvo: { tipo: "alvos", qtd: 1, restrito: null } },
    efeitos: {},
    aprimoramentos: [],
    criadaEm: new Date().toISOString(),
  };
}

// ============================================================ html seguro: ver carta.mjs

// editor rich text mínimo: negrito, itálico, enter = quebra de verdade
function richText({ html, placeholder, oninput, alto }) {
  const ed = el("div", { className: "rt-area" + (alto ? " alto" : ""), contentEditable: "true", innerHTML: sanitizarHtml(html) });
  if (placeholder) ed.dataset.ph = placeholder;
  ed.addEventListener("input", () => oninput(sanitizarHtml(ed.innerHTML)));
  ed.addEventListener("paste", (e) => {
    e.preventDefault();
    document.execCommand("insertText", false, e.clipboardData.getData("text/plain"));
  });
  const btn = (rot, cmd, title) => el("button", {
    type: "button", className: "rt-bt", innerHTML: rot, title,
    onmousedown: (e) => { e.preventDefault(); document.execCommand(cmd); ed.focus(); },
  });
  const wrap = el("div", { className: "rt" },
    el("div", { className: "rt-barra" }, btn("<b>B</b>", "bold", "negrito"), btn("<i>I</i>", "italic", "itálico")),
    ed);
  wrap.editor = ed;
  return wrap;
}


function chipsTermos(m, ta, aoInserir) {
  const chaves = ["nome", "circulo", "escola", "execucao", "alvo", "alcance", "duracao",
    ...(m.eixos.alvo?.tipo === "area" ? ["area"] : []),
    ...(m.efeitos.dano ? ["dano", "dano_dado", "tipo_dano"] : []), ...(m.efeitos.cura ? ["cura", "cura_dado"] : []),
    ...((Array.isArray(m.efeitos.bonus) ? m.efeitos.bonus.length : m.efeitos.bonus) ? ["bonus"] : []),
    ...((Array.isArray(m.efeitos.penalidade) ? m.efeitos.penalidade.length : m.efeitos.penalidade) ? ["penalidade"] : []),
    ...(m.efeitos.condicoes?.length ? ["condicao"] : []),
    ...(m.efeitos.condicoes || []).slice(0, 4).map((_, i) => "condicao" + (i + 1)),
    ...(ehOfensiva(m) && m.eixos.resistencia !== "nenhuma" ? ["teste", "resistencia", "cd"] : []),
    ...(m.efeitos.custom ? ["efeitoespecial"] : [])];
  const box = el("div", { className: "chips" });
  for (const c of chaves) {
    if (aoInserir === c) continue; // não oferecer {efeitoespecial} dentro do próprio efeito
    box.append(el("button", {
      type: "button", className: "chip",
      textContent: `{${c}} = ${(PLACEHOLDERS[c](m) + "").slice(0, 40)}`,
      onmousedown: (e) => {
        e.preventDefault();
        ta.focus();
        document.execCommand("insertText", false, `{${c}}`);
      },
    }));
  }
  return box;
}

// ============================================================ passos
const PASSOS = [
  { id: "basico", titulo: "A magia", pergunta: "Como ela se chama?", render: passoBasico },
  { id: "efeitos", titulo: "Efeitos", pergunta: "O que a magia faz?", render: passoEfeitos },
  { id: "config", titulo: "Detalhes", pergunta: "Configure cada efeito", render: passoConfig, visivel: (m) => Object.keys(m.efeitos).length > 0 },
  { id: "alvo", titulo: "Alvo", pergunta: "Quem ela atinge?", render: passoAlvo },
  { id: "tempo", titulo: "Tempo", pergunta: "Quando e por quanto tempo?", render: passoTempo },
  { id: "resistencia", titulo: "Resistência", pergunta: "O alvo pode resistir?", render: passoResistencia, visivel: ehOfensiva },
  { id: "descricao", titulo: "Descrição", pergunta: "Descreva a magia", render: passoDescricao },
  { id: "aprimoramentos", titulo: "Aprimoramentos", pergunta: "Como ela cresce gastando PM?", render: passoAprimoramentos },
  { id: "revisao", titulo: "Pronto!", pergunta: "Revise e salve", render: passoRevisao },
];
const passosVisiveis = () => PASSOS.filter((p) => !p.visivel || p.visivel(magia));

function cardOpcao({ marcado, titulo, custo, explica, onclick }) {
  return el("button", { type: "button", className: "opcao" + (marcado ? " on" : ""), onclick },
    el("span", { className: "op-titulo", textContent: titulo }),
    custo != null ? el("span", { className: "op-custo " + (custo > 0 ? "paga" : custo < 0 ? "devolve" : ""), textContent: custo > 0 ? `+${custo} pt` : custo < 0 ? `${custo} pt` : "0 pt" }) : null,
    explica ? el("span", { className: "op-explica", textContent: explica }) : null,
  );
}

function grupoEixo(eixo, aoMudar) {
  const box = el("div", { className: "opcoes" });
  for (const [chave, rotulo] of Object.entries(ROTULOS[eixo])) {
    if (!(chave in TABELA.eixos[eixo])) continue;
    box.append(cardOpcao({
      marcado: magia.eixos[eixo] === chave,
      titulo: rotulo, custo: TABELA.eixos[eixo][chave], explica: EXPLICA[eixo]?.[chave],
      onclick: () => { magia.eixos[eixo] = chave; (aoMudar || renderPasso)(); atualizar(); },
    }));
  }
  return box;
}

// ---------------------------------------------------------------- passo 1
function passoBasico(box) {
  box.append(
    el("label", { className: "campo" }, "Nome da magia",
      el("input", { id: "w-nome", maxLength: 40, value: magia.nome, placeholder: "Lança de Cinzas", autofocus: true,
        oninput: (e) => { magia.nome = e.target.value; atualizar(false); },
        onkeydown: (e) => { if (e.key === "Enter") $("#bt-avancar").click(); } })),
    el("div", { className: "campo-linha" },
      el("label", { className: "campo" }, "Círculo",
        el("select", { onchange: (e) => { magia.circulo = +e.target.value; renderPasso(); atualizar(); } },
          ...[1, 2, 3, 4, 5].map((c) => el("option", { value: String(c), textContent: `${c}º círculo — ${TABELA.orcamento[String(c)]} pontos`, selected: (magia.circulo || 1) === c })))),
      el("label", { className: "campo" }, "Tipo",
        el("select", { onchange: (e) => { magia.tipo = e.target.value; atualizar(); } },
          ...["Arcana", "Divina", "Universal"].map((t) => el("option", { textContent: t, selected: magia.tipo === t })))),
      el("label", { className: "campo" }, "Escola",
        el("select", { onchange: (e) => { magia.escola = e.target.value; atualizar(); } },
          ...["Abjuração", "Adivinhação", "Convocação", "Encantamento", "Evocação", "Ilusão", "Necromancia", "Transmutação"].map((t) => el("option", { textContent: t, selected: magia.escola === t })))),
    ),
  );
}

// ---------------------------------------------------------------- passo 2
const BLOCOS = [
  ["dano", "💥 Causa dano", "dados de dano num alvo ou área"],
  ["cura", "✚ Cura", "recupera pontos de vida"],
  ["bonus", "🛡 Dá um bônus", "+X em Defesa, ataque, perícia…"],
  ["condicoes", "🕸 Atrapalha", "impõe condições: lento, cego, caído…"],
  ["penalidade", "➖ Penalidade", "−X em Defesa, ataques, perícias do alvo"],
  ["custom", "✨ Efeito especial", "qualquer outra coisa — voar, ilusão, comando…"],
];
function passoEfeitos(box) {
  box.append(el("p", { className: "explica", textContent: "Marque tudo que a magia faz (pode combinar):" }));
  const ops = el("div", { className: "opcoes grandes" });
  for (const [chave, titulo, explica] of BLOCOS) {
    const v0 = magia.efeitos[chave];
    const ligado = chave === "condicoes" ? !!magia.efeitos.condicoes : Array.isArray(v0) ? true : !!v0;
    ops.append(cardOpcao({
      marcado: ligado, titulo, explica,
      onclick: () => {
        if (ligado) delete magia.efeitos[chave];
        else magia.efeitos[chave] = { dano: { n: 2, faces: 6, fixo: 0, tipo: "fogo" }, cura: { n: 2, faces: 8, fixo: 2 }, bonus: [{ valor: 2, em: "", escopo: "especifico" }], penalidade: [{ valor: 2, em: "", escopo: "especifico" }], condicoes: [], custom: { texto: "", pontos: 0 } }[chave];
        renderPasso(); atualizar();
      },
    }));
  }
  box.append(ops);
}

// ---------------------------------------------------------------- passo 3
function seletor(nome, valor, opcoes, aoMudar) {
  return el("label", { className: "campo mini-campo" }, nome,
    el("select", { onchange: (e) => { aoMudar(e.target.value); atualizar(); } },
      ...opcoes.map((o) => el("option", { value: String(o), textContent: String(o), selected: String(o) === String(valor) }))));
}

// tipos de dano: 1 = fixo; 2+ = escolhido na hora (Armadura Elemental, Runa de Proteção oficiais)
function chipsTipoDano(d) {
  if (!Array.isArray(d.tipos) || !d.tipos.length) d.tipos = [d.tipo || "fogo"];
  const chips = el("div", { className: "chips" });
  for (const tp of TIPOS_DANO) {
    const delta = TABELA.efeitos.custo_tipo_dano?.[semAcento(tp)] ?? 0;
    chips.append(el("button", {
      type: "button", className: "chip" + (d.tipos.includes(tp) ? " on" : ""),
      innerHTML: `${tp} <span class="tier">${delta > 0 ? "+" + delta : delta}pt</span>`,
      onclick: () => {
        const i = d.tipos.indexOf(tp);
        if (i >= 0) { if (d.tipos.length > 1) d.tipos.splice(i, 1); } else d.tipos.push(tp);
        d.tipo = d.tipos[0]; renderPasso(); atualizar();
      },
    }));
  }
  return chips;
}

function passoConfig(box) {
  const ef = magia.efeitos;
  if (ef.dano) {
    const custoDado = (f) => TABELA.efeitos.dano_por_dado[String(f)];
    box.append(el("div", { className: "sub-painel" },
      el("h3", {}, "💥 Dano"),
      el("div", { className: "campo-linha" },
        seletor("quantos dados", ef.dano.n, [1, 2, 3, 4, 5, 6, 7, 8, 10, 12], (v) => (ef.dano.n = +v)),
        seletor("qual dado", ef.dano.faces, [4, 6, 8, 10, 12], (v) => (ef.dano.faces = +v)),
        seletor("+ fixo", ef.dano.fixo, [0, 1, 2, 3, 4, 5, 6, 8, 10], (v) => (ef.dano.fixo = +v)),
      ),
      chipsTipoDano(ef.dano),
      el("p", { className: "explica", textContent: `cada d${ef.dano.faces} custa ${custoDado(ef.dano.faces)} pts \u00b7 +1 fixo = ${TABELA.efeitos.dano_fixo_por_ponto} pt \u00b7 marque 2+ tipos e quem conjura escolhe na hora (paga o mais caro) \u00b7 refer\u00eancia: 2d6 num alvo, 2d8+2 no toque` }),
    ));
  }
  if (ef.cura) {
    box.append(el("div", { className: "sub-painel" },
      el("h3", {}, "✚ Cura"),
      el("div", { className: "campo-linha" },
        seletor("quantos dados", ef.cura.n, [1, 2, 3, 4, 5, 6, 7, 8, 10, 12], (v) => (ef.cura.n = +v)),
        seletor("qual dado", ef.cura.faces, [4, 6, 8, 10, 12], (v) => (ef.cura.faces = +v)),
        seletor("+ fixo", ef.cura.fixo, [0, 1, 2, 3, 4, 5, 6, 8, 10], (v) => (ef.cura.fixo = +v)),
      ),
      el("p", { className: "explica", textContent: "referência oficial: Curar Ferimentos = 2d8+2 no toque" }),
    ));
  }
  const painelNumerico = (chave, titulo, sinal) => {
    // migra formato antigo (número único) pra lista
    if (!Array.isArray(ef[chave])) ef[chave] = [{ valor: ef[chave] || 2, em: ef[chave + "Em"] || "", escopo: ef[chave + "Escopo"] || "especifico" }];
    const esc2 = TABELA.efeitos.bonus_escalonado;
    const escopos = [["especifico", "1 perícia / 1 uso específico (×1)"], ["combate", "Defesa OU ataques OU resistências (×1.5)"], ["amplo", "uma categoria inteira de testes (×2)"]];
    const painel = el("div", { className: "sub-painel" }, el("h3", {}, titulo));
    ef[chave].forEach((item, i) => {
      painel.append(el("div", { className: "campo-linha" },
        seletor("valor", item.valor, [1, 2, 3, 4, 5], (v) => (item.valor = +v)),
        el("label", { className: "campo" }, "abrangência",
          el("select", { onchange: (e) => { item.escopo = e.target.value; atualizar(); } },
            ...escopos.map(([v, r]) => el("option", { value: v, textContent: r, selected: (item.escopo || "especifico") === v })))),
        el("label", { className: "campo" }, "em quê, exatamente?",
          el("input", { maxLength: 60, value: item.em || "", placeholder: sinal === "+" ? "Defesa, Atletismo…" : "Defesa, ataques do alvo…", oninput: (e) => { item.em = e.target.value; atualizar(false); } })),
        ef[chave].length > 1 ? el("button", { className: "bt mini", textContent: "×", onclick: () => { ef[chave].splice(i, 1); renderPasso(); atualizar(); } }) : null,
      ));
    });
    painel.append(
      el("button", { className: "bt mini", textContent: sinal === "+" ? "+ outro bônus" : "+ outra penalidade", onclick: () => { ef[chave].push({ valor: 2, em: "", escopo: "especifico" }); renderPasso(); atualizar(); } }),
      el("p", { className: "explica", textContent: `custo por valor: ${esc2.map((c, i) => `${sinal}${i + 1}=${c}pt`).join("  ")} × abrangência · o mais caro paga cheio, extras pagam metade` }),
    );
    box.append(painel);
  };
  if (ef.bonus != null) painelNumerico("bonus", "🛡 Bônus", "+");
  if (ef.penalidade != null) painelNumerico("penalidade", "➖ Penalidade (o alvo resiste)", "−");
  if (ef.condicoes) {
    // as 35 condições oficiais, agrupadas pelo "Tipo" do Livro Básico
    const tierDe = {};
    for (const [tier, lista] of Object.entries(TABELA.efeitos.condicoes_tier)) for (const c of lista) tierDe[c] = tier;
    const grupos = { ...TABELA.condicao_categoria };
    const comTipo = new Set(Object.values(grupos).flat());
    grupos["sem tipo"] = Object.keys(tierDe).filter((c) => !comTipo.has(c)).sort();
    const painel = el("div", { className: "sub-painel" },
      el("h3", {}, "🕸 Condições"),
      el("p", { className: "explica", textContent: "a mais cara conta cheia; extras pagam metade do próprio tier. Com resistência parcial/reduz, tudo sai por metade." }));
    for (const [grupo, lista] of Object.entries(grupos)) {
      const chips = el("div", { className: "chips" });
      for (const c of [...lista].sort()) {
        const b = el("button", {
          type: "button", className: "chip" + (ef.condicoes.includes(c) ? " on" : ""),
          innerHTML: `${condNome(c)} <span class="tier">${TABELA.efeitos.condicao_custo_por_tier[tierDe[c]]}pt</span>`,
          onclick: () => {
            const i = ef.condicoes.indexOf(c);
            i >= 0 ? ef.condicoes.splice(i, 1) : ef.condicoes.push(c);
            b.classList.toggle("on"); atualizar();
          },
        });
        chips.append(b);
      }
      painel.append(el("h4", { className: "cat-cond", textContent: grupo }), chips);
    }
    box.append(painel);
  }
  if (ef.custom) {
    const rt = richText({
      html: ef.custom.texto, alto: true,
      placeholder: "Descreva o efeito. Enter pula linha, B/I formatam, e os códigos {assim} viram os valores reais…",
      oninput: (h) => { ef.custom.texto = h; atualizar(false); },
    });
    box.append(el("div", { className: "sub-painel" },
      el("h3", {}, "✨ Efeito especial"),
      chipsTermos(magia, rt.editor, "efeitoespecial"),
      rt,
      el("label", { className: "chk", style: "margin:6px 0" },
        el("input", { type: "checkbox", checked: !!ef.resistenciaForcada, onchange: (e) => { ef.resistenciaForcada = e.target.checked; renderPasso(); atualizar(); } }),
        " o alvo pode resistir a este efeito (magia ofensiva)"),
      el("div", { className: "campo-linha" },
        el("label", { className: "campo mini-campo" }, "custo combinado com o mestre (pontos)",
          el("input", { id: "custom-pontos", type: "number", min: 0, max: 20, step: 0.5, value: ef.custom.pontos, oninput: (e) => { ef.custom.pontos = +e.target.value; atualizar(false); } })),
        el("div", { className: "ia-box" },
          el("button", { className: "bt mini", textContent: "⚡ sugerir preço com IA", onclick: sugerirPrecoIA }),
          el("div", { id: "ia-res", className: "explica" })),
      ),
      el("p", { className: "explica" }, "sem ideia do preço? ",
        el("a", { href: "#galeria", textContent: "veja as referências oficiais", onclick: (e) => { e.preventDefault(); abrirAba("exemplos"); $("#galeria").scrollIntoView({ behavior: "smooth" }); } }),
        ` — a mediana oficial de um efeito de 1º círculo é ${TABELA.efeitos.utilitario_base} pts.`),
    ));
  }
}

// ---------------------------------------------------------------- passo 4
function passoAlvo(box) {
  const a = magia.eixos.alvo;
  const ops = el("div", { className: "opcoes" });
  const escolhe = (novo) => () => { magia.eixos.alvo = { ...a, ...novo, tipo: novo.tipo }; if (novo.tipo === "pessoal") magia.eixos.alcance = "pessoal"; renderPasso(); atualizar(); };
  ops.append(
    cardOpcao({ marcado: a.tipo === "pessoal", titulo: "você mesmo", custo: TABELA.eixos.alvo.pessoal, explica: "buff pessoal — alcance vira pessoal", onclick: escolhe({ tipo: "pessoal" }) }),
    cardOpcao({ marcado: a.tipo === "alvos", titulo: "criaturas / objetos", custo: 0, explica: "1 ou mais alvos que você aponta", onclick: escolhe({ tipo: "alvos", qtd: a.qtd || 1 }) }),
    cardOpcao({ marcado: a.tipo === "area", titulo: "uma área", custo: TABELA.eixos.alvo.area_p, explica: "cone, esfera, linha — pega todo mundo dentro", onclick: escolhe({ tipo: "area", tamanho: a.tamanho || "p" }) }),
  );
  box.append(ops);

  if (a.tipo === "alvos") {
    const ops2 = el("div", { className: "opcoes" });
    for (const [q, rot, custo] of [[1, "1 alvo", 0], [2, "2 alvos", TABELA.eixos.alvo.alvo_extra], [3, "3 alvos", 2 * TABELA.eixos.alvo.alvo_extra], ["escolhidas", "escolhidos à vontade", TABELA.eixos.alvo.escolhidas]]) {
      ops2.append(cardOpcao({ marcado: String(a.qtd) === String(q), titulo: rot, custo, onclick: () => { a.qtd = q === "escolhidas" ? q : +q; renderPasso(); atualizar(); } }));
    }
    box.append(el("h3", { className: "sub-perg", textContent: "Quantos alvos?" }), ops2);

    const ops3 = el("div", { className: "opcoes" });
    for (const [chave, rot, exp] of RESTRITOS) {
      ops3.append(cardOpcao({
        marcado: (a.restrito || null) === chave && !(a.restritoCustom && chave === null),
        titulo: rot, custo: chave ? TABELA.eixos.alvo.restrito : 0, explica: exp,
        onclick: () => { a.restrito = chave; a.restritoCustom = false; renderPasso(); atualizar(); },
      }));
    }
    ops3.append(cardOpcao({
      marcado: !!a.restritoCustom, titulo: "outro tipo…", custo: TABELA.eixos.alvo.restrito,
      explica: "mortos-vivos, espíritos, plantas…",
      onclick: () => { a.restritoCustom = true; a.restrito = a.restrito && !(a.restrito in RESTRITO_SINGULAR) ? a.restrito : "espíritos"; renderPasso(); atualizar(); },
    }));
    box.append(el("h3", { className: "sub-perg", textContent: "Atinge o quê? (restringir o tipo devolve ponto — dá pra expandir por aprimoramento)" }), ops3);
    if (a.restritoCustom) {
      box.append(el("label", { className: "campo mini-campo" }, "qual tipo?",
        el("input", { maxLength: 30, value: a.restrito || "", oninput: (e) => { a.restrito = e.target.value; atualizar(false); } })));
    }
  }
  if (a.tipo === "area") {
    const ops2 = el("div", { className: "opcoes" });
    for (const [t, rot, ex] of [["p", "pequena", "cone 6m · linha 9m · esfera 3m"], ["m", "média", "cone 9m · esfera 6m"], ["g", "grande", "esfera 9m+ · quadrado 18m"]]) {
      ops2.append(cardOpcao({ marcado: (a.tamanho || "p") === t, titulo: rot, custo: TABELA.eixos.alvo["area_" + t], explica: ex, onclick: () => { a.tamanho = t; delete a.metros; renderPasso(); atualizar(); } }));
    }
    box.append(el("h3", { className: "sub-perg", textContent: "Que tamanho?" }), ops2);

    const cat = a.tamanho || "p";
    const formas = Object.keys(FORMAS.p);
    const linha = el("div", { className: "campo-linha" },
      seletor("forma", a.forma || "esfera", formas, (v) => { a.forma = v; if (cat !== "g") a.metros = FORMAS[cat][v]; renderPasso(); }),
      cat === "g"
        ? seletor("metros", a.metros || 9,
            METROS_G.filter((mm) => mm <= (TABELA.areas.g_max_m?.[a.forma || "esfera"] ?? 18)),
            (v) => (a.metros = +v))
        : el("span", { className: "explica", textContent: `${FORMAS[cat][a.forma || "esfera"]}m (o tamanho ${cat === "p" ? "pequeno" : "médio"} oficial pra essa forma)` }),
    );
    box.append(el("h3", { className: "sub-perg", textContent: "Qual forma?" }), linha);
  }
  if (a.tipo !== "pessoal") {
    box.append(el("h3", { className: "sub-perg", textContent: "A que distância?" }), grupoEixo("alcance"));
  }
}

// ---------------------------------------------------------------- passo 5
function passoTempo(box) {
  box.append(
    el("h3", { className: "sub-perg", textContent: "Execução — o que ela custa do seu turno?" }), grupoEixo("execucao"),
    el("h3", { className: "sub-perg", textContent: "Duração — quanto tempo o efeito fica?" }), grupoEixo("duracao"),
  );
  // limites que as oficiais usam pra baratear a magia
  const mods = TABELA.modificadores || {};
  const limite = (chave, custo, rotulo, explica) => el("label", { className: "chk" },
    el("input", { type: "checkbox", checked: !!magia.eixos[chave], onchange: (e) => { magia.eixos[chave] = e.target.checked; renderPasso(); atualizar(); } }),
    el("span", {}, ` ${rotulo} `, el("b", { className: "op-custo devolve" }, `${custo} pt`)),
    el("span", { className: "explica", style: "display:block;margin-left:24px", textContent: explica }));
  box.append(el("div", { className: "sub-painel" },
    el("h3", {}, "⏳ Limites (devolvem pontos)"),
    limite("umaVezPorCena", mods.uma_vez_por_cena ?? -1, "o mesmo alvo só é afetado uma vez por cena",
      "como Adaga Mental, Comando e Leque Cromático — impede reaplicar no mesmo inimigo na mesma cena"),
    limite("componente", mods.componente_material ?? -1, "exige um componente material que se gasta",
      "como Aprisionamento, Runa de Proteção e Servo Divino — sem o material, a magia não sai"),
  ));
}

// ---------------------------------------------------------------- passo 6
function passoResistencia(box) {
  box.append(el("p", { className: "explica", textContent: "Sua magia é ofensiva — o alvo tem direito a um teste?" }), grupoEixo("resistencia", renderPasso));
  if (magia.eixos.resistencia !== "nenhuma") {
    const ops = el("div", { className: "opcoes" });
    for (const t of TESTES) {
      ops.append(cardOpcao({
        marcado: magia.eixos.teste === t, titulo: t,
        explica: { Fortitude: "resistir com o corpo (veneno, doença)", Reflexos: "desviar (rajadas, áreas)", Vontade: "resistir com a mente (medo, encanto)" }[t],
        onclick: () => { magia.eixos.teste = t; renderPasso(); atualizar(); },
      }));
    }
    box.append(el("h3", { className: "sub-perg", textContent: "Qual teste?" }), ops);

    const cd = magia.eixos.cdFixa;
    box.append(el("div", { className: "sub-painel" },
      el("h3", {}, "🎯 CD do teste"),
      el("label", { className: "chk" },
        el("input", { type: "checkbox", checked: !!cd, onchange: (e) => { magia.eixos.cdFixa = e.target.checked ? 15 : null; renderPasso(); atualizar(); } }),
        " a magia tem CD própria, fixa (não escala com o nível)"),
      cd ? el("label", { className: "campo mini-campo" }, "CD",
        el("input", { type: "number", min: 2, max: 30, value: cd, oninput: (e) => { magia.eixos.cdFixa = +e.target.value; atualizar(false); } })) : null,
      el("p", { className: "explica", textContent: cd
        ? `CD 15 é neutra (é a CD normal na maior parte da campanha); cada ponto abaixo devolve 0,5 pt (CD 2 = −6,5, o piso — 1 nunca falha) e cada ponto acima cobra 0,5. Oficiais com CD escrita: Área Escorregadia (Acrobacia CD 10), Armadura Gélida (Reflexos CD 20).`
        : "sem marcar, vale a CD normal: 10 + metade do nível + atributo-chave — cresce com quem conjura." }),
    ));
  }
}

// ---------------------------------------------------------------- passo 7: descrição
function passoDescricao(box) {
  const rt = richText({
    html: magia.descricao, alto: true,
    placeholder: "Ex.: Você lança uma bola de fogo que causa {dano} em {alvo}. Quem falhar no teste de {teste} fica {condicao}.",
    oninput: (h) => { magia.descricao = h; atualizar(false); },
  });
  box.append(
    el("p", { className: "explica", textContent: "Escreva livre — enter pula linha, B/I formatam. Os códigos {assim} viram os valores reais na carta; se você mudar o dano depois, o texto acompanha:" }),
    chipsTermos(magia, rt.editor),
    rt,
  );
}

// ---------------------------------------------------------------- passo 8: aprimoramentos REAIS
let cacheSug = { chave: "", lista: null };

// "…efeito X. Requer 2º círculo." -> tira a frase do texto e devolve o número
function extrairRequer(texto) {
  const m = texto.match(/requer (\d)\s*[ºo°]?\s*c[ií]rculo/i);
  if (!m) return { circ: null, texto };
  return {
    circ: +m[1],
    texto: texto.replace(/\.?\s*requer \d\s*[ºo°]?\s*c[ií]rculo\.?/i, ".").replace(/\.\.+/g, ".").trim(),
  };
}

function requerInicial(texto, pm, truque) {
  const ex = extrairRequer(texto);
  if (ex.circ) return { texto: ex.texto, requerCirculo: ex.circ };
  const trilho = truque ? 1 : circuloEfetivo(1 + (pm || 0));
  return { texto, requerCirculo: trilho > 1 ? trilho : null };
}

function featuresDaMagia(m) {
  return {
    circulo: m.circulo, escola: m.escola,
    dano: m.efeitos.dano ? { n: m.efeitos.dano.n, faces: m.efeitos.dano.faces } : null,
    cura: !!m.efeitos.cura, condicoes: m.efeitos.condicoes || [],
    alvoTipo: m.eixos.alvo.tipo, alvoRestrito: m.eixos.alvo.restrito || null,
    alcance: m.eixos.alcance, duracao: m.eixos.duracao, resistencia: m.eixos.resistencia,
    texto: (htmlParaTexto(m.descricao) + " " + htmlParaTexto(m.efeitos.custom?.texto || "")).slice(0, 1500),
  };
}

function passoAprimoramentos(box) {
  box.append(el("p", { className: "explica", textContent: "Aprimoramentos não gastam pontos da magia — quem conjura paga PM a mais. Sugestões abaixo são aprimoramentos REAIS de magias oficiais parecidas com a sua (pode adaptar texto e custo à vontade):" }));
  const sugs = el("div", { className: "sugestoes", textContent: "buscando nas oficiais…" });
  box.append(sugs);

  const f = featuresDaMagia(magia);
  const chave = JSON.stringify(f);
  const preencher = (lista) => {
    sugs.replaceChildren();
    const usados = new Set(magia.aprimoramentos.map((x) => x.texto));
    for (const s of lista.filter((s) => !usados.has(s.texto))) {
      sugs.append(el("button", {
        type: "button", className: "sugestao",
        title: s.texto,
        onclick: () => {
          const ini = requerInicial(s.texto, s.pm, s.truque);
          magia.aprimoramentos.push({ texto: ini.texto, pm: s.pm ?? 0, truque: !!s.truque, fonte: s.fonte, requerCirculo: ini.requerCirculo });
          renderPasso(); atualizar();
        },
      },
        el("b", {}, s.truque ? "Truque" : `+${s.pm} PM`), " ",
        el("span", {}, s.texto.length > 90 ? s.texto.slice(0, 90) + "…" : s.texto),
        el("span", { className: "op-explica", textContent: ` — de ${s.fonte}${s.n > 1 ? ` (e mais ${s.n - 1})` : ""}` }),
      ));
    }
    if (!sugs.children.length) sugs.textContent = "nenhuma oficial parecida — escreva o seu abaixo.";
  };
  if (cacheSug.chave === chave && cacheSug.lista) preencher(cacheSug.lista);
  else fetch("/api/sugestoes-apr", { method: "POST", body: chave })
    .then((r) => r.json())
    .then((j) => { cacheSug = { chave, lista: j.sugestoes || [] }; preencher(cacheSug.lista); })
    .catch(() => (sugs.textContent = "não deu pra buscar as sugestões."));

  box.append(el("div", { className: "acoes" },
    el("button", { className: "bt mini", textContent: "+ escrever um do zero", onclick: () => { magia.aprimoramentos.push({ texto: "", pm: 1 }); renderPasso(); } }),
    el("button", { className: "bt mini", textContent: "+ truque (0 PM)", onclick: () => { magia.aprimoramentos.push({ texto: "", pm: 0, truque: true }); renderPasso(); } }),
  ));

  if (magia.aprimoramentos.length) {
    const lista = el("div", { className: "lista-apr" });
    magia.aprimoramentos.forEach((ap, i) => {
      const trilho = ap.truque ? 1 : circuloEfetivo(1 + (ap.pm || 0));
      const selRequer = el("select", { className: "requer", title: "círculo mínimo pra usar este aprimoramento",
        onchange: (e) => { ap.requerCirculo = e.target.value ? +e.target.value : null; atualizar(false); } },
        el("option", { value: "", textContent: "requer: —", selected: !ap.requerCirculo }),
        ...[2, 3, 4, 5].map((c) => el("option", { value: String(c), textContent: `requer ${c}º`, selected: ap.requerCirculo === c })));
      lista.append(el("div", { className: "apr-item" },
        alcaDeArrasto(lista, ap),
        ap.truque ? el("b", { className: "pm-fixo" }, "Truque") :
          el("input", { className: "pm", type: "number", min: 0, max: 15, value: ap.pm, onchange: (e) => { ap.pm = +e.target.value; renderPasso(); atualizar(); } }),
        ap.truque ? null : el("span", {}, "PM"),
        el("textarea", { rows: 2, maxLength: 500, value: ap.texto, placeholder: "o que o aprimoramento faz…", oninput: (e) => { ap.texto = e.target.value; atualizar(false); } }),
        el("div", { className: "apr-lado" },
          selRequer,
          (() => {
            const tf = !ap.truque && tarifaDoTexto(ap.texto, magia, TARIFAS);
            const fora = tf && Math.abs((ap.pm || 0) - tf.pm) > 1;
            return el("span", { className: "sug" + (fora ? " fora" : "") },
              (ap.fonte ? `de ${ap.fonte}` : "") +
              (fora ? `${ap.fonte ? " · " : ""}oficiais cobram ~${tf.pm} PM (${tf.n}×)` : "") +
              (!ap.requerCirculo && trilho > 1 ? " · PM sugere " + trilho + "º" : ""));
          })()),
        el("button", { className: "bt mini", textContent: "×", onclick: () => { magia.aprimoramentos.splice(i, 1); renderPasso(); atualizar(); } }),
      ));
      lista.lastElementChild.__ap = ap;
    });
    box.append(el("h3", { className: "sub-perg", textContent: "Os desta magia (⠿ arrasta pra reordenar):" }), lista);
  }
}

// alça ⠿: arrastar item pra cima/baixo (mouse e toque) e gravar a nova ordem
function alcaDeArrasto(lista) {
  const alca = el("span", { className: "apr-alca", textContent: "⠿", title: "arraste pra reordenar" });
  alca.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    const item = alca.closest(".apr-item");
    item.classList.add("arrastando");
    const aoMover = (ev) => {
      const alvo = [...lista.children].find((c) => {
        if (c === item) return false;
        const r = c.getBoundingClientRect();
        return ev.clientY > r.top && ev.clientY < r.bottom;
      });
      if (!alvo) return;
      const r = alvo.getBoundingClientRect();
      lista.insertBefore(item, ev.clientY < r.top + r.height / 2 ? alvo : alvo.nextSibling);
    };
    const aoSoltar = () => {
      item.classList.remove("arrastando");
      document.removeEventListener("pointermove", aoMover);
      document.removeEventListener("pointerup", aoSoltar);
      magia.aprimoramentos = [...lista.children].map((c) => c.__ap);
      renderPasso(); atualizar();
    };
    // no document, e não na alça: insertBefore tira o nó do DOM por um instante e
    // isso cancelaria o pointer capture no meio do arrasto
    document.addEventListener("pointermove", aoMover);
    document.addEventListener("pointerup", aoSoltar);
  });
  return alca;
}

// ---------------------------------------------------------------- passo 9
function passoRevisao(box) {
  const r = calcular(magia, TABELA);
  box.append(
    el("div", { className: "carta carta-revisao", innerHTML: cartaHtml(magia, r) }),
    el("div", { className: "acoes" },
      el("button", { className: "bt destaque", textContent: "salvar", onclick: salvarServidor }),
      el("button", { className: "bt", textContent: "copiar texto", onclick: () => { navigator.clipboard.writeText(textoPlano(magia, r)); aviso("texto copiado"); } }),
      el("button", { className: "bt", textContent: "baixar .json", title: "backup / levar pra outra mesa", onclick: () => {
        const a = el("a", { href: URL.createObjectURL(new Blob([JSON.stringify(magia, null, 2)], { type: "application/json" })), download: `${magia.nome || "magia"}.json` });
        a.click(); URL.revokeObjectURL(a.href);
      } }),
      ...(estaPublicada()
        ? [el("button", { className: "bt", textContent: "🔗 compartilhar", onclick: () => { navigator.clipboard.writeText(linkDaMagia()); aviso("link copiado: " + linkDaMagia()); } }),
           el("button", { className: "bt", textContent: "despublicar", onclick: despublicar })]
        : [el("button", { className: "bt", textContent: "publicar", onclick: publicar })]),
      el("button", { className: "bt", textContent: "nova magia", onclick: comecarNova }),
    ),
  );
  if (!r.valido) box.append(el("p", { className: "explica erro-txt", textContent: "A magia estourou o orçamento — volte e ajuste (ou combine o extra com o mestre)." }));
  box.append(
    el("div", { className: "acoes" },
      el("button", { className: "bt", textContent: "⚡ sugestões da IA", onclick: revisarComIA }),
      el("span", { className: "explica", textContent: "compara e você escolhe o que aplicar — nada muda sozinho" })),
    el("div", { id: "ia-rev" }),
  );
}

// ============================================================ IA (chave do próprio usuário, só no navegador)
function pedirChave(out, dePois) {
  out.replaceChildren(
    el("span", {}, "cole sua chave da API da Anthropic (fica só no seu navegador): "),
    el("input", { type: "password", className: "ia-key", placeholder: "sk-ant-…", style: "width:220px" }),
    el("button", { className: "bt mini", textContent: "guardar", onclick: () => { const v = out.querySelector(".ia-key").value.trim(); if (v) { localStorage.setItem("cm_apikey", v); dePois(); } } }),
  );
}

// devolve o objeto JSON da resposta, ou {erro} — nunca lança
async function chamarIA(system, userMsg, maxTokens = 2000) {
  const key = localStorage.getItem("cm_apikey") || "";
  if (!key) return { semChave: true };
  try {
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify({ model: "claude-opus-5", max_tokens: maxTokens, system, messages: [{ role: "user", content: userMsg }] }),
    });
    const j = await resp.json();
    if (!resp.ok) return { erro: j.error?.message?.slice(0, 140) || `erro ${resp.status}`, chaveRuim: resp.status === 401 };
    if (j.stop_reason === "refusal") return { erro: "a IA recusou analisar esse texto." };
    const texto = (j.content || []).find((b) => b.type === "text")?.text || "";
    const m = texto.match(/\{[\s\S]*\}/);
    if (!m) return { erro: "resposta sem JSON." };
    return { dados: JSON.parse(m[0]) };
  } catch {
    return { erro: "não consegui falar com a API (chave? rede?)." };
  }
}

const REGUA_IA = () => `Régua calibrada nas magias oficiais de Tormenta 20 (orçamentos por círculo: 1º=10, 2º=18, 3º=25, 4º=34, 5º=45 pontos; esta magia é de ${magia.circulo || 1}º círculo = ${TABELA.orcamento[String(magia.circulo || 1)]} pontos; alcance/duração/área/resistência são pagos à parte dos efeitos): dano 2d6 ≈ 6 pts; condição fraca 2, média 5, forte 8, incapacitante 12 (metade se há teste); bônus +1=2/+2=5/+3=9; efeito utilitário mediano ≈ ${TABELA.efeitos.utilitario_base} pts. Aprimoramentos custam PM (não pontos): +1 PM ≈ +1 dado de dano/+1 alvo; trilho de círculo: magia de 1º com aprimoramento que soma 3+ PM equivale a 2º círculo (6=3º, 10=4º, 15=5º) e deve levar "requer Xº círculo".`;

async function sugerirPrecoIA() {
  const out = $("#ia-res");
  const efeito = htmlParaTexto(magia.efeitos.custom?.texto || "");
  if (!efeito) { out.textContent = "escreva o efeito primeiro."; return; }
  if (!localStorage.getItem("cm_apikey")) return pedirChave(out, sugerirPrecoIA);
  out.textContent = "consultando a IA…";

  const referencias = EXEMPLOS.utilitarias.map((e2) => `${e2.nome}: ${e2.preco_efeito} pts`).join("; ");
  const r = await chamarIA(
    `Você precifica EFEITOS de magias customizadas de Tormenta 20. ${REGUA_IA()}
Preços de referência dos EFEITOS das oficiais de 1º círculo (efeito puro, sem eixos): ${referencias}.
Responda APENAS um JSON: {"pontos": <número 0-20, pode .5>, "justificativa": "<1 frase comparando com 1-2 oficiais>"}`,
    `Efeito a precificar: "${efeito}"
Contexto da magia: alcance ${magia.eixos.alcance}, duração ${magia.eixos.duracao}, alvo ${textoAlvo(magia)}${ehOfensiva(magia) ? ", resistência " + textoResistencia(magia) : ""}. (Não cobre pelos eixos — só pelo efeito em si.)`,
    1000);
  if (r.semChave) return pedirChave(out, sugerirPrecoIA);
  if (r.erro) {
    out.replaceChildren(el("span", { className: "erro-txt", textContent: r.erro }),
      r.chaveRuim ? el("button", { className: "bt mini", textContent: "trocar chave", onclick: () => { localStorage.removeItem("cm_apikey"); sugerirPrecoIA(); } }) : null);
    return;
  }
  magia.efeitos.custom.pontos = Number(r.dados.pontos) || 0;
  $("#custom-pontos").value = magia.efeitos.custom.pontos;
  out.textContent = `sugestão: ${r.dados.pontos} pts — ${r.dados.justificativa}`;
  atualizar(false);
}

// ---- IA revisora: sugere mudanças na descrição, efeito e aprimoramentos ----
const plainParaHtml = (t) => esc(t).replace(/\n/g, "<br>");

async function revisarComIA() {
  const out = $("#ia-rev");
  if (!localStorage.getItem("cm_apikey")) return pedirChave(out, revisarComIA);
  out.textContent = "a IA está lendo sua magia…";
  const r0 = calcular(magia, TABELA);
  const aprsTxt = magia.aprimoramentos.map((a, i) =>
    `[${i}] ${a.truque ? "Truque" : "+" + a.pm + " PM"}: ${a.texto}${a.requerCirculo ? ` (requer ${a.requerCirculo}º)` : ""}`).join("\n") || "(nenhum)";
  const r = await chamarIA(
    `Você é um mestre experiente de Tormenta 20 revisando uma magia customizada de jogador. ${REGUA_IA()}
Sugira melhorias de CLAREZA e BALANCEAMENTO: reescrever a descrição (mantendo os códigos {dano}, {alvo}, {teste} etc. quando existirem), ajustar o efeito especial, corrigir texto/PM/círculo de aprimoramentos existentes, ou propor aprimoramentos novos no estilo oficial. Só sugira o que realmente melhora — pode devolver lista vazia. Máximo 5 sugestões.
Responda APENAS um JSON:
{"comentario":"<1-2 frases gerais sobre a magia>",
 "sugestoes":[
  {"tipo":"descricao","novo":"<texto>","motivo":"<curto>"},
  {"tipo":"efeitoespecial","novo":"<texto>","motivo":"<curto>"},
  {"tipo":"apr-editar","indice":<n>,"pm":<n>,"texto":"<texto>","requerCirculo":<2-5 ou null>,"motivo":"<curto>"},
  {"tipo":"apr-novo","pm":<n>,"texto":"<texto>","requerCirculo":<2-5 ou null>,"truque":<bool>,"motivo":"<curto>"}
 ]}`,
    `MAGIA (${r0.total}/${r0.orcamento} pontos):
${textoPlano(magia, r0)}

Efeito especial (texto puro): ${htmlParaTexto(magia.efeitos.custom?.texto || "") || "(nenhum)"}
Aprimoramentos indexados:
${aprsTxt}`,
    3000);
  if (r.semChave) return pedirChave(out, revisarComIA);
  if (r.erro) { out.replaceChildren(el("span", { className: "erro-txt", textContent: r.erro })); return; }

  const d = r.dados;
  out.replaceChildren(el("p", { className: "explica", textContent: d.comentario || "" }));
  const sugs = Array.isArray(d.sugestoes) ? d.sugestoes : [];
  if (!sugs.length) out.append(el("p", { className: "explica", textContent: "a IA não sugeriu mudanças." }));

  for (const s of sugs) {
    let rotulo = "", antes = "", aplicar = null;
    if (s.tipo === "descricao") {
      rotulo = "Descrição"; antes = htmlParaTexto(magia.descricao) || "(vazia)";
      aplicar = () => { magia.descricao = plainParaHtml(s.novo); };
    } else if (s.tipo === "efeitoespecial") {
      rotulo = "Efeito especial"; antes = htmlParaTexto(magia.efeitos.custom?.texto || "") || "(nenhum)";
      aplicar = () => {
        magia.efeitos.custom = magia.efeitos.custom || { texto: "", pontos: 0 };
        magia.efeitos.custom.texto = plainParaHtml(s.novo);
      };
    } else if (s.tipo === "apr-editar" && magia.aprimoramentos[s.indice]) {
      const ap = magia.aprimoramentos[s.indice];
      rotulo = `Aprimoramento ${s.indice + 1} (editar)`;
      antes = `${ap.truque ? "Truque" : "+" + ap.pm + " PM"}: ${ap.texto}${ap.requerCirculo ? ` (requer ${ap.requerCirculo}º)` : ""}`;
      aplicar = () => Object.assign(ap, { pm: s.pm ?? ap.pm, texto: s.texto ?? ap.texto, requerCirculo: s.requerCirculo ?? null });
    } else if (s.tipo === "apr-novo") {
      rotulo = "Aprimoramento novo"; antes = "(não existe)";
      aplicar = () => magia.aprimoramentos.push({ pm: s.pm ?? 1, texto: s.texto || "", truque: !!s.truque, requerCirculo: s.requerCirculo ?? null, fonte: "IA" });
    } else continue;

    const depois = s.tipo === "descricao" || s.tipo === "efeitoespecial" ? s.novo
      : `${s.truque ? "Truque" : "+" + (s.pm ?? "?") + " PM"}: ${s.texto}${s.requerCirculo ? ` (requer ${s.requerCirculo}º)` : ""}`;
    const btn = el("button", {
      className: "bt mini", textContent: "aplicar",
      onclick: () => {
        aplicar();
        btn.textContent = "aplicado ✓"; btn.disabled = true;
        const r2 = atualizar(false); // sem renderPasso: manter a lista de sugestões viva
        const carta = $(".carta-revisao");
        if (carta) carta.innerHTML = cartaHtml(magia, r2);
      },
    });
    out.append(el("div", { className: "sug-card" },
      el("div", { className: "sug-cab" }, el("b", {}, rotulo), s.motivo ? el("span", { className: "op-explica", textContent: " — " + s.motivo }) : null, btn),
      el("div", { className: "sug-antes" }, el("i", {}, "atual: "), antes),
      el("div", { className: "sug-depois" }, el("i", {}, "sugestão: "), depois),
    ));
  }
}

// ============================================================ carta: ver carta.mjs
function textoPlano(m, r) {
  const linhas = [
    `${(m.nome || "Sem Nome").toUpperCase()} (${m.escola} ${m.tipo} ${m.circulo || 1})`,
    `Execução: ${ROTULOS.execucao[m.eixos.execucao]}; Alcance: ${ROTULOS.alcance[m.eixos.alcance].replace(/ \(.+\)/, "")}; Alvo: ${textoAlvo(m)}; Duração: ${ROTULOS.duracao[m.eixos.duracao]}; Resistência: ${textoResistencia(m)}`,
  ];
  if (m.descricao) linhas.push(substituir(htmlParaTexto(m.descricao), m));
  else {
    const e2 = [];
    if (m.efeitos.dano) e2.push(textoDano(m));
    if (m.efeitos.cura) e2.push("cura " + textoCura(m));
    if (m.efeitos.bonus) e2.push(textoBonus(m));
    if (m.efeitos.penalidade) e2.push(textoPenalidade(m));
    if (m.efeitos.condicoes?.length) e2.push("condição: " + textoCond(m));
    if (m.efeitos.custom?.texto) e2.push(htmlParaTexto(m.efeitos.custom.texto));
    if (e2.length) linhas.push(e2.join("; ") + ".");
  }
  for (const a of m.aprimoramentos.filter((a) => a.texto)) linhas.push(`${a.truque ? "Truque" : "+" + a.pm + " PM"}: ${a.texto}${a.requerCirculo ? ` (requer ${a.requerCirculo}º círculo)` : ""}`);
  linhas.push(`[${r.total}/${r.orcamento} pontos — magias.raynathus.com.br]`);
  return linhas.join("\n");
}

// ============================================================ wizard render
function renderProgresso() {
  const nav = $("#progresso");
  nav.replaceChildren();
  const vis = passosVisiveis();
  vis.forEach((p, i) => {
    nav.append(el("button", {
      className: "prog" + (i === passoAtual ? " atual" : i < passoAtual ? " feito" : ""),
      textContent: p.titulo,
      onclick: () => { passoAtual = i; renderPasso(); },
    }));
  });
}

function renderPasso() {
  const vis = passosVisiveis();
  passoAtual = Math.min(passoAtual, vis.length - 1);
  const p = vis[passoAtual];
  const box = $("#passo");
  box.replaceChildren(el("h2", { className: "pergunta", textContent: p.pergunta }));
  p.render(box);
  $("#bt-voltar").disabled = passoAtual === 0;
  $("#bt-avancar").hidden = passoAtual === vis.length - 1;
  $("#lateral").hidden = p.id === "revisao"; // a revisão já mostra a carta grande
  renderProgresso();
  localStorage.setItem(chaveRascunho(), JSON.stringify(magia));
}

function atualizar(rerender = true) {
  const r = calcular(magia, TABELA);
  const pct = Math.min(100, (Math.max(0, r.total) / r.orcamento) * 100);
  $("#medidor-fill").style.width = pct + "%";
  $("#medidor-txt").textContent = `${r.total} / ${r.orcamento} pontos`;
  $("#sub-circ").textContent = `${magia.circulo || 1}º círculo`;
  $("#sub-orc").textContent = `${r.orcamento} pontos`;
  $(".medidor").classList.toggle("estourou", !r.valido && !r.precisaAval);
  $(".medidor").classList.toggle("aval", !!r.precisaAval);
  $("#avisos").replaceChildren(...r.avisos.map((a) => el("div", { textContent: a })));
  $("#partes").replaceChildren(...Object.entries(r.partes).filter(([, v]) => v !== 0)
    .map(([k, v]) => el("li", { textContent: `${k}: ${v > 0 ? "+" + v : v}` })));
  $("#carta").innerHTML = cartaHtml(magia, r);
  localStorage.setItem(chaveRascunho(), JSON.stringify(magia));
  document.title = (magia.nome ? magia.nome + " — " : "") + "Criador de Magias T20";
  // salvar no topo: aparece quando há nome e usuário; marca ● se difere do que está no servidor
  const salva = minhas.find((x) => x.id === magia.id);
  const sujo = !salva || JSON.stringify(salva) !== JSON.stringify(magia);
  const bs = $("#bt-salvar-topo");
  bs.hidden = !magia.nome;
  bs.textContent = sujo ? "● salvar" : "💾 salvo";
  bs.classList.toggle("destaque", sujo && !!user);
  if (rerender) renderProgresso();
  return r;
}

// ============================================================ login + sync + galeria
function aviso(t, erro) {
  const m = $("#msg");
  m.textContent = t;
  m.className = erro ? "erro" : "";
  clearTimeout(msgTimer);
  msgTimer = setTimeout(() => (m.textContent = ""), 5000);
}

function entrou() {
  const rasc = localStorage.getItem(chaveRascunho());
  if (rasc) { try { magia = { ...novaMagia(), ...JSON.parse(rasc) }; } catch {} }
  else magia = novaMagia();
  passoAtual = 0;
  renderPasso(); atualizar();
  $("#nome-user").hidden = $("#bt-entrar").hidden = true;
  $("#quem").hidden = false;
  $("#quem-nome").textContent = user;
  sincronizar();
}

async function sincronizar() {
  try {
    const st = await (await fetch(`/api/state?user=${encodeURIComponent(user)}`)).json();
    minhas = st.minhas;
    const alheia = (st.publicadas || []).find((p2) => p2.id === magia.id && normNome(p2.autor) !== normNome(user));
    if (alheia && !minhas.some((x) => x.id === magia.id)) {
      magia.id = idNovo(); // rascunho herdado de outra conta neste navegador: vira uma cópia sua
      aviso(`"${magia.nome || "essa magia"}" é de ${alheia.autor} — sua versão virou uma cópia separada`);
    }
    let ganhouId = false;
    for (const m of minhas) if (!m.id) {
      // magia antiga sem id: se existe publicada homônima minha, é a MESMA magia
      const pub = (st.publicadas || []).find((p2) => normNome(p2.autor) === normNome(user) && p2.nome === m.nome);
      m.id = pub?.id || idNovo();
      ganhouId = true;
    }
    if (ganhouId) await fetch(`/api/user/${encodeURIComponent(user)}`, { method: "PUT", body: JSON.stringify({ magias: minhas }) });
    window.__publicadas = st.publicadas;
    abrirAba(abaAtiva);
    atualizar(false); // botão "salvo/● salvar" compara com a lista que acabou de chegar
  } catch {}
}

async function salvarServidor() {
  if (!user) return aviso("entre com seu nome (lá em cima) pra salvar", true);
  if (!magia.nome.trim()) return aviso("dê um nome à magia antes de salvar", true);
  const r = atualizar(false);
  const i = minhas.findIndex((x) => x.id === magia.id);
  if (i >= 0) minhas[i] = magia; else minhas.push(magia);
  const j = await (await fetch(`/api/user/${encodeURIComponent(user)}`, { method: "PUT", body: JSON.stringify({ magias: minhas }) })).json();
  j.ok ? aviso(`salvo (${r.total}/${r.orcamento} pts)` + (estaPublicada() ? " — publicada atualizada junto" : "")) : aviso(j.erro || "erro ao salvar", true);
  await sincronizar();
}

const linkDaMagia = () => `${location.origin}/m/${magia.id}`;
const estaPublicada = () => (window.__publicadas || []).some((p) => p.id === magia.id && normNome(p.autor) === normNome(user));

async function publicar() {
  if (!user) return aviso("entre com seu nome primeiro", true);
  const r = calcular(magia, TABELA);
  if (!r.valido && !r.precisaAval) return aviso("estourou o orçamento — ajuste antes de publicar", true);
  if (r.precisaAval && !confirm(`A magia passou do orçamento (${r.total}/${r.orcamento}) — publicar mesmo assim, condicionada ao aval do mestre?`)) return;
  if (!magia.nome) return aviso("dê um nome à magia", true);
  if (magia.efeitos.custom?.texto && !(Number(magia.efeitos.custom.pontos) > 0) &&
      !confirm("O efeito especial está com custo 0 pontos (ainda não combinado com o mestre). Publicar assim mesmo?")) return;
  const i = minhas.findIndex((x) => x.id === magia.id);
  if (i >= 0) minhas[i] = magia; else minhas.push(magia);
  await fetch(`/api/user/${encodeURIComponent(user)}`, { method: "PUT", body: JSON.stringify({ magias: minhas }) });
  const j = await (await fetch("/api/publicar", { method: "POST", body: JSON.stringify({ autor: user, magia }) })).json();
  if (j.ok) {
    navigator.clipboard?.writeText(linkDaMagia());
    aviso(`publicada! link copiado: ${linkDaMagia()}`);
    await sincronizar();
    renderPasso();
  } else aviso(j.erro, true);
}

async function despublicar() {
  const j = await (await fetch("/api/despublicar", { method: "POST", body: JSON.stringify({ autor: user, id: magia.id }) })).json();
  if (j.ok) { aviso("despublicada — o link parou de funcionar"); await sincronizar(); renderPasso(); }
  else aviso(j.erro, true);
}

// cópia sua de uma magia (minha, publicada de outro, ou importada): id novo, sem autor, vai pro editor
function duplicar(m, sufixo = true) {
  const naoSalva = magia.nome && !minhas.some((x) => x.id === magia.id);
  if (naoSalva && !confirm(`"${magia.nome}" não foi salva e será descartada. Continuar?`)) return;
  const { autor, publicadaEm, ...resto } = JSON.parse(JSON.stringify(m));
  magia = { ...novaMagia(), ...resto, id: idNovo(), nome: sufixo ? `${m.nome || "Sem Nome"} (cópia)` : m.nome || "" };
  passoAtual = 0;
  renderPasso(); atualizar();
  scrollTo({ top: 0, behavior: "smooth" });
  aviso("cópia aberta no editor — salve pra ficar sua");
}

let abaAtiva = "minhas";
const mesa = mesaGlobal();
function abrirAba(aba) {
  abaAtiva = aba;
  document.querySelectorAll(".aba").forEach((b) => b.classList.toggle("ativa", b.dataset.aba === aba));
  const g = $("#galeria");
  g.replaceChildren();
  const add = (props, ...kids) => g.append(el("div", { className: "card", ...props }, ...kids));

  if (aba === "minhas") {
    g.append(el("button", { className: "card card-nova", onclick: comecarNova },
      el("h3", { textContent: "✦ criar nova magia" }),
      el("div", { className: "meta", textContent: "começa do zero, passo a passo" }),
      el("span", { className: "link-ouro", style: "font-size:.8rem", textContent: "ou importar um .json", onclick: (ev) => {
        ev.stopPropagation();
        const inp = el("input", { type: "file", accept: ".json,application/json", onchange: async () => {
          try { const m = JSON.parse(await inp.files[0].text()); if (!m?.eixos) throw 0; duplicar(m, false); }
          catch { aviso("esse arquivo não é uma magia do criador", true); }
        } });
        inp.click();
      } })));
    if (!minhas.length) return g.append(el("div", { className: "vazio", textContent: user ? "nenhuma magia salva ainda" : "entre com seu nome pra ver suas magias" }));
    const pubIds = new Set((window.__publicadas || []).filter((p2) => normNome(p2.autor) === normNome(user)).map((p2) => p2.id));
    for (const m of minhas) {
      const r = calcular(m, TABELA);
      add({ onclick: () => { magia = m; passoAtual = passosVisiveis().length - 1; renderPasso(); atualizar(); scrollTo({ top: 0, behavior: "smooth" }); } },
        el("h3", { textContent: m.nome || "Sem Nome" }),
        el("span", { className: "custo", textContent: `${r.total}pt` }),
        el("div", { className: "meta", textContent: `${m.escola} · ${m.tipo}` + (pubIds.has(m.id) ? " · 🔗 publicada" : "") }),
        el("div", { className: "acoes-card" },
          el("button", { className: "bt mini", textContent: "duplicar", onclick: (ev) => { ev.stopPropagation(); duplicar(m); } }),
          " ",
          el("button", { className: "bt mini", textContent: "apagar", onclick: async (ev) => {
            ev.stopPropagation();
            if (!confirm(`Apagar "${m.nome || "Sem Nome"}"?` + (pubIds.has(m.id) ? " Ela está publicada — o link vai parar de funcionar." : ""))) return;
            minhas = minhas.filter((x) => x !== m);
            if (user) await fetch(`/api/user/${encodeURIComponent(user)}`, { method: "PUT", body: JSON.stringify({ magias: minhas }) });
            abrirAba("minhas");
          } })));
    }
  } else if (aba === "publicadas") {
    const pubs = window.__publicadas || [];
    if (!pubs.length) return g.append(el("div", { className: "vazio", textContent: "ninguém publicou nada ainda" }));
    for (const m of pubs) {
      add({ onclick: () => mesa.abrir("p:" + m.id), draggable: true, ondragstart: (e) => e.dataTransfer.setData(TIPO_ARRASTO, "p:" + m.id) },
        el("h3", { textContent: m.nome }),
        el("span", { className: "custo", textContent: `${m.pontos?.gasto}pt` }),
        el("div", { className: "meta", textContent: `${m.escola} · por ${m.autor}` }),
        el("div", { className: "acoes-card" },
          el("button", { className: "bt mini", textContent: "usar como base", title: "vira uma cópia sua pra editar", onclick: (ev) => { ev.stopPropagation(); duplicar(m); } })));
    }
  } else {
    g.append(el("div", { className: "vazio", textContent: "As 101 magias oficiais de 1º círculo reconstruídas. Clique pra ler o texto oficial e comparar; nas de efeito especial dá pra usar o preço como referência." + ((magia.circulo || 1) > 1 ? " (Sua magia é de " + magia.circulo + "º círculo — escale o preço proporcionalmente ao orçamento.)" : "") }));
    const todas = [
      ...EXEMPLOS.utilitarias.map((ex) => ({ ...ex, badge: `efeito ≈ ${ex.preco_efeito}pt` })),
      ...EXEMPLOS.numericas.map((ex) => ({ ...ex, badge: `total ${ex.total}pt` })),
    ].sort((a, b) => a.nome.localeCompare(b.nome));
    for (const ex of todas) add({ onclick: () => mesa.abrir("o:" + ex.slug), draggable: true, ondragstart: (e) => e.dataTransfer.setData(TIPO_ARRASTO, "o:" + ex.slug), title: "clique ou arraste pra ler na mesa" },
      el("h3", { textContent: ex.nome }),
      el("span", { className: "custo", textContent: ex.badge }),
      el("div", { className: "meta", textContent: `${ex.escola} · ${ex.grupo}` }),
      ex.preco_efeito != null ? el("div", { className: "acoes-card" },
        el("button", { className: "bt mini", textContent: `usar como referência (${ex.preco_efeito}pt)`, onclick: (ev) => { ev.stopPropagation(); usarReferencia(ex); } })) : null);
  }
}

function usarReferencia(ex) {
  magia.efeitos.custom = magia.efeitos.custom || { texto: "", pontos: 0 };
  magia.efeitos.custom.pontos = ex.preco_efeito;
  if (!magia.efeitos.custom.texto) magia.efeitos.custom.texto = `(efeito no estilo de ${ex.nome})`;
  passoAtual = passosVisiveis().findIndex((p) => p.id === "config");
  renderPasso(); atualizar();
  scrollTo({ top: 0, behavior: "smooth" });
}

// ============================================================ boot
async function boot() {
  [TABELA, TARIFAS, EXEMPLOS] = await Promise.all(
    ["/data/tabela-custos.json", "/data/tarifas-pm.json", "/data/exemplos.json"].map((u) => fetch(u).then((r) => r.json()))
  );

  const rascunho = localStorage.getItem(chaveRascunho());
  if (rascunho) try { magia = { ...novaMagia(), ...JSON.parse(rascunho) }; } catch {}
  if (!magia.id) magia.id = idNovo();

  $("#bt-voltar").onclick = () => { passoAtual = Math.max(0, passoAtual - 1); renderPasso(); };
  $("#bt-avancar").onclick = () => { passoAtual = Math.min(passosVisiveis().length - 1, passoAtual + 1); renderPasso(); };
  // login/sair moram na barra do hub (hub.js); estes botões ficam escondidos
  $("#bt-nova-topo").onclick = comecarNova;
  $("#bt-salvar-topo").onclick = salvarServidor;
  document.addEventListener("keydown", (e) => { if ((e.ctrlKey || e.metaKey) && e.key === "s") { e.preventDefault(); salvarServidor(); } });

  // gaveta do grimório: consultar outras magias durante a criação
  const btG = el("button", { className: "bt bt-grimorio", title: "consultar o grimório", textContent: "📖" });
  const gaveta = el("aside", { className: "gaveta" },
    el("div", { className: "gaveta-cab" },
      el("b", {}, "📖 Grimório"),
      el("span", {},
        el("a", { className: "link-ouro", href: "/", textContent: "página completa", style: "margin-right:10px;font-size:.85rem" }),
        el("button", { className: "bt mini", textContent: "✕ fechar", onclick: () => gaveta.classList.remove("aberta") }))),
    el("div", { className: "gaveta-corpo" }));
  document.body.append(btG, gaveta);
  let gavetaPronta = false;
  btG.onclick = async () => {
    gaveta.classList.toggle("aberta");
    if (!gavetaPronta) {
      gavetaPronta = true;
      const { montarGrimorio } = await import("/grimorio.js");
      montarGrimorio(gaveta.querySelector(".gaveta-corpo"));
    }
  };
  document.querySelectorAll(".aba").forEach((b) => (b.onclick = () => abrirAba(b.dataset.aba)));

  try { user = (await (await fetch("/api/eu")).json()).nome || ""; } catch {}
  if (user) entrou();
  renderPasso();
  atualizar();

  abrirAba("minhas");
}

boot();
