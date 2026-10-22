import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

// Models are served from public/models/ (Vite serves public/ at the site root).
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment()).texture;
const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.01, 100);
camera.position.set(0, 0.5, 3);
const controls = new OrbitControls(camera, renderer.domElement);

const loader = new GLTFLoader();
let current;

async function show(name) {
  const gltf = await loader.loadAsync(`/models/${name}.glb`);
  if (current) scene.remove(current);
  current = gltf.scene;
  const box = new THREE.Box3().setFromObject(current);
  const size = box.getSize(new THREE.Vector3()).length();
  current.position.sub(box.getCenter(new THREE.Vector3()));
  current.scale.setScalar(2 / size);
  scene.add(current);
}

document.getElementById('model').addEventListener('change', (e) => show(e.target.value));
show('boombox');

renderer.setAnimationLoop(() => {
  controls.update();
  renderer.render(scene, camera);
});
