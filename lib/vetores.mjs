// lib/vetores.mjs — busca por SENTIDO: vetores bge-m3 (1.024 números, normalizados) de cada item do acervo.
// Os vetores dos itens são feitos no PC (tools/embutir.mjs) e sobem prontos em dados/vetores/<fonte>.f32 + .json;
// aqui só se embute a CONSULTA (Ollama local, ~100 ms) e se compara com tudo (produto escalar, alguns ms).
// Sem Ollama ou sem arquivo, tudo devolve vazio e a busca segue só por palavra — nada quebra.
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

export const DIM = 1024, MODELO = "bge-m3";

export function criarVetores(dir, { url = process.env.OLLAMA_URL || "http://127.0.0.1:11434", desligado = false } = {}) {
  const fontes = new Map(); // nome → { ids, mat } | null (não existe)
  function carregar(nome) {
    if (!fontes.has(nome)) {
      let f = null;
      try {
        const arq = join(dir, nome);
        if (existsSync(arq + ".f32") && existsSync(arq + ".json")) {
          const ids = JSON.parse(readFileSync(arq + ".json", "utf-8")).ids, buf = readFileSync(arq + ".f32");
          // Float32Array precisa começar em múltiplo de 4 dentro do ArrayBuffer: se não começar, copia
          const mat = buf.byteOffset % 4 === 0 ? new Float32Array(buf.buffer, buf.byteOffset, buf.length / 4) : new Float32Array(new Uint8Array(buf).buffer);
          if (mat.length === ids.length * DIM) f = { ids, mat, pos: new Map(ids.map((id, i) => [id, i])) };
          else console.error(`vetores ${nome}: ${mat.length / DIM} vetores para ${ids.length} ids — ignorado`);
        }
      } catch (e) { console.error("vetores " + nome + ":", e.message); }
      fontes.set(nome, f);
    }
    return fontes.get(nome);
  }

  const cache = new Map(); // consulta → vetor (as últimas 500)
  let foraAte = 0, aquecendo = false;
  async function pedir(texto, ms) {
    const r = await fetch(url + "/api/embed", { method: "POST", signal: AbortSignal.timeout(ms), headers: { "content-type": "application/json" }, body: JSON.stringify({ model: MODELO, input: [texto] }) });
    if (!r.ok) throw new Error("ollama " + r.status);
    const v = (await r.json()).embeddings?.[0];
    if (!v || v.length !== DIM) throw new Error("vetor de tamanho inesperado");
    return Float32Array.from(v);
  }
  /** Vetor da consulta, ou null se o Ollama não respondeu a tempo (a busca segue sem o sentido). */
  async function embutir(texto, ms = 1500) {
    const k = String(texto || "").trim().toLowerCase().slice(0, 2000);
    if (desligado || k.length < 3) return null;
    if (cache.has(k)) return cache.get(k);
    if (Date.now() < foraAte) return null;
    try {
      const v = await pedir(k, ms);
      cache.set(k, v);
      if (cache.size > 500) cache.delete(cache.keys().next().value);
      return v;
    } catch (e) {
      // modelo dormindo (primeira consulta depois de horas leva ~2,5 s): não trava a busca — acorda por fora e tenta de novo em 5 s
      foraAte = Date.now() + (e.name === "TimeoutError" ? 5_000 : 30_000);
      if (e.name === "TimeoutError" && !aquecendo) { aquecendo = true; pedir("aquecer", 60_000).catch(() => {}).finally(() => { aquecendo = false; foraAte = 0; }); }
      return null;
    }
  }
  /** Os k itens mais parecidos com o vetor: [[id, cosseno], …] do maior pro menor. `so` (Set de ids) restringe. */
  function vizinhos(nome, v, k = 50, min = 0, so = null) {
    const f = carregar(nome);
    if (!f || !v) return [];
    const { ids, mat } = f, out = [];
    for (let i = 0; i < ids.length; i++) {
      if (so && !so.has(ids[i])) continue;
      let s = 0;
      for (let j = 0, o = i * DIM; j < DIM; j++) s += v[j] * mat[o + j];
      if (s >= min) out.push([ids[i], s]);
    }
    return out.sort((a, b) => b[1] - a[1]).slice(0, k);
  }
  /** Vetor de um item já embutido (pra "parecidos com este"). */
  const vetorDe = (nome, id) => { const f = carregar(nome), i = f?.pos.get(id); return i == null ? null : f.mat.subarray(i * DIM, (i + 1) * DIM); };
  return { embutir, vizinhos, vetorDe, tem: (nome) => !!carregar(nome), aquecer: () => embutir("aquecer o modelo", 60_000) };
}

