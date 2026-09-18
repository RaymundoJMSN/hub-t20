// Hub T20 — um servidor só (Node puro, sem dependências) pra mesa inteira:
// grimório/criador de magias (herdado do criador-magias), bestiário, itens, regras (livros + STR),
// compêndio, missões, agenda, links — tudo atrás de login com senha.
// node server.mjs [--check] | PORT=8100
// node server.mjs --usuario "Nome" senha [jogador|mestre] ["Personagem"]   → cria/atualiza conta
import http from "node:http";
import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync, copyFileSync, readdirSync, unlinkSync } from "node:fs";
import { join, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes, createHmac, scryptSync, timingSafeEqual } from "node:crypto";
import { calcular } from "./static/custo.mjs";
import { esc, htmlParaTexto, ROTULOS } from "./static/carta.mjs";
import { tipoDePocao, tipoDePocaoDosEixos } from "./static/pocao.mjs";
import { eixosDe } from "./static/eixos.mjs";

// a magia da mesa vira a mesma linha técnica das oficiais, pra cair no mesmo parser
function eixosDaMesa(e = {}) {
  const r = e.resistencia;
  return eixosDe(ROTULOS.execucao[e.execucao], ROTULOS.alcance[e.alcance],
    !r || r === "nenhuma" ? "nenhuma" : `${e.teste || ""} ${ROTULOS.resistencia[r] || ""}`);
}

const RAIZ = dirname(fileURLToPath(import.meta.url));
const DADOS = join(RAIZ, "dados");
const ARQ = join(DADOS, "estado.json");
const TABELA = JSON.parse(readFileSync(join(RAIZ, "data", "tabela-custos.json")));
const PORT = Number(process.env.PORT || 8100);

const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".webmanifest": "application/manifest+json", ".ttf": "font/ttf", ".otf": "font/otf", ".woff2": "font/woff2" };
const MAX_MAGIAS = 200, MAX_BODY = 512 * 1024, MAX_NOME = 40;
const CHECK = process.argv.includes("--check");

// ---------------------------------------------------------------- arquivos json (escrita atômica, backup diário do estado)
function lerJson(arq, padrao) { try { return JSON.parse(readFileSync(arq, "utf-8")); } catch { return padrao; } }
function gravarJson(arq, obj) {
  if (CHECK) return; // self-test não toca disco
  mkdirSync(dirname(arq), { recursive: true });
  const tmp = arq + ".tmp";
  writeFileSync(tmp, JSON.stringify(obj));
  renameSync(tmp, arq);
}

function carregar() { return normalizarEstado(lerJson(ARQ, { usuarios: {}, publicadas: {} })); }
function normalizarEstado(d) {
  // migração: "Amanda" e "amanda" eram contas separadas -> mesclar por nome normalizado
  const u = {};
  for (const [k, magias] of Object.entries(d.usuarios || {})) {
    const nk = normNome(k);
    u[nk] = u[nk] || [];
    for (const m of magias) if (!m.id || !u[nk].some((x) => x.id === m.id)) u[nk].push(m);
  }
  d.usuarios = u;
  d.publicadas = d.publicadas || {};
  return d;
}
let estado = CHECK ? { usuarios: {}, publicadas: {} } : carregar();

function salvar() {
  if (CHECK) return;
  mkdirSync(DADOS, { recursive: true });
  const hoje = new Date().toISOString().slice(0, 10);
  const bk = join(DADOS, `backup-${hoje}.json`);
  if (existsSync(ARQ) && !existsSync(bk)) {
    copyFileSync(ARQ, bk);
    const bks = readdirSync(DADOS).filter((f) => f.startsWith("backup-")).sort();
    for (const velho of bks.slice(0, -7)) unlinkSync(join(DADOS, velho));
  }
  gravarJson(ARQ, estado);
}

