// Grimório: pesquisa e filtros sobre as oficiais + publicadas da mesa.
// Duas abas com o MESMO mecanismo de busca: magias e poderes (oficiais, de
// todos os livros — vêm de /api/poderes).
// Componente reutilizável: página / (grimório), gaveta lateral do criador.
// Clicar ou arrastar põe a carta na mesa (quadro.js), em qualquer página.
import { mesaGlobal, TIPO_ARRASTO } from "/quadro.js";
import { EXECUCOES, ALCANCES, TESTES, EFEITOS } from "/eixos.mjs";
import { capitalizar, aoSair } from "/hub.js";

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
// poderes: categorias e livros vêm do minerador (tools/minerar-poderes.mjs)
const CATEGORIAS = ["Combate", "Destino", "Magia", "Tormenta", "Geral", "Grupo", "Classe", "Habilidade", "Racial", "Origem", "Concedido", "Distinção"];
const LIVROS = ["Livro Básico", "Heróis de Arton", "Dragão Brasil", "Distinções", "Deuses de Arton", "Guia de NPCs"];

export const chaveDe = (m) => m.fonte === "mesa" ? "p:" + m.id : m.fonte === "poder" ? "d:" + m.slug : "o:" + m.slug;

const ABAS = [["magias", "📕 magias"], ["poderes", "⚔ poderes"]];
const ORDENS = {
  magias: [["circulo", "por círculo"], ["nome", "por nome"], ["escola", "por escola"]],
  poderes: [["categoria", "por categoria"], ["nome", "por nome"], ["livro", "por livro"]],
};
const PADRAO_ORD = { magias: "circulo", poderes: "categoria" };
// filtros ⇄ URL (?aba=poderes&q=fogo&c=1,2&t=Arcana&e=Evocação&f=mesa&cat=Combate&liv=…&ord=nome)
const URL_CHAVES = { circulo: "c", tipo: "t", escola: "e", fonte: "f", pocao: "poc", exec: "ex", alc: "al", res: "res", categoria: "cat", livro: "liv" };

