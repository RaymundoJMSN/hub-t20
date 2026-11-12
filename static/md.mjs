// md.mjs — o Markdown das respostas do Arauto virando HTML seguro (tudo é escapado antes; só nascem as tags daqui).
// Cobre o que o Arauto escreve: títulos, listas, negrito/itálico, `código`, --- e links.
// Link pra item do acervo ([Atlético](d:atletico), (o:velocidade), (c:itens/espada-longa)) vira <a data-carta="…">: a página abre a carta.
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
/** id de carta → endereço da página (pro link funcionar também fora do hub: Matrix, copiar e colar). */
export const hrefDaCarta = (id) => id[0] === "c" ? "/c/" + id.slice(2) : `/${id[0]}/${id.slice(2)}`;

function emLinha(t) {
  return esc(t)
    .replace(/\[([^\]\n]+)\]\(((?:d|o|c):[\w\-/.]+)\)/g, (_, rot, id) => `<a class="q-link" data-carta="${id}" href="${hrefDaCarta(id)}">${rot}</a>`)
    .replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
    .replace(/\[([^\]\n]+)\]\((?:[^()\s]|\([^()\s]*\))*\)/g, "$1") // qualquer outro destino (javascript:alert(1), id inventado): fica só o texto
    .replace(/`([^`\n]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*\n]+)\*\*/g, "<b>$1</b>")
    .replace(/(^|[\s(])\*([^*\s][^*\n]*?)\*(?=[\s).,;:!?]|$)/g, "$1<i>$2</i>");
}

export function md(texto) {
  const out = [];
  let lista = null, par = [];
  const fechaPar = () => { if (par.length) { out.push(`<p>${par.join("<br>")}</p>`); par = []; } };
  const fechaLista = () => { if (lista) { out.push(`</${lista}>`); lista = null; } };
  for (const bruta of String(texto ?? "").replace(/\r/g, "").split("\n")) {
    const l = bruta.trimEnd();
    let m;
    if (!l.trim()) { fechaPar(); fechaLista(); continue; }
    if ((m = l.match(/^(#{1,4})\s+(.+)$/))) { fechaPar(); fechaLista(); out.push(`<h${Math.min(6, m[1].length + 2)}>${emLinha(m[2])}</h${Math.min(6, m[1].length + 2)}>`); continue; }
    if (/^\s*(-{3,}|\*{3,})\s*$/.test(l)) { fechaPar(); fechaLista(); out.push("<hr>"); continue; }
    if ((m = l.match(/^\s*([-*•]|\d+[.)])\s+(.+)$/))) {
      const tipo = /\d/.test(m[1]) ? "ol" : "ul";
      fechaPar();
      if (lista !== tipo) { fechaLista(); out.push(`<${tipo}>`); lista = tipo; }
      out.push(`<li>${emLinha(m[2])}</li>`);
      continue;
    }
    fechaLista();
    par.push(emLinha(l.replace(/^>\s?/, "")));
  }
  fechaPar(); fechaLista();
  return out.join("\n");
}

// self-test: node static/md.mjs --check
if (typeof process !== "undefined" && process.argv?.[1]?.replace(/\\/g, "/").endsWith("static/md.mjs") && process.argv.includes("--check")) {
  const eq = (a, b, m) => { if (a !== b) { console.error("FALHOU:", m, "\n  veio:", a, "\n  esperava:", b); process.exitCode = 1; } };
  eq(md("## Raças\n- **Elfo**: 12m ([Graça](d:graca))\n- item 2\n\nTexto *leve* e `código`.\nSegunda linha."),
    '<h4>Raças</h4>\n<ul>\n<li><b>Elfo</b>: 12m (<a class="q-link" data-carta="d:graca" href="/d/graca">Graça</a>)</li>\n<li>item 2</li>\n</ul>\n<p>Texto <i>leve</i> e <code>código</code>.<br>Segunda linha.</p>', "título, lista, link de carta, ênfase");
  eq(md("1. um\n2. dois"), "<ol>\n<li>um</li>\n<li>dois</li>\n</ol>", "lista numerada");
  eq(md('<img src=x onerror=alert(1)> [clique](javascript:alert(1)) [ok](https://exemplo.com/a?b=1)'),
    '<p>&lt;img src=x onerror=alert(1)&gt; clique <a href="https://exemplo.com/a?b=1" target="_blank" rel="noopener">ok</a></p>', "HTML escapado e link perigoso vira texto");
  eq(md("[Espada](c:itens/espada-longa) e [Luz](o:luz)"), '<p><a class="q-link" data-carta="c:itens/espada-longa" href="/c/itens/espada-longa">Espada</a> e <a class="q-link" data-carta="o:luz" href="/o/luz">Luz</a></p>', "coleção e magia");
  eq(md("2 * 3 * 4 e 5*6"), "<p>2 * 3 * 4 e 5*6</p>", "asterisco solto não vira itálico");
  if (!process.exitCode) console.log("md.mjs --check OK");
}
