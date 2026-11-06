#!/bin/bash
# Creates openhab-test-suite.min.js from openhab-test-suite.js – only Python is needed:
#   pip install rjsmin && bash tools/build.sh
set -e
cd "$(dirname "$0")/.."
python3 - <<'X'
import re, rjsmin
src = open("openhab-test-suite.js", encoding="utf-8").read()
licence = re.match(r"/\*\*.*?\*/", src, re.S).group(0)
open("openhab-test-suite.min.js", "w", encoding="utf-8").write(licence + "\n" + rjsmin.jsmin(src) + "\n")
X
echo "openhab-test-suite.min.js: $(wc -c < openhab-test-suite.min.js) bytes"
