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

// [rota, "emoji Rótulo", cargaCompleta?] — /ficha/ é um app à parte (recarrega de verdade)
export const ABAS = [["/", "📖 Grimório"], ["/criar", "✦ Criar magia"], ["/ficha/", "🧾 Criar ficha", true], ["/bestiario", "🐉 Bestiário"], ["/itens", "🎒 Itens"],
  ["/regras", "⚖️ Regras"], ["/compendio", "🏛️ Compêndio"], ["/missoes", "📜 Missões"], ["/agenda", "📅 Agenda"], ["/links", "🎲 Mesa"]];
// páginas de coleção: cada aba da página é uma coleção de dados/colecoes/
export const PAGINAS_COL = {
  "/bestiario": { titulo: "Bestiário", sub: "620 ameaças com a ficha inteira · Livro Básico, Ameaças de Arton, Deuses de Arton, Guia de NPCs", abas: [["ameacas", "🐉 ameaças"]] },
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
  const a = e.target.closest(".hub-abas a[href]");
  if (a && a.href.startsWith(location.origin) && !CARGA_COMPLETA.test(new URL(a.href).pathname)) buscarHtml(new URL(a.href).pathname).catch(() => {});
});

// ---------------------------------------------------------------- barra, gaveta (celular) e conta
function ativa() {
  const p = location.pathname;
  if (/^\/[mod](\/|$)/.test(p)) return "/";
  const c = p.match(/^\/c\/([\w-]+)/);
  if (c) return paginaDaColecao(c[1]) || "/";
  return ABAS.find(([h]) => h !== "/" && p.startsWith(h))?.[0] || (p === "/" ? "/" : "");
}
let nav, gaveta;
function marcarAtiva() {
  if (!nav) return;
  const at = ativa();
  for (const a of nav.querySelectorAll(".hub-abas a[href]")) a.classList.toggle("on", a.getAttribute("href") === at);
  nav.querySelector(".hub-titulo").textContent = (ABAS.find(([h]) => h === at)?.[1] || "Hub T20").replace(/^\S+\s/, "");
}
function abrirGaveta() { nav.classList.add("aberta"); gaveta.hidden = false; }
function fecharGaveta() { nav?.classList.remove("aberta"); if (gaveta) gaveta.hidden = true; }

const postJson = (rota, corpo) => fetch(rota, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(corpo) }).then((r) => r.json());
// diálogo da conta: nome de exibição + personagem (quem vota nas missões), trocar senha, sair (+ painel do mestre)
function dialogoConta(u) {
  fecharGaveta();
  const dlg = el("dialog", { className: "hub-dialog" });
  const nome = el("input", { value: u.nome, placeholder: "seu nome", maxLength: 40, autocomplete: "username" });
  const pers = el("input", { value: u.personagem || "", placeholder: "personagem (aparece nas missões)", maxLength: 60 });
  const msg1 = el("div", { className: "hub-msg" });
  const atual = el("input", { type: "password", placeholder: "senha atual", required: true, autocomplete: "current-password" });
  const nova = el("input", { type: "password", placeholder: "senha nova (mín. 4)", required: true, minLength: 4, autocomplete: "new-password" });
  const msg2 = el("div", { className: "hub-msg" });
  const conta = el("form", { method: "dialog" },
    el("h3", { textContent: "Sua conta" }),
    el("div", { className: "hub-quem" }, el("b", { textContent: u.nome }), u.personagem ? ` · ${u.personagem}` : "", u.mestre ? " · mestre" : ""),
    el("label", { className: "hub-rotulo-campo", textContent: "nome" }), nome,
    el("label", { className: "hub-rotulo-campo", textContent: "personagem" }), pers, msg1,
    el("div", { className: "hub-acoes" }, el("button", { className: "hub-bt destaque", textContent: "salvar nome e personagem" })));
  conta.onsubmit = async (e) => {
    e.preventDefault();
    const r = await postJson("/api/conta", { nome: nome.value, personagem: pers.value });
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
  const aba = ([href, rot, completa]) => {
    const [emoji, ...resto] = rot.split(" ");
    const a = el("a", { href, title: rot }, el("span", { className: "hub-emoji", textContent: emoji }), el("span", { className: "hub-rotulo", textContent: resto.join(" ") }));
    if (completa) a.dataset.recarrega = "";
    return a;
  };
  nav = el("nav", { className: "hub-nav" },
    el("button", { className: "hub-menu-bt", type: "button", title: "menu", textContent: "☰", onclick: () => nav.classList.contains("aberta") ? fecharGaveta() : abrirGaveta() }),
    el("span", { className: "hub-titulo" }),
    el("div", { className: "hub-abas" }, ...ABAS.map(aba),
      el("div", { className: "hub-gaveta-conta" },
        el("button", { className: "hub-bt", type: "button", textContent: (u.mestre ? "👑 " : "👤 ") + u.nome, onclick: () => dialogoConta(u) }),
        el("button", { className: "hub-bt", type: "button", textContent: "sair", onclick: sair }))),
    el("div", { className: "hub-eu" },
      el("span", { className: "hub-nome", title: u.personagem ? `${u.nome} · ${u.personagem}` : u.nome }, el("b", { textContent: u.nome }), u.personagem ? el("span", { className: "hub-pers", textContent: " · " + u.personagem }) : null),
      u.mestre ? el("a", { href: "/mestre", className: "hub-bt", textContent: "👑 mestre" }) : null,
      el("button", { className: "hub-bt", type: "button", textContent: "conta", onclick: () => dialogoConta(u) }),
      el("button", { className: "hub-bt", type: "button", textContent: "sair", onclick: sair }),
      el("button", { className: "hub-bt hub-conta-bt", type: "button", title: u.nome, textContent: u.mestre ? "👑" : "👤", onclick: () => dialogoConta(u) })));
  nav.dataset.hub = "";
  gaveta = el("div", { className: "hub-fundo", hidden: true, onclick: fecharGaveta });
  gaveta.dataset.hub = "";
  document.body.prepend(nav, gaveta);
  document.documentElement.classList.add("com-nav");
  marcarAtiva();
});
document.addEventListener("keydown", (e) => { if (e.key === "Escape") fecharGaveta(); });
// PWA: instalável e abre offline o que já foi visto (sw.js = cache primeiro pra css/js/dados fixos)
if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