export function montarGrimorio(raiz, { qInicial = "", abrir = null, naUrl = false, aba = "magias" } = {}) {
  const mesa = mesaGlobal();
  // filtros multi-seleção (vazio = todos); Arcana e Divina são exclusivas entre si
  const filtro = { circulo: new Set(), tipo: new Set(), escola: new Set(), fonte: new Set(), pocao: new Set(),
    exec: new Set(), alc: new Set(), res: new Set(), categoria: new Set(), livro: new Set(), q: qInicial, ord: PADRAO_ORD[aba], aba };
  if (naUrl) {
    const ps = new URLSearchParams(location.search);
    if (ABAS.some(([a]) => a === ps.get("aba"))) filtro.aba = ps.get("aba");
    for (const [k, u] of Object.entries(URL_CHAVES))
      for (const v of (ps.get(u) || "").split(",").filter(Boolean)) filtro[k].add(k === "circulo" ? +v : v);
    if (ORDENS[filtro.aba].some(([o]) => o === ps.get("ord"))) filtro.ord = ps.get("ord");
  }
  function gravarUrl() {
    if (!naUrl) return;
    const ps = new URLSearchParams();
    if (filtro.aba !== "magias") ps.set("aba", filtro.aba);
    if (filtro.q.trim()) ps.set("q", filtro.q.trim());
    for (const [k, u] of Object.entries(URL_CHAVES)) if (filtro[k].size) ps.set(u, [...filtro[k]].join(","));
    if (filtro.ord !== PADRAO_ORD[filtro.aba]) ps.set("ord", filtro.ord);
    history.replaceState(null, "", location.pathname + (ps.size ? "?" + ps : ""));
  }
  let TUDO = { oficiais: [], publicadas: [], poderes: [] };
  let buscaTimer;

  const busca = el("input", {
    type: "search", className: "g-busca", value: qInicial, autocomplete: "off",
    oninput: (e) => { filtro.q = e.target.value; clearTimeout(buscaTimer); buscaTimer = setTimeout(buscar, 300); },
  });
  const barraAbas = el("div", { className: "g-abas" });
  const boxFiltros = el("div", { className: "g-filtros" });
  const conta = el("div", { className: "explica" });
  const ordem = el("select", { className: "g-ordem", title: "ordenar", onchange: (e) => { filtro.ord = e.target.value; render(); } });
  const lista = el("div", { className: "grimorio-lista" });
  raiz.append(barraAbas, busca, boxFiltros, el("div", { className: "g-conta-linha" }, conta, ordem), lista);

  for (const [valor, rotulo] of ABAS) {
    const b = el("button", {
      type: "button", className: "chip g-aba", textContent: rotulo,
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
      ? "pesquisar por nome ou texto… (fogo, medo, cura)"
      : "pesquisar por nome ou texto… (fúria, bárbaro, +2 na Defesa)";
    ordem.replaceChildren(...ORDENS[valor].map(([v, t]) => el("option", { value: v, textContent: capitalizar(t), selected: v === filtro.ord })));
    montarChips();
    return buscar();
  }

  const EXCLUSIVOS = { Arcana: "Divina", Divina: "Arcana" }; // não se misturam
  function chips(itens, chave, rotulo = (x) => String(x)) {
    const box = el("div", { className: "chips" });
    const botoes = new Map();
    for (const item of itens) {
      const valor = Array.isArray(item) ? item[0] : item;
      const b = el("button", {
        type: "button", className: "chip",
        textContent: capitalizar(Array.isArray(item) ? item[1] : rotulo(item)),
        onclick: () => {
          const sel = filtro[chave];
          if (sel.has(valor)) sel.delete(valor);
          else {
            const oposto = chave === "tipo" && EXCLUSIVOS[valor];
            if (oposto && sel.has(oposto)) { sel.delete(oposto); botoes.get(oposto).classList.remove("on"); }
            sel.add(valor);
          }
          b.classList.toggle("on", sel.has(valor));
          render();
        },
      });
      botoes.set(valor, b);
      b.classList.toggle("on", filtro[chave].has(valor));
      box.append(b);
    }
    boxFiltros.append(box);
  }
  // dropdown de um valor só; guardado num Set pra usar a mesma ida-e-volta de URL dos chips
  function seletor(chave, titulo, pares, grupos = []) {
    const opcao = ([v, t]) => el("option", { value: v, textContent: capitalizar(t), selected: filtro[chave].has(v) });
    const sel = el("select", {
      className: "g-sel" + (filtro[chave].size ? " on" : ""), title: "filtrar por " + titulo,
      onchange: (e) => {
        filtro[chave] = new Set(e.target.value ? [e.target.value] : []);
        sel.classList.toggle("on", !!e.target.value);   // remontar o box aqui tiraria o foco do próprio select
        render();
      },
    }, el("option", { value: "", textContent: "Tudo" }), ...pares.map(opcao));
    for (const [rotulo, ps] of grupos) sel.append(el("optgroup", { label: capitalizar(rotulo) }, ...ps.map(opcao)));
    return el("div", { className: "filtro select" }, el("span", { className: "chips-rotulo", textContent: titulo }), sel);
  }

  function montarChips() {
    boxFiltros.replaceChildren();
    if (filtro.aba === "magias") {
      chips(CIRCULOS, "circulo", (c) => `${c}º`);
      chips(TIPOS, "tipo");
      chips(ESCOLAS, "escola");
      chips(FONTES, "fonte");
      chips(POCOES, "pocao");
      // eixos técnicos: lista longa demais pra chip, e só um valor por vez faz sentido
      boxFiltros.append(el("div", { className: "g-selects" },
        seletor("exec", "execução", EXECUCOES.map((v) => [v, v])),
        seletor("alc", "alcance", ALCANCES.map((v) => [v, v])),
        seletor("res", "resistência", [], [
          ["teste", TESTES.map((v) => ["t:" + v, v])],
          ["efeito", EFEITOS.map((v) => ["e:" + v, v])],
        ])));
    } else {
      chips(CATEGORIAS, "categoria");
      chips(LIVROS, "livro");
    }
  }

  async function buscar() {
    const q = filtro.q.trim();
    const qs = q ? `?q=${encodeURIComponent(q)}` : "";
    gravarUrl();
    try {
      TUDO = filtro.aba === "magias"
        ? { ...await (await fetch("/api/grimorio" + qs)).json(), poderes: [] }
        : { oficiais: [], publicadas: [], ...await (await fetch("/api/poderes" + qs)).json() };
    } catch { TUDO = { oficiais: [], publicadas: [], poderes: [] }; }
    render();
  }

  const passa = (m, fonte) =>
    (!filtro.circulo.size || filtro.circulo.has(m.circulo)) &&
    (!filtro.tipo.size || filtro.tipo.has(m.grupo)) &&
    (!filtro.escola.size || filtro.escola.has(m.escola)) &&
    (!filtro.fonte.size || filtro.fonte.has(fonte)) &&
    (!filtro.pocao.size || (m.pocao && (filtro.pocao.has("sim") || filtro.pocao.has(m.pocao)))) &&
    (!filtro.exec.size || filtro.exec.has(m.exec)) &&
    (!filtro.alc.size || filtro.alc.has(m.alc)) &&
    (!filtro.res.size || filtro.res.has("t:" + m.res) || filtro.res.has("e:" + m.resEf));
  const passaPoder = (p) =>
    (!filtro.categoria.size || filtro.categoria.has(p.categoria)) &&
    (!filtro.livro.size || filtro.livro.has(p.livro));

  function itensMagias() {
    const itens = [
      ...TUDO.publicadas.filter((m) => passa(m, "mesa")).map((m) => ({ ...m, fonte: "mesa" })),
      ...TUDO.oficiais.filter((m) => passa(m, "oficiais")).map((m) => ({ ...m, fonte: "oficiais" })),
    ];
    const ord = filtro.ord;
    itens.sort((a, b) => ord === "circulo" ? a.circulo - b.circulo || a.nome.localeCompare(b.nome)
      : ord === "escola" ? a.escola.localeCompare(b.escola) || a.circulo - b.circulo || a.nome.localeCompare(b.nome)
      : a.nome.localeCompare(b.nome));
    return itens;
  }
  function itensPoderes() {
    const itens = TUDO.poderes.filter(passaPoder).map((p) => ({ ...p, fonte: "poder" }));
    const ord = filtro.ord;
    const pos = (p) => { const i = CATEGORIAS.indexOf(p.categoria); return i < 0 ? 99 : i; };
    itens.sort((a, b) => ord === "categoria" ? pos(a) - pos(b) || (a.sub || "").localeCompare(b.sub || "") || a.nome.localeCompare(b.nome)
      : ord === "livro" ? LIVROS.indexOf(a.livro) - LIVROS.indexOf(b.livro) || pos(a) - pos(b) || a.nome.localeCompare(b.nome)
      : a.nome.localeCompare(b.nome));
    return itens;
  }

  function render() {
    lista.replaceChildren();
    const poderes = filtro.aba === "poderes";
    const itens = poderes ? itensPoderes() : itensMagias();
    gravarUrl();

    const quantos = `${itens.length} ${poderes ? "poder" : "magia"}${itens.length === 1 ? "" : poderes ? "es" : "s"}`;
    conta.textContent = quantos
      + (!poderes && TUDO.publicadas.length ? ` · ${itens.filter((m) => m.fonte === "mesa").length} da mesa` : "")
      + " · clique ou arraste pra pôr na mesa";

    if (!itens.length) return lista.append(el("div", { className: "vazio", textContent: `nenhum${poderes ? " poder" : "a magia"} com esses filtros.` }));
    let grupo = null;
    for (const m of itens) {
      // cabeçalho por grupo (círculo/escola, ou categoria/livro), só quando faz sentido pra ordem
      const g = poderes
        ? (filtro.ord === "categoria" ? m.categoria : filtro.ord === "livro" ? m.livro : null)
        : (filtro.ord === "circulo" ? `${m.circulo}º círculo` : filtro.ord === "escola" ? m.escola : null);
      if (g !== null && g !== grupo) { grupo = g; lista.append(el("h2", { className: "g-grupo", textContent: g })); }
      const chave = chaveDe(m);
      lista.append(el("div", {
        className: "card" + (m.fonte === "mesa" ? " card-mesa" : ""),
        draggable: true, title: "clique ou arraste pra pôr na mesa",
        onclick: () => mesa.abrir(chave),
        ondragstart: (e) => { e.dataTransfer.setData(TIPO_ARRASTO, chave); e.dataTransfer.effectAllowed = "copy"; },
      },
        el("span", { className: "circ", textContent: poderes ? (m.custo || "") : `${m.circulo}º` }),
        el("h3", { textContent: m.nome }),
        el("div", {
          className: "meta",
          textContent: poderes ? [m.categoria, m.sub, m.livro].filter(Boolean).join(" · ")
            : [m.escola, m.grupo, m.pocao && `🧪 ${m.pocao}`, m.autor && `por ${m.autor}`].filter(Boolean).join(" · "),
        }),
      ));
    }
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
  const g = montarGrimorio(pagina, {
    qInicial: params.get("q") || "", abrir: params.get("abrir"), naUrl: true,
    aba: rota?.[1] === "d" ? "poderes" : "magias",
  });
  if (rota) mesaGlobal().abrir(`${rota[1] === "m" ? "p" : rota[1]}:${rota[2]}`);
  const atalho = (e) => {
    if (e.key === "/" && !e.target.closest("input, textarea, [contenteditable]")) { e.preventDefault(); g.busca.focus(); g.busca.select(); }
  };
  document.addEventListener("keydown", atalho);
  aoSair(() => document.removeEventListener("keydown", atalho)); // o roteador roda este módulo de novo a cada visita
}