function nomeOk(n) {
  return typeof n === "string" && n.trim().length >= 1 && n.length <= MAX_NOME && !/[\\/<>"]/.test(n);
}
// identidade: uma conta só, independente de maiúsculas ("Amanda" = "amanda" = "AMANDA")
// (function, não const: carregar() roda no topo do módulo antes desta linha)
function normNome(n) { return (n || "").trim().normalize("NFC").toLowerCase(); }
function mesmoDono(a, b) { return normNome(a) === normNome(b); }

// ---------------------------------------------------------------- contas e sessão
// dados/usuarios.json = { chave: { nome, papel: "jogador"|"mestre", personagem, sal, hash } }
// senha: scrypt; sessão: cookie "hub" = base64url({n: chave, e: expira}) + "." + HMAC(segredo) — sem tabela de sessões
const ARQ_USU = join(DADOS, "usuarios.json");
let usuarios = CHECK ? {} : lerJson(ARQ_USU, {});
const ARQ_SEG = join(DADOS, "segredo");
let segredo = CHECK ? "segredo-de-teste" : lerTexto(ARQ_SEG);
function lerTexto(arq) { try { return readFileSync(arq, "utf-8").trim(); } catch { return ""; } }
if (!segredo) { segredo = randomBytes(32).toString("hex"); if (!CHECK) { mkdirSync(DADOS, { recursive: true }); writeFileSync(ARQ_SEG, segredo); } }

const hashSenha = (senha, sal) => scryptSync(String(senha), sal, 32).toString("hex");
function definirUsuario({ nome, senha, papel, personagem }) {
  const chave = normNome(nome);
  const u = usuarios[chave] || { nome: nome.trim(), criadoEm: new Date().toISOString() };
  if (senha) { u.sal = randomBytes(16).toString("hex"); u.hash = hashSenha(senha, u.sal); }
  if (papel) u.papel = papel === "mestre" ? "mestre" : "jogador";
  if (!u.papel) u.papel = "jogador";
  if (personagem != null) u.personagem = String(personagem).trim().slice(0, 60);
  usuarios[chave] = u;
  gravarJson(ARQ_USU, usuarios);
  return u;
}
function conferirSenha(u, senha) {
  if (!u?.hash) return false;
  const a = Buffer.from(hashSenha(senha, u.sal), "hex"), b = Buffer.from(u.hash, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}
const b64 = (s) => Buffer.from(s).toString("base64url");
const assinar = (s) => createHmac("sha256", segredo).update(s).digest("base64url");
function tokenDe(chave) { const corpo = b64(JSON.stringify({ n: chave, e: Date.now() + 365 * 864e5 })); return `${corpo}.${assinar(corpo)}`; }
function sessaoDe(req) {
  const m = /(?:^|;\s*)hub=([\w-]+)\.([\w-]+)/.exec(req.headers.cookie || "");
  if (!m) return null;
  const a = Buffer.from(assinar(m[1])), b = Buffer.from(m[2]);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const { n, e } = JSON.parse(Buffer.from(m[1], "base64url").toString());
    return e > Date.now() && usuarios[n] ? { chave: n, ...usuarios[n] } : null;
  } catch { return null; }
}
const cookieSessao = (req, valor, maxAge) =>
  `hub=${valor}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${/^(localhost|127\.0\.0\.1)(:|$)/.test(req.headers.host || "") ? "" : "; Secure"}`;
const publico = (u) => u && { nome: u.nome, papel: u.papel, personagem: u.personagem || "", criadoEm: u.criadoEm };
// freio de força bruta por IP: 8 erros → 60 s de espera
const erros = new Map();
function bloqueado(ip) { const e = erros.get(ip); return e && e.n >= 8 && Date.now() - e.em < 60_000; }
function errou(ip) { const e = erros.get(ip) || { n: 0 }; erros.set(ip, { n: (Date.now() - (e.em || 0) < 60_000 ? e.n : 0) + 1, em: Date.now() }); }
const ipDe = (req) => req.headers["x-real-ip"] || req.socket.remoteAddress || "?";

// ---------------------------------------------------------------- coleções (dados/colecoes/<nome>.json, geradas por tools/importar.mjs)
const colecoes = { cache: {} };
function carregarColecao(nome) {
  nome = String(nome).replace(/[^\w-]/g, "");
  if (!(nome in colecoes.cache)) {
    const c = lerJson(join(DADOS, "colecoes", `${nome}.json`), null);
    if (c) c.porId = new Map(c.itens.map((i) => [i.id, i]));
    colecoes.cache[nome] = c;
  }
  return colecoes.cache[nome];
}
const resumo = ({ id, nome, linha, grupo, f }) => ({ id, nome, linha, grupo, f });

// ---------------------------------------------------------------- missões, agenda, links (json simples em dados/)
const ARQ_MIS = join(DADOS, "missoes.json"), ARQ_AGE = join(DADOS, "agenda.json"), ARQ_LINKS = join(DADOS, "links.json");
let missoes = CHECK ? { missoes: [], votos: {} } : lerJson(ARQ_MIS, { missoes: [], votos: {} });
let agenda = CHECK ? { users: {} } : lerJson(ARQ_AGE, { users: {} });
const LINKS_PADRAO = {
  grupos: [
    { titulo: "Jogar", links: [
      { nome: "Foundry VTT", url: "https://foundry.raynathus.com.br", desc: "a mesa: onde o jogo acontece", icone: "🎲" },
      { nome: "Call (Papinho)", url: "https://chat.raynathus.com.br", desc: "voz e chat da mesa", icone: "🎧" },
      { nome: "Agenda", url: "/agenda", desc: "marque os dias em que pode jogar", icone: "📅" },
      { nome: "Missões", url: "/missoes", desc: "quadro da guilda: vote no que quer fazer", icone: "📜" }] },
    { titulo: "Ferramentas", links: [
      { nome: "Arena Imperial", url: "https://arena.raynathus.com.br", desc: "montar e balancear encontros por ND", icone: "⚔️" },
      { nome: "Cenas", url: "https://cenas.raynathus.com.br", desc: "mapas e cenas do acervo", icone: "🗺️" },
      { nome: "Caseiro", url: "https://caseiro.raynathus.com.br", desc: "documentos com cara de livro de T20", icone: "📖" },
      { nome: "Criador de ficha", url: "https://ficha.raynathus.com.br", desc: "ficha passo a passo (antigo)", icone: "🧾" },
      { nome: "Draw", url: "https://draw.raynathus.com.br", desc: "quadro branco (Excalidraw)", icone: "✏️" }] },
    { titulo: "Baixar", links: [
      { nome: "FLC (Foundry Lightweight Client)", url: "https://tools.ruleplaying.com/flc", desc: "cliente leve do Foundry pra PC", icone: "💻" },
      { nome: "FLC Mobile (Android)", url: "https://github.com/RaymundoJMSN/flc-mobile/releases/latest", desc: "APK do Foundry pra celular, feito pela mesa", icone: "📱" },
      { nome: "App da call", url: "https://chat.raynathus.com.br", desc: "abre no navegador; instale como app pelo menu do navegador", icone: "🎙️" }] },
  ],
};
let links = CHECK ? LINKS_PADRAO : lerJson(ARQ_LINKS, LINKS_PADRAO);

function validarMagia(m) {
  if (typeof m !== "object" || !m) return "magia inválida";
  if (!nomeOk(m.nome || "x")) return "nome inválido";
  if (JSON.stringify(m).length > 20_000) return "magia grande demais";
  if (![1, 2, 3, 4, 5].includes(m.circulo || 1)) return "círculo deve ser 1 a 5";
  try { m.pontos = { gasto: calcular(m, TABELA).total, orcamento: TABELA.orcamento[String(m.circulo || 1)] }; }
  catch { return "estrutura de eixos/efeitos inválida"; }
  return null;
}

function json(res, code, obj, extra = {}) {
  const b = JSON.stringify(obj);
  res.writeHead(code, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...extra });
  res.end(b);
}

function corpo(req) {
  return new Promise((ok, err) => {
    let b = "";
    req.on("data", (c) => { b += c; if (b.length > MAX_BODY) { err(new Error("grande")); req.destroy(); } });
    req.on("end", () => { try { ok(b ? JSON.parse(b) : {}); } catch { err(new Error("json")); } });
  });
}

function estatico(res, caminho) {
  try {
    const c = readFileSync(caminho);
    const ext = extname(caminho);
    res.writeHead(200, { "content-type": MIME[ext] || "application/octet-stream", "cache-control": /\.(ttf|otf|woff2|png)$/.test(ext) ? "public, max-age=604800" : "no-cache" });
    res.end(c);
  } catch { res.writeHead(404); res.end("404"); }
}
const pagina = (nome) => join(RAIZ, "static", nome);
// título/descrição pro link ficar bonito no WhatsApp/Discord (a carta em si só abre depois do login)
function htmlComOg(arquivo, titulo, desc, site) {
  let html = readFileSync(pagina(arquivo), "utf-8");
  if (titulo) html = html.replace(/<title>.*<\/title>/, `<title>${esc(titulo)} — ${site}</title>`)
    .replace('<meta name="description"', `<meta property="og:title" content="${esc(titulo)}"><meta property="og:description" content="${esc(desc)}"><meta property="og:site_name" content="${site}"><meta name="description"`);
  return html;
}
function responderHtml(res, html, code = 200) { res.writeHead(code, { "content-type": "text/html; charset=utf-8", "cache-control": "no-cache" }); res.end(html); }
const redirecionar = (res, para) => { res.writeHead(302, { location: para }); res.end(); };

