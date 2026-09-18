// hub.js — barra de abas do Hub em toda página + quem está logado (sair / trocar senha).
// Sem sessão a API devolve 401 → manda pra tela de login guardando o destino.
export const el = (tag, props = {}, ...filhos) => {
  const n = Object.assign(document.createElement(tag), props);
  n.append(...filhos.filter((f) => f != null));
  return n;
};
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

function ativa() {
  const p = location.pathname;
  if (/^\/[mod](\/|$)/.test(p)) return "/";
  const c = p.match(/^\/c\/([\w-]+)/);
  if (c) return paginaDaColecao(c[1]) || "/";
  return ABAS.find(([h]) => h !== "/" && p.startsWith(h))?.[0] || (p === "/" ? "/" : "");
}

async function trocarSenha() {
  const dlg = el("dialog", { className: "hub-dialog" });
  const atual = el("input", { type: "password", placeholder: "senha atual", required: true, autocomplete: "current-password" });
  const nova = el("input", { type: "password", placeholder: "senha nova (mín. 4)", required: true, minLength: 4, autocomplete: "new-password" });
  const msg = el("div", { className: "explica" });
  const form = el("form", { method: "dialog" }, el("h3", { textContent: "Trocar senha" }), atual, nova, msg,
    el("div", { className: "acoes" }, el("button", { className: "bt", type: "button", textContent: "cancelar", onclick: () => dlg.close() }), el("button", { className: "bt destaque", textContent: "salvar" })));
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
    el("div", { className: "hub-abas" }, ...ABAS.map(aba)),
    el("div", { className: "hub-eu" },
      el("span", { className: "hub-nome", title: u.personagem ? `${u.nome} · ${u.personagem}` : u.nome }, el("b", { textContent: u.nome }), u.personagem ? el("span", { className: "hub-pers", textContent: " · " + u.personagem }) : null),
      u.mestre ? el("a", { href: "/mestre", className: "bt mini" + (at === "/mestre" || location.pathname === "/mestre" ? " on" : ""), textContent: "👑 mestre" }) : null,
      el("button", { className: "bt mini", textContent: "senha", onclick: trocarSenha }),
      el("button", { className: "bt mini", textContent: "sair", onclick: async () => { await fetch("/api/sair", { method: "POST" }); location.href = "/login"; } })));
  document.body.prepend(nav);
  document.documentElement.classList.add("com-nav");
  // aba ativa visível na barra rolável do celular
  nav.querySelector(".hub-abas a.on")?.scrollIntoView({ inline: "center", block: "nearest" });
});
// PWA: instalável e abre offline o que já foi visto (sw.js = rede primeiro)
if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
