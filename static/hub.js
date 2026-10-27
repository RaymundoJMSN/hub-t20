// hub.js — casca do Hub em toda página: barra de abas (gaveta ☰ no celular), conta, e o ROTEADOR:
// clicar num link interno não recarrega a página — busca o HTML, troca <head>/<body> e roda o script da página.
// O CSS da barra é o nav.css (injetado daqui), autocontido: páginas com CSS próprio (agenda, missões) ficam intactas.
// Sem sessão a API devolve 401 → manda pra tela de login guardando o destino.
export const el = (tag, props = {}, ...filhos) => {
  const n = Object.assign(document.createElement(tag), props);
  n.append(...filhos.filter((f) => f != null));
  return n;
};
const link = el("link", { rel: "stylesheet", href: "/nav.css" });
link.dataset.hub = "";
document.head.append(link);

// menu lateral em árvore: ["emoji Grupo", [filhos]] ou [rota, "emoji Rótulo", [filhos]?, cargaCompleta?]
// /ficha/ é um app à parte (recarrega de verdade). Abas de página de coleção são "?aba=<coleção>".
export const MENU = [
  ["🏛️ Compêndio", [
    ["/", "📖 Grimório", [["/criar", "✦ Criar magia"]]],
    ["/poderes", "⚔️ Poderes"],
    ["/bestiario", "🐉 Bestiário", [["/criar-ameaca", "👹 Criar ameaça"]]],
    ["/itens", "🎒 Itens"],
    ["/compendio", "🧝 Raças"], ["/compendio?aba=classes", "🛡️ Classes"], ["/compendio?aba=origens", "🏠 Origens"],
    ["/compendio?aba=deuses", "☀️ Deuses"], ["/compendio?aba=distincoes", "🎖️ Distinções"], ["/compendio?aba=parceiros", "🐎 Parceiros"]]],
  ["⚖️ Regras", [["/regras", "📘 Livros"], ["/regras?aba=str", "⚖️ STR"], ["/regras?aba=perigos", "☠️ Perigos"], ["/regras?aba=aventuras", "🗺️ Breves jornadas"]]],
  ["🎲 Mesa", [["/ficha/", "🧾 Fichas", null, true], ["/missoes", "📜 Missões"], ["/agenda", "📅 Agenda"], ["/links", "🔗 Links"]]],
];
// páginas de coleção: cada aba da página é uma coleção de dados/colecoes/
export const PAGINAS_COL = {
  "/bestiario": { titulo: "Bestiário", sub: "620 ameaças com a ficha inteira · Livro Básico, Ameaças de Arton, Deuses de Arton, Guia de NPCs", abas: [["ameacas", "🐉 ameaças"]], acao: ["/criar-ameaca", "👹 criar ameaça"] },
  "/itens": { titulo: "Itens", sub: "armas, armaduras, itens gerais e mágicos, encantamentos, modificações, maldições e culinária", abas: [["itens", "🎒 itens"]] },
  "/regras": { titulo: "Regras", sub: "os capítulos de regras dos livros, o Supremo Tribunal Regreiro (Dragão Brasil) e os perigos", abas: [["regras", "📘 livros"], ["str", "⚖️ STR"], ["perigos", "☠️ perigos"], ["aventuras", "🗺️ breves jornadas"]] },
  "/compendio": { titulo: "Compêndio", sub: "raças, classes, origens, deuses, distinções e parceiros", abas: [["racas", "🧝 raças"], ["classes", "🛡️ classes"], ["origens", "🏠 origens"], ["deuses", "☀️ deuses"], ["distincoes", "🎖️ distinções"], ["parceiros", "🐎 parceiros"]] },
};
export function paginaDaColecao(col) { return Object.entries(PAGINAS_COL).find(([, p]) => p.abas.some(([c]) => c === col))?.[0]; }
export const irParaLogin = () => { location.href = "/login?voltar=" + encodeURIComponent(location.pathname + location.search); return new Promise(() => {}); };
export const eu = fetch("/api/eu").then((r) => r.ok ? r.json() : irParaLogin()).catch(irParaLogin);
export const sair = async () => { await fetch("/api/sair", { method: "POST" }); location.href = "/login"; };
// primeira LETRA maiúscula (pula emoji/símbolo na frente: "🧝 raças" → "🧝 Raças")
export const capitalizar = (s) => String(s ?? "").replace(/\p{L}/u, (c) => c.toUpperCase());