// o que cada link compartilhável abre (pra montar o Open Graph sem exigir login)
function alvoDaRota(p) {
  const r = p.match(/^\/([mod])\/([\w-]+)/);
  if (r) {
    const id = r[2];
    if (r[1] === "m") { const m = estado.publicadas[id.replace(/[^a-f0-9]/g, "")]; return m && [m.nome, `${m.escola} (${m.tipo}) — ${m.circulo || 1}º círculo. ${htmlParaTexto(m.descricao || "")}`, "Grimório T20"]; }
    const t = (r[1] === "d" ? carregarPoderes() : carregarTextos())[id.replace(/[^\w-]/g, "")];
    return t && [t.nome, `${t.linha}. ${t.descricao || ""}`, "Grimório T20"];
  }
  const c = p.match(/^\/c\/([\w-]+)\/([\w-]+)/);
  if (c) { const it = carregarColecao(c[1])?.porId.get(c[2]); return it && [it.nome, it.linha, "Hub T20"]; }
  return null;
}
const PAGINAS = { "/": "grimorio.html", "/criar": "index.html", "/bestiario": "colecao.html", "/itens": "colecao.html", "/regras": "colecao.html", "/compendio": "colecao.html",
  "/missoes": "missoes.html", "/agenda": "agenda.html", "/links": "links.html", "/mestre": "mestre.html" };
// sem sessão só passa: login, css/fontes (a tela de login usa) e a API de login
const livre = (p) => p === "/login" || p === "/api/login" || p === "/style.css" || p.startsWith("/fontes/") || p === "/favicon.ico" || p === "/manifest.webmanifest";

