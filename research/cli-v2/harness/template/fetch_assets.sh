#!/bin/sh
# Downloads the test models into assets/ and public/models/ (they are not committed: ~33 MB).
# Every file is checked against the SHA-1 of the copy used in the trials.
set -e
cd "$(dirname "$0")"
mkdir -p assets public/models
K=https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models
T=https://raw.githubusercontent.com/mrdoob/three.js/r170/examples/models
get() { # url dest sha1
  [ -f "$2" ] && echo "$3  $2" | sha1sum -c --quiet 2>/dev/null && return 0
  curl -sSLf -o "$2" "$1"
  echo "$3  $2" | sha1sum -c --quiet || { echo "checksum mismatch: $2" >&2; exit 1; }
}
get $K/DamagedHelmet/glTF-Binary/DamagedHelmet.glb assets/helmet.glb 85c96ef38aea6342df2841f4bfd5a2c496aa4e81
get $K/ToyCar/glTF-Binary/ToyCar.glb assets/toycar.glb e19747445e1803a1cb508127d466519aabb626c7
get $K/Lantern/glTF-Binary/Lantern.glb assets/lantern.glb 4693ec739a5244a02d6a82959f7ceb31ecdcf85a
get $K/BoomBox/glTF-Binary/BoomBox.glb assets/boombox.glb 3259d2309bdfadbf6bf39b5ec65014c6641f5f3a
get $K/Duck/glTF-Binary/Duck.glb assets/duck.glb 78170efd55f69ea61bda4ab184ba0776c78c5b5c
get $K/Fox/glTF-Binary/Fox.glb assets/fox.glb a8a8829ae77284f58311da489dd758628a7a1e13
get "$T/fbx/Samba%20Dancing.fbx" assets/robot.fbx 4ad183809aaa7c30f03baee1c998e612c3520dd2
get $T/obj/male02/male02.obj assets/male02.obj 5c881fec489a6b840cd62110f9456b8229352838
get $T/obj/male02/male02.mtl assets/male02.mtl 1c17e83a9ed963399ae61117c8f31a3ef26565e4
get $T/obj/male02/01_-_Default1noCulling.JPG assets/01_-_Default1noCulling.JPG ce60ee268549e2ae662b5f96c9ef3077819448f5
get $T/obj/male02/male-02-1noCulling.JPG assets/male-02-1noCulling.JPG 562c88d0270ed58731182a66d572a9a70a98acbf
get $T/obj/male02/orig_02_-_Defaul1noCulling.JPG assets/orig_02_-_Defaul1noCulling.JPG 15b58906167de1e795ca3a196fbb258872704ad2
head -c 40000 assets/duck.glb > assets/broken.glb   # a truncated GLB, for error-handling tasks
# The site starts out serving the unoptimized originals.
cp assets/helmet.glb assets/toycar.glb assets/boombox.glb public/models/
echo "assets ready"