// ---------------------------------------------------------------- roteador ("turbo")
// Cada página registra o que precisa desfazer ao sair (timers, listeners no document) com aoSair(fn).
let limpezas = [];
export const aoSair = (fn) => { limpezas.push(fn); };
const CARGA_COMPLETA = /^\/(ficha\/|login$)/;
const htmlCache = new Map(); // caminho → { t, html } (60 s): passar o mouse na aba já busca a página
async function buscarHtml(caminho) {
  const c = htmlCache.get(caminho);
  if (c && Date.now() - c.t < 60_000) return c.html;
  const r = await fetch(caminho, { headers: { "x-hub": "spa" } });
  if (!r.ok) throw new Error("http " + r.status);
  const html = await r.text();
  htmlCache.set(caminho, { t: Date.now(), html });
  return html;
}
const persistente = (n) => n.hasAttribute?.("data-hub") || n.id === "mesa" || n.classList?.contains("mesa-barra") || n.classList?.contains("hub-dialog");
// na primeira carga, os estilos que vieram no <head> são da página (o nav.css e as fontes são da casca)
for (const n of document.head.querySelectorAll('link[rel="stylesheet"]:not([data-hub]), style, link[rel~="icon"], link[rel="apple-touch-icon"]'))
  if (!/fonts\.googleapis/.test(n.href || "")) n.setAttribute("data-pagina", "");

export async function visitar(url, { push = true } = {}) {
  const u = new URL(url, location.href);
  if (u.origin !== location.origin || CARGA_COMPLETA.test(u.pathname)) { location.href = u.href; return; }
  const caminho = u.pathname + u.search;
  let doc;
  try {
    doc = new DOMParser().parseFromString(await buscarHtml(caminho), "text/html");
  } catch (e) { console.warn("roteador:", e); location.href = u.href; return; }
  if (doc.querySelector("form.ficha")) { location.href = u.href; return; } // caiu no login: sessão acabou
  for (const f of limpezas.splice(0)) { try { f(); } catch {} }
  document.title = doc.title;
  // estilos da página nova ENTRAM e carregam antes de a antiga sair (senão a tela pisca sem CSS);
  // folha que as duas páginas usam (style.css) fica onde está, sem recarregar
  const antigos = [...document.head.querySelectorAll("[data-pagina]")];
  const hrefDe = (n) => n.tagName === "LINK" ? new URL(n.getAttribute("href"), location.href).href : null;
  const carregando = [];
  for (const n of doc.head.querySelectorAll('link[rel="stylesheet"], style, link[rel~="icon"], link[rel="apple-touch-icon"]')) {
    if (/fonts\.googleapis/.test(n.getAttribute("href") || "")) continue;
    const h = hrefDe(n);
    const igual = h && antigos.find((a) => a.tagName === "LINK" && a.rel === n.rel && hrefDe(a) === h);
    if (igual) { antigos.splice(antigos.indexOf(igual), 1); continue; } // já está na página
    const c = document.adoptNode(n); c.setAttribute("data-pagina", "");
    if (c.tagName === "LINK" && c.rel === "stylesheet") carregando.push(new Promise((ok) => { c.onload = c.onerror = ok; setTimeout(ok, 1500); }));
    document.head.append(c);
  }
  await Promise.all(carregando);
  for (const n of antigos) n.remove();
  // corpo: sai tudo que não é da casca (barra, gaveta, mesa, diálogos); entra o corpo novo, scripts à parte
  document.body.className = doc.body.className;
  for (const n of [...document.body.childNodes]) if (!persistente(n)) n.remove();
  const scripts = [];
  const ancora = document.getElementById("mesa"); // a mesa continua no fim do body
  for (const n of [...doc.body.childNodes]) {
    if (n.tagName === "SCRIPT") { scripts.push(n); continue; }
    if (ancora) document.body.insertBefore(document.adoptNode(n), ancora); else document.body.append(document.adoptNode(n));
  }
  if (push) history.pushState({ hub: true }, "", caminho);
  scrollTo(0, 0);
  marcarAtiva();
  fecharGaveta();
  for (const s of scripts) {
    const src = s.getAttribute("src");
    try {
      if (src) {
        const p = new URL(src, location.href);
        if (p.pathname === "/hub.js") continue; // a casca já está rodando
        await import(p.pathname + "?v=" + Date.now()); // sufixo novo = módulo roda de novo
      } else if (s.type === "module") {
        const n = el("script", { type: "module", textContent: s.textContent }); n.setAttribute("data-pagina-script", "");
        document.body.append(n);
      } else new Function(s.textContent)();
    } catch (e) { console.error("script da página:", e); }
  }
  for (const n of document.querySelectorAll("script[data-pagina-script]")) n.remove(); // já rodaram
}
document.addEventListener("click", (e) => {
  const a = e.target.closest("a[href]");
  if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  if (a.target === "_blank" || a.hasAttribute("download") || a.dataset.recarrega != null) return;
  const u = new URL(a.href, location.href);
  if (u.origin !== location.origin) return;
  if (u.pathname === location.pathname && u.search === location.search && u.hash) return; // âncora na mesma página
  e.preventDefault();
  visitar(u.href);
});
addEventListener("popstate", () => visitar(location.href, { push: false }));
// passar o mouse (ou tocar) numa aba já busca o HTML dela
document.addEventListener("pointerover", (e) => {
  const a = e.target.closest(".hub-lado a[href], .hub-atalhos a[href]");
  if (a && a.href.startsWith(location.origin) && !CARGA_COMPLETA.test(new URL(a.href).pathname)) buscarHtml(new URL(a.href).pathname).catch(() => {});
});

