// hub.js — barra de abas do Hub em toda página + quem está logado (senha / sair).
// O CSS da barra é o nav.css (injetado daqui), autocontido: páginas com CSS próprio (agenda, missões) não mudam.
// Sem sessão a API devolve 401 → manda pra tela de login guardando o destino.
export const el = (tag, props = {}, ...filhos) => {
  const n = Object.assign(document.createElement(tag), props);
  n.append(...filhos.filter((f) => f != null));
  return n;
};
document.head.append(el("link", { rel: "stylesheet", href: "/nav.css" }));

// [rota, "emoji Rótulo", externo?] — no celular a barra fica embaixo (emoji em cima, rótulo embaixo)
export const ABAS = [["/", "📖 Grimório"], ["/criar", "✦ Criar magia"], ["/bestiario", "🐉 Bestiário"], ["/itens", "🎒 Itens"], ["/regras", "⚖️ Regras"],
  ["/compendio", "🏛️ Compêndio"], ["/missoes", "📜 Missões"], ["/agenda", "📅 Agenda"], ["/links", "🎲 Mesa"], ["https://ficha.raynathus.com.br", "🧾 Ficha", true]];
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

function ativa() {
  const p = location.pathname;
  if (/^\/[mod](\/|$)/.test(p)) return "/";
  const c = p.match(/^\/c\/([\w-]+)/);
  if (c) return paginaDaColecao(c[1]) || "/";
  return ABAS.find(([h]) => h !== "/" && p.startsWith(h))?.[0] || (p === "/" ? "/" : "");
}

// diálogo da conta: trocar senha + sair (+ painel do mestre); no celular é o único acesso a isso
function dialogoConta(u) {
  const dlg = el("dialog", { className: "hub-dialog" });
  const atual = el("input", { type: "password", placeholder: "senha atual", required: true, autocomplete: "current-password" });
  const nova = el("input", { type: "password", placeholder: "senha nova (mín. 4)", required: true, minLength: 4, autocomplete: "new-password" });
  const msg = el("div", { className: "hub-msg" });
  const form = el("form", { method: "dialog" },
    el("h3", { textContent: "Sua conta" }),
    el("div", { className: "hub-quem" }, el("b", { textContent: u.nome }), u.personagem ? ` · ${u.personagem}` : "", u.mestre ? " · mestre" : ""),
    atual, nova, msg,
    el("div", { className: "hub-acoes" },
      u.mestre ? el("a", { className: "hub-bt", href: "/mestre", textContent: "👑 painel do mestre" }) : null,
      el("button", { className: "hub-bt", type: "button", textContent: "sair", onclick: sair }),
      el("button", { className: "hub-bt", type: "button", textContent: "fechar", onclick: () => dlg.close() }),
      el("button", { className: "hub-bt destaque", textContent: "trocar senha" })));
  form.onsubmit = async (e) => {
    e.preventDefault();
    const r = await (await fetch("/api/senha", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ atual: atual.value, nova: nova.value }) })).json();
    if (r.ok) { msg.textContent = "senha trocada ✓"; setTimeout(() => dlg.close(), 700); } else msg.textContent = r.erro || "erro";
  };
  dlg.append(form);
  document.body.append(dlg);
  dlg.showModal();
  dlg.addEventListener("close", () => dlg.remove());
}

eu.then((u) => {
  const at = ativa();
  const aba = ([href, rot, externo]) => {
    const [emoji, ...resto] = rot.split(" ");
    return el("a", { href, className: href === at ? "on" : "", target: externo ? "_blank" : "", rel: externo ? "noopener" : "", title: rot },
      el("span", { className: "hub-emoji", textContent: emoji }), el("span", { className: "hub-rotulo", textContent: resto.join(" ") }));
  };
  const nav = el("nav", { className: "hub-nav" },
    el("div", { className: "hub-abas" }, ...ABAS.map(aba),
      // só aparece no celular (nav.css): a conta como último item da barra
      el("a", { href: "#", className: "hub-conta", title: u.nome, onclick: (e) => { e.preventDefault(); dialogoConta(u); } },
        el("span", { className: "hub-emoji", textContent: u.mestre ? "👑" : "👤" }), el("span", { className: "hub-rotulo", textContent: u.nome.split(" ")[0] }))),
    el("div", { className: "hub-eu" },
      el("span", { className: "hub-nome", title: u.personagem ? `${u.nome} · ${u.personagem}` : u.nome }, el("b", { textContent: u.nome }), u.personagem ? el("span", { className: "hub-pers", textContent: " · " + u.personagem }) : null),
      u.mestre ? el("a", { href: "/mestre", className: "hub-bt" + (location.pathname === "/mestre" ? " on" : ""), textContent: "👑 mestre" }) : null,
      el("button", { className: "hub-bt", textContent: "senha", onclick: () => dialogoConta(u) }),
      el("button", { className: "hub-bt", textContent: "sair", onclick: sair })));
  document.body.prepend(nav);
  document.documentElement.classList.add("com-nav");
  nav.querySelector(".hub-abas a.on")?.scrollIntoView({ inline: "center", block: "nearest" });
});
// PWA: instalável e abre offline o que já foi visto (sw.js = rede primeiro)
if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
