// Grimório: pesquisa e filtros sobre as oficiais + publicadas da mesa.
// Duas abas com o MESMO mecanismo de busca: magias e poderes (oficiais, de
// todos os livros — vêm de /api/poderes).
// Componente reutilizável: página / (grimório), gaveta lateral do criador.
// Clicar ou arrastar põe a carta na mesa (quadro.js), em qualquer página.
import { mesaGlobal, TIPO_ARRASTO } from "/quadro.js";
import { EXECUCOES, ALCANCES, TESTES, EFEITOS } from "/eixos.mjs";
import { capitalizar, aoSair } from "/hub.js";
import { TEMA_ROTULO, TEMA_GRUPOS } from "/temas.mjs";

const el = (tag, props = {}, ...filhos) => {
  const n = Object.assign(document.createElement(tag), props);
  n.append(...filhos.filter((f) => f != null));
  return n;
};

const CIRCULOS = [1, 2, 3, 4, 5];
const TIPOS = ["Arcana", "Divina", "Universal"];
const ESCOLAS = ["Abjuração", "Adivinhação", "Convocação", "Encantamento", "Evocação", "Ilusão", "Necromancia", "Transmutação"];
const FONTES = [["oficiais", "📕 oficiais"], ["mesa", "🔗 da mesa"]];
// item de uso único (LB p. 341): o nome do frasco muda com o alvo da magia
const POCOES = [["sim", "🧪 permitido em poção"], ["poção", "poção"], ["óleo", "óleo"], ["granada", "granada"]];
// poderes: o TIPO é como se obtém (tools/construir-base.mjs). Cada tipo abre a sua faceta filha: raça, classe, grupo, divindade, distinção.
const ACESSOS = [["raca", "habilidade de raça", "Habilidades de raça"], ["poder-raca", "poder de raça", "Poderes de raça"], ["classe-habilidade", "habilidade de classe", "Habilidades de classe"],
  ["classe-poder", "poder de classe", "Poderes de classe"], ["geral", "poder geral", "Poderes gerais"], ["concedido", "concedido", "Poderes concedidos"], ["origem", "origem", "Origens"],
  ["distincao", "distinção", "Distinções"], ["complicacao", "complicação", "Complicações"], ["aventura", "aventura", "Recompensas de aventura"]];
const ACESSO_POS = Object.fromEntries(ACESSOS.map(([v], i) => [v, i])), ACESSO_ROT = Object.fromEntries(ACESSOS.map(([v, r]) => [v, r])), ACESSO_GRUPO = Object.fromEntries(ACESSOS.map(([v, , g]) => [v, g]));
const GERAIS = ["Combate", "Destino", "Magia", "Tormenta", "Grupo"];
const DEUSES = ["Aharadak", "Allihanna", "Arsenal", "Azgher", "Hyninn", "Kallyadranoch", "Khalmyr", "Lena", "Lin-Wu", "Marah", "Megalokk", "Nimb", "Oceano", "Sszzaas", "Tanna-Toh", "Tenebra", "Thwor", "Thyatis", "Valkaria", "Wynna"];
const MENORES = "Deuses menores";
const ORDEM_LIVROS = ["Livro Básico", "Heróis de Arton", "Deuses de Arton", "Ameaças de Arton", "Atlas de Arton", "Dragão Brasil", "Guia de Deuses Menores", "Guia de NPCs", "Distinções (livreto)", "Libertação de Valkaria", "Caseiro"];
// categorias do hub antigo que viraram tipo (links e atalhos salvos continuam abrindo o filtro certo)
const CAT_ANTIGA = { Classe: ["classe-poder"], Habilidade: ["classe-habilidade"], Racial: ["raca", "poder-raca"], Origem: ["origem"], Concedido: ["concedido"], "Distinção": ["distincao"] };

export const chaveDe = (m) => m.fonte === "mesa" ? "p:" + m.id : m.fonte === "poder" ? "d:" + m.slug : "o:" + m.slug;