// ---------------------------------------------------------------- menu lateral, atalhos e busca em tudo
// Menu = árvore à esquerda: aparece ao encostar o mouse na borda, ☰ deixa fixo (desktop) ou abre a gaveta (celular).
// Cada página do menu tem ☆ = atalho no topo, guardado na conta (/api/atalhos), então vale em qualquer aparelho.
const no = (x) => x[0].startsWith("/") ? { href: x[0], rot: x[1], filhos: (x[2] || []).map(no), completa: x[3] } : { rot: x[0], filhos: x[1].map(no) };
const celular = () => matchMedia("(max-width: 900px)").matches;
const guardado = (k, padrao) => { try { return JSON.parse(localStorage.getItem(k)) ?? padrao; } catch { return padrao; } };
const guardar = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
let arvore = [], nav, lado, fundo, atalhosBox, atalhos = [], abertos = guardado("hub-menu", {});
// rota → chave do menu: /o/x é o grimório, /d/x os poderes, /c/<col>/x a página da coleção (com ?aba= se não for a 1ª)
function chaveAtual() {
  const p = location.pathname, aba = new URLSearchParams(location.search).get("aba");
  if (/^\/[mo](\/|$)/.test(p) || (p === "/" && aba === "poderes")) return aba === "poderes" ? "/poderes" : "/";
  if (/^\/d(\/|$)/.test(p)) return "/poderes";
  if (p.startsWith("/ficha/")) return "/ficha/";
  const c = p.match(/^\/c\/([\w-]+)/);
  const pag = c ? paginaDaColecao(c[1]) : p, col = c ? c[1] : aba;
  if (PAGINAS_COL[pag]) return pag + (col && col !== PAGINAS_COL[pag].abas[0][0] ? "?aba=" + col : "");
  return p;
}
const caminhoAte = (chave, nos = arvore, pais = []) => {
  for (const n of nos) {
    if (n.href === chave) return [...pais, n];
    const r = caminhoAte(chave, n.filhos, [...pais, n]);
    if (r) return r;
  }
  return null;
};
const semEmoji = (rot) => rot.replace(/^\S+\s/, "");
export function marcarAtiva() {
  if (!lado) return;
  const chave = chaveAtual(), caminho = caminhoAte(chave) || [];
  for (const a of lado.querySelectorAll("a[href]")) a.classList.toggle("on", a.getAttribute("href") === chave);
  for (const a of atalhosBox.querySelectorAll("a[href]")) a.classList.toggle("on", a.getAttribute("href") === chave);
  for (const n of caminho.slice(0, -1)) n.li.classList.add("aberto"); // a página atual nunca fica escondida num galho fechado
  nav.querySelector(".hub-trilha").textContent = caminho.length ? caminho.map((n) => semEmoji(n.rot)).join(" › ") : "Hub T20";
  if (lado.contains(document.activeElement)) document.activeElement.blur(); // senão o :focus-within segura o menu aberto depois do clique
}
function alternar(n) {
  const aberto = n.li.classList.toggle("aberto");
  abertos[n.rot] = aberto; guardar("hub-menu", abertos);
}
function montarNo(n) {
  const [emoji, ...resto] = n.rot.split(" ");
  const rotulo = [el("span", { className: "hub-emoji", textContent: emoji }), el("span", { className: "hub-rotulo", textContent: resto.join(" ") })];
  const linha = el("div", { className: "hub-linha" });
  if (n.href) {
    const a = el("a", { href: n.href, title: semEmoji(n.rot) }, ...rotulo);
    if (n.completa) a.dataset.recarrega = "";
    linha.append(a, el("button", { type: "button", className: "hub-estrela", title: "atalho no topo", onclick: () => alternarAtalho(n.href) }));
  } else linha.append(el("button", { type: "button", className: "hub-grupo-bt", onclick: () => alternar(n) }, ...rotulo));
  if (n.filhos.length) linha.append(el("button", { type: "button", className: "hub-seta", title: "abrir / fechar", "aria-label": "abrir ou fechar " + semEmoji(n.rot), onclick: () => alternar(n) }));
  // grupo começa aberto, página com filhos começa fechada; o que a pessoa abriu/fechou fica lembrado
  n.li = el("li", { className: (n.href ? "hub-item" : "hub-grupo") + ((abertos[n.rot] ?? !n.href) ? " aberto" : "") }, linha);
  if (n.filhos.length) n.li.append(el("ul", {}, ...n.filhos.map(montarNo)));
  return n.li;
}
const todos = (nos = arvore) => nos.flatMap((n) => [n, ...todos(n.filhos)]);
function desenharAtalhos() {
  const porHref = new Map(todos().filter((n) => n.href).map((n) => [n.href, n]));
  atalhosBox.replaceChildren(...atalhos.filter((h) => porHref.has(h)).map((h) => {
    const n = porHref.get(h), [emoji, ...resto] = n.rot.split(" ");
    const a = el("a", { href: h, title: semEmoji(n.rot) }, el("span", { className: "hub-emoji", textContent: emoji }), el("span", { className: "hub-rotulo", textContent: resto.join(" ") }));
    if (n.completa) a.dataset.recarrega = "";
    return a;
  }));
  for (const n of porHref.values()) {
    const b = n.li.querySelector(":scope > .hub-linha > .hub-estrela"), tem = atalhos.includes(n.href);
    b.textContent = tem ? "★" : "☆"; b.classList.toggle("on", tem); b.title = tem ? "tirar do topo" : "atalho no topo";
  }
  marcarAtiva();
}
async function alternarAtalho(href) {
  atalhos = atalhos.includes(href) ? atalhos.filter((h) => h !== href) : [...atalhos, href];
  desenharAtalhos();
  try { atalhos = (await postJson("/api/atalhos", { atalhos })).atalhos ?? atalhos; } catch {}
}
function abrirGaveta() { lado.classList.add("aberto"); fundo.hidden = false; }
function fecharGaveta() { lado?.classList.remove("aberto"); if (fundo) fundo.hidden = true; }
function fixar(sim) { document.documentElement.classList.toggle("lado-fixo", sim); guardar("hub-lado-fixo", sim); }

