# -*- coding: utf-8 -*-
"""Gera dados/aprimoramentos.json: os 748 aprimoramentos oficiais com o
contexto da magia dona, pra busca de sugestoes no server.

Tem texto Jambo -> dados/ (gitignored), sobe por scp. Nunca no repo.
"""
import json
import pathlib

BASE = pathlib.Path(__file__).resolve().parents[1]
DATASET = BASE.parents[0] / "magias-t20" / "dataset.json"
SAIDA = BASE / "dados" / "aprimoramentos.json"

ds = json.loads(DATASET.read_text(encoding="utf-8"))
itens = []
for m in ds["magias"]:
    ctx = {
        "slug": m["slug"], "nome": m["nome"], "escola": m["escola"],
        "grupo": m["grupo"], "circulo": m["circulo"],
        "alcance": m["alcance"]["cat"], "duracao": m["duracao"]["cat"],
        "resistencia": m["resistencia"]["modo"],
        "alvo_tipo": m["alvo"]["tipo"],
        "alvo_restrito": m["alvo"].get("restrito"),
        "area_forma": m["alvo"].get("forma"),
        "dano_dados": m.get("dano", {}).get("dados"),
        "tem_cura": "cura" in m,
        "condicoes": m.get("condicoes", []),
    }
    for a in m["aprimoramentos"]:
        itens.append({"pm": a["pm"], "truque": a["truque"],
                      "restrito": a.get("restrito", False),
                      "texto": a["texto"].strip(),
                      "deltas": [d["tipo"] for d in a["deltas"]],
                      "magia": ctx})

SAIDA.parent.mkdir(exist_ok=True)
SAIDA.write_text(json.dumps(itens, ensure_ascii=False), encoding="utf-8")
print(f"{len(itens)} aprimoramentos -> {SAIDA}")
