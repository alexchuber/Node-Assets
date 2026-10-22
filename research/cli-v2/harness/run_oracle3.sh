#!/bin/sh
# Reference (oracle) tune runs with the finer NA_ORACLE grid, one at a time on a quiet machine.
set -x
cd "$(dirname "$0")/oracle"
[ -e assets ] || ln -s ../template/assets assets
B="node ../../prototype/bin.mjs"
export NA_ORACLE=1
$B tune assets/toycar.glb --for load -o ref3/ --time-limit 60m > ref3_toycar.out 2> ref3_toycar.err
$B tune assets/helmet.glb --for gpu,compat -o ref3/ --time-limit 60m > ref3_helmet.out 2> ref3_helmet.err
$B tune assets/lantern.glb --for size,gpu -o ref3/ --time-limit 60m > ref3_lantern.out 2> ref3_lantern.err
$B tune assets/boombox.glb assets/helmet.glb assets/toycar.glb --for size --amortize 3 -o ref3_s1/ --time-limit 90m > ref3_s1.out 2> ref3_s1.err
echo ORACLE_DONE