async function tratar(req, res) {
  const url = new URL(req.url, "http://x");
  const p = url.pathname;
  const eu = sessaoDe(req);

  if (p === "/api/login" && req.method === "POST") {
    const ip = ipDe(req);
    if (bloqueado(ip)) return json(res, 429, { erro: "muitas tentativas — espere um minuto" });
    let b;
    try { b = await corpo(req); } catch { return json(res, 400, { erro: "corpo inválido" }); }
    const u = usuarios[normNome(b.nome)];
    if (!u || !conferirSenha(u, String(b.senha ?? ""))) { errou(ip); return json(res, 401, { erro: "nome ou senha errados" }); }
    return json(res, 200, { ok: true, eu: publico(u) }, { "set-cookie": cookieSessao(req, tokenDe(normNome(b.nome)), 365 * 86400) });
  }
  if (p === "/login") {
    if (eu) return redirecionar(res, url.searchParams.get("voltar") || "/");
    return estatico(res, pagina("login.html"));
  }
  if (!eu && !livre(p)) {
    if (p.startsWith("/api/")) return json(res, 401, { erro: "entre primeiro" });
    // página → tela de login já com o destino guardado (e Open Graph do link, se for carta)
    const og = alvoDaRota(p);
    let html = htmlComOg("login.html", og?.[0], og?.[1], og?.[2] || "Hub T20");
    html = html.replace("</head>", `<script>window.VOLTAR=${JSON.stringify(p + url.search)}</script></head>`);
    return responderHtml(res, html, 200);
  }
  if (p === "/api/sair" && req.method === "POST") return json(res, 200, { ok: true }, { "set-cookie": cookieSessao(req, "x", 0) });
  if (p === "/api/eu") return json(res, 200, { ...publico(eu), mestre: eu.papel === "mestre" });
  if (p === "/api/senha" && req.method === "POST") {
    let b;
    try { b = await corpo(req); } catch { return json(res, 400, { erro: "corpo inválido" }); }
    if (!conferirSenha(usuarios[eu.chave], String(b.atual ?? ""))) return json(res, 403, { erro: "senha atual errada" });
    if (String(b.nova || "").length < 4) return json(res, 400, { erro: "senha nova curta demais (mínimo 4)" });
    definirUsuario({ nome: eu.nome, senha: String(b.nova) });
    return json(res, 200, { ok: true });
  }
  // ---- painel do mestre: contas
  if (p.startsWith("/api/usuarios")) {
    if (eu.papel !== "mestre") return json(res, 403, { erro: "só o mestre" });
    if (req.method === "GET") return json(res, 200, { usuarios: Object.values(usuarios).map(publico) });
    let b;
    try { b = await corpo(req); } catch { return json(res, 400, { erro: "corpo inválido" }); }
    if (p === "/api/usuarios/apagar") {
      const chave = normNome(b.nome);
      if (chave === eu.chave) return json(res, 400, { erro: "não dá pra apagar a si mesmo" });
      delete usuarios[chave]; gravarJson(ARQ_USU, usuarios);
      return json(res, 200, { ok: true });
    }
    if (!nomeOk(b.nome)) return json(res, 400, { erro: "nome inválido" });
    if (!usuarios[normNome(b.nome)] && String(b.senha || "").length < 4) return json(res, 400, { erro: "conta nova precisa de senha (mínimo 4)" });
    if (normNome(b.nome) === eu.chave && b.papel && b.papel !== "mestre") return json(res, 400, { erro: "você não pode se rebaixar" });
    return json(res, 200, { ok: true, usuario: publico(definirUsuario({ nome: b.nome, senha: b.senha || "", papel: b.papel, personagem: b.personagem })) });
  }

  // ---- grimório / criador (dono = quem está logado; o nome no caminho/corpo é ignorado)
  if (p === "/api/state" && req.method === "GET") {
    return json(res, 200, {
      minhas: estado.usuarios[eu.chave] || [],
      publicadas: Object.entries(estado.publicadas).map(([id, m]) => ({ ...m, id })),
    });
  }
  if (p.startsWith("/api/user/") && req.method === "PUT") {
    const nome = eu.nome, chave = eu.chave;
    let b;
    try { b = await corpo(req); } catch { return json(res, 400, { erro: "corpo inválido" }); }
    const magias = Array.isArray(b.magias) ? b.magias.slice(0, MAX_MAGIAS) : null;
    if (!magias) return json(res, 400, { erro: "esperado {magias:[...]}" });
    for (const m of magias) {
      const e = validarMagia(m);
      if (e) return json(res, 400, { erro: `${m?.nome || "?"}: ${e}` });
    }
    estado.usuarios[chave] = magias;
    // magia publicada É a mesma magia: editar a sua atualiza a publicada, apagar despublica
    const idsAgora = new Set(magias.map((m) => m.id).filter(Boolean));
    for (const [id, pub] of Object.entries(estado.publicadas)) {
      if (!mesmoDono(pub.autor, nome)) continue;
      if (!idsAgora.has(id)) delete estado.publicadas[id];
    }
    for (const m of magias) {
      const pub = m.id && estado.publicadas[m.id];
      if (pub && mesmoDono(pub.autor, nome)) estado.publicadas[m.id] = { ...m, autor: pub.autor, publicadaEm: pub.publicadaEm };
    }
    salvar();
    return json(res, 200, { ok: true, n: magias.length });
  }
  if (p === "/api/publicar" && req.method === "POST") {
    let b;
    try { b = await corpo(req); } catch { return json(res, 400, { erro: "corpo inválido" }); }
    const autor = eu.nome, { magia } = b;
    const e = validarMagia(magia);
    if (e) return json(res, 400, { erro: e });
    const limiteAval = magia.pontos.orcamento + Math.max(1, Math.round(magia.pontos.orcamento * (TABELA.aval_mestre_pct ?? 0.15)));
    if (magia.pontos.gasto > limiteAval) return json(res, 400, { erro: "estourou além da margem do mestre — só rascunho" });
    const id = typeof magia.id === "string" && /^[a-f0-9]{6,16}$/.test(magia.id) ? magia.id : randomBytes(4).toString("hex");
    const jaTem = estado.publicadas[id];
    if (jaTem && !mesmoDono(jaTem.autor, autor)) return json(res, 403, { erro: "essa magia é de outra pessoa" });
    estado.publicadas[id] = { ...magia, id, autor, publicadaEm: jaTem?.publicadaEm || new Date().toISOString() };
    salvar();
    return json(res, 200, { ok: true, id });
  }
  if (p === "/api/despublicar" && req.method === "POST") {
    let b;
    try { b = await corpo(req); } catch { return json(res, 400, { erro: "corpo inválido" }); }
    const m = estado.publicadas[b.id];
    if (!m) return json(res, 404, { erro: "não existe" });
    if (!mesmoDono(m.autor, eu.nome) && eu.papel !== "mestre") return json(res, 403, { erro: "só o autor (ou o mestre) despublica" });
    delete estado.publicadas[b.id];
    salvar();
    return json(res, 200, { ok: true });
  }
  if (p.startsWith("/api/magia/") && req.method === "GET") {
    const m = estado.publicadas[p.slice("/api/magia/".length)];
    return m ? json(res, 200, m) : json(res, 404, { erro: "não existe" });
  }
  if (p.startsWith("/api/texto/") && req.method === "GET") {
    const t = carregarTextos()[p.slice("/api/texto/".length).replace(/[^\w-]/g, "")];
    return t ? json(res, 200, t) : json(res, 404, { erro: "sem texto no servidor" });
  }
  // grimório: lista leve (oficiais + publicadas). Busca = toda palavra precisa bater (AND), cada uma com sinônimos (OR)
  if (p === "/api/grimorio" && req.method === "GET") {
    const textos = carregarTextos();
    const termos = termosBusca(url.searchParams.get("q"));
    const bate = (blob) => termos.every((alts) => alts.some((t) => blob.includes(t)));
    const oficiais = Object.entries(textos)
      .filter(([, t]) => bate(blobDe(t)))
      .map(([slug, t]) => ({ slug, nome: t.nome, escola: t.escola, grupo: t.grupo, circulo: t.circulo, pocao: tipoDePocao(t.stats?.["Alvo/Área"]),
        ...eixosDe(t.stats?.["Execução"], t.stats?.["Alcance"], t.stats?.["Resistência"]) }));
    const publicadas = Object.entries(estado.publicadas)
      .filter(([, m]) => bate(norm([m.nome, htmlParaTexto(m.descricao), m.escola, m.tipo, (m.aprimoramentos || []).map((a) => a.texto).join(" "), JSON.stringify(m.eixos || {})].join(" "))))
      .map(([id, m]) => ({ id, nome: m.nome, escola: m.escola, grupo: m.tipo, circulo: m.circulo || 1, autor: m.autor, pontos: m.pontos, pocao: tipoDePocaoDosEixos(m.eixos?.alvo),
        ...eixosDaMesa(m.eixos) }));
    return json(res, 200, { oficiais, publicadas });
  }
  if (p === "/api/poderes" && req.method === "GET") {
    const termos = termosBusca(url.searchParams.get("q"));
    const poderes = Object.entries(carregarPoderes())
      .filter(([, t]) => termos.every((alts) => alts.some((x) => blobDe(t).includes(x))))
      .map(([slug, t]) => ({ slug, nome: t.nome, categoria: t.categoria, sub: t.sub, livro: t.livro, custo: t.custo }));
    return json(res, 200, { poderes });
  }
  if (p.startsWith("/api/poder/") && req.method === "GET") {
    const t = carregarPoderes()[p.slice("/api/poder/".length).replace(/[^\w-]/g, "")];
    return t ? json(res, 200, t) : json(res, 404, { erro: "sem texto no servidor" });
  }
  if (p === "/api/sugestoes-apr" && req.method === "POST") {
    if (!tratar.aprs) tratar.aprs = lerJson(join(DADOS, "aprimoramentos.json"), []);
    let f;
    try { f = await corpo(req); } catch { return json(res, 400, { erro: "corpo inválido" }); }
    return json(res, 200, { sugestoes: sugerirAprimoramentos(f, tratar.aprs) });
  }

  // ---- coleções: /api/c/<nome>?q=  (lista leve)  |  /api/c/<nome>/<id>  (ficha completa)
  const c = p.match(/^\/api\/c\/([\w-]+)(?:\/([\w-]+))?$/);
  if (c && req.method === "GET") {
    const col = carregarColecao(c[1]);
    if (!col) return json(res, 404, { erro: "coleção não existe no servidor" });
    if (c[2]) { const it = col.porId.get(c[2]); return it ? json(res, 200, it) : json(res, 404, { erro: "não existe" }); }
    const termos = termosBusca(url.searchParams.get("q"));
    const itens = termos.length ? col.itens.filter((i) => termos.every((alts) => alts.some((t) => i.t.includes(t)))) : col.itens;
    return json(res, 200, { meta: col.meta, itens: itens.map(resumo) });
  }
  if (p === "/api/colecoes") return json(res, 200, lerJson(join(DADOS, "colecoes", "INDEX.json"), { contagem: {} }));

  // ---- missões (quadro da guilda): voto = personagem de quem está logado (ou o nome)
  if (p === "/api/missoes" && req.method === "GET") return json(res, 200, { ...missoes, eu: eu.personagem || eu.nome });
  if (p === "/api/missoes" && req.method === "PUT") {
    if (eu.papel !== "mestre") return json(res, 403, { erro: "só o mestre edita o quadro" });
    let b;
    try { b = await corpo(req); } catch { return json(res, 400, { erro: "corpo inválido" }); }
    if (!Array.isArray(b.missoes) || b.missoes.length > 200) return json(res, 400, { erro: "esperado {missoes:[...]}" });
    const lista = [];
    for (const m of b.missoes) {
      if (!m || !nomeOk(String(m.titulo || "").slice(0, MAX_NOME) || "x") || !String(m.titulo || "").trim()) return json(res, 400, { erro: "missão sem título" });
      const id = /^[\w-]{1,80}$/.test(m.id || "") ? m.id : slug(m.titulo);
      lista.push({ id, titulo: String(m.titulo).slice(0, 120), solicitante: String(m.solicitante || "").slice(0, 120), local: String(m.local || "").slice(0, 120),
        descricao: String(m.descricao || "").slice(0, 2000), perigo: Math.min(5, Math.max(1, Number(m.perigo) || 1)), recompensa: String(m.recompensa || "").slice(0, 120), concluida: !!m.concluida });
    }
    const ids = new Set(lista.map((m) => m.id));
    for (const id of Object.keys(missoes.votos)) if (!ids.has(id)) delete missoes.votos[id];
    missoes.missoes = lista;
    gravarJson(ARQ_MIS, missoes);
    return json(res, 200, { ok: true, n: lista.length });
  }
  if ((p === "/api/missoes/votar" || p === "/api/missoes/concluir") && req.method === "POST") {
    let b;
    try { b = await corpo(req); } catch { return json(res, 400, { erro: "corpo inválido" }); }
    const m = missoes.missoes.find((x) => x.id === b.id);
    if (!m) return json(res, 404, { erro: "missão não existe" });
    if (p.endsWith("concluir")) {
      if (eu.papel !== "mestre") return json(res, 403, { erro: "só o mestre conclui" });
      m.concluida = !!b.ligar;
      if (m.concluida) delete missoes.votos[m.id];
    } else {
      if (m.concluida) return json(res, 400, { erro: "missão já cumprida" });
      const quem = eu.personagem || eu.nome;
      missoes.votos[m.id] = missoes.votos[m.id] || {};
      if (b.ligar) missoes.votos[m.id][quem] = true; else delete missoes.votos[m.id][quem];
      if (!Object.keys(missoes.votos[m.id]).length) delete missoes.votos[m.id];
    }
    gravarJson(ARQ_MIS, missoes);
    return json(res, 200, { ok: true, ...missoes });
  }

  // ---- agenda (herdada do data-rpg): cada um só grava os próprios dias; a lista de nomes vem das contas
  if (p === "/api/agenda/state" && req.method === "GET") {
    const contas = Object.values(usuarios);
    return json(res, 200, { users: agenda.users, nomes: contas.map((u) => u.nome), mestre: contas.find((u) => u.papel === "mestre")?.nome || "", eu: eu.nome });
  }
  const ag = p.match(/^\/api\/agenda\/user\/([^/]+)$/);
  if (ag && (req.method === "PUT" || req.method === "POST")) { // POST = sendBeacon
    const nome = decodeURIComponent(ag[1]);
    if (!mesmoDono(nome, eu.nome) && eu.papel !== "mestre") return json(res, 403, { erro: "só os próprios dias" });
    let b;
    try { b = await corpo(req); } catch { return json(res, 400, { erro: "corpo inválido" }); }
    const dias = b?.days;
    if (!dias || typeof dias !== "object" || !Object.entries(dias).every(([k, v]) => /^\d{4}-\d{2}-\d{2}$/.test(k) && (v === "yes" || v === "no"))) return json(res, 400, { erro: "dias inválidos" });
    const dono = usuarios[normNome(nome)]?.nome || eu.nome;
    agenda.users[dono] = { days: dias, updatedAt: Number(b.updatedAt) || Date.now() };
    gravarJson(ARQ_AGE, agenda);
    return json(res, 200, { ok: true });
  }

  // ---- links (cards da página Mesa); o mestre edita
  if (p === "/api/links" && req.method === "GET") return json(res, 200, links);
  if (p === "/api/links" && req.method === "PUT") {
    if (eu.papel !== "mestre") return json(res, 403, { erro: "só o mestre" });
    let b;
    try { b = await corpo(req); } catch { return json(res, 400, { erro: "corpo inválido" }); }
    if (!Array.isArray(b.grupos)) return json(res, 400, { erro: "esperado {grupos:[{titulo, links:[{nome,url,desc,icone}]}]}" });
    links = { grupos: b.grupos.slice(0, 20).map((g) => ({ titulo: String(g.titulo || "").slice(0, 60),
      links: (g.links || []).slice(0, 40).map((l) => ({ nome: String(l.nome || "").slice(0, 80), url: String(l.url || "").slice(0, 500), desc: String(l.desc || "").slice(0, 200), icone: String(l.icone || "").slice(0, 8) })) })) };
    gravarJson(ARQ_LINKS, links);
    return json(res, 200, { ok: true });
  }

  // ---- páginas
  if (p.startsWith("/m/") || p.startsWith("/o/") || p.startsWith("/d/") || p.startsWith("/c/")) {
    const og = alvoDaRota(p);
    return responderHtml(res, htmlComOg(p.startsWith("/c/") ? "colecao.html" : "grimorio.html", og?.[0], og?.[1], og?.[2] || "Hub T20"), og ? 200 : 404);
  }
  if (p === "/mestre" && eu.papel !== "mestre") return redirecionar(res, "/");
  if (PAGINAS[p]) return estatico(res, pagina(PAGINAS[p]));
  if (p === "/grimorio") return redirecionar(res, "/");
  if (p.startsWith("/data/")) return estatico(res, join(RAIZ, "data", p.slice(6).replace(/[^\w.-]/g, "")));
  return estatico(res, join(RAIZ, "static", p.slice(1).replace(/[^\w./-]/g, "").replace(/\.\./g, "")));
}

