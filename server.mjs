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

const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".webmanifest": "application/manifest+json", ".ttf": "font/ttf", ".otf": "font/otf", ".woff2": "font/woff2",
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif", ".hbs": "text/plain; charset=utf-8", ".txt": "text/plain; charset=utf-8", ".map": "application/json" };
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
// conta pode ser achada pelo nome OU pelo apelido (login aceita os dois)
function buscarConta(nome) {
  const n = normNome(nome);
  if (usuarios[n]) return [n, usuarios[n]];
  const par = Object.entries(usuarios).find(([, u]) => u.apelido && normNome(u.apelido) === n);
  return par || [null, null];
}
function apelidoLivre(apelido, chave) {
  const n = normNome(apelido);
  if (!n) return true;
  return !Object.entries(usuarios).some(([k, u]) => k !== chave && (k === n || normNome(u.apelido) === n));
}
function definirUsuario({ nome, senha, papel, personagem, apelido }) {
  const chave = normNome(nome);
  const u = usuarios[chave] || { nome: nome.trim(), criadoEm: new Date().toISOString() };
  if (apelido != null) u.apelido = String(apelido).trim().slice(0, 40);
  if (senha) { u.sal = randomBytes(16).toString("hex"); u.hash = hashSenha(senha, u.sal); }
  if (papel) u.papel = papel === "mestre" ? "mestre" : "jogador";
  if (!u.papel) u.papel = "jogador";
  if (personagem != null) u.personagem = String(personagem).trim().slice(0, 60);
  usuarios[chave] = u;
  gravarJson(ARQ_USU, usuarios);
  return u;
}
// muda o nome de exibição (e a chave) e/ou o personagem de uma conta, arrastando tudo que aponta pra ela:
// magias (estado.usuarios), autor das publicadas, dias da agenda e votos das missões (votante = personagem || nome).
// Devolve { chave } nova ou uma string de erro. Maiúsculas: a chave é minúscula, o `nome` guarda como foi escrito.
function renomearConta(chave, { novoNome, personagem, apelido }) {
  const u = usuarios[chave];
  if (!u) return "conta não existe";
  if (apelido != null) {
    if (String(apelido).trim() && !nomeOk(apelido)) return "apelido inválido";
    if (!apelidoLivre(apelido, chave)) return "esse apelido já é de outra conta";
    u.apelido = String(apelido).trim().slice(0, 40);
  }
  const votanteAntigo = u.personagem || u.nome;
  if (novoNome != null && String(novoNome).trim() && String(novoNome).trim() !== u.nome) {
    if (!nomeOk(novoNome)) return "nome inválido";
    const nova = normNome(novoNome), antigoNome = u.nome;
    if (nova !== chave && (usuarios[nova] || !apelidoLivre(novoNome, chave))) return "já existe conta com esse nome";
    u.nome = String(novoNome).trim();
    if (nova !== chave) {
      delete usuarios[chave]; usuarios[nova] = u;
      if (estado.usuarios[chave]) { estado.usuarios[nova] = estado.usuarios[chave]; delete estado.usuarios[chave]; }
      chave = nova;
    }
    for (const m of Object.values(estado.publicadas)) if (mesmoDono(m.autor, antigoNome)) m.autor = u.nome;
    if (antigoNome !== u.nome && agenda.users[antigoNome]) { agenda.users[u.nome] = agenda.users[antigoNome]; delete agenda.users[antigoNome]; }
  }
  if (personagem != null) u.personagem = String(personagem).trim().slice(0, 60);
  const votanteNovo = u.personagem || u.nome;
  if (votanteNovo !== votanteAntigo) for (const v of Object.values(missoes.votos)) if (v[votanteAntigo]) { v[votanteNovo] = true; delete v[votanteAntigo]; }
  gravarJson(ARQ_USU, usuarios); salvar(); gravarJson(ARQ_AGE, agenda); gravarJson(ARQ_MIS, missoes);
  return { chave };
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
const publico = (u) => u && { nome: u.nome, apelido: u.apelido || "", papel: u.papel, personagem: u.personagem || "", criadoEm: u.criadoEm };
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
// personagens do criador de ficha: { chave da conta: { id: { nome, resumo, estado, passo, ficha, criadoEm, atualizadoEm } } }
const ARQ_PERS = join(DADOS, "personagens.json");
let personagens = CHECK ? {} : lerJson(ARQ_PERS, {});
const FICHA_DIR = join(DADOS, "ficha-site"); // build do criador-ficha-foundry (site, base /ficha/), sobe por scp

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

function corpo(req, limite = MAX_BODY) {
  return new Promise((ok, err) => {
    let b = "";
    req.on("data", (c) => { b += c; if (b.length > limite) { err(new Error("grande")); req.destroy(); } });
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
// sem sessão só passa: login, a API de login e arquivos estáticos (css/js/fontes/ícones/manifest/sw — código e enfeite, não dados)
const livre = (p) => p === "/login" || p === "/api/login" || /\.(css|js|mjs|png|svg|ico|ttf|otf|woff2|webmanifest)$/.test(p);

async function tratar(req, res) {
  const url = new URL(req.url, "http://x");
  const p = url.pathname;
  const eu = sessaoDe(req);

  if (p === "/api/login" && req.method === "POST") {
    const ip = ipDe(req);
    if (bloqueado(ip)) return json(res, 429, { erro: "muitas tentativas — espere um minuto" });
    let b;
    try { b = await corpo(req); } catch { return json(res, 400, { erro: "corpo inválido" }); }
    const [chaveLogin, u] = buscarConta(b.nome);
    if (!u || !conferirSenha(u, String(b.senha ?? ""))) { errou(ip); return json(res, 401, { erro: "nome ou senha errados" }); }
    return json(res, 200, { ok: true, eu: publico(u) }, { "set-cookie": cookieSessao(req, tokenDe(chaveLogin), 365 * 86400) });
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
  // ---- minha conta: nome de exibição e personagem (a senha é /api/senha)
  if (p === "/api/conta" && req.method === "POST") {
    let b;
    try { b = await corpo(req); } catch { return json(res, 400, { erro: "corpo inválido" }); }
    const r = renomearConta(eu.chave, { novoNome: b.nome, personagem: b.personagem, apelido: b.apelido });
    if (typeof r === "string") return json(res, 400, { erro: r });
    // a chave mudou → cookie novo (o antigo aponta pra uma conta que não existe mais)
    return json(res, 200, { ok: true, eu: publico(usuarios[r.chave]) }, r.chave !== eu.chave ? { "set-cookie": cookieSessao(req, tokenDe(r.chave), 365 * 86400) } : {});
  }
  // ---- painel do mestre: contas (criar, senha, papel, personagem, renomear, apagar)
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
    let chave = normNome(b.nome);
    const eraEu = chave === eu.chave;
    if (!usuarios[chave] && String(b.senha || "").length < 4) return json(res, 400, { erro: "conta nova precisa de senha (mínimo 4)" });
    if (chave === eu.chave && b.papel && b.papel !== "mestre") return json(res, 400, { erro: "você não pode se rebaixar" });
    if (!usuarios[chave]) {
      if (!apelidoLivre(b.nome, chave) || (b.apelido && !apelidoLivre(b.apelido, chave))) return json(res, 400, { erro: "nome ou apelido já usado" });
      definirUsuario({ nome: b.nome, senha: b.senha, papel: b.papel, personagem: b.personagem, apelido: b.apelido });
    } else {
      const r = renomearConta(chave, { novoNome: b.novoNome, personagem: b.personagem, apelido: b.apelido });
      if (typeof r === "string") return json(res, 400, { erro: r });
      chave = r.chave;
      definirUsuario({ nome: usuarios[chave].nome, senha: b.senha || "", papel: b.papel });
    }
    // o mestre renomeou a própria conta → a chave do cookie dele mudou, manda um novo
    const extra = eraEu && chave !== eu.chave ? { "set-cookie": cookieSessao(req, tokenDe(chave), 365 * 86400) } : {};
    return json(res, 200, { ok: true, usuario: publico(usuarios[chave]) }, extra);
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
    const q = norm(url.searchParams.get("q")).trim();
    const termos = await comIA(termosBusca(q, vocabDe(textos, () => Object.values(textos).map(blobDe))));
    const aprsDe = (t) => (t.aprimoramentos || []).map((a) => a.texto || a).join(" ");
    const oficiais = filtrar(Object.entries(textos), ([, t]) => blobDe(t), termos)
      .map(([slug, t]) => ({ slug, nome: t.nome, escola: t.escola, grupo: t.grupo, circulo: t.circulo, pocao: tipoDePocao(t.stats?.["Alvo/Área"]),
        rel: relevancia([t.nome, [t.linha, t.escola, t.grupo, t.descricao, Object.values(t.stats || {}).join(" ")].join(" "), aprsDe(t)], termos, q),
        ...eixosDe(t.stats?.["Execução"], t.stats?.["Alcance"], t.stats?.["Resistência"]) }));
    const publicadasPartes = Object.entries(estado.publicadas)
      .map(([id, m]) => [id, m, m.nome, [m.escola, m.tipo, htmlParaTexto(m.descricao), JSON.stringify(m.eixos || {})].join(" "), aprsDe(m)]);
    const publicadas = filtrar(publicadasPartes, ([, , ...partes]) => norm(partes.join(" ")), termos)
      .map(([id, m, ...partes]) => ({ id, nome: m.nome, escola: m.escola, grupo: m.tipo, circulo: m.circulo || 1, autor: m.autor, pontos: m.pontos, pocao: tipoDePocaoDosEixos(m.eixos?.alvo),
        rel: relevancia(partes, termos, q), ...eixosDaMesa(m.eixos) }));
    return json(res, 200, { oficiais, publicadas });
  }
  if (p === "/api/poderes" && req.method === "GET") {
    const todos = carregarPoderes(), q = norm(url.searchParams.get("q")).trim();
    const termos = await comIA(termosBusca(q, vocabDe(todos, () => Object.values(todos).map(blobDe))));
    const poderes = filtrar(Object.entries(todos), ([, t]) => blobDe(t), termos)
      .map(([slug, t]) => ({ slug, nome: t.nome, categoria: t.categoria, sub: t.sub, livro: t.livro, custo: t.custo, divindade: t.divindade,
        rel: relevancia([t.nome, [t.categoria, t.sub, t.livro, t.prereq].join(" "), t.descricao], termos, q) }));
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
    const q = norm(url.searchParams.get("q")).trim();
    const termos = await comIA(termosBusca(q, vocabDe(col, () => col.itens.map((i) => i.t))));
    const itens = termos.length
      ? filtrar(col.itens, (i) => i.t, termos).map((i) => ({ ...resumo(i), rel: relevancia([i.nome, [i.linha, ...Object.values(i.f || {})].join(" "), i.t], termos, q) }))
      : col.itens.map(resumo);
    return json(res, 200, { meta: col.meta, itens });
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

  // ---- criador de ficha (site do t20-ficha-wizard buildado em dados/ficha-site, base /ficha/): personagens salvos POR CONTA
  // mesma API que o site já falava (/api/criador/personagens); o "jogador" do site é ignorado — a sessão manda
  const pc = p.match(/^\/api\/criador\/personagens(?:\/([A-Za-z0-9_-]{4,40}))?$/);
  if (pc) {
    const meus = (personagens[eu.chave] ||= {});
    if (!pc[1] && req.method === "GET") return json(res, 200, Object.entries(meus).map(([id, x]) => ({ id, nome: x.nome, resumo: x.resumo, passo: x.passo, temFicha: !!x.ficha, atualizadoEm: x.atualizadoEm })).sort((a, b) => b.atualizadoEm - a.atualizadoEm));
    if (!pc[1]) return json(res, 405, { error: "método" });
    const id = pc[1];
    if (req.method === "GET") return meus[id] ? json(res, 200, { id, jogador: eu.nome, ...meus[id] }) : json(res, 404, { error: "não encontrado" });
    if (req.method === "DELETE") { delete meus[id]; gravarJson(ARQ_PERS, personagens); return json(res, 200, { ok: true }); }
    if (req.method === "PUT") {
      let b;
      try { b = await corpo(req, 4 * 1024 * 1024); } catch { return json(res, 400, { error: "corpo inválido ou grande demais" }); }
      if (!b.estado) return json(res, 400, { error: "estado obrigatório" });
      const texto = (v) => (v == null ? null : typeof v === "string" ? v : JSON.stringify(v));
      meus[id] = { nome: String(b.nome || "Sem nome").slice(0, 80), resumo: String(b.resumo ?? "").slice(0, 200), estado: texto(b.estado),
        passo: b.passo ? String(b.passo).slice(0, 40) : null, ficha: texto(b.ficha), criadoEm: meus[id]?.criadoEm || Date.now(), atualizadoEm: Date.now() };
      gravarJson(ARQ_PERS, personagens);
      return json(res, 200, { ok: true, id });
    }
    return json(res, 405, { error: "método" });
  }
  if (p === "/ficha") return redirecionar(res, "/ficha/");
  if (p.startsWith("/ficha/")) {
    const rel = decodeURIComponent(p.slice("/ficha/".length)).replace(/\.\./g, "");
    if (rel === "" || rel === "index.html") {
      // o site lê o nome do jogador do localStorage antes de subir: gravamos o da sessão e escondemos o campo
      let html;
      try { html = readFileSync(join(FICHA_DIR, "index.html"), "utf-8"); } catch { return responderHtml(res, "<h1>Criador de ficha ainda não instalado neste servidor</h1>", 404); }
      // fundo escuro antes de qualquer CSS (senão pisca branco na carga) + confirm do site no lugar do nativo
      html = html.replace("<head>", `<head><meta name="color-scheme" content="dark"><style>html,body{background:#120809 !important}</style><script src="/ficha-hub.js"></script>`);
      html = html.replace("</head>", `<script>try{localStorage.setItem("t20w-site.jogador",${JSON.stringify(eu.nome)})}catch{}</script>`
        + `<link href="https://fonts.googleapis.com/css2?family=Cinzel:wght@500;700;900&family=Alegreya:ital,wght@0,400;0,500;0,700;1,400&display=swap" rel="stylesheet">`
        + `<link rel="stylesheet" href="/ficha-tema.css"><script type="module" src="/hub.js"></script></head>`);
      return responderHtml(res, html);
    }
    return estatico(res, join(FICHA_DIR, rel));
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
const ELEMENTOS = { fogo: ["Reflexos", "em chamas"], frio: ["Fortitude", "arrefecida"], eletricidade: ["Reflexos", "eletrificada"] };
function carregarTextos() {
  if (!carregarTextos.cache) {
    const t = lerJson(join(DADOS, "textos.json"), {});
    for (const m of Object.values(t)) {
      const d = norm(m.descricao || "");
      const tem = Object.keys(ELEMENTOS).filter((e) => new RegExp("\\b" + (e === "eletricidade" ? "eletric" : e)).test(d));
      for (const a of m.aprimoramentos || []) {
        if (!/muda a resist[eê]ncia para Reflexos \(eletricidade, fogo\)/.test(a.texto) || tem.length !== 1) continue;
        const [teste, cond] = ELEMENTOS[tem[0]];
        a.texto = `muda a resistência para ${teste} parcial. Se falha, a criatura fica ${cond} (${tem[0]}). (DB #219)`;
      }
    }
    carregarTextos.cache = t;
  }
  return carregarTextos.cache;
}
function carregarPoderes() {
  if (!carregarPoderes.cache) {
    const p = lerJson(join(DADOS, "poderes.json"), {});
    // nome do poder → deuses que o concedem (lista "Poderes Concedidos" de cada deus na coleção)
    const porPoder = {};
    for (const d of carregarColecao("deuses")?.itens || [])
      for (const n of (d.html.match(/Poderes Concedidos:<\/b>\s*([^<]+)/i)?.[1] || "").replace(/\.\s*$/, "").split(/,\s*/)) if (n.trim()) (porPoder[norm(n.trim())] ??= []).push(d.nome);
    for (const [slug, t] of Object.entries(p)) {
      // índice de raça do Heróis de Arton ("Anão: Arma Amada, Atração pela Pólvora, …") que o minerador leu como poder
      if (t.categoria === "Racial" && !t.sub && (t.nome === "Várias" || /^(?:[^,.\n]{3,45}, ){2,}[^,.\n]{3,45}\.?$/.test(t.descricao.trim()))) { delete p[slug]; continue; }
      consertarPrereq(t);
      origemDoPoder(t, porPoder);
      if (t.categoria === "Classe" && t.sub === "Geral") { t.sub = "Qualquer classe"; t.linha = t.linha.replace("· Geral ·", "· Qualquer classe ·"); } // Aumento de Atributo
      // pack "poderes que faltam": "Escolhido de X" da aventura Libertação de Valkaria vem como "Geral" do LB com links @UUID no texto
      if (/Liberta[çc][ãa]o de Valkaria/.test(t.publicacao || "")) {
        t.livro = "Libertação de Valkaria";
        if (t.categoria === "Geral") { t.categoria = "Destino"; const d = t.nome.match(/^Escolhido de (.+)$/)?.[1]; if (d) { t.divindade = d; t.sub = d; } }
        t.descricao = t.descricao.replace(/@UUID\[[^\]]*\]\{([^}]*)\}/g, "$1");
        t.linha = ["Poder de " + t.categoria.toLowerCase(), t.sub, t.livro].filter(Boolean).join(" · ");
      }
    }
    carregarPoderes.cache = p;
  }
  return carregarPoderes.cache;
}
// "Raça: Anão, Hobgoblin" / "Divindade: Lena, Marah" na 1ª linha (Heróis/Deuses de Arton) vira campo próprio e subtítulo;
// concedido do Livro Básico vem com o domínio ("Paz") → nome do deus pela lista de Poderes Concedidos (4 domínios sem lista, na mão)
const DOMINIO_DEUS = { Honra: "Lin-Wu", Libertadora: "Valkaria", "Goblinóides": "Thwor", Sol: "Azgher" };
function origemDoPoder(t, porPoder = {}) {
  const m = (t.descricao || "").match(/^(Raça|Divindade):\s*([^\n]+)\n+/);
  if (m) { t[m[1] === "Raça" ? "raca" : "divindade"] = m[2].trim(); t.descricao = t.descricao.slice(m[0].length); }
  if (t.categoria === "Concedido" && !t.divindade) { const ds = porPoder[norm(t.nome)] || (DOMINIO_DEUS[t.sub] ? [DOMINIO_DEUS[t.sub]] : []); if (ds.length) t.divindade = ds.join(", "); }
  const sub = t.divindade || t.raca;
  if (sub) { t.sub = sub; t.linha = [String(t.linha || "").split(" · ")[0], sub, t.livro].filter(Boolean).join(" · "); }
  return t;
}
// OCR do livro partiu 11 poderes na palavra "pré-requisitos" do MEIO do texto ("um poder cujos | cumpra"): o campo
// prereq ficou com o resto da frase e o pré-requisito de verdade foi parar numa linha no fim da descrição. Recompõe.
function consertarPrereq(t) {
  const m = (t.descricao || "").match(/\s*Pr[eé]-?requisitos?:\s*([^\n]+?)\s*$/i);
  if (!m || m.index === 0) return t;
  const resto = t.descricao.slice(0, m.index).trimEnd(), frag = (t.prereq || "").trim();
  if (frag && frag === m[1].replace(/\.$/, "")) { t.descricao = resto; return t; } // só duplicado no fim
  const plural = /cujos|demais$/.test(resto) ? "s" : "";
  t.descricao = resto + " pré-requisito" + plural + (frag ? (/^[,.;]/.test(frag) ? "" : " ") + frag : "") + (/[.!?)]$/.test(frag) ? "" : ".");
  t.prereq = m[1].replace(/\.$/, "");
  return t;
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
// ---- busca (grimório, poderes e toda coleção): cada palavra vira um grupo de alternativas e o item passa
// se TODO grupo bate (AND). Alternativas FORTES = a palavra e seus sinônimos; FRACAS = palavras do próprio
// acervo parecidas por digitação (relampgo → relampago) e, com dados/ia.key, sinônimos pedidos à IA.
// Fraca só entra quando a palavra não acha nada como está, e vale metade na relevância.
const SINONIMOS = [
  ["fogo", "chama", "queima", "incendi", "ignea", "igneo"],
  ["frio", "gelo", "congel", "gelid"],
  ["eletricidade", "eletric", "eletrific", "relampago", "choque", "faisca"],
  ["acido", "corro"],
  ["cura", "curar", "recupera pv", "recupera pontos de vida", "regenera"],
  ["medo", "amedrontado", "apavorado", "assust", "aterroriz"],
  ["veneno", "envenenado", "toxic"],
  ["ilusao", "ilusor", "imagem", "invisi"],
  ["voar", "voo", "levit", "deslocamento de voo"],
  ["luz", "ilumin", "brilh", "ofuscado", "cego"],
  ["escuridao", "trevas", "sombra"],
  ["morto", "morto-vivo", "mortos-vivos", "necro", "zumbi", "esqueleto"],
  ["invocar", "convoca", "criatura convocada"],
  ["teleport", "teletransport", "deslocar", "viaj"],
  ["bonus", "+1", "+2", "+5", "recebe +"],
  ["dormir", "sono", "inconsciente", "adormec"],
  ["paralis", "imovel", "enredado", "agarrado"],
  ["escudo", "protecao", "proteg", "abjur"],
  ["voz", "som", "sonico", "silenc", "surdo"],
  ["mental", "mente", "fascinado", "enfeiticado"],
];
// Levenshtein com teto: para de contar quando passa de `max`
function distancia(a, b, max) {
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]; let menor = i;
    for (let j = 1; j <= b.length; j++) { cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); menor = Math.min(menor, cur[j]); }
    if (menor > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}
// vocabulário de cada fonte (palavras com 4+ letras dos blobs), montado uma vez por objeto-fonte
const vocabs = new WeakMap();
function vocabDe(chave, blobsDe) {
  if (!vocabs.has(chave)) { const v = new Set(); for (const b of blobsDe()) for (const w of b.split(/[^a-z0-9]+/)) if (w.length >= 4) v.add(w); vocabs.set(chave, { palavras: v, parecidos: new Map() }); }
  return vocabs.get(chave);
}
function parecidos(w, vocab) {
  if (!vocab || w.length < 5) return [];
  if (!vocab.parecidos.has(w)) {
    let out = [];
    for (const v of vocab.palavras) if (v.includes(w)) { out = null; break; } // já casa como está: nada a corrigir
    if (out) { const max = w.length >= 8 ? 2 : 1; for (const v of vocab.palavras) if (Math.abs(v.length - w.length) <= max && distancia(w, v, max) <= max) out.push(v); }
    vocab.parecidos.set(w, (out || []).slice(0, 8));
  }
  return vocab.parecidos.get(w);
}
const VAZIAS = new Set(["de", "do", "da", "em", "a", "o", "e", "um", "uma", "no", "na"]);
function termosBusca(q, vocab) {
  const ws = norm(q).split(/\s+/).filter(Boolean);
  return ws.filter((w) => ws.length === 1 || !VAZIAS.has(w)).map((w) => {
    const grupo = SINONIMOS.find((g) => g.some((sin) => w.startsWith(sin) || sin.startsWith(w) && w.length >= 4));
    const alts = grupo ? [...new Set([w, ...grupo])] : [w];
    alts.fortes = alts.length;
    for (const p of parecidos(w, vocab)) if (!alts.includes(p)) alts.push(p);
    return alts;
  });
}
const bate = (blob, termos) => termos.every((alts) => alts.some((t) => blob.includes(t)));
// todas as palavras (AND); se nada tem todas ("dragão vermelho" sem dragão vermelho), serve qualquer uma e a relevância ordena
function filtrar(lista, blob, termos) {
  if (!termos.length) return lista;
  const todas = lista.filter((x) => bate(blob(x), termos));
  return todas.length || termos.length < 2 ? todas : lista.filter((x) => termos.some((alts) => alts.some((t) => blob(x).includes(t))));
}
// relevância: nome ×3 > linha/escola/categoria ×2 > corpo ×1 por grupo (fraca vale metade); nome igual à consulta ou começando por ela sobe
function relevancia(partes, termos, q) {
  if (!termos.length) return 0;
  const [nome, meio, corpo] = partes.map(norm);
  let r = nome.trim() === q ? 6 : nome.startsWith(q) ? 3 : 0;
  for (const alts of termos) {
    let melhor = 0;
    alts.forEach((x, i) => { const p = (nome.includes(x) ? 3 : meio.includes(x) ? 2 : corpo.includes(x) ? 1 : 0) * (i < alts.fortes ? 1 : 0.5); if (p > melhor) melhor = p; });
    r += melhor;
  }
  return r;
}
// IA opcional: com dados/ia.key (chave da Anthropic), cada palavra nova da consulta ganha até 6 radicais de T20
// pedidos ao modelo UMA vez (cache em dados/ia-busca.json); sem chave ou com erro, a busca segue sem ela
const ARQ_IA = join(DADOS, "ia-busca.json"), ARQ_IA_KEY = join(DADOS, "ia.key");
let iaCache = null;
async function sinonimosIA(w) {
  if (CHECK || w.length < 4 || !existsSync(ARQ_IA_KEY)) return [];
  iaCache ??= lerJson(ARQ_IA, {});
  if (w in iaCache) return iaCache[w];
  iaCache[w] = []; // marca antes: a mesma palavra digitada de novo enquanto a IA responde não dispara outra chamada
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", signal: AbortSignal.timeout(6000),
      headers: { "x-api-key": readFileSync(ARQ_IA_KEY, "utf8").trim(), "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: 150, messages: [{ role: "user", content:
        `Busca num compêndio de Tormenta 20 (RPG, português). Termo digitado: "${w}". Responda SÓ um array JSON com até 6 radicais de palavras em português (minúsculas, sem acento, sem espaço; radical curto: "congel" cobre congelado/congelar) que o texto de uma magia, poder, monstro ou item usaria pra falar disso. Só termos específicos; nada genérico como "dano", "criatura", "teste". Se não houver, [].` }] }) });
    const texto = (await r.json()).content?.[0]?.text || "[]";
    iaCache[w] = JSON.parse(texto.match(/\[[\s\S]*\]/)?.[0] || "[]").map(norm).filter((s) => /^[a-z0-9-]{3,}$/.test(s) && s !== w).slice(0, 6);
    gravarJson(ARQ_IA, iaCache);
  } catch { delete iaCache[w]; return []; }
  return iaCache[w];
}
async function comIA(termos) {
  for (const alts of termos) for (const s of await sinonimosIA(alts[0])) if (!alts.includes(s)) alts.push(s);
  return termos;
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
const iRen = process.argv.indexOf("--renomear"); // node server.mjs --renomear "Nome atual" "Nome novo" ["Personagem"]
if (iRen > 0) {
  const [atual, novo, personagem] = process.argv.slice(iRen + 1);
  const r = renomearConta(normNome(atual), { novoNome: novo, personagem });
  if (typeof r === "string") { console.error(r); process.exit(1); }
  console.log(`conta "${atual}" agora é "${usuarios[r.chave].nome}"${usuarios[r.chave].personagem ? " (" + usuarios[r.chave].personagem + ")" : ""}`);
  process.exit(0);
}
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
      const digitado = await (await fetch(`${base}/api/c/teste?q=mordda`, { headers: H })).json(); // "mordida" com letra faltando
      if (digitado.itens.length !== 1 || digitado.itens[0].id !== "lobo") return falha("parecido por digitação: " + JSON.stringify(digitado.itens));
      const ou = await (await fetch(`${base}/api/c/teste?q=lobo urso`, { headers: H })).json(); // ninguém tem as duas → qualquer uma serve
      if (ou.itens.length !== 2) return falha("busca sem resultado devia cair pra qualquer palavra");
      const ani = await (await fetch(`${base}/api/c/teste?q=lobo`, { headers: H })).json();
      if (ani.itens[0]?.rel !== 6 + 3) return falha("nome igual à consulta devia pontuar 9, veio " + ani.itens[0]?.rel);
      const tb = termosBusca("fogo relampgo", vocabDe({}, () => ["relampago chama"]));
      if (tb[0].fortes < 3 || tb[1].fortes !== 1 || tb[1][1] !== "relampago") return falha("termosBusca: " + JSON.stringify(tb));
      if (relevancia(["Relâmpago", "evocação fogo", "raio"], tb, "fogo relampgo") !== 2 + 1.5) return falha("relevância fraca devia valer metade");
      if (distancia("relampago", "relampgo", 2) !== 1 || distancia("urso", "gato", 1) !== 2) return falha("distancia()");
      const pr = consertarPrereq({ descricao: "Você recebe um poder de cavaleiro cujos\n\nPré-requisito: treinado em Nobreza.", prereq: "cumpra, usando seu nível como nível de cavaleiro" });
      if (pr.prereq !== "treinado em Nobreza" || pr.descricao !== "Você recebe um poder de cavaleiro cujos pré-requisitos cumpra, usando seu nível como nível de cavaleiro.") return falha("consertarPrereq: " + JSON.stringify(pr));
      const pr2 = consertarPrereq({ descricao: "que tenha Encouraçado como\n\nPré-requisito: proficiência com armaduras pesadas.", prereq: "" });
      if (pr2.prereq !== "proficiência com armaduras pesadas" || !pr2.descricao.endsWith("como pré-requisito.")) return falha("consertarPrereq sem campo: " + JSON.stringify(pr2));
      if (consertarPrereq({ descricao: "Pré-requisito: x no começo não é fim", prereq: "" }).prereq !== "") return falha("consertarPrereq não devia mexer em linha inicial");
      const o1 = origemDoPoder({ nome: "Dom da Esperança", categoria: "Concedido", sub: "Paz", livro: "Livro Básico", linha: "Poder concedido · Paz · Livro Básico", descricao: "Você soma…" }, { "dom da esperanca": ["Marah"] });
      if (o1.divindade !== "Marah" || o1.sub !== "Marah" || o1.linha !== "Poder concedido · Marah · Livro Básico") return falha("origemDoPoder LB: " + JSON.stringify(o1));
      const o2 = origemDoPoder({ nome: "Companheiro Celeste", categoria: "Concedido", sub: "", livro: "Deuses de Arton", linha: "Poder concedido · Deuses de Arton", descricao: "Divindade: Lena, Marah\n\nVocê possui um luminar." });
      if (o2.divindade !== "Lena, Marah" || o2.descricao !== "Você possui um luminar." || o2.linha !== "Poder concedido · Lena, Marah · Deuses de Arton") return falha("origemDoPoder DdA: " + JSON.stringify(o2));
      const o3 = origemDoPoder({ nome: "Arma Amada", categoria: "Racial", sub: "", livro: "Heróis de Arton", linha: "Poder racial · Heróis de Arton", descricao: "Raça: Anão, Hobgoblin\n\nEscolha uma arma." });
      if (o3.raca !== "Anão, Hobgoblin" || o3.sub !== "Anão, Hobgoblin" || o3.descricao !== "Escolha uma arma.") return falha("origemDoPoder raça: " + JSON.stringify(o3));
      if (origemDoPoder({ nome: "Tradição de Samurai", categoria: "Concedido", sub: "Honra", descricao: "x" }).divindade !== "Lin-Wu") return falha("domínio sem lista devia cair na tabela");
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
      // renomear: personagem muda o votante; nome muda a chave, a agenda, o autor das publicadas e o cookie
      const HA2 = { cookie: (await fetch(`${base}/api/login`, { method: "POST", body: JSON.stringify({ nome: "amanda", senha: "nova1" }) })).headers.get("set-cookie").split(";")[0], "content-type": "application/json" };
      await fetch(`${base}/api/missoes/votar`, { method: "POST", headers: HA2, body: JSON.stringify({ id: "x-1", ligar: true }) });
      const ren = await fetch(`${base}/api/conta`, { method: "POST", headers: HA2, body: JSON.stringify({ nome: "Amanda Silva", personagem: "Lydia" }) });
      if (ren.status !== 200) return falha("renomear: " + (await ren.json()).erro);
      if (!usuarios["amanda silva"] || usuarios.amanda) return falha("chave não mudou");
      if (!missoes.votos["x-1"]?.Lydia || missoes.votos["x-1"]["Lydia Alnari"]) return falha("voto não seguiu o personagem: " + JSON.stringify(missoes.votos));
      if (!agenda.users["Amanda Silva"] || agenda.users.Amanda) return falha("agenda não seguiu o nome");
      if ((await fetch(`${base}/api/eu`, { headers: { cookie: HA2.cookie } })).status !== 401) return falha("cookie antigo devia morrer");
      const cookieNovo = ren.headers.get("set-cookie").split(";")[0];
      if ((await (await fetch(`${base}/api/eu`, { headers: { cookie: cookieNovo } })).json()).nome !== "Amanda Silva") return falha("cookie novo não veio");
      if ((await fetch(`${base}/api/conta`, { method: "POST", headers: { cookie: cookieNovo, "content-type": "application/json" }, body: JSON.stringify({ nome: "Davi" }) })).status !== 400) return falha("não podia tomar o nome do Davi");
      // mestre renomeia a si mesmo mantendo as publicadas e o papel
      await fetch(`${base}/api/publicar`, { method: "POST", headers: HJ, body: JSON.stringify({ magia }) });
      const renRay = await fetch(`${base}/api/usuarios`, { method: "POST", headers: HJ, body: JSON.stringify({ nome: "Ray", novoNome: "RayNathus", papel: "mestre" }) });
      if (renRay.status !== 200 || !usuarios.raynathus || usuarios.raynathus.papel !== "mestre") return falha("mestre renomeado errado");
      if (!Object.values(estado.publicadas).every((m) => m.autor === "RayNathus")) return falha("autor das publicadas não seguiu");
      const HR = { cookie: renRay.headers.get("set-cookie").split(";")[0], "content-type": "application/json" };
      if ((await (await fetch(`${base}/api/eu`, { headers: HR })).json()).nome !== "RayNathus") return falha("cookie do mestre renomeado");
      // apelido: login aceita nome ou apelido; apelido não pode ser nome/apelido de outro
      if ((await fetch(`${base}/api/conta`, { method: "POST", headers: { cookie: cookieNovo, "content-type": "application/json" }, body: JSON.stringify({ apelido: "Manduuu" }) })).status !== 200) return falha("definir apelido");
      if ((await fetch(`${base}/api/login`, { method: "POST", body: JSON.stringify({ nome: "manduuu", senha: "nova1" }) })).status !== 200) return falha("login pelo apelido");
      if ((await fetch(`${base}/api/usuarios`, { method: "POST", headers: HR, body: JSON.stringify({ nome: "Davi", apelido: "manduuu" }) })).status !== 400) return falha("apelido repetido devia falhar");
      if ((await fetch(`${base}/api/usuarios`, { method: "POST", headers: HR, body: JSON.stringify({ nome: "Manduuu", senha: "1234" }) })).status !== 400) return falha("conta nova com nome igual a apelido devia falhar");
      // criador de ficha: personagens por conta (o "jogador" do site é ignorado), lista/ler/apagar
      const HP = { cookie: cookieNovo, "content-type": "application/json" };
      const putP = await fetch(`${base}/api/criador/personagens/abcd1234?jogador=outro`, { method: "PUT", headers: HP, body: JSON.stringify({ jogador: "outro", nome: "Zé", resumo: "humano guerreiro", estado: { nome: "Zé" }, passo: "raca" }) });
      if (putP.status !== 200) return falha("PUT personagem: " + putP.status);
      const lista2 = await (await fetch(`${base}/api/criador/personagens?jogador=x`, { headers: HP })).json();
      if (lista2.length !== 1 || lista2[0].id !== "abcd1234" || lista2[0].temFicha) return falha("lista de personagens: " + JSON.stringify(lista2));
      if ((await (await fetch(`${base}/api/criador/personagens`, { headers: HR })).json()).length !== 0) return falha("personagem vazou pra outra conta");
      const um = await (await fetch(`${base}/api/criador/personagens/abcd1234`, { headers: HP })).json();
      if (um.estado !== JSON.stringify({ nome: "Zé" }) || um.jogador !== "Amanda Silva") return falha("ler personagem: " + JSON.stringify(um));
      if ((await fetch(`${base}/api/criador/personagens/abcd1234`, { method: "DELETE", headers: HP })).status !== 200) return falha("apagar personagem");
      if ((await fetch(`${base}/api/criador/personagens/abcd1234`, { headers: HP })).status !== 404) return falha("personagem devia sumir");
      if ((await fetch(`${base}/ficha`, { headers: HP, redirect: "manual" })).status !== 302) return falha("/ficha devia redirecionar pra /ficha/");
      // links: padrão vem, mestre troca, jogador não
      const lk = await (await fetch(`${base}/api/links`, { headers: HR })).json(); // H morreu com o rename do Ray
      if (!lk.grupos?.length) return falha("links padrão");
      if ((await fetch(`${base}/api/links`, { method: "PUT", headers: { cookie: cookieNovo, "content-type": "application/json" }, body: JSON.stringify({ grupos: [] }) })).status !== 403) return falha("jogadora não edita links");
      if ((await fetch(`${base}/api/sair`, { method: "POST", headers: HR })).headers.get("set-cookie") !== cookieSessao({ headers: { host: "127.0.0.1" } }, "x", 0)) return falha("sair devia apagar o cookie");
      console.log("server.mjs --check OK");
      server.close();
    } catch (e) { falha(e.stack || e.message); }
  });
} else {
  server.listen(PORT, () => console.log(`Hub T20 em http://localhost:${PORT} (${Object.keys(usuarios).length} contas)`));
}
