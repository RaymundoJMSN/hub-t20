# -*- coding: utf-8 -*-
"""Le dataset.json e agrega a tarifa oficial de PM por tipo de delta.

Sinal limpo = aprimoramentos com UM delta mecanico so (custo inteiro atribuivel
ao delta). Saida data/tarifas-pm.json: por (delta, valor, circulo da magia) ->
distribuicao de custos PM + mediana. E o que o app usa pra sugerir preco.
"""
import json
import pathlib
import statistics
from collections import defaultdict

BASE = pathlib.Path(__file__).resolve().parents[1]
DATASET = BASE.parents[0] / "magias-t20" / "dataset.json"
SAIDA = BASE / "data" / "tarifas-pm.json"


def chave(delta):
    v = delta.get("valor")
    return delta["tipo"] + (f":{v}" if v is not None else "")


def minerar_tarifas():
    ds = json.loads(DATASET.read_text(encoding="utf-8"))
    porchave = defaultdict(list)   # chave -> [(pm, circulo, magia)]
    for m in ds["magias"]:
        for a in m["aprimoramentos"]:
            if a["pm"] is None or a.get("truque") or a.get("restrito"):
                continue
            mec = [d for d in a["deltas"] if d["tipo"] not in ("efeito-novo", "substitui")]
            if len(mec) == 1 and len(a["deltas"]) == 1:  # sinal limpo
                porchave[chave(mec[0])].append((a["pm"], m["circulo"], m["slug"]))

    tarifas = {}
    for k, obs in sorted(porchave.items(), key=lambda kv: -len(kv[1])):
        pms = [o[0] for o in obs]
        tarifas[k] = {
            "n": len(obs),
            "pm_mediana": statistics.median(pms),
            "pm_moda": statistics.mode(pms),
            "pm_dist": {str(pm): pms.count(pm) for pm in sorted(set(pms))},
            "por_circulo": {
                str(c): statistics.median([o[0] for o in obs if o[1] == c])
                for c in sorted({o[1] for o in obs})
            },
            "exemplos": [o[2] for o in obs[:4]],
        }

    # efeitos-novos: distribuicao geral de custo por circulo (base da galeria custom)
    novos = defaultdict(list)
    for m in ds["magias"]:
        for a in m["aprimoramentos"]:
            if a["pm"] is not None and not a.get("truque") and not a.get("restrito") \
                    and all(d["tipo"] in ("efeito-novo", "substitui") for d in a["deltas"]):
                novos[m["circulo"]].append(a["pm"])
    efeito_novo = {str(c): {"n": len(v), "pm_mediana": statistics.median(v),
                            "pm_dist": {str(pm): v.count(pm) for pm in sorted(set(v))}}
                   for c, v in sorted(novos.items())}

    out = {"fonte_versao": ds["versao"], "fonte_sha1": ds["fonte_sha1"],
           "tarifas": tarifas, "efeito_novo_por_circulo": efeito_novo}
    SAIDA.parent.mkdir(exist_ok=True)
    SAIDA.write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"{len(tarifas)} tarifas -> {SAIDA}")
    for k, t in list(tarifas.items())[:14]:
        print(f"  {k:28s} n={t['n']:3d} mediana={t['pm_mediana']} dist={t['pm_dist']}")
    return out


if __name__ == "__main__":
    t = minerar_tarifas()
    assert t["tarifas"], "nenhuma tarifa minerada"
    assert t["tarifas"].get("dano+:1d6", {}).get("n", 0) >= 5, "sumiu o padrao +1d6"
    print("OK")