// busca em tudo: /api/busca devolve as melhores de cada fonte; "ver todas" abre a página da fonte já filtrada
function caixaDeBusca() {
  const caixa = el("input", { type: "search", className: "hub-busca", placeholder: "Buscar em tudo…", autocomplete: "off", title: "buscar em magias, poderes, bestiário, itens, regras… (Ctrl+K)" });
  const res = el("div", { className: "hub-resultados", hidden: true });
  let timer, n = 0;
  const paginaDe = (g, q) => {
    const u = new URL(g.col ? paginaDaColecao(g.col) || "/compendio" : g.pagina, location.origin);
    if (g.col) u.searchParams.set("aba", g.col);
    u.searchParams.set("q", q);
    return u.pathname + u.search;
  };
  async function buscar() {
    const q = caixa.value.trim(), eu = ++n;
    if (q.length < 2) { res.hidden = true; return; }
    const r = await fetch("/api/busca?q=" + encodeURIComponent(q)).then((x) => x.json()).catch(() => ({ grupos: [] }));
    if (eu !== n) return; // chegou resposta de uma busca velha
    res.replaceChildren(...(r.grupos?.length ? r.grupos.map((g) => el("div", { className: "hub-res-grupo" },
      el("a", { className: "hub-res-titulo", href: paginaDe(g, q), textContent: `${g.titulo} · ${g.total}${g.total > g.itens.length ? " — ver todas" : ""}` }),
      ...g.itens.map((i) => el("a", { className: "hub-res-item", href: i.href }, el("b", { textContent: i.nome }), el("span", { textContent: i.linha || "" })))))
      : [el("div", { className: "hub-res-vazio", textContent: "nada encontrado" })]));
    res.hidden = false;
  }
  caixa.oninput = () => { clearTimeout(timer); timer = setTimeout(buscar, 250); };
  caixa.onfocus = () => { if (res.childElementCount && caixa.value.trim().length > 1) res.hidden = false; };
  caixa.onkeydown = (e) => {
    if (e.key === "Escape") { res.hidden = true; caixa.blur(); }
    if (e.key === "Enter") res.querySelector(".hub-res-item")?.click();
  };
  res.addEventListener("click", (e) => { if (e.target.closest("a")) res.hidden = true; });
  document.addEventListener("pointerdown", (e) => { if (!e.target.closest(".hub-busca-box")) res.hidden = true; });
  return el("div", { className: "hub-busca-box" }, caixa, res);
}

