# -*- coding: utf-8 -*-
"""Gera dados/textos.json: textos oficiais por slug, SERVIDOS pelo server local.

Fica em dados/ (gitignored) e sobe por scp no deploy — o repo publico nunca
versiona texto da Jambo. Fonte: dataset.json local.
"""
import json
import pathlib

BASE = pathlib.Path(__file__).resolve().parents[1]
DATASET = BASE.parents[0] / "magias-t20" / "dataset.json"
SAIDA = BASE / "dados" / "textos.json"

ds = json.loads(DATASET.read_text(encoding="utf-8"))
textos = {}
for m in ds["magias"]:
    textos[m["slug"]] = {
        "nome": m["nome"],
        "escola": m["escola"], "grupo": m["grupo"], "circulo": m["circulo"],
        "linha": f"{m['escola']} · {m['grupo']} · {m['circulo']}º círculo",
        "stats": {"Execução": m["execucao"]["bruto"], "Alcance": m["alcance"]["bruto"],
                  "Alvo/Área": m["alvo"]["bruto"], "Duração": m["duracao"]["bruto"],
                  "Resistência": m["resistencia"]["bruto"] or "nenhuma"},
        "descricao": m["descricao"],
        "aprimoramentos": [{"custo": a["bruto_custo"], "texto": a["texto"]}
                           for a in m["aprimoramentos"]],
        "publicacao": m["publicacao"],
    }

SAIDA.parent.mkdir(exist_ok=True)
SAIDA.write_text(json.dumps(textos, ensure_ascii=False), encoding="utf-8")
print(f"{len(textos)} textos -> {SAIDA}")
