# -*- coding: utf-8 -*-
"""Perfil profundo de cada escola de magia, minerado das 275 oficiais.

Gera data/perfil-escolas.json: o ARTEFATO PERMANENTE (regra do projeto) —
toda regra futura de escola deriva dele, nunca re-analisa na mao.
So numeros/categorias, zero texto autoral.
"""
import json
import pathlib
from collections import Counter, defaultdict

BASE = pathlib.Path(__file__).resolve().parents[1]
DATASET = BASE.parents[0] / "magias-t20" / "dataset.json"
TABELA = json.loads((BASE / "data" / "tabela-custos.json").read_text(encoding="utf-8"))
SAIDA = BASE / "data" / "perfil-escolas.json"

CAT = {c: cat for cat, lista in TABELA["condicao_categoria"].items() for c in lista}

ds = json.loads(DATASET.read_text(encoding="utf-8"))
P = defaultdict(lambda: {
    "n": 0, "por_circulo": Counter(), "grupos": Counter(),
    "dano": {"n": 0, "tipos": Counter(), "com_area": 0, "com_condicao": 0},
    "cura": {"n": 0},
    "modificador": {"n": 0},
    "condicoes": {"n_magias": 0, "quais": Counter(), "categorias": Counter()},
    "alvo": Counter(), "formas_area": Counter(), "restritos": Counter(),
    "execucao": Counter(), "alcance": Counter(), "duracao": Counter(),
    "resistencia_teste": Counter(), "resistencia_modo": Counter(),
    "aprimoramentos": {"n": 0, "deltas": Counter(), "pm_mediana_base": []},
})

for m in ds["magias"]:
    e = P[m["escola"]]
    e["n"] += 1
    e["por_circulo"][m["circulo"]] += 1
    e["grupos"][m["grupo"]] += 1
    if "dano" in m:
        e["dano"]["n"] += 1
        if m["dano"].get("tipo"): e["dano"]["tipos"][m["dano"]["tipo"]] += 1
        if m["alvo"]["tipo"] == "area": e["dano"]["com_area"] += 1
        if m.get("condicoes"): e["dano"]["com_condicao"] += 1
    if "cura" in m: e["cura"]["n"] += 1
    if "modificador" in m: e["modificador"]["n"] += 1
    if m.get("condicoes"):
        e["condicoes"]["n_magias"] += 1
        for c in m["condicoes"]:
            e["condicoes"]["quais"][c] += 1
            e["condicoes"]["categorias"][CAT.get(c, "outra")] += 1
    e["alvo"][m["alvo"]["tipo"]] += 1
    if m["alvo"]["tipo"] == "area": e["formas_area"][m["alvo"].get("forma", "?")] += 1
    if m["alvo"].get("restrito"): e["restritos"][m["alvo"]["restrito"]] += 1
    e["execucao"][m["execucao"]["cat"]] += 1
    e["alcance"][m["alcance"]["cat"]] += 1
    e["duracao"][m["duracao"]["cat"]] += 1
    if m["resistencia"]["teste"]: e["resistencia_teste"][m["resistencia"]["teste"]] += 1
    e["resistencia_modo"][m["resistencia"]["modo"]] += 1
    for a in m["aprimoramentos"]:
        e["aprimoramentos"]["n"] += 1
        for d in a["deltas"]: e["aprimoramentos"]["deltas"][d["tipo"]] += 1

def plain(x):
    if isinstance(x, Counter): return dict(x.most_common())
    if isinstance(x, dict): return {k: plain(v) for k, v in x.items()}
    return x

out = {"fonte_versao": ds["versao"], "fonte_sha1": ds["fonte_sha1"],
       "taxonomia_condicoes": TABELA["condicao_categoria"],
       "escolas": {k: plain(dict(v)) for k, v in sorted(P.items())}}
for e in out["escolas"].values(): e["aprimoramentos"].pop("pm_mediana_base", None)
SAIDA.write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
print(f"{len(out['escolas'])} escolas -> {SAIDA}")
