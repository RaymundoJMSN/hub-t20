#!/usr/bin/env bash
# deploy/instalar-servidor.sh — primeira instalação no devilsworks (roda NO servidor, depois do deploy.ps1):
# systemd, migração do estado do criador-magias e da agenda do data-rpg, contas, nginx apontando pro 8100.
# uso: bash deploy/instalar-servidor.sh Raimundo:senha Lais:senha ...   (Raimundo vira mestre)
set -e
cd /home/ubuntu/hub-t20
sudo cp deploy/hub-t20.service /etc/systemd/system/ && sudo systemctl daemon-reload && sudo systemctl enable hub-t20 >/dev/null 2>&1
[ -f dados/estado.json ] || node tools/migrar-estado.mjs /home/ubuntu/criador-magias/dados/estado.json dados/estado.json raynathus=Raimundo eu=Raimundo davi=Davi amanda=Amanda
[ -f dados/agenda.json ] || cp /home/ubuntu/data-rpg/data/agenda.json dados/agenda.json
for par in "$@"; do
  nome="${par%%:*}"; senha="${par#*:}"; papel=jogador; [ "$nome" = Raimundo ] && papel=mestre
  node server.mjs --usuario "$nome" "$senha" $papel
done
sudo sed -i 's#proxy_pass http://127.0.0.1:8070;#proxy_pass http://127.0.0.1:8100;#' /etc/nginx/sites-enabled/magias.raynathus.com.br
sudo nginx -t && sudo systemctl reload nginx
sudo systemctl restart hub-t20; sleep 1
curl -s -o /dev/null -w "hub local: %{http_code}\n" http://127.0.0.1:8100/login