const postJson = (rota, corpo) => fetch(rota, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(corpo) }).then((r) => r.json());
// diálogo da conta: nome de exibição + personagem (quem vota nas missões), trocar senha, sair (+ painel do mestre)
function dialogoConta(u) {
  fecharGaveta();
  const dlg = el("dialog", { className: "hub-dialog" });
  const nome = el("input", { value: u.nome, placeholder: "seu nome", maxLength: 40, autocomplete: "username" });
  const apel = el("input", { value: u.apelido || "", placeholder: "apelido (também serve pra entrar)", maxLength: 40 });
  const pers = el("input", { value: u.personagem || "", placeholder: "personagem (aparece nas missões)", maxLength: 60 });
  const msg1 = el("div", { className: "hub-msg" });
  const atual = el("input", { type: "password", placeholder: "senha atual", required: true, autocomplete: "current-password" });
  const nova = el("input", { type: "password", placeholder: "senha nova (mín. 4)", required: true, minLength: 4, autocomplete: "new-password" });
  const msg2 = el("div", { className: "hub-msg" });
  const conta = el("form", { method: "dialog" },
    el("h3", { textContent: "Sua conta" }),
    el("div", { className: "hub-quem" }, el("b", { textContent: u.nome }), u.personagem ? ` · ${u.personagem}` : "", u.mestre ? " · mestre" : ""),
    el("label", { className: "hub-rotulo-campo", textContent: "nome" }), nome,
    el("label", { className: "hub-rotulo-campo", textContent: "apelido" }), apel,
    el("label", { className: "hub-rotulo-campo", textContent: "personagem" }), pers, msg1,
    el("div", { className: "hub-acoes" }, el("button", { className: "hub-bt destaque", textContent: "salvar" })));
  conta.onsubmit = async (e) => {
    e.preventDefault();
    const r = await postJson("/api/conta", { nome: nome.value, personagem: pers.value, apelido: apel.value });
    if (r.ok) { msg1.textContent = "salvo ✓"; setTimeout(() => location.reload(), 500); } else msg1.textContent = r.erro || "erro";
  };
  const senha = el("form", { method: "dialog" },
    el("label", { className: "hub-rotulo-campo", textContent: "trocar senha" }), atual, nova, msg2,
    el("div", { className: "hub-acoes" },
      u.mestre ? el("a", { className: "hub-bt", href: "/mestre", textContent: "👑 painel do mestre", onclick: () => dlg.close() }) : null,
      el("button", { className: "hub-bt", type: "button", textContent: "sair", onclick: sair }),
      el("button", { className: "hub-bt", type: "button", textContent: "fechar", onclick: () => dlg.close() }),
      el("button", { className: "hub-bt destaque", textContent: "trocar senha" })));
  senha.onsubmit = async (e) => {
    e.preventDefault();
    const r = await postJson("/api/senha", { atual: atual.value, nova: nova.value });
    if (r.ok) { msg2.textContent = "senha trocada ✓"; setTimeout(() => dlg.close(), 700); } else msg2.textContent = r.erro || "erro";
  };
  dlg.append(conta, senha);
  document.body.append(dlg);
  dlg.showModal();
  dlg.addEventListener("close", () => dlg.remove());
}

