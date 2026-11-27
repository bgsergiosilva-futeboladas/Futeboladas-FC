#!/bin/sh
# Corre antes de cada versão publicada:
#  1) sobe o número da versão do rodapé (1.1 → 1.2 → 1.3 …) na app e no ecrã de login
#  2) marca a versão (BUILD) no index.html e em version.json para as apps recarregarem sozinhas
#  ./publicar.sh --manter-versao  → só correções pequenas: não sobe o número
set -e
cur=$(sed -n "s/^const APPVER='\([0-9]*\)\.\([0-9]*\)';.*/\1.\2/p" index.html)
if [ "$1" = "--manter-versao" ]; then nov="$cur"; else
  maj=${cur%.*}; min=${cur#*.}; nov="$maj.$((min + 1))"
  sed -i "s/^const APPVER='$cur';/const APPVER='$nov';/" index.html
  sed -i "s/Futeboladas APP™ versão $cur /Futeboladas APP™ versão $nov /" supa.js
fi
b=$(date -u +%Y%m%d%H%M%S)
sed -i "s/^const BUILD='[^']*';/const BUILD='$b';/" index.html
printf '{"b":"%s"}\n' "$b" > version.json
echo "versão $cur → $nov (build $b)"
