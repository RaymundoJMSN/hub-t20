# -*- coding: utf-8 -*-
"""Exporta data/features.json: dataset sem NENHUM texto autoral da Jambo.

So numeros/categorias -- e o que o repo publico versiona e o que o app usa
como "exemplos oficiais". Descricoes ficam no dataset.json local.
"""
import json
import pathlib

BASE = pathlib.Path(__file__).resolve().parents[1]
DATASET = BASE.parents[0] / "magias-t20" / "dataset.json"
SAIDA = BASE / "data" / "features.json"

ds = json.loads(DATASET.read_text(encoding="utf-8"))
feats = []
for m in ds["magias"]:
    f = {k: m[k] for k in ("id", "slug", "nome", "grupo", "circulo", "escola", "publicacao")}
    f["execucao"] = m["execucao"]["cat"]
    f["alcance"] = m["alcance"]["cat"]
    f["duracao"] = m["duracao"]["cat"]
    f["resistencia"] = {k: m["resistencia"][k] for k in ("teste", "modo")}
    f["alvo"] = {k: v for k, v in m["alvo"].items() if k != "bruto"}
    for k in ("dano", "cura", "condicoes", "modificador"):
        if k in m:
            f[k] = m[k]
    f["aprimoramentos"] = [
        {"pm": a["pm"], "truque": a["truque"], "deltas": a["deltas"]}
        for a in m["aprimoramentos"]]
    feats.append(f)

SAIDA.parent.mkdir(exist_ok=True)
SAIDA.write_text(json.dumps(
    {"versao": ds["versao"], "fonte_sha1": ds["fonte_sha1"], "magias": feats},
    ensure_ascii=False, indent=1), encoding="utf-8")
print(f"{len(feats)} magias -> {SAIDA}")
assert "descricao" not in json.dumps(feats), "vazou texto"
assert not any("texto" in a for f in feats for a in f["aprimoramentos"]), "vazou texto de aprimoramento"
print("OK sem texto autoral")