// ---- textos oficiais + busca ----
function carregarTextos() {
  if (!carregarTextos.cache) carregarTextos.cache = lerJson(join(DADOS, "textos.json"), {});
  return carregarTextos.cache;
}
function carregarPoderes() {
  if (!carregarPoderes.cache) carregarPoderes.cache = lerJson(join(DADOS, "poderes.json"), {});
  return carregarPoderes.cache;
}
const norm = (x) => (x || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const slug = (s) => norm(s).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80) || randomBytes(3).toString("hex");
const blobs = new WeakMap();
function blobDe(t) {
  if (!blobs.has(t)) blobs.set(t, norm([t.nome, t.linha, t.escola, t.grupo, t.descricao,
    t.categoria, t.sub, t.livro, t.prereq,
    Object.entries(t.stats || {}).map(([k, v]) => `${k} ${v}`).join(" "),
    (t.aprimoramentos || []).map((a) => a.texto || a).join(" ")].join(" ")));
  return blobs.get(t);
}
// sinônimos: cada palavra da consulta vira um grupo de alternativas (qualquer uma serve)
const SINONIMOS = [
  ["fogo", "chama", "queima", "incendi", "ignea", "igneo"],
  ["frio", "gelo", "congel", "gelid"],
  ["eletricidade", "raio", "eletric", "relampago", "choque"],
  ["acido", "corro"],
  ["cura", "curar", "recupera pv", "recupera pontos de vida", "regenera"],
  ["medo", "amedrontado", "apavorado", "assust", "aterroriz"],
  ["veneno", "envenenado", "toxic"],
  ["ilusao", "ilusor", "imagem", "invisi"],
  ["voar", "voo", "levit", "deslocamento de voo"],
  ["luz", "ilumin", "brilh", "ofuscado", "cego"],
  ["escuridao", "trevas", "sombra"],
  ["morto", "morto-vivo", "mortos-vivos", "necro", "zumbi", "esqueleto"],
  ["invocar", "convoca", "conjura", "criatura convocada"],
  ["teleport", "teletransport", "deslocar", "viaj"],
  ["bonus", "+1", "+2", "+5", "recebe +"],
  ["dormir", "sono", "inconsciente", "adormec"],
  ["paralis", "imovel", "preso", "enredado", "agarrado"],
  ["escudo", "protecao", "proteg", "defesa", "abjur"],
  ["voz", "som", "sonico", "silenc", "surdo"],
  ["mental", "mente", "vontade", "encant", "fascinado", "enfeiticado"],
];
function termosBusca(q) {
  return norm(q).split(/\s+/).filter(Boolean).map((w) => {
    const grupo = SINONIMOS.find((g) => g.some((sin) => w.startsWith(sin) || sin.startsWith(w) && w.length >= 4));
    return grupo ? [...new Set([w, ...grupo])] : [w];
  });
}

