#!/bin/sh
# marca a versão (BUILD) no index.html e em version.json antes de cada commit
b=$(date -u +%Y%m%d%H%M%S)
sed -i "s/^const BUILD='[^']*';/const BUILD='$b';/" index.html
printf '{"b":"%s"}\n' "$b" > version.json