/**
 * Junta a busca por palavra com a busca por sentido.
 * `achados`: [{ id, rel, … }] da busca por palavra. `sem`: Map id → cosseno. `criar(id)`: monta o item que só o sentido achou.
 * Quem casa as palavras continua valendo pelo `rel`; o sentido soma até PESO pontos. Só-sentido entra (marcado `sem: 1`)
 * quando `resgatar` — poucas palavras casaram ou a consulta é uma frase.
 */
// Cossenos do bge-m3 medidos no acervo. Texto curto (poder e magia = nome + resumo + temas): o que tem a ver fica em
// 0,56–0,65 e o ruído não passa de 0,54. Texto longo (coleções, com o corpo): tudo mais espremido, então resgata mais alto.
export const PESO = 6, CURTO = { piso: 0.48, teto: 0.63, resgate: 0.555 }, LONGO = { piso: 0.5, teto: 0.68, resgate: 0.59 };
export const PISO = CURTO.piso, TETO = CURTO.teto, RESGATE = CURTO.resgate;
export function fundir(achados, sem, criar, resgatar, { piso, teto, resgate } = CURTO) {
  if (!sem?.size) return achados;
  const pontos = (s) => PESO * Math.min(1, Math.max(0, (s - piso) / (teto - piso)));
  const vistos = new Set();
  for (const a of achados) { vistos.add(a.id); const s = sem.get(a.id); if (s) a.rel += pontos(s); }
  if (resgatar) for (const [id, s] of sem) {
    if (vistos.has(id) || s < resgate) continue;
    const x = criar(id);
    if (x) achados.push({ ...x, rel: pontos(s) * 0.9, sem: 1 });
  }
  return achados;
}

// self-test: node lib/vetores.mjs --check
if (process.argv[1]?.replace(/\\/g, "/").endsWith("lib/vetores.mjs") && process.argv.includes("--check")) {
  const { writeFileSync, mkdtempSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const d = mkdtempSync(join(tmpdir(), "vet-"));
  const unit = (i) => { const v = new Float32Array(DIM); v[i] = 1; return v; };
  const mat = new Float32Array(3 * DIM); mat.set(unit(0), 0); mat.set(unit(1), DIM); mat.set(unit(0).map((x, j) => (j === 0 ? 0.8 : j === 1 ? 0.6 : 0)), 2 * DIM);
  writeFileSync(join(d, "t.f32"), Buffer.from(mat.buffer)); writeFileSync(join(d, "t.json"), JSON.stringify({ ids: ["a", "b", "c"] }));
  const V = criarVetores(d, { desligado: true });
  const falha = (m) => { console.error("FALHOU:", m); process.exitCode = 1; };
  const viz = V.vizinhos("t", unit(0), 5, 0.1);
  if (JSON.stringify(viz.map(([id, s]) => [id, +s.toFixed(2)])) !== '[["a",1],["c",0.8]]') falha("vizinhos: " + JSON.stringify(viz));
  if (V.vizinhos("t", unit(0), 5, 0, new Set(["c"])).length !== 1) falha("restrição por ids");
  if (V.tem("naoexiste") || V.vizinhos("naoexiste", unit(0)).length) falha("fonte que não existe devia ser vazia");
  if (await V.embutir("qualquer coisa") !== null) falha("desligado devia devolver null");
  if (Math.abs(V.vetorDe("t", "c")[1] - 0.6) > 1e-6 || V.vetorDe("t", "zz") !== null) falha("vetorDe");
  const f = fundir([{ id: "a", rel: 3 }], new Map([["a", TETO], ["b", 0.6], ["c", 0.5]]), (id) => ({ id }), true);
  if (f[0].rel !== 3 + PESO || f.length !== 2 || f[1].id !== "b" || !f[1].sem) falha("fundir: " + JSON.stringify(f));
  if (fundir([{ id: "a", rel: 3 }], new Map([["b", 0.9]]), (id) => ({ id }), false).length !== 1) falha("sem resgate não devia acrescentar");
  rmSync(d, { recursive: true, force: true });
  if (!process.exitCode) console.log("vetores.mjs --check OK");
}
