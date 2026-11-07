#!/bin/sh
# Copia js/core.js a apps-script/Core.gs (deben ser idénticos).
cd "$(dirname "$0")/.." && cp js/core.js apps-script/Core.gs && echo "Core.gs actualizado"
