# -*- coding: utf-8 -*-
"""Deriva as regras de escola (tabela-custos.json -> 'escolas') do perfil minerado.

Pipeline permanente do projeto: minerar.py -> minerar_escolas.py -> ESTE script.
Mudou o entendimento? Ajusta os limiares aqui e re-roda — nada é feito na mao.

Niveis: 'bloqueio' (0 casos e semantica clara), 'aviso', 'ok'.
"""
import json
import pathlib

BASE = pathlib.Path(__file__).resolve().parents[1]
PERFIL = json.loads((BASE / "data" / "perfil-escolas.json").read_text(encoding="utf-8"))
TAB_P = BASE / "data" / "tabela-custos.json"
t = json.loads(TAB_P.read_text(encoding="utf-8"))

PERFIS_TXT = {  # texto curto pras mensagens do app
    "Abjuração": "proteções, escudos e seladuras",
    "Adivinhação": "informação, sentidos e previsão",
    "Convocação": "criaturas e objetos conjurados",
    "Encantamento": "mente: sono, fascínio, comando",
    "Evocação": "energia pura: blasts e cura pela luz",
    "Ilusão": "enganos sensoriais",
    "Necromancia": "morte, medo e drenagem (dano de trevas)",
    "Transmutação": "transformar matéria e corpo",
}
CURA_SEMPRE_OK = {"Evocação"}  # cura pela luz; Necromancia drena (raro)

escolas = {}
for nome, e in PERFIL["escolas"].items():
    n = e["n"]
    dn = e["dano"]["n"]
    nivel_dano = "bloqueio" if dn == 0 else "aviso" if dn <= 2 else "ok"
    cn = e["cura"]["n"]
    nivel_cura = "ok" if nome in CURA_SEMPRE_OK else "aviso" if cn else "bloqueio"
    testes = e["resistencia_teste"]
    total_t = sum(testes.values())
    teste_tipico = next((tst for tst, c in testes.items()
                         if tst != "especial" and total_t >= 5 and c / total_t >= 0.8), None)
    n_area = sum(e["formas_area"].values())
    cond_cats = [c for c, v in e["condicoes"]["categorias"].items() if c != "outra" and v >= 1]
    escolas[nome] = {
        "n": n,
        "perfil": PERFIS_TXT.get(nome, ""),
        "dano": nivel_dano, "dano_n": dn,
        "tiposDano": [tp for tp, c in e["dano"]["tipos"].items() if c >= 2],  # 1 caso = exceção, não perfil
        "cura": nivel_cura, "cura_n": cn,
        "areas": "raro" if n_area / n <= 0.10 else "ok", "areas_n": n_area,
        "condCategorias": cond_cats,
        "condRaras": e["condicoes"]["n_magias"] <= 2,
        "testeTipico": teste_tipico.capitalize() if teste_tipico else None,
    }

t["escolas"] = {"comentario": "DERIVADO de data/perfil-escolas.json por tools/regras_escolas.py — nao editar na mao, re-rodar o pipeline.", **escolas}
t["versao"] = max(t.get("versao", 0), 11)  # nao rebaixar: quem manda na versao e a tabela
TAB_P.write_text(json.dumps(t, ensure_ascii=False, indent=1), encoding="utf-8")
for nome, r in escolas.items():
    print(f"{nome[:14]:14s} dano={r['dano']:8s} cura={r['cura']:8s} áreas={r['areas']:4s} "
          f"cats={','.join(sorted(r['condCategorias']))[:44]:44s} teste={r['testeTipico']}")