const ABAS = [["magias", "📕 magias"], ["poderes", "⚔ poderes"]];
const ORDENS = {
  magias: [["circulo", "por círculo"], ["nome", "por nome"], ["escola", "por escola"]],
  poderes: [["tipo", "por tipo"], ["nome", "por nome"], ["livro", "por livro"]],
};
const PADRAO_ORD = { magias: "circulo", poderes: "tipo" };
// filtros ⇄ URL (?q=fogo&c=1,2&t=Arcana&e=Evocação&f=mesa&tp=geral&cat=Combate&tema=deslocamento&liv=…&ord=nome)
// valor com "-" na frente = excluído (botão direito no chip): ?tp=-distincao
// separados por aba (tema e livro valem nas duas): é a lista que o "limpar filtros" zera, sem tocar no que a outra aba guarda
const CHAVES_MAGIAS = { circulo: "c", tipo: "t", escola: "e", fonte: "f", pocao: "poc", exec: "ex", alc: "al", res: "res", resEf: "ref" };
const CHAVES_PODERES = { acesso: "tp", categoria: "cat", raca: "raca", classe: "cls", divindade: "deus", distincao: "dist" };
const CHAVES_COMUNS = { tema: "tema", livro: "liv" };
const URL_CHAVES = { ...CHAVES_MAGIAS, ...CHAVES_PODERES, ...CHAVES_COMUNS };
const CHAVES_ABA = { magias: Object.keys({ ...CHAVES_MAGIAS, ...CHAVES_COMUNS }), poderes: Object.keys({ ...CHAVES_PODERES, ...CHAVES_COMUNS }) };
// facetas filhas dos poderes: [filtro, tipos a que se aplica, valores do item]
const classesDe = (p, variantes) => p.acesso === "classe-poder" ? [...(p.donos || []), ...Object.entries(variantes).filter(([, b]) => (p.donos || []).includes(b)).map(([v]) => v)] : p.donos || [];
const deusesDe = (p) => (p.donos || []).flatMap((d) => DEUSES.includes(d) ? [d] : [d, MENORES]);
const FILHAS = [
  ["raca", ["raca", "poder-raca"], (p) => p.racas || []],
  ["classe", ["classe-habilidade", "classe-poder"], classesDe],
  ["categoria", ["geral"], (p) => [p.categoria]],
  ["divindade", ["concedido", "aventura"], deusesDe],
  ["distincao", ["distincao"], (p) => p.donos || []],
];
// a lista inteira de cada aba (sem busca), pedida uma vez: é dela que saem os valores dos chips
const completas = {};
const completa = (aba) => (completas[aba] ??= fetch(aba === "poderes" ? "/api/poderes" : "/api/grimorio").then((r) => r.json()).catch(() => ({})));

