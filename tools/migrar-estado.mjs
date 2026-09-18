// tools/migrar-estado.mjs — migração única do estado.json do criador-magias pro hub:
// as contas antigas eram nomes digitados ("raynathus", "eu"…); no hub cada conta tem nome fixo.
// node tools/migrar-estado.mjs <estado-antigo.json> <estado-novo.json> "raynathus=Raimundo" "eu=Raimundo" "davi=Davi" "amanda=Amanda"
import { readFileSync, writeFileSync } from "node:fs";
const [de, para, ...mapas] = process.argv.slice(2);
const mapa = Object.fromEntries(mapas.map((m) => m.split("=")));
const norm = (n) => (n || "").trim().normalize("NFC").toLowerCase();
const d = JSON.parse(readFileSync(de, "utf-8"));
const usuarios = {};
for (const [k, magias] of Object.entries(d.usuarios || {})) {
  const novo = norm(mapa[norm(k)] || k);
  usuarios[novo] = usuarios[novo] || [];
  for (const m of magias) if (!m.id || !usuarios[novo].some((x) => x.id === m.id)) usuarios[novo].push(m);
}
const publicadas = {};
for (const [id, m] of Object.entries(d.publicadas || {})) publicadas[id] = { ...m, autor: mapa[norm(m.autor)] || m.autor };
writeFileSync(para, JSON.stringify({ usuarios, publicadas }));
console.log("usuários:", Object.fromEntries(Object.entries(usuarios).map(([k, v]) => [k, v.length])), "publicadas:", Object.keys(publicadas).length);
