# -*- coding: utf-8 -*-
"""Padroes do corpus que viram REGRA no motor de custo (artefato permanente).

Le ../magias-t20/dataset.json (local, textos da Jambo) e escreve
data/padroes-corpus.json — so nomes e numeros, nunca o texto das magias:

- tipos_escolhiveis: oficiais em que o jogador escolhe o tipo de dano/energia na
  hora. Prova (a) que o padrao existe e (b) que as oficiais NUNCA misturam faixas
  de custo de tipo -> lista de tipos paga o delta mais caro da lista.
- cd_fixa: toda CD numerica escrita na descricao (a CD normal e 10 + metade do
  nivel + atributo, entao CD fixa e um teto que nao escala).
- resistencia_por_efeito: que modo as oficiais usam para so-dano, dano+condicao,
  so-condicao. E daqui que sai "parcial = metade do dano E evita a condicao".
- condicoes_alternativas: oficiais com varias condicoes em que so uma se aplica.

Uso: python tools/minerar_padroes.py
"""
import collections
import json
import pathlib
import re

BASE = pathlib.Path(__file__).resolve().parents[1]
DATASET = BASE.parents[0] / "magias-t20" / "dataset.json"
SAIDA = BASE / "data" / "padroes-corpus.json"

TIPOS = ["fogo", "frio", "eletricidade", "acido", "veneno", "corte", "impacto",
         "perfuracao", "luz", "trevas", "psiquico", "essencia"]
FAIXA = {"fogo": 0, "frio": 0, "eletricidade": 0, "acido": 0, "veneno": 0,
         "corte": -1, "impacto": -1, "perfuracao": -1, "luz": 1, "trevas": 1,
         "psiquico": 2, "essencia": 2}
ESCOLHE = re.compile(r"escolh", re.I)  # frase com "escolh*" + 2 tipos = escolha de tipo
ALTERNATIVA = re.compile(r"escolh\w+ (?:um dos|entre) (?:os )?(?:seguintes|efeitos)", re.I)
CD = re.compile(r"([^.]{0,60})\bCD (\d+)")
PERICIA = re.compile(r"\b(Acrobacia|Atletismo|Fortitude|Reflexos|Vontade|Misticismo|Força|"
                     r"Percepção|Ofício|Luta|Pontaria|Furtividade|Enganação|Intimidação)\b")


def sem_acento(s):
    import unicodedata
    return "".join(c for c in unicodedata.normalize("NFD", s or "")
                   if unicodedata.category(c) != "Mn").lower()


def main():
    ms = json.loads(DATASET.read_text(encoding="utf-8"))["magias"]
    saida = {
        "comentario": "DERIVADO de dataset.json por tools/minerar_padroes.py — nao editar na mao.",
        "n_magias": len(ms),
    }

    escolhiveis, mistura = [], 0
    for m in ms:
        # a escolha acontece numa frase so: "escolha um tipo de energia entre acido, ... ou frio"
        frases = [f for f in re.split(r"[.;]", sem_acento(m["descricao"])) if ESCOLHE.search(f)]
        tipos = sorted({t for f in frases for t in TIPOS if re.search(r"\b" + t, f)})
        if len(tipos) < 2:
            continue
        faixas = sorted({FAIXA[t] for t in tipos})
        mistura += len(faixas) > 1
        escolhiveis.append({"nome": m["nome"], "circulo": m["circulo"], "tipos": tipos,
                            "faixas": faixas, "com_dano": "dano" in m})
    saida["tipos_escolhiveis"] = {
        "n": len(escolhiveis),
        "misturam_faixas": mistura,
        "regra": "lista de tipos paga o delta mais caro da lista (custo_tipo_dano) — a maioria "
                 "das oficiais agrupa tipos da mesma faixa, e as que misturam (Runa de Protecao) "
                 "cobrariam a faixa de cima de qualquer jeito",
        "magias": escolhiveis,
    }

    cds = []
    for m in ms:
        for antes, valor in CD.findall(m["descricao"]):
            achados = PERICIA.findall(antes)
            cds.append({"nome": m["nome"], "circulo": m["circulo"],
                        "teste": achados[-1] if achados else None, "cd": int(valor)})
    saida["cd_fixa"] = {
        "n": len(cds),
        "comentario": "CD normal = 10 + metade do nivel + atributo (LB, cap. Magia); CD fixa nao escala.",
        "valores": sorted({c["cd"] for c in cds}),
        "casos": cds,
    }

    por_efeito = collections.defaultdict(collections.Counter)
    for m in ms:
        tem_d, tem_c = "dano" in m, bool(m.get("condicoes"))
        cat = "dano+condicao" if tem_d and tem_c else "so_dano" if tem_d else \
              "so_condicao" if tem_c else "outros"
        por_efeito[cat][m["resistencia"]["modo"]] += 1
    saida["resistencia_por_efeito"] = {
        "comentario": "dano+condicao nas oficiais e sempre 'parcial': passar reduz o dano a "
                      "metade E evita a condicao (Adaga Mental, Detonacao Congelante). "
                      "'reduz-metade' e o modo de dano puro (Bola de Fogo).",
        "por_categoria": {k: dict(v.most_common()) for k, v in sorted(por_efeito.items())},
    }

    alt = [{"nome": m["nome"], "circulo": m["circulo"], "condicoes": m["condicoes"]}
           for m in ms if len(m.get("condicoes") or []) >= 2 and ALTERNATIVA.search(m["descricao"])]
    saida["condicoes_alternativas"] = {
        "n": len(alt),
        "comentario": "so uma das condicoes se aplica por conjuracao. Rogar Maldicao (2o, 6 "
                      "alternativas) fecha em 18.5/18 com a regra normal (a mais cara cheia, "
                      "extras pela metade) -> alternativa NAO ganha desconto proprio.",
        "magias": alt,
    }

    SAIDA.write_text(json.dumps(saida, ensure_ascii=False, indent=1), encoding="utf-8")
    assert saida["tipos_escolhiveis"]["n"] >= 4, "escolha de tipo sumiu do corpus?"
    assert saida["cd_fixa"]["n"] >= 5 and saida["condicoes_alternativas"]["n"] >= 1
    print(f"padroes-corpus.json: {len(escolhiveis)} com escolha de tipo "
          f"(misturam faixas: {mistura}), {len(cds)} CDs fixas, {len(alt)} com condicoes alternativas")
    for c in saida["resistencia_por_efeito"]["por_categoria"].items():
        print(" ", c)


if __name__ == "__main__":
    main()
