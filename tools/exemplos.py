# -*- coding: utf-8 -*-
"""Gera data/exemplos.json: galeria de precos de referencia para o app.

- utilitarias: preco do efeito DERIVADO (orcamento - eixos). E a regua que o
  usuario consulta ao precificar um efeito custom ("Comando custa ~X").
- numericas: reconstrucao completa (partes + total) como prova de calibracao.

So nome + numeros/categorias -- nenhum texto autoral da Jambo.
"""
import json
import pathlib

from calibrar import DATASET, TABELA, eh_numerica, reconstruir

BASE = pathlib.Path(__file__).resolve().parents[1]
SAIDA = BASE / "data" / "exemplos.json"

ds = json.loads(DATASET.read_text(encoding="utf-8"))
c1 = [m for m in ds["magias"] if m["circulo"] == 1]
orc = TABELA["orcamento"]["1"]

exemplos = {"orcamento": orc, "utilitarias": [], "numericas": []}
for m in c1:
    total, partes = reconstruir(m)
    base = {"slug": m["slug"], "nome": m["nome"], "grupo": m["grupo"],
            "escola": m["escola"],
            "eixos": {"execucao": m["execucao"]["cat"], "alcance": m["alcance"]["cat"],
                      "duracao": m["duracao"]["cat"], "resistencia": m["resistencia"]["modo"],
                      "alvo": {k: v for k, v in m["alvo"].items() if k != "bruto"}}}
    if eh_numerica(m):
        exemplos["numericas"].append({**base, "partes": partes, "total": total})
    else:
        eixos = total - partes.get("utilitario", 0)
        exemplos["utilitarias"].append({**base, "custo_eixos": eixos,
                                        "preco_efeito": orc - eixos})

exemplos["utilitarias"].sort(key=lambda x: x["preco_efeito"])
exemplos["numericas"].sort(key=lambda x: x["total"])
SAIDA.write_text(json.dumps(exemplos, ensure_ascii=False, indent=1), encoding="utf-8")
print(f"{len(exemplos['utilitarias'])} utilitarias + {len(exemplos['numericas'])} numericas -> {SAIDA}")
assert "descricao" not in json.dumps(exemplos), "vazou texto"
print("OK")