eu.then((u) => {
  arvore = MENU.map(no);
  if (u.mestre) arvore.find((n) => n.rot.endsWith("Mesa"))?.filhos.push(no(["/mestre", "👑 Mestre"]));
  atalhos = u.atalhos || [];
  atalhosBox = el("div", { className: "hub-atalhos" });
  const menuBt = el("button", { className: "hub-menu-bt", type: "button", title: "menu (fixar aberto)", textContent: "☰",
    onclick: () => celular() ? (lado.classList.contains("aberto") ? fecharGaveta() : abrirGaveta()) : fixar(!document.documentElement.classList.contains("lado-fixo")) });
  nav = el("nav", { className: "hub-nav" }, menuBt, el("span", { className: "hub-trilha" }), atalhosBox, caixaDeBusca(),
    el("div", { className: "hub-eu" },
      el("span", { className: "hub-nome", title: u.personagem ? `${u.nome} · ${u.personagem}` : u.nome }, el("b", { textContent: u.nome }), u.personagem ? el("span", { className: "hub-pers", textContent: " · " + u.personagem }) : null),
      el("button", { className: "hub-bt", type: "button", textContent: "conta", onclick: () => dialogoConta(u) }),
      el("button", { className: "hub-bt", type: "button", textContent: "sair", onclick: sair }),
      el("button", { className: "hub-bt hub-conta-bt", type: "button", title: u.nome, textContent: u.mestre ? "👑" : "👤", onclick: () => dialogoConta(u) })));
  lado = el("aside", { className: "hub-lado", "aria-label": "menu" },
    el("div", { className: "hub-lado-topo" }, el("b", { textContent: "Hub T20" }),
      el("button", { className: "hub-fixar", type: "button", title: "deixar o menu sempre aberto", textContent: "📌", onclick: () => fixar(!document.documentElement.classList.contains("lado-fixo")) })),
    el("ul", { className: "hub-arvore" }, ...arvore.map(montarNo)),
    el("div", { className: "hub-gaveta-conta" },
      el("button", { className: "hub-bt", type: "button", textContent: (u.mestre ? "👑 " : "👤 ") + u.nome, onclick: () => dialogoConta(u) }),
      el("button", { className: "hub-bt", type: "button", textContent: "sair", onclick: sair })));
  const borda = el("div", { className: "hub-borda", "aria-hidden": "true" }); // faixa invisível na esquerda: encostar abre o menu
  fundo = el("div", { className: "hub-fundo", hidden: true, onclick: fecharGaveta });
  for (const n of [nav, borda, lado, fundo]) n.dataset.hub = "";
  document.body.prepend(nav, borda, lado, fundo);
  document.documentElement.classList.add("com-nav");
  fixar(guardado("hub-lado-fixo", false));
  desenharAtalhos();
});
addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); document.querySelector(".hub-busca")?.focus(); }
});
document.addEventListener("keydown", (e) => { if (e.key === "Escape") fecharGaveta(); });
// PWA: instalável e abre offline o que já foi visto (sw.js = cache primeiro pra css/js/dados fixos)
if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