// ---- ranking de aprimoramentos oficiais contra a magia do usuário ----
const semAcento = (s) => (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const tokens = (s) => new Set(semAcento(s).split(/[^a-z0-9d]+/).filter((t) => t.length > 3));
function pontuarApr(f, a) {
  const m = a.magia;
  let s = 0;
  const tem = (t) => a.deltas.includes(t);
  if (f.dano && tem("dano+")) { s += 3; if (m.dano_dados?.includes("d" + f.dano.faces)) s += 2; }
  if (f.cura && tem("cura+")) s += 4;
  if (f.alvoTipo === "alvos" && tem("alvos+")) s += 2;
  if (f.alvoTipo === "area" && tem("area->")) s += 2;
  if (f.alvoTipo === "alvos" && (f.dano || f.condicoes?.length) && tem("area->")) s += 1;
  if (f.alvoRestrito && /muda o alvo para/.test(semAcento(a.texto))) s += 3;
  if (tem("alcance->") && m.alcance === f.alcance) s += 3;
  if (tem("duracao->") && (f.duracao === "cena" || f.duracao === "1dia")) s += 1;
  if (tem("resistencia->") && f.resistencia && f.resistencia !== "nenhuma") s += 2;
  if (f.condicoes?.length && m.condicoes?.some((c) => f.condicoes.includes(c))) s += 3;
  if (f.escola === m.escola) s += 1;
  if (m.circulo === (f.circulo || 1)) s += 2;
  const tu = tokens(f.texto || "");
  const ta = tokens(a.texto + " " + m.nome);
  let overlap = 0;
  for (const t of tu) if (ta.has(t)) overlap += 0.5;
  s += Math.min(overlap, 3);
  return s;
}
function sugerirAprimoramentos(f, aprs) {
  const vistos = new Map();
  for (const a of aprs) {
    if (a.pm == null && !a.truque) continue;
    if (a.restrito) continue;
    const s = pontuarApr(f, a);
    if (s <= 2) continue;
    const chave = semAcento(a.texto).slice(0, 80);
    const v = vistos.get(chave);
    if (v) { v.n++; if (s > v.score) { v.score = s; v.pm = a.pm; v.fonte = a.magia.nome; } }
    else vistos.set(chave, { score: s, n: 1, pm: a.pm, truque: a.truque, texto: a.texto, fonte: a.magia.nome, circuloFonte: a.magia.circulo });
  }
  const lista = [...vistos.values()].sort((x, y) => y.score - x.score);
  const truques = lista.filter((x) => x.truque).slice(0, 2);
  const normais = lista.filter((x) => !x.truque).slice(0, 10);
  return [...normais, ...truques].map(({ score, ...resto }) => resto);
}

// ---------------------------------------------------------------- CLI: --usuario Nome senha [papel] [personagem]
const iUsu = process.argv.indexOf("--usuario");
if (iUsu > 0) {
  const [nome, senha, papel, personagem] = process.argv.slice(iUsu + 1);
  if (!nomeOk(nome || "") || !senha) { console.error('uso: node server.mjs --usuario "Nome" senha [jogador|mestre] ["Personagem"]'); process.exit(1); }
  const u = definirUsuario({ nome, senha, papel, personagem });
  console.log(`conta "${u.nome}" (${u.papel}${u.personagem ? ", " + u.personagem : ""}) gravada em ${ARQ_USU}`);
  process.exit(0);
}

const server = http.createServer((req, res) => {
  tratar(req, res).catch((e) => { console.error(e); json(res, 500, { erro: "interno" }); });
});

if (CHECK) {
  server.listen(0, async () => {
    const base = `http://127.0.0.1:${server.address().port}`;
    const falha = (msg) => { console.error("FALHOU:", msg); server.close(); process.exitCode = 1; };
    try {
      const mesclado = normalizarEstado({ usuarios: { Amanda: [{ id: "1" }], amanda: [{ id: "2" }, { id: "1" }] } });
      if (Object.keys(mesclado.usuarios).length !== 1 || mesclado.usuarios.amanda.length !== 2) return falha("normalizarEstado não mesclou: " + JSON.stringify(mesclado));
      definirUsuario({ nome: "Ray", senha: "1234", papel: "mestre", personagem: "" });
      definirUsuario({ nome: "Amanda", senha: "abcd", papel: "jogador", personagem: "Lydia Alnari" });
      // coleção falsa injetada no cache (o self-test não lê dados/)
      colecoes.cache.teste = { meta: { titulo: "Teste", filtros: [{ k: "nd", rotulo: "ND" }], ordem: { nd: ["1", "2"] } },
        itens: [{ id: "lobo", nome: "Lobo", linha: "Animal · ND 1", grupo: "x", f: { nd: "1" }, t: "lobo animal nd 1 mordida", html: "<b>PV</b> 10" },
          { id: "urso", nome: "Urso", linha: "Animal · ND 2", grupo: "x", f: { nd: "2" }, t: "urso animal nd 2 garra", html: "<b>PV</b> 30" }] };
      colecoes.cache.teste.porId = new Map(colecoes.cache.teste.itens.map((i) => [i.id, i]));

      // sem sessão: API 401, página vira tela de login (com o destino guardado)
      if ((await fetch(`${base}/api/state`)).status !== 401) return falha("sem login devia dar 401");
      const semLogin = await fetch(`${base}/bestiario`);
      if (semLogin.status !== 200 || !(await semLogin.text()).includes('window.VOLTAR="/bestiario"')) return falha("página sem login devia virar login com VOLTAR");
      const errada = await fetch(`${base}/api/login`, { method: "POST", body: JSON.stringify({ nome: "ray", senha: "nope" }) });
      if (errada.status !== 401) return falha("senha errada devia dar 401");
      const login = await fetch(`${base}/api/login`, { method: "POST", body: JSON.stringify({ nome: "RAY", senha: "1234" }) });
      if (login.status !== 200) return falha("login: " + login.status);
      const cookie = login.headers.get("set-cookie").split(";")[0];
      const H = { cookie }, HJ = { cookie, "content-type": "application/json" };
      const eu = await (await fetch(`${base}/api/eu`, { headers: H })).json();
      if (eu.nome !== "Ray" || !eu.mestre) return falha("eu: " + JSON.stringify(eu));
      const cookieFalso = cookie.replace(/.$/, (c) => c === "a" ? "b" : "a");
      if ((await fetch(`${base}/api/eu`, { headers: { cookie: cookieFalso } })).status !== 401) return falha("cookie adulterado devia dar 401");

      // grimório: dono = sessão, não o nome do caminho
      const magia = { nome: "Teste", circulo: 1,
        eixos: { execucao: "padrao", alcance: "curto", duracao: "instantanea", resistencia: "reduz-metade", alvo: { tipo: "alvos", qtd: 1 } },
        efeitos: { dano: { n: 2, faces: 6 } } };
      const put = await fetch(`${base}/api/user/qualquer`, { method: "PUT", headers: HJ, body: JSON.stringify({ magias: [magia] }) });
      if (put.status !== 200) return falha("PUT " + put.status);
      const st = await (await fetch(`${base}/api/state?user=outro`, { headers: H })).json();
      if (st.minhas.length !== 1 || st.minhas[0].pontos.gasto !== 7) return falha("state: " + JSON.stringify(st.minhas[0]?.pontos));
      const pub = await (await fetch(`${base}/api/publicar`, { method: "POST", headers: HJ, body: JSON.stringify({ autor: "ladrao", magia }) })).json();
      if (!pub.ok || !pub.id) return falha("publicar: " + JSON.stringify(pub));
      if (estado.publicadas[pub.id].autor !== "Ray") return falha("autor devia ser o da sessão");
      const m = await (await fetch(`${base}/api/magia/${pub.id}`, { headers: H })).json();
      if (m.nome !== "Teste") return falha("magia publicada errada");
      const ruim = await fetch(`${base}/api/user/x`, { method: "PUT", headers: HJ, body: JSON.stringify({ magias: [{ nome: "x", circulo: 7 }] }) });
      if (ruim.status !== 400) return falha("devia recusar círculo 7");
      const gri = await (await fetch(`${base}/api/grimorio`, { headers: H })).json();
      if (gri.publicadas.find((x) => x.id === pub.id)?.pocao !== "poção") return falha("grimório não marcou a poção");
      // outra conta não despublica; o mestre despublica qualquer uma
      const loginA = await fetch(`${base}/api/login`, { method: "POST", body: JSON.stringify({ nome: "amanda", senha: "abcd" }) });
      const cA = loginA.headers.get("set-cookie").split(";")[0];
      const HA = { cookie: cA, "content-type": "application/json" };
      if ((await fetch(`${base}/api/despublicar`, { method: "POST", headers: HA, body: JSON.stringify({ id: pub.id }) })).status !== 403) return falha("Amanda não podia despublicar a do Ray");
      if ((await fetch(`${base}/api/usuarios`, { headers: HA })).status !== 403) return falha("jogador não vê contas");
      if ((await fetch(`${base}/api/despublicar`, { method: "POST", headers: HJ, body: JSON.stringify({ id: pub.id }) })).status !== 200) return falha("mestre devia despublicar");
      const idx = await fetch(`${base}/m/${pub.id}`, { headers: H });
      if (idx.status !== 404) return falha("/m/ de despublicada devia dar 404");
      if ((await fetch(`${base}/`, { headers: H })).status !== 200 || (await fetch(`${base}/criar`, { headers: H })).status !== 200) return falha("/ ou /criar fora");

      // coleções: busca com sinônimo, filtros vêm da meta, ficha completa
      const lista = await (await fetch(`${base}/api/c/teste?q=garra`, { headers: H })).json();
      if (lista.itens.length !== 1 || lista.itens[0].id !== "urso" || lista.itens[0].html) return falha("busca da coleção: " + JSON.stringify(lista));
      if (lista.meta.ordem.nd[1] !== "2") return falha("meta da coleção não veio");
      const urso = await (await fetch(`${base}/api/c/teste/urso`, { headers: H })).json();
      if (urso.html !== "<b>PV</b> 30") return falha("ficha da coleção");
      if ((await fetch(`${base}/api/c/naoexiste`, { headers: H })).status !== 404) return falha("coleção inexistente devia dar 404");
      const paginaC = await fetch(`${base}/c/teste/urso`, { headers: H });
      if (paginaC.status !== 200 || !(await paginaC.text()).includes('og:title" content="Urso"')) return falha("/c/ sem Open Graph");

      // missões: mestre grava o quadro, jogadora vota como o personagem, concluir apaga votos
      const quadro = await fetch(`${base}/api/missoes`, { method: "PUT", headers: HJ, body: JSON.stringify({ missoes: [{ titulo: "Caçar o lobo", perigo: 9 }, { id: "x-1", titulo: "Escolta" }] }) });
      if (quadro.status !== 200) return falha("PUT missões: " + (await quadro.json()).erro);
      if (missoes.missoes[0].perigo !== 5 || missoes.missoes[0].id !== "cacar-o-lobo") return falha("missão normalizada errada: " + JSON.stringify(missoes.missoes[0]));
      if ((await fetch(`${base}/api/missoes`, { method: "PUT", headers: HA, body: JSON.stringify({ missoes: [] }) })).status !== 403) return falha("jogadora não edita o quadro");
      const voto = await (await fetch(`${base}/api/missoes/votar`, { method: "POST", headers: HA, body: JSON.stringify({ id: "cacar-o-lobo", ligar: true }) })).json();
      if (!voto.votos["cacar-o-lobo"]?.["Lydia Alnari"]) return falha("voto devia ser do personagem: " + JSON.stringify(voto.votos));
      if ((await fetch(`${base}/api/missoes/concluir`, { method: "POST", headers: HA, body: JSON.stringify({ id: "cacar-o-lobo", ligar: true }) })).status !== 403) return falha("jogadora não conclui");
      const conc = await (await fetch(`${base}/api/missoes/concluir`, { method: "POST", headers: HJ, body: JSON.stringify({ id: "cacar-o-lobo", ligar: true }) })).json();
      if (!conc.missoes[0].concluida || conc.votos["cacar-o-lobo"]) return falha("concluir devia apagar votos");
      if ((await fetch(`${base}/api/missoes/votar`, { method: "POST", headers: HA, body: JSON.stringify({ id: "cacar-o-lobo", ligar: true }) })).status !== 400) return falha("não vota em cumprida");

      // agenda: só os próprios dias (mestre pode pelos outros), validação igual à do data-rpg
      const dias = { days: { "2026-10-03": "yes", "2026-10-04": "no" }, updatedAt: 5 };
      if ((await fetch(`${base}/api/agenda/user/Ray`, { method: "PUT", headers: HA, body: JSON.stringify(dias) })).status !== 403) return falha("Amanda não grava os dias do Ray");
      if ((await fetch(`${base}/api/agenda/user/amanda`, { method: "PUT", headers: HA, body: JSON.stringify(dias) })).status !== 200) return falha("Amanda devia gravar os próprios dias");
      if ((await fetch(`${base}/api/agenda/user/Amanda`, { method: "PUT", headers: HA, body: JSON.stringify({ days: { x: "yes" } }) })).status !== 400) return falha("data inválida → 400");
      const ags = await (await fetch(`${base}/api/agenda/state`, { headers: H })).json();
      if (ags.users.Amanda?.days["2026-10-03"] !== "yes" || ags.mestre !== "Ray" || ags.nomes.length !== 2) return falha("agenda state: " + JSON.stringify(ags));

      // contas: mestre cria, jogadora troca a própria senha, senha antiga para de valer
      const nova = await fetch(`${base}/api/usuarios`, { method: "POST", headers: HJ, body: JSON.stringify({ nome: "Davi", senha: "davi1", personagem: "Behrtio" }) });
      if (nova.status !== 200 || usuarios.davi?.personagem !== "Behrtio") return falha("criar conta");
      if ((await fetch(`${base}/api/usuarios`, { method: "POST", headers: HJ, body: JSON.stringify({ nome: "Novo" }) })).status !== 400) return falha("conta nova sem senha devia falhar");
      if ((await fetch(`${base}/api/senha`, { method: "POST", headers: HA, body: JSON.stringify({ atual: "errada", nova: "zzzz" }) })).status !== 403) return falha("senha atual errada");
      if ((await fetch(`${base}/api/senha`, { method: "POST", headers: HA, body: JSON.stringify({ atual: "abcd", nova: "nova1" }) })).status !== 200) return falha("trocar senha");
      if ((await fetch(`${base}/api/login`, { method: "POST", body: JSON.stringify({ nome: "amanda", senha: "abcd" }) })).status !== 401) return falha("senha antiga ainda vale");
      if ((await fetch(`${base}/api/login`, { method: "POST", body: JSON.stringify({ nome: "amanda", senha: "nova1" }) })).status !== 200) return falha("senha nova não vale");
      // links: padrão vem, mestre troca, jogador não
      const lk = await (await fetch(`${base}/api/links`, { headers: H })).json();
      if (!lk.grupos?.length) return falha("links padrão");
      if ((await fetch(`${base}/api/links`, { method: "PUT", headers: HA, body: JSON.stringify({ grupos: [] }) })).status !== 403) return falha("jogadora não edita links");
      if ((await fetch(`${base}/api/sair`, { method: "POST", headers: H })).headers.get("set-cookie") !== cookieSessao({ headers: { host: "127.0.0.1" } }, "x", 0)) return falha("sair devia apagar o cookie");
      console.log("server.mjs --check OK");
      server.close();
    } catch (e) { falha(e.stack || e.message); }
  });
} else {
  server.listen(PORT, () => console.log(`Hub T20 em http://localhost:${PORT} (${Object.keys(usuarios).length} contas)`));
}
