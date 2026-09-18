# Hub T20

A mesa de **Tormenta 20** num lugar só, atrás de login com senha: grimório e criador de magias,
bestiário com a ficha inteira, itens, regras dos livros + STR, compêndio, quadro de missões,
agenda de sessões e os links da mesa (Foundry, call, cenas, arena, downloads).

Um processo Node puro (`server.mjs`, sem dependências), um deploy, um domínio: **rpg.raynathus.com.br** (`magias.` e `data.` só redirecionam). Instalável como app (PWA: manifest + `sw.js` rede-primeiro; no celular a barra de abas fica embaixo).

## Abas

| Aba | O que é | De onde vem |
|---|---|---|
| 📖 Grimório (`/`, `/criar`) | 275 magias oficiais + 1.612 poderes + magias da mesa; criador por compra de pontos | herdado do [criador-magias-t20](https://github.com/RaymundoJMSN/criador-magias-t20) |
| 🐉 Bestiário (`/bestiario`) | 620 ameaças com ficha completa (ataques, habilidades, atributos, imagem) | Arsenal |
| 🎒 Itens (`/itens`) | armas, armaduras, itens gerais e mágicos, encantos, modificações, maldições, culinária | Arsenal |
| ⚖️ Regras (`/regras`) | capítulos de regras dos livros (testes, combate, cobertura, condições, perigos, regras opcionais) + 492 respostas do STR + perigos + breves jornadas | livros em markdown + Arsenal |
| 🏛️ Compêndio (`/compendio`) | raças, classes, origens, deuses, distinções, parceiros | livros em markdown + Arsenal |
| 📜 Missões (`/missoes`) | quadro da guilda: cada um vota no que quer fazer, o mestre marca cumprida e edita o quadro | herdado do guilda-mineradores |
| 📅 Agenda (`/agenda`) | calendário: quem pode em cada dia, próxima sessão = dia mais próximo com 4+ | herdado do data-rpg |
| 🎲 Mesa (`/links`) | links e downloads; o mestre edita | `dados/links.json` |
| 👑 Mestre (`/mestre`) | contas: criar, trocar senha, personagem | `dados/usuarios.json` |

Qualquer ficha (magia, poder, ameaça, item, regra…) abre como carta na **mesa** flutuante
(`static/quadro.js`), que segue entre as páginas; `/c/<coleção>/<id>` é o link direto.

## Dados

- `dados/` fica **fora do git** (texto da Jambo e dados dos jogadores). `tools/importar.mjs` gera
  `dados/colecoes/*.json` a partir do [Arsenal](https://github.com/nicholemos/arsenal) (clone ao lado,
  `../arsenal`) e dos livros em markdown (`../tormenta-livros/livros`). `--missoes ../guilda-mineradores`
  migra o quadro antigo.
- Cada coleção: `{ meta: { titulo, filtros:[{k,rotulo}], ordem:{k:[…]} }, itens: [{ id, nome, linha, grupo, f, t, html }] }`.
  `t` = texto pesquisável normalizado; `html` já sanitizado (o servidor confia, o navegador só mostra).
- Login: `dados/usuarios.json` (scrypt) + cookie `hub` assinado com HMAC (`dados/segredo`). Sem sessão a
  API dá 401 e toda página vira a tela de login com o destino guardado.

## Rodar

```
node server.mjs --usuario "Raimundo" senha mestre      # cria a conta do mestre
node server.mjs                                        # http://localhost:8100
node server.mjs --check && node tools/importar.mjs --check
```

Deploy: `deploy/deploy.ps1` (devilsworks, porta 8100, systemd `hub-t20`).

Ferramenta de fã. Tormenta 20 pertence à Jambo Editora. Dados de ameaças, itens, STR e perigos
vêm do Arsenal (Nicholas Lemos); os livros em markdown vêm do accessible-tormenta.