// soAba: a página mostra só uma das abas (/ = magias, /poderes = poderes) — a gaveta do criador segue com as duas
export function montarGrimorio(raiz, { qInicial = "", abrir = null, naUrl = false, aba = "magias", soAba = false } = {}) {
  const mesa = mesaGlobal();
  // filtros multi-seleção (vazio = todos); Arcana e Divina são exclusivas entre si
  const filtro = { em: "", pre: "", num: "maior", q: qInicial, ord: PADRAO_ORD[aba], aba, ex: {} };
  for (const k of Object.keys(URL_CHAVES)) { filtro[k] = new Set(); filtro.ex[k] = new Set(); }
  if (naUrl) {
    const ps = new URLSearchParams(location.search);
    if (!soAba && ABAS.some(([a]) => a === ps.get("aba"))) filtro.aba = ps.get("aba");
    for (const [k, u] of Object.entries(URL_CHAVES))
      for (const v of (ps.get(u) || "").split(",").filter(Boolean)) {
        const ex = v.startsWith("-"), s = ex ? v.slice(1) : v, alvo = (kk) => (ex ? filtro.ex[kk] : filtro[kk]);
        if (k === "categoria" && CAT_ANTIGA[s]) for (const a of CAT_ANTIGA[s]) alvo("acesso").add(a);
        else alvo(k).add(k === "circulo" ? +s : s);
      }
    if (ORDENS[filtro.aba].some(([o]) => o === ps.get("ord"))) filtro.ord = ps.get("ord");
    if (ps.get("em") === "pre") filtro.em = "pre";
    if (["sem", "com"].includes(ps.get("pre"))) filtro.pre = ps.get("pre");
  }
  function gravarUrl() {
    if (!naUrl) return;
    const ps = new URLSearchParams();
    if (filtro.aba !== "magias" && !soAba) ps.set("aba", filtro.aba);
    if (filtro.q.trim()) ps.set("q", filtro.q.trim());
    for (const [k, u] of Object.entries(URL_CHAVES)) if (filtro[k].size || filtro.ex[k].size) ps.set(u, [...filtro[k], ...[...filtro.ex[k]].map((v) => "-" + v)].join(","));
    if (filtro.ord !== PADRAO_ORD[filtro.aba]) ps.set("ord", filtro.ord);
    if (filtro.aba === "poderes") { if (filtro.em) ps.set("em", filtro.em); if (filtro.pre) ps.set("pre", filtro.pre); }
    history.replaceState(null, "", location.pathname + (ps.size ? "?" + ps : ""));
  }
  let TUDO = { oficiais: [], publicadas: [], poderes: [] };
  let FAC = { poderes: null, magias: null }; // valores dos chips, tirados da lista completa de cada aba
  let variantes = {}, temaAberto = null;
  let buscaTimer;

  const busca = el("input", {
    type: "search", className: "g-busca", value: qInicial, autocomplete: "off",
    oninput: (e) => { filtro.q = e.target.value; clearTimeout(buscaTimer); buscaTimer = setTimeout(buscar, 300); },
  });
  const barraAbas = el("div", { className: "g-abas" });
  const boxFiltros = el("div", { className: "g-filtros" });
  const conta = el("div", { className: "explica" });
  const ordem = el("div", { className: "g-abas g-ordem", title: "ordenar" }); // botões num bloco só, como as abas
  // busca com número variável ("+#m"): ordena pelo número achado em cada item
  const numBox = el("div", { className: "g-abas g-ordem", title: "ordenar pelo número que casou com o #", hidden: true }, el("span", { className: "g-ordem-rotulo", textContent: "Número" }),
    ...[["maior", "Maior"], ["menor", "Menor"], ["rel", "Relevância"]].map(([v, t]) => el("button", { type: "button", className: "chip g-aba" + (v === filtro.num ? " on" : ""), textContent: t,
      onclick: (e) => { filtro.num = v; for (const b of numBox.querySelectorAll(".g-aba")) b.classList.toggle("on", b === e.currentTarget); render(); } })));
  // "limpar filtros": tira de uma vez tudo que está marcado ou excluído na aba (o texto da busca e a ordem ficam).
  // Fica no fim dos filtros e só aparece quando há o que limpar (como o "Reset" da barra de filtros do shadcn).
  const limpar = el("div", { className: "g-abas g-seg g-limpar" },
    el("button", { type: "button", className: "chip g-aba", textContent: "✕ Limpar filtros", title: "tira todos os filtros marcados e excluídos · o texto da busca fica", onclick: limparFiltros }));
  // a busca aceita trecho exato com variáveis; os exemplos são clicáveis
  const EXEMPLOS = { poderes: ['"+#m"', '"+# na Defesa"', '"+# em %"', '"#d# de dano"'], magias: ['"#d# pontos de dano de fogo"', '"+# na Defesa"', '"# rodadas"', '"imune a %"'] };
  const dica = el("div", { className: "explica g-dica" });
  const lista = el("div", { className: "grimorio-lista" });
  raiz.append(barraAbas, busca, dica, boxFiltros, el("div", { className: "g-conta-linha" }, conta, numBox, ordem), lista);
  barraAbas.hidden = soAba;

  for (const [valor, rotulo] of ABAS) {
    const b = el("button", {
      type: "button", className: "chip g-aba", textContent: capitalizar(rotulo),
      onclick: () => { if (filtro.aba !== valor) trocarAba(valor); },
    });
    b.dataset.aba = valor;
    barraAbas.append(b);
  }

  function trocarAba(valor) {
    filtro.aba = valor;
    // "por nome" existe nas duas abas e sobrevive à troca (e ao ?ord= da URL); o resto volta ao padrão
    if (!ORDENS[valor].some(([o]) => o === filtro.ord)) filtro.ord = PADRAO_ORD[valor];
    for (const b of barraAbas.children) b.classList.toggle("on", b.dataset.aba === valor);
    busca.placeholder = valor === "magias"
      ? "pesquisar magias… (fogo, proteger aliados, ficar invisível)"
      : "pesquisar poderes… (fúria, mais deslocamento, atacar duas vezes)";
    ordem.replaceChildren(el("span", { className: "g-ordem-rotulo", textContent: "Ordem" }), ...ORDENS[valor].map(([v, t]) => el("button", { type: "button", className: "chip g-aba" + (v === filtro.ord ? " on" : ""), textContent: capitalizar(t),
      onclick: (e) => { filtro.ord = v; for (const b of ordem.querySelectorAll(".g-aba")) b.classList.toggle("on", b === e.currentTarget); render(); } })));
    dica.replaceChildren('"entre aspas" = texto exato · ', el("b", { textContent: "#" }), " = qualquer número · ", el("b", { textContent: "%" }), " = qualquer palavra · ex.: ",
      ...EXEMPLOS[valor].map((ex) => el("button", { type: "button", className: "g-exemplo", textContent: ex, title: "pesquisar este trecho", onclick: () => { busca.value = filtro.q = ex; if (filtro.em) { filtro.em = ""; montarChips(); } buscar(); } })));
    temaAberto = null;
    montarChips();
    return buscar();
  }

  const EXCLUSIVOS = { Arcana: "Divina", Divina: "Arcana" }; // não se misturam
  // aoMudar: chips que mudam QUAIS filtros aparecem (o Tipo abre as facetas filhas) remontam a caixa
  function chips(itens, chave, rotulo = (x) => String(x), titulo = "", aoMudar = null) {
    const box = el("div", { className: "g-abas g-seg" }, titulo ? el("span", { className: "g-ordem-rotulo", textContent: titulo }) : null);
    const botoes = new Map();
    for (const item of itens) {
      const valor = Array.isArray(item) ? item[0] : item;
      const depois = () => { aoMudar ? aoMudar() : pintar(); render(); };
      const b = el("button", {
        type: "button", className: "chip g-aba", title: "clique: só isto · botão direito: sem isto",
        textContent: capitalizar(Array.isArray(item) ? item[1] : rotulo(item)),
        onclick: () => {
          const sel = filtro[chave];
          filtro.ex[chave].delete(valor);
          if (sel.has(valor)) sel.delete(valor);
          else {
            const oposto = chave === "tipo" && EXCLUSIVOS[valor];
            if (oposto && sel.has(oposto)) { sel.delete(oposto); botoes.get(oposto).classList.remove("on"); }
            sel.add(valor);
          }
          depois();
        },
        oncontextmenu: (e) => { // botão direito (ou toque longo) = excluir
          e.preventDefault();
          const ex = filtro.ex[chave];
          filtro[chave].delete(valor);
          ex.has(valor) ? ex.delete(valor) : ex.add(valor);
          depois();
        },
      });
      const pintar = () => { b.classList.toggle("on", filtro[chave].has(valor)); b.classList.toggle("nao", filtro.ex[chave].has(valor)); };
      botoes.set(valor, b);
      pintar();
      box.append(b);
    }
    boxFiltros.append(box);
    return box;
  }
  // bloco de escolha única (onde a busca procura, com ou sem pré-requisito)
  function seletor(titulo, opcoes, atual, escolher) {
    const box = el("div", { className: "g-abas g-seg" }, el("span", { className: "g-ordem-rotulo", textContent: titulo }),
      ...opcoes.map(([v, t]) => el("button", { type: "button", className: "chip g-aba" + (atual === v ? " on" : ""), textContent: t,
        onclick: (e) => { for (const b of box.querySelectorAll(".g-aba")) b.classList.toggle("on", b === e.currentTarget); escolher(v); } })));
    boxFiltros.append(box);
  }
  // temas: 68 chips seriam uma parede — um botão por grupo (Movimento, Ataque…) abre os temas do grupo logo abaixo
  function chipsTema(usados) {
    const grupos = TEMA_GRUPOS.map(([g, ids]) => [g, ids.filter((t) => usados.has(t))]).filter(([, ids]) => ids.length);
    if (!grupos.length) return;
    const marcados = (ids) => ids.filter((t) => filtro.tema.has(t) || filtro.ex.tema.has(t)).length;
    boxFiltros.append(el("div", { className: "g-abas g-seg g-temas" }, el("span", { className: "g-ordem-rotulo", textContent: "Tema" }),
      ...grupos.map(([g, ids]) => el("button", { type: "button", className: "chip g-aba g-tema-grupo" + (temaAberto === g ? " aberto" : "") + (marcados(ids) ? " tem" : ""),
        textContent: g + (marcados(ids) ? ` · ${marcados(ids)}` : ""), title: "abrir os temas deste grupo",
        onclick: () => { temaAberto = temaAberto === g ? null : g; montarChips(); } }))));
    const aberto = grupos.find(([g]) => g === temaAberto);
    if (aberto) chips(aberto[1].map((t) => [t, TEMA_ROTULO[t]]), "tema", undefined, aberto[0], () => { montarChips(); }).classList.add("g-tema-lista");
  }
  // a faceta filha aparece quando o tipo dela está marcado, ou quando ela mesma já tem algo marcado (link antigo, atalho)
  const mostra = (tipos, chave) => tipos.some((t) => filtro.acesso.has(t)) || filtro[chave].size || filtro.ex[chave].size;
  function montarChips() {
    boxFiltros.replaceChildren();
    const fac = FAC[filtro.aba];
    if (filtro.aba === "magias") {
      chips(CIRCULOS, "circulo", (c) => `${c}º`, "Círculo");
      chips(TIPOS, "tipo", undefined, "Tipo");
      chips(ESCOLAS, "escola", undefined, "Escola");
      chips(FONTES, "fonte", undefined, "Fonte");
      chips(POCOES, "pocao", undefined, "Poção");
      // eixos técnicos: mesmos blocos, multi-seleção (Vontade e/ou Reflexos; teste E efeito se os dois marcados)
      chips(EXECUCOES, "exec", undefined, "Execução");
      chips(ALCANCES, "alc", undefined, "Alcance");
      chips(TESTES, "res", undefined, "Resistência");
      chips(EFEITOS, "resEf", undefined, "Efeito");
      if (fac) { chipsTema(fac.temas); if (fac.livros.length > 1) chips(fac.livros, "livro", undefined, "Livro"); }
    } else {
      // onde a busca procura: tudo, ou só no pré-requisito ("quem exige Ataque Furtivo?")
      seletor("Buscar em", [["", "Tudo"], ["pre", "Pré-requisito"]], filtro.em, (v) => { filtro.em = v; acertarLimpar(); buscar(); });
      chips(ACESSOS, "acesso", undefined, "Tipo", montarChips);
      if (fac) {
        if (mostra(["raca", "poder-raca"], "raca")) chips(fac.racas, "raca", undefined, "Raça");
        if (mostra(["classe-habilidade", "classe-poder"], "classe")) chips(fac.classes, "classe", undefined, "Classe");
        if (mostra(["geral"], "categoria")) chips(GERAIS, "categoria", undefined, "Poder geral de");
        if (mostra(["concedido", "aventura"], "divindade")) chips([...DEUSES, MENORES], "divindade", undefined, "Divindade");
        if (mostra(["distincao"], "distincao")) chips(fac.distincoes, "distincao", undefined, "Distinção");
        chipsTema(fac.temas);
        chips(fac.livros, "livro", undefined, "Livro");
      }
      seletor("Pré-requisito", [["", "Tanto faz"], ["sem", "Sem"], ["com", "Com"]], filtro.pre, (v) => { filtro.pre = v; render(); });
    }
    acertarLimpar();
    boxFiltros.append(limpar); // o mesmo nó volta pro fim a cada remontagem
  }
  // "Buscar em" e "Pré-requisito" só existem nos poderes
  const temFiltro = () => CHAVES_ABA[filtro.aba].some((k) => filtro[k].size || filtro.ex[k].size) || (filtro.aba === "poderes" && !!(filtro.em || filtro.pre));
  // display direto no nó, e não o atributo hidden: o inline-flex do bloco vence o hidden, e assim não depende de regra nova no CSS
  function acertarLimpar() { limpar.style.display = temFiltro() ? "" : "none"; }
  function limparFiltros(e) {
    const tinhaEm = filtro.aba === "poderes" && filtro.em;
    for (const k of CHAVES_ABA[filtro.aba]) { filtro[k].clear(); filtro.ex[k].clear(); }
    if (filtro.aba === "poderes") filtro.em = filtro.pre = "";
    temaAberto = null;
    montarChips();
    render();
    if (tinhaEm) buscar(); // "Buscar em" muda o que o servidor procura; o resto é filtro feito aqui
    if (e && !e.detail) busca.focus(); // acionado pelo teclado: o botão some e o foco não pode cair no vazio (no toque não, pra não abrir o teclado)
  }
  // valores dos chips: saem da lista COMPLETA da aba (a busca só devolve o que casou)
  function facetas(aba, d) {
    const itens = aba === "poderes" ? d.poderes || [] : d.oficiais || [];
    const unicos = (f) => [...new Set(itens.flatMap(f).filter(Boolean))].sort((a, b) => a.localeCompare(b, "pt"));
    const livros = unicos((x) => [x.livro]).sort((a, b) => (ORDEM_LIVROS.indexOf(a) + 1 || 99) - (ORDEM_LIVROS.indexOf(b) + 1 || 99));
    const temas = new Set(itens.flatMap((x) => x.tags || []));
    if (aba !== "poderes") return { livros, temas };
    variantes = d.variantes || {};
    const de = (tipos) => itens.filter((p) => tipos.includes(p.acesso));
    return { livros, temas, racas: [...new Set(de(["raca", "poder-raca"]).flatMap((p) => p.racas || []))].sort((a, b) => a.localeCompare(b, "pt")),
      classes: [...new Set([...de(["classe-habilidade", "classe-poder"]).flatMap((p) => p.donos || []), ...Object.keys(variantes)])].sort((a, b) => a.localeCompare(b, "pt")),
      distincoes: [...new Set(de(["distincao"]).flatMap((p) => p.donos || []))].sort((a, b) => a.localeCompare(b, "pt")) };
  }

  async function buscar() {
    const q = filtro.q.trim(), aba = filtro.aba, em = filtro.em;
    const qs = q ? `?q=${encodeURIComponent(q)}` : "";
    gravarUrl();
    try {
      // sem busca, a lista completa é a mesma que alimenta os chips: um pedido só
      const d = !q ? await completa(aba) : await (await fetch((aba === "magias" ? "/api/grimorio" : "/api/poderes") + qs + (aba === "poderes" && em ? "&em=" + em : ""))).json();
      // chegou atrasada: já tem outra busca no ar (toda troca de aba, de texto ou do "Buscar em" dispara uma busca nova)
      if (aba !== filtro.aba || q !== filtro.q.trim() || em !== filtro.em) return;
      TUDO = { oficiais: [], publicadas: [], poderes: [], ...d };
    } catch { TUDO = { oficiais: [], publicadas: [], poderes: [] }; }
    if (!FAC[aba]) completa(aba).then((d) => { if (!FAC[aba]) { FAC[aba] = facetas(aba, d); if (filtro.aba === aba) { montarChips(); render(); } } });
    render();
  }
  // passa no chip: nada marcado ou este marcado, e não excluído (botão direito)
  const ok = (k, v) => (!filtro[k].size || filtro[k].has(v)) && !filtro.ex[k].has(v);
  const okAlgum = (k, vs) => (!filtro[k].size || vs.some((v) => filtro[k].has(v))) && !vs.some((v) => filtro.ex[k].has(v));

  const passa = (m, fonte) =>
    ok("circulo", m.circulo) && ok("tipo", m.grupo) && ok("escola", m.escola) && ok("fonte", fonte) &&
    // "permitido em poção" só corta quem não vira item; os tipos (poção/óleo/granada) refinam por cima
    (!filtro.pocao.size || (m.pocao && (![...filtro.pocao].some((v) => v !== "sim") || filtro.pocao.has(m.pocao)))) &&
    !(filtro.ex.pocao.has("sim") && m.pocao) && !(m.pocao && filtro.ex.pocao.has(m.pocao)) &&
    ok("exec", m.exec) && ok("alc", m.alc) && ok("res", m.res) && ok("resEf", m.resEf) &&
    okAlgum("tema", m.tags || []) && (fonte === "mesa" ? !filtro.livro.size && !filtro.tema.size : ok("livro", m.livro));
  const passaPoder = (p) => {
    if (!ok("acesso", p.acesso) || !ok("livro", p.livro) || !okAlgum("tema", p.tags || [])) return false;
    if ((filtro.pre === "sem" && p.pre) || (filtro.pre === "com" && !p.pre)) return false;
    for (const [k, tipos, valores] of FILHAS) {
      if (tipos.includes(p.acesso)) { if (!okAlgum(k, valores(p, variantes))) return false; }
      // faceta filha marcada (ex.: Divindade = Marah) e o item é de outro tipo: só fica se esse outro tipo foi pedido no Tipo
      else if (filtro[k].size && !filtro.acesso.has(p.acesso)) return false;
    }
    return true;
  };

  // com busca, quem mais se parece com o que foi digitado vem primeiro, sem separar por círculo/escola/tipo
  const ordemAtiva = () => (filtro.q.trim() ? "" : filtro.ord);
  const rel = (a, b) => (b.rel || 0) - (a.rel || 0); // palavra, tema e sentido já vêm somados do servidor
  function itensMagias() {
    const itens = [
      ...TUDO.publicadas.filter((m) => passa(m, "mesa")).map((m) => ({ ...m, fonte: "mesa" })),
      ...TUDO.oficiais.filter((m) => passa(m, "oficiais")).map((m) => ({ ...m, fonte: "oficiais" })),
    ];
    const ord = ordemAtiva();
    itens.sort((a, b) => ord === "circulo" ? a.circulo - b.circulo || rel(a, b) || a.nome.localeCompare(b.nome)
      : ord === "escola" ? a.escola.localeCompare(b.escola) || a.circulo - b.circulo || rel(a, b) || a.nome.localeCompare(b.nome)
      : rel(a, b) || a.nome.localeCompare(b.nome));
    return itens;
  }
  function itensPoderes() {
    const itens = TUDO.poderes.filter(passaPoder).map((p) => ({ ...p, fonte: "poder" }));
    const ord = ordemAtiva();
    const pos = (p) => ACESSO_POS[p.acesso] ?? 99, liv = (p) => ORDEM_LIVROS.indexOf(p.livro) + 1 || 99;
    const dono = (a, b) => (a.acesso === "geral" ? GERAIS.indexOf(a.categoria) - GERAIS.indexOf(b.categoria) : (a.sub || "").localeCompare(b.sub || "", "pt"));
    itens.sort((a, b) => ord === "tipo" ? pos(a) - pos(b) || dono(a, b) || a.nome.localeCompare(b.nome)
      : ord === "livro" ? liv(a) - liv(b) || pos(a) - pos(b) || a.nome.localeCompare(b.nome)
      : rel(a, b) || a.nome.localeCompare(b.nome));
    return itens;
  }
  const metaPoder = (m) => [m.acesso === "geral" ? `poder de ${m.categoria === "Tormenta" ? "Tormenta" : m.categoria.toLowerCase()}` : ACESSO_ROT[m.acesso], m.sub, m.op && `opção de ${m.op}`, m.livro].filter(Boolean).join(" · ");

  function render() {
    lista.replaceChildren();
    const poderes = filtro.aba === "poderes";
    const itens = poderes ? itensPoderes() : itensMagias();
    gravarUrl();
    // com busca, os botões de ordem não valem (manda a relevância); se a busca tem # ("+#m"), dá pra ordenar pelo número achado
    const buscando = !!filtro.q.trim(), comNumero = buscando && itens.some((m) => m.num != null);
    ordem.hidden = buscando; numBox.hidden = !comNumero; acertarLimpar();
    if (comNumero && filtro.num !== "rel") {
      const v = (m) => m.num ?? (filtro.num === "menor" ? Infinity : -Infinity);
      itens.sort((a, b) => (filtro.num === "menor" ? v(a) - v(b) : v(b) - v(a)));
    }

    const porSentido = itens.filter((m) => m.sem).length;
    const quantos = `${itens.length} ${poderes ? "poder" : "magia"}${itens.length === 1 ? "" : poderes ? "es" : "s"}`;
    conta.textContent = quantos
      + (porSentido ? ` · ${porSentido} por sentido` : "")
      + (!poderes && TUDO.publicadas.length ? ` · ${itens.filter((m) => m.fonte === "mesa").length} da mesa` : "")
      + " · clique ou arraste pra pôr na mesa";

    if (!itens.length) return lista.append(el("div", { className: "vazio", textContent: `nenhum${poderes ? " poder" : "a magia"} com esses filtros.`
      + (/["#]/.test(filtro.q) ? ' O trecho entre aspas (ou com #) precisa aparecer igualzinho: tente um pedaço menor — "+#m" em vez de "+#m de movimento".' : "") }));
    let grupo = null;
    const frag = document.createDocumentFragment();
    for (const m of itens) {
      // cabeçalho por grupo (círculo/escola, ou tipo/livro) quando há ordem; na busca não há grupos: vale a relevância
      const o = ordemAtiva(), g = !o ? null
        : poderes ? (o === "tipo" ? ACESSO_GRUPO[m.acesso] + (m.acesso === "geral" ? ` · ${m.categoria}` : "") : o === "livro" ? m.livro : null)
        : (o === "circulo" ? `${m.circulo}º círculo` : o === "escola" ? m.escola : null);
      if (g !== null && g !== grupo) { grupo = g; frag.append(el("h2", { className: "g-grupo", textContent: g })); }
      const chave = chaveDe(m);
      frag.append(el("div", {
        className: "card" + (m.fonte === "mesa" ? " card-mesa" : "") + (m.sem ? " card-sem" : ""),
        draggable: true, title: m.sem ? "achado pelo sentido da frase (não tem as palavras digitadas) · clique ou arraste pra pôr na mesa" : "clique ou arraste pra pôr na mesa",
        onclick: () => mesa.abrir(chave),
        ondragstart: (e) => { e.dataTransfer.setData(TIPO_ARRASTO, chave); e.dataTransfer.effectAllowed = "copy"; },
      },
        el("span", { className: "circ", textContent: poderes ? (m.custo || "") : `${m.circulo}º` }),
        el("h3", { textContent: m.nome }),
        el("div", {
          className: "meta",
          textContent: poderes ? metaPoder(m)
            : [m.escola, m.grupo, m.livro && m.livro !== "Livro Básico" && m.livro, m.pocao && `🧪 ${m.pocao}`, m.autor && `por ${m.autor}`].filter(Boolean).join(" · "),
        }),
        m.trecho ? el("div", { className: "trecho" }, m.trecho[0], el("mark", { textContent: m.trecho[1] }), m.trecho[2]) : null,
        m.r && !m.trecho ? el("div", { className: "resumo", textContent: m.r }) : null,
        m.pre ? el("div", { className: "pre", textContent: "pré: " + m.pre }) : null,
      ));
    }
    lista.append(frag);
  }

  const pronto = trocarAba(filtro.aba).then(() => {
    if (abrir) {
      const m = [...TUDO.publicadas.map((x) => ({ ...x, fonte: "mesa" })), ...TUDO.oficiais.map((x) => ({ ...x, fonte: "oficiais" }))]
        .find((x) => x.nome === abrir);
      if (m) mesa.abrir(chaveDe(m));
    }
  });
  return { buscar, busca, pronto };
}

// bootstrap automático da página / (container #g-pagina); /m/<id> abre a publicada na mesa
const pagina = document.querySelector("#g-pagina");
if (pagina) {
  const params = new URLSearchParams(location.search);
  const rota = location.pathname.match(/^\/([mod])\/([\w-]+)/);
  // poderes têm página própria: /poderes (e /d/<slug>); link antigo /?aba=poderes vira /poderes
  if (location.pathname === "/" && params.get("aba") === "poderes") {
    params.delete("aba");
    history.replaceState(null, "", "/poderes" + (params.size ? "?" + params : ""));
  }
  const aba = rota?.[1] === "d" || location.pathname === "/poderes" ? "poderes" : "magias";
  if (aba === "poderes") {
    document.querySelector("header h1").textContent = "Poderes";
    document.querySelector("header .sub").replaceChildren("Tormenta 20 · tudo que um personagem pode ter, por como se obtém: raça, classe, poderes gerais, concedidos, origens, distinções · ",
      el("a", { className: "link-ouro", href: "/", textContent: "📖 magias" }), " · ", el("a", { className: "link-ouro", href: "/arauto", textContent: "🪶 perguntar ao Arauto" }));
    document.title = "Poderes — Hub T20";
  }
  const g = montarGrimorio(pagina, { qInicial: params.get("q") || "", abrir: params.get("abrir"), naUrl: true, aba, soAba: true });
  if (rota) mesaGlobal().abrir(`${rota[1] === "m" ? "p" : rota[1]}:${rota[2]}`);
  const atalho = (e) => {
    if (e.key === "/" && !e.target.closest("input, textarea, [contenteditable]")) { e.preventDefault(); g.busca.focus(); g.busca.select(); }
  };
  document.addEventListener("keydown", atalho);
  aoSair(() => document.removeEventListener("keydown", atalho)); // o roteador roda este módulo de novo a cada visita
}
