import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import * as CANNON from 'cannon-es';
import { PlayerController } from './player.js';
import { createMoonTexture, createGrassTexture } from './texture_generator.js';
import { MotionObject } from './motion_object.js';
import { KinematicsSimulation } from './kinematics_sim.js';
import { KinematicsUI } from './kinematics_ui.js';
import { KinematicsGraph } from './kinematics_graph.js';

// --- CONFIGURATION ---
const SETTINGS = {
    gravity: -20, // Increased gravity for snappier jumping
    colors: [0x00ffcc, 0xff0055, 0xaa00ff, 0xffcc00, 0x0088ff], // Neon Palette
};

// --- GLOBAL STATE ---
const objectsToUpdate = [];
let isZeroG = false;
let isTimeSlow = false;

// --- SCENE SETUP ---
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x050505);
scene.fog = new THREE.FogExp2(0x050505, 0.03);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 500);
// Initial position will be handled by player controller

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
renderer.setSize(window.innerWidth, window.innerHeight);
// Cap pixel ratio to 2 — prevents GPU overload on high-DPI displays (3x, 4x)
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
document.getElementById('game-container').appendChild(renderer.domElement);

// --- PHYSICS WORLD ---
const world = new CANNON.World();
world.gravity.set(0, SETTINGS.gravity, 0);
world.broadphase = new CANNON.SAPBroadphase(world);
world.allowSleep = true;
const defaultMaterial = new CANNON.Material('default');
const defaultContactMaterial = new CANNON.ContactMaterial(defaultMaterial, defaultMaterial, {
    friction: 0.0, // Zero friction for player walking
    restitution: 0.0
});
world.addContactMaterial(defaultContactMaterial);

// --- PLAYER CONTROLLER ---
const player = new PlayerController(scene, world, camera, document.body);

// --- KINEMATICS SYSTEM ---
const kinematicsSimulation = new KinematicsSimulation();
let kinematicsGraph = null; // Deferred — DOM not ready yet
let kinematicsUI = null;

// --- ENVIRONMENT SYSTEM ---
const envObjects = { lights: [], meshes: [], helpers: [] };

function clearEnvironment() {
    envObjects.lights.forEach(l => scene.remove(l));

    envObjects.meshes.forEach(m => {
        // If it's a mesh
        if (m.geometry) {
            scene.remove(m);
            m.geometry.dispose();
            if (m.material) m.material.dispose();
        }
        // If it's a tracked physics body (stored as { body: ... })
        if (m.body) {
            world.removeBody(m.body);
        }
        // If it was a mesh but also had a body attached manually (not using objectsToUpdate)
        // We generally separate them, but good to be safe.
    });

    envObjects.helpers.forEach(h => scene.remove(h));

    // Reset arrays
    envObjects.lights = [];
    envObjects.meshes = [];
    envObjects.helpers = [];
}

// Global reference for physics floor to update friction
let physicsFloorBody = null;

window.changeEnvironment = (type) => {
    // Clear previous
    clearEnvironment();
    window.resetWorld(); // Clear physics objects to avoid glitches

    // Defaults
    let gravity = -20;
    let floorColor = 0x050505;

    // --- GRAPH MODE (Original) ---
    if (type === 'graph') {
        scene.background = new THREE.Color(0x050505);
        scene.fog = new THREE.FogExp2(0x050505, 0.03);
        gravity = -20;

        // Lights
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.1);
        const spotLight = new THREE.SpotLight(0xffffff, 500);
        spotLight.position.set(20, 50, 20);
        spotLight.angle = Math.PI / 4;
        spotLight.penumbra = 0.5;
        spotLight.castShadow = true;
        const rimLight = new THREE.SpotLight(0x0088ff, 500);
        rimLight.position.set(-20, 40, -20);

        scene.add(ambientLight, spotLight, rimLight);
        envObjects.lights.push(ambientLight, spotLight, rimLight);

        // Grid & Floor
        const gridHelper = new THREE.GridHelper(100, 50, 0x444444, 0x111111);
        scene.add(gridHelper);
        envObjects.helpers.push(gridHelper);

        const floorGeo = new THREE.PlaneGeometry(200, 200);
        const floorMat = new THREE.MeshStandardMaterial({ color: 0x050505, roughness: 0.1, metalness: 0.8 });
        const floorMesh = new THREE.Mesh(floorGeo, floorMat);
        floorMesh.rotation.x = -Math.PI / 2;
        floorMesh.receiveShadow = true;
        scene.add(floorMesh);
        envObjects.meshes.push(floorMesh);
    }

    // --- MOON MODE ---
    else if (type === 'moon') {
        const bg = 0x0a0a0a;
        scene.background = new THREE.Color(bg);
        scene.fog = new THREE.FogExp2(bg, 0.015);
        gravity = -3.5; // Low Gravity
        bloomPass.strength = 0.3; // Low Bloom
        bloomPass.threshold = 0.5;

        // Lights (Stark white sun)
        const ambientLight = new THREE.AmbientLight(0x404040, 0.5); // Dim ambient
        const sunLight = new THREE.DirectionalLight(0xffffff, 2);
        sunLight.position.set(-50, 100, -20);
        sunLight.castShadow = true;
        sunLight.shadow.mapSize.width = 2048;
        sunLight.shadow.mapSize.height = 2048;

        scene.add(ambientLight, sunLight);
        envObjects.lights.push(ambientLight, sunLight);

        // Floor (Grey/Dusty)
        const floorGeo = new THREE.PlaneGeometry(200, 200);
        const floorMat = new THREE.MeshStandardMaterial({
            map: createMoonTexture(),
            roughness: 0.9,
            metalness: 0.2
        });
        const floorMesh = new THREE.Mesh(floorGeo, floorMat);
        floorMesh.rotation.x = -Math.PI / 2;
        floorMesh.receiveShadow = true;
        scene.add(floorMesh);
        envObjects.meshes.push(floorMesh);

        // Visible Sun
        const sunGeo = new THREE.SphereGeometry(5, 32, 32);
        const sunMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
        const sunMesh = new THREE.Mesh(sunGeo, sunMat);
        sunMesh.position.copy(sunLight.position);
        scene.add(sunMesh);
        envObjects.meshes.push(sunMesh);

        // Earth in Sky
        const earthGeo = new THREE.SphereGeometry(20, 32, 32);
        const earthMat = new THREE.MeshStandardMaterial({ color: 0x4488ff, emissive: 0x112244, roughness: 0.8 });
        const earthMesh = new THREE.Mesh(earthGeo, earthMat);
        earthMesh.position.set(80, 40, 80);
        scene.add(earthMesh);
        envObjects.meshes.push(earthMesh);

        // Craters (Torus shapes)
        for (let i = 0; i < 10; i++) {
            const x = (Math.random() - 0.5) * 120;
            const z = (Math.random() - 0.5) * 120;
            if (Math.abs(x) < 10 && Math.abs(z) < 10) continue; // Spawn area clear

            const radius = Math.random() * 3 + 2;
            const tube = Math.random() * 0.5 + 0.3;
            const craterGeo = new THREE.TorusGeometry(radius, tube, 16, 30);
            const craterMat = new THREE.MeshStandardMaterial({ color: 0x555555, roughness: 1 });
            const crater = new THREE.Mesh(craterGeo, craterMat);
            crater.position.set(x, 0.2, z);
            crater.rotation.x = -Math.PI / 2;
            crater.receiveShadow = true;
            crater.castShadow = true;
            scene.add(crater);
            envObjects.meshes.push(crater);
        }
    }

    // --- GREEN FIELD MODE ---
    else if (type === 'field') {
        const bg = 0x87CEEB; // Clear sky blue
        scene.background = new THREE.Color(bg);
        scene.fog = new THREE.FogExp2(bg, 0.0008); // Very light fog
        gravity = -15; // Earth-ish
        bloomPass.strength = 0.15; // Subtle bloom
        bloomPass.threshold = 0.85;

        // Lights (Golden Hour)
        const ambientLight = new THREE.AmbientLight(0xffeedd, 0.5); // Warm ambient
        const sunLight = new THREE.DirectionalLight(0xffcc66, 1.5); // Golden sun
        sunLight.position.set(120, 60, 60);
        sunLight.castShadow = true;
        sunLight.shadow.mapSize.width = 4096;
        sunLight.shadow.mapSize.height = 4096;
        sunLight.shadow.camera.left = -100;
        sunLight.shadow.camera.right = 100;
        sunLight.shadow.camera.top = 100;
        sunLight.shadow.camera.bottom = -100;
        sunLight.shadow.camera.far = 300;

        scene.add(ambientLight, sunLight);
        envObjects.lights.push(ambientLight, sunLight);

        // 2D Sun disc
        const sunGeo = new THREE.CircleGeometry(20, 64);
        const sunMat = new THREE.MeshBasicMaterial({ color: 0xffffaa, side: THREE.DoubleSide });
        const sunMesh = new THREE.Mesh(sunGeo, sunMat);
        sunMesh.position.copy(sunLight.position).multiplyScalar(2);
        sunMesh.lookAt(camera.position);
        scene.add(sunMesh);
        envObjects.meshes.push(sunMesh);

        // Floor — completely flat
        const floorGeo = new THREE.PlaneGeometry(500, 500);
        const floorMat = new THREE.MeshStandardMaterial({
            map: createGrassTexture(),
            roughness: 0.9,
            metalness: 0.0
        });
        const floorMesh = new THREE.Mesh(floorGeo, floorMat);
        floorMesh.rotation.x = -Math.PI / 2;
        floorMesh.receiveShadow = true;
        scene.add(floorMesh);
        envObjects.meshes.push(floorMesh);
    }

    // Physics Updates
    SETTINGS.gravity = gravity;
    if (!isZeroG) { // Only apply if not already in Zero-G mode
        world.gravity.set(0, gravity, 0);
    }

    // Re-create Physics Floor if needed (or just keep one)
    if (!physicsFloorBody) {
        physicsFloorBody = new CANNON.Body({
            mass: 0,
            shape: new CANNON.Plane(),
            material: defaultMaterial
        });
        physicsFloorBody.quaternion.setFromAxisAngle(new CANNON.Vec3(1, 0, 0), -Math.PI / 2);
        world.addBody(physicsFloorBody);
    }
};

// --- POST-PROCESSING (BLOOM) ---
const renderScene = new RenderPass(scene, camera);

// Bloom at HALF resolution — dramatic GPU savings with barely visible quality difference
const bloomPass = new UnrealBloomPass(
    new THREE.Vector2(window.innerWidth / 2, window.innerHeight / 2), 1.5, 0.4, 0.85
);
bloomPass.threshold = 0.15;
bloomPass.strength = 0.9; // Slightly reduced for perf
bloomPass.radius = 0.4;

const composer = new EffectComposer(renderer);
composer.addPass(renderScene);
composer.addPass(bloomPass);

// --- OBJECT MANAGEMENT ---
// objectsToUpdate, isZeroG, isTimeSlow moved to top

// Neon Material Generator
function createNeonMaterial(color) {
    return new THREE.MeshStandardMaterial({
        color: 0x111111,
        emissive: color,
        emissiveIntensity: 2,
        roughness: 0.1,
        metalness: 0.9
    });
}

function updateUI() {
    document.getElementById('obj-count').innerText = `OBJECTS: ${objectsToUpdate.length}`;
}

// --- SPAWN LOGIC ---
window.isKinematicsSpawnMode = false;
window.toggleKinematicsMode = () => {
    window.isKinematicsSpawnMode = !window.isKinematicsSpawnMode;
    const btn = document.getElementById('btn-kinematics');
    if (btn) {
        if (window.isKinematicsSpawnMode) {
            btn.innerText = "KINEMATICS [ON] [K]";
            btn.style.color = "#000";
            btn.style.backgroundColor = "#00ffff";
        } else {
            btn.innerText = "KINEMATICS [OFF] [K]";
            btn.style.color = "#00ffff";
            btn.style.backgroundColor = "transparent";
        }
    }
};

window.spawnBox = () => {
    const p = player.body.position;
    // Spawn in front of player
    const spawnPos = new THREE.Vector3(0, 0, -5).applyQuaternion(camera.quaternion).add(p);

    const size = Math.random() * 1 + 0.5;
    const geo = new THREE.BoxGeometry(size, size, size);
    const color = SETTINGS.colors[Math.floor(Math.random() * SETTINGS.colors.length)];
    const mat = createNeonMaterial(color);
    const mesh = new THREE.Mesh(geo, mat);

    mesh.position.copy(spawnPos);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);

    if (window.isKinematicsSpawnMode) {
        const motionObj = new MotionObject(scene, spawnPos, { mesh });
        kinematicsSimulation.addObject(motionObj);
        return; // Skip physics
    }

    const shape = new CANNON.Box(new CANNON.Vec3(size / 2, size / 2, size / 2));
    const body = new CANNON.Body({ mass: 1, position: new CANNON.Vec3(spawnPos.x, spawnPos.y, spawnPos.z), shape: shape, material: defaultMaterial });
    world.addBody(body);
    objectsToUpdate.push({ mesh, body });
    updateUI();
};

window.spawnSphere = () => {
    const p = player.body.position;
    const spawnPos = new THREE.Vector3(0, 0, -5).applyQuaternion(camera.quaternion).add(p);

    const radius = Math.random() * 0.5 + 0.3;
    const geo = new THREE.SphereGeometry(radius, 32, 32);
    const color = SETTINGS.colors[Math.floor(Math.random() * SETTINGS.colors.length)];
    const mat = createNeonMaterial(color);
    const mesh = new THREE.Mesh(geo, mat);

    mesh.position.copy(spawnPos);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);

    if (window.isKinematicsSpawnMode) {
        const motionObj = new MotionObject(scene, spawnPos, { mesh });
        kinematicsSimulation.addObject(motionObj);
        return; // Skip physics
    }

    const shape = new CANNON.Sphere(radius);
    const body = new CANNON.Body({ mass: 1, position: new CANNON.Vec3(spawnPos.x, spawnPos.y, spawnPos.z), shape: shape, material: defaultMaterial });
    world.addBody(body);
    objectsToUpdate.push({ mesh, body });
    updateUI();
};

window.spawnTower = () => {
    // Spawn somewhere in front
    const p = player.body.position;
    const spawnPos = new THREE.Vector3(0, 0, -10).applyQuaternion(camera.quaternion).add(p);
    spawnPos.y = 0.5; // Starts at floor

    const size = 1;
    for (let i = 0; i < 10; i++) {
        setTimeout(() => {
            const geo = new THREE.BoxGeometry(size, size, size);
            const color = SETTINGS.colors[i % SETTINGS.colors.length];
            const mat = createNeonMaterial(color);
            const mesh = new THREE.Mesh(geo, mat);
            const elementPos = new THREE.Vector3(spawnPos.x, i * 1.05 + 0.5, spawnPos.z);
            mesh.position.copy(elementPos);
            mesh.castShadow = true;
            mesh.receiveShadow = true;
            scene.add(mesh);

            if (window.isKinematicsSpawnMode) {
                const motionObj = new MotionObject(scene, elementPos, { mesh });
                kinematicsSimulation.addObject(motionObj);
                return;
            }

            const shape = new CANNON.Box(new CANNON.Vec3(size / 2, size / 2, size / 2));
            const body = new CANNON.Body({ mass: 0.5, position: new CANNON.Vec3(elementPos.x, elementPos.y, elementPos.z), shape: shape, material: defaultMaterial });
            world.addBody(body);
            objectsToUpdate.push({ mesh, body });
            updateUI();
        }, i * 50);
    }
};

// --- GOD POWERS ---
window.toggleGravity = () => {
    isZeroG = !isZeroG;
    world.gravity.set(0, isZeroG ? 0 : SETTINGS.gravity, 0);
    objectsToUpdate.forEach(o => o.body.wakeUp());
    document.getElementById('grav-btn').classList.toggle('active-state', isZeroG);
};

window.toggleTime = () => {
    isTimeSlow = !isTimeSlow;
    document.getElementById('time-btn').classList.toggle('active-state', isTimeSlow);
};



window.spawnBreakableBox = () => {
    const p = player.body.position;
    const spawnPos = new THREE.Vector3(0, 0, -5).applyQuaternion(camera.quaternion).add(p);
    const size = 1.5;

    // Visuals
    const geo = new THREE.BoxGeometry(size, size, size);
    const mat = new THREE.MeshStandardMaterial({
        color: 0x00ffff,
        transparent: true,
        opacity: 0.7,
        roughness: 0.1,
        metalness: 0.9
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(spawnPos);
    mesh.castShadow = true;
    scene.add(mesh);

    if (window.isKinematicsSpawnMode) {
        const motionObj = new MotionObject(scene, spawnPos, { mesh });
        kinematicsSimulation.addObject(motionObj);
        return;
    }

    // Physics
    const shape = new CANNON.Box(new CANNON.Vec3(size / 2, size / 2, size / 2));
    const body = new CANNON.Body({ mass: 5, position: new CANNON.Vec3(spawnPos.x, spawnPos.y, spawnPos.z), shape: shape, material: defaultMaterial });
    world.addBody(body);

    const obj = { mesh, body };
    objectsToUpdate.push(obj);
    updateUI();

    // Collision Logic (Fracture)
    let hasBroken = false;
    body.addEventListener("collide", (e) => {
        if (hasBroken) return;

        // Check impact velocity
        const relativeVelocity = e.contact.getImpactVelocityAlongNormal();
        if (Math.abs(relativeVelocity) > 15) { // Threshold
            hasBroken = true;

            // 1. Remove Old
            world.removeBody(body);
            scene.remove(mesh);
            const idx = objectsToUpdate.indexOf(obj);
            if (idx > -1) objectsToUpdate.splice(idx, 1);

            // 2. Spawn Pieces (2x2x2)
            const subSize = size / 2;
            const startPos = body.position.clone().vsub(new CANNON.Vec3(size / 4, size / 4, size / 4)); // Offset center

            for (let x = 0; x < 2; x++) {
                for (let y = 0; y < 2; y++) {
                    for (let z = 0; z < 2; z++) {
                        const piecePos = new CANNON.Vec3(
                            body.position.x + (x - 0.5) * subSize,
                            body.position.y + (y - 0.5) * subSize,
                            body.position.z + (z - 0.5) * subSize
                        );

                        // Visual
                        const pGeo = new THREE.BoxGeometry(subSize, subSize, subSize);
                        const pMat = mat.clone(); // Share material style
                        const pMesh = new THREE.Mesh(pGeo, pMat);
                        pMesh.position.copy(piecePos);
                        pMesh.castShadow = true;
                        scene.add(pMesh);

                        // Physics
                        const pShape = new CANNON.Box(new CANNON.Vec3(subSize / 2, subSize / 2, subSize / 2));
                        const pBody = new CANNON.Body({ mass: 1, position: piecePos, shape: pShape, material: defaultMaterial });

                        // Inherit velocity + explode a bit
                        pBody.velocity.copy(body.velocity);
                        pBody.velocity.x += (Math.random() - 0.5) * 5;
                        pBody.velocity.y += (Math.random() - 0.5) * 5;
                        pBody.velocity.z += (Math.random() - 0.5) * 5;

                        world.addBody(pBody);
                        objectsToUpdate.push({ mesh: pMesh, body: pBody });
                    }
                }
            }
            updateUI();
        }
    });

};

// --- KINEMATICS SPAWN ---
window.spawnMotionObject = () => {
    const p = player.body.position;
    // Spawn 5 units in front of where the player is looking
    const spawnPos = new THREE.Vector3(0, 0, -5).applyQuaternion(camera.quaternion).add(p);
    // Ensure it spawns at least at ground level
    if (spawnPos.y < 0.35) spawnPos.y = 0.35;

    const motionObj = new MotionObject(scene, spawnPos);
    kinematicsSimulation.addObject(motionObj);
    updateUI();
};

// --- RIGHT-CLICK: Open projectile parameter panel ---
// Prevent browser default context menu everywhere on the game
window.addEventListener('contextmenu', (e) => {
    e.preventDefault();
});

window.addEventListener('mousedown', (e) => {
    if (e.button !== 2) return; // Only right-click
    if (!player.controls.isLocked) return;
    e.preventDefault();

    // Raycast from screen center
    const center = new THREE.Vector2(0, 0);
    raycaster.setFromCamera(center, camera);

    // Build list of all interactable meshes
    const regularMeshes = objectsToUpdate.map(o => o.mesh);
    const kinematicsMeshes = kinematicsSimulation.motionObjects
        .map(m => m.mesh)
        .filter(Boolean);

    const allMeshes = [...regularMeshes, ...kinematicsMeshes];
    if (allMeshes.length === 0) return;

    const intersects = raycaster.intersectObjects(allMeshes);
    if (intersects.length > 0) {
        const hitMesh = intersects[0].object;

        // Already a MotionObject → just open the panel
        if (hitMesh.userData.isMotionObject && hitMesh.userData.motionObjectRef && kinematicsUI) {
            kinematicsUI.open(hitMesh.userData.motionObjectRef);
            return;
        }

        // Regular physics object → convert it to a MotionObject on the fly
        const obj = objectsToUpdate.find(o => o.mesh === hitMesh);
        if (obj && kinematicsUI) {
            // Remove from physics world
            world.removeBody(obj.body);
            const idx = objectsToUpdate.indexOf(obj);
            if (idx > -1) objectsToUpdate.splice(idx, 1);

            // Create a MotionObject wrapping this mesh
            const pos = new THREE.Vector3().copy(hitMesh.position);
            const motionObj = new MotionObject(scene, pos, { mesh: hitMesh });
            kinematicsSimulation.addObject(motionObj);

            // Open the kinematics panel for it
            kinematicsUI.open(motionObj);
            return;
        }
    }
});

// --- TOOLS STATE ---
let currentTool = null; // 'weld', 'rope', or null
let selectedBodyA = null;
let selectedMeshA = null;

window.selectTool = (tool) => {
    // Toggle
    if (currentTool === tool) {
        currentTool = null;
        if (selectedMeshA && selectedMeshA.material) selectedMeshA.material.emissive.setHex(selectedMeshA.userData.originalEmissive || 0);
        selectedBodyA = null;
        selectedMeshA = null;
        document.getElementById('tool-status').innerText = "Select a tool...";
    } else {
        currentTool = tool;
        document.getElementById('tool-status').innerText = `${tool.toUpperCase()}: Click Object 1`;
    }

    // UI Feedback
    document.querySelectorAll('.control-group button').forEach(b => b.classList.remove('active-state'));
    if (currentTool) document.getElementById(`btn-${tool}`).classList.add('active-state');
}

function createConstraint(bodyA, bodyB, type) {
    if (!bodyA || !bodyB) return;
    let c;
    if (type === 'weld') {
        c = new CANNON.LockConstraint(bodyA, bodyB);
    } else if (type === 'rope') {
        c = new CANNON.PointToPointConstraint(bodyA, new CANNON.Vec3(0, 0, 0), bodyB, new CANNON.Vec3(0, 0, 0));
    }
    world.addConstraint(c);
}

window.spawnWall = () => {
    const p = player.body.position;
    const spawnPos = new THREE.Vector3(0, 1.5, -5).applyQuaternion(camera.quaternion).add(p);

    // Visuals
    const size = { x: 4, y: 3, z: 0.5 };
    const geo = new THREE.BoxGeometry(size.x, size.y, size.z);
    const mat = new THREE.MeshStandardMaterial({ color: 0x888888, roughness: 0.9 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(spawnPos);

    // Look at player (start rotated correctly)
    mesh.lookAt(player.body.position.x, mesh.position.y, player.body.position.z);

    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);

    if (window.isKinematicsSpawnMode) {
        const motionObj = new MotionObject(scene, spawnPos, { mesh });
        kinematicsSimulation.addObject(motionObj);
        return;
    }

    // Physics (Mass 0 = Static)
    const shape = new CANNON.Box(new CANNON.Vec3(size.x / 2, size.y / 2, size.z / 2));
    const body = new CANNON.Body({ mass: 0, position: new CANNON.Vec3(spawnPos.x, spawnPos.y, spawnPos.z), shape: shape, material: defaultMaterial });

    // Sync rotation from mesh lookAt
    body.quaternion.set(mesh.quaternion.x, mesh.quaternion.y, mesh.quaternion.z, mesh.quaternion.w);

    world.addBody(body);
    objectsToUpdate.push({ mesh, body }); // Add to update list just so we can grab it/interact, though position won't update
    updateUI();
};

window.resetWorld = () => {
    objectsToUpdate.forEach(obj => {
        world.removeBody(obj.body);
        scene.remove(obj.mesh);
        obj.mesh.geometry.dispose();
        obj.mesh.material.dispose();
    });
    objectsToUpdate.length = 0;

    // Clear all kinematics objects
    if (kinematicsUI && kinematicsUI.isOpen) kinematicsUI.close();
    kinematicsSimulation.removeAll();
    if (kinematicsGraph) kinematicsGraph.clearData();

    updateUI();
};

// --- INTERACTION (DRAG) ---
const mouse = new THREE.Vector2(0, 0); // Center of screen
const raycaster = new THREE.Raycaster();
const mouseBody = new CANNON.Body({ mass: 0, type: CANNON.Body.KINEMATIC, position: new CANNON.Vec3(0, 0, 0), shape: new CANNON.Sphere(0.1) });
mouseBody.collisionFilterGroup = 0;
world.addBody(mouseBody);
let mouseConstraint = null;
let levitationDistance = 5; // Default distance

// Simplified Logic: Click = Grab center of screen
window.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;

    // Check if player is not locked (e.g. clicking UI), if so, logic handled by player.js to lock
    if (!player.controls.isLocked) return;

    raycaster.setFromCamera(mouse, camera);
    const intersects = raycaster.intersectObjects(objectsToUpdate.map(o => o.mesh));
    if (intersects.length > 0) {
        const hit = intersects[0];
        const obj = objectsToUpdate.find(o => o.mesh === hit.object);

        if (obj) {
            // --- TOOL LOGIC ---
            if (currentTool) {
                if (!selectedBodyA) {
                    // Select First
                    selectedBodyA = obj.body;
                    selectedMeshA = obj.mesh;
                    selectedMeshA.userData.originalEmissive = selectedMeshA.material.emissive.getHex();
                    selectedMeshA.material.emissive.setHex(0xff0000); // Red Highlight
                    document.getElementById('tool-status').innerText = `${currentTool.toUpperCase()}: Click Object 2`;
                } else if (obj.body !== selectedBodyA) {
                    // Select Second & Create
                    createConstraint(selectedBodyA, obj.body, currentTool);

                    // Reset
                    selectedMeshA.material.emissive.setHex(selectedMeshA.userData.originalEmissive || 0);
                    selectedBodyA = null;
                    selectedMeshA = null;
                    // Keep tool active for chain building
                    document.getElementById('tool-status').innerText = "Constraint Created! Click Obj 1";
                }
                return; // Don't grab if using tool
            }

            // --- GRAB LOGIC ---
            // Set initial distance
            levitationDistance = hit.distance;

            mouseBody.position.copy(hit.point);
            mouseConstraint = new CANNON.PointToPointConstraint(mouseBody, new CANNON.Vec3(0, 0, 0), obj.body, obj.body.pointToLocalFrame(new CANNON.Vec3(hit.point.x, hit.point.y, hit.point.z)));
            world.addConstraint(mouseConstraint);
        }
    }
});

window.addEventListener('mouseup', () => {
    if (mouseConstraint) {
        world.removeConstraint(mouseConstraint);
        mouseConstraint = null;
    }
});

// Scroll to push/pull
window.addEventListener('wheel', (e) => {
    if (!mouseConstraint) return;

    // Scroll Down (Positive) = Pull Closer? Or Push? Standard is usually Pull Down = Pull Closer?
    // Let's try: Scroll Up (Negative) = Push Away (Increase Distance)
    // Scroll Down (Positive) = Pull Closer (Decrease Distance)
    // Adjust sensitivity as needed

    // e.deltaY is usually +/- 100 per tick
    const delta = e.deltaY * 0.01;
    levitationDistance += delta;

    // Clamp
    levitationDistance = Math.max(2, Math.min(levitationDistance, 50));
});

function moveJointBody() {
    if (!mouseConstraint) return;
    raycaster.setFromCamera(mouse, camera);

    // Move along ray at set distance
    const targetPos = raycaster.ray.origin.clone().add(raycaster.ray.direction.multiplyScalar(levitationDistance));
    mouseBody.position.copy(targetPos);
}

// Keys handled mostly by PlayerController, but Global ones here
window.addEventListener('keydown', (e) => {
    switch (e.key.toLowerCase()) {
        case 'q': window.spawnBox(); break;
        case 'e': window.spawnSphere(); break;
        case 'r': window.spawnTower(); break;
        case 'y': window.spawnBreakableBox(); break;
        case 'u': window.spawnWall(); break;
        case 'k': window.toggleKinematicsMode(); break;
        case '1': window.selectTool('weld'); break;
        case '2': window.selectTool('rope'); break;
        case 'g': window.toggleGravity(); break;
        case 't': window.toggleTime(); break;
        case 'escape':
            // Close panels if open, otherwise reset world
            if (kinematicsUI && kinematicsUI.isOpen) {
                kinematicsUI.close();
            } else {
                window.resetWorld(); player.controls.unlock();
            }
            break;
    }
});



// --- PHYSICS SLIDERS ---
document.getElementById('grav-slider').addEventListener('input', (e) => {
    const val = parseFloat(e.target.value);
    SETTINGS.gravity = -val; // Invert so positive slider = downward gravity
    if (!isZeroG) world.gravity.set(0, -val, 0);
    document.getElementById('grav-val').innerText = val; // Show magnitude
    objectsToUpdate.forEach(o => o.body.wakeUp()); // Wake up playing bodies
});

document.getElementById('fric-slider').addEventListener('input', (e) => {
    const val = parseFloat(e.target.value);
    defaultContactMaterial.friction = val;
    document.getElementById('fric-val').innerText = val.toFixed(2);
    // Friction changes apply immediately to ongoing contacts in Cannon.es usually,
    // but waking up ensures they re-solve constraints with new parameters.
    objectsToUpdate.forEach(o => o.body.wakeUp());
    // Also update player friction if separate? No, player uses separate logic usually or default.
    // Ideally we should make sure player doesn't get stuck.
});

// --- RENDER LOOP ---
const clock = new THREE.Clock();
let oldElapsedTime = 0;

// Cache DOM references to avoid getElementById every frame (causes layout thrashing)
const fpsCounterEl = document.getElementById('fps-counter');
let fpsUpdateAccum = 0; // accumulator for throttled FPS display

const tick = () => {
    const elapsedTime = clock.getElapsedTime();
    let deltaTime = elapsedTime - oldElapsedTime;
    oldElapsedTime = elapsedTime;

    // Cap deltaTime to avoid spiral of death on lag spikes
    if (deltaTime > 0.1) deltaTime = 0.1;

    // Physics Step
    if (isTimeSlow) {
        // Slow Motion: Scale delta time, but ALSO use smaller fixed step for smoothness
        // We want to simulate less time, but still have high resolution
        world.step(1 / 120, deltaTime * 0.1, 3);
    } else {
        // Normal Motion
        world.step(1 / 60, deltaTime, 3);
    }

    // Update Player
    player.update(deltaTime);

    // Update Kinematics Simulation (new motion objects)
    kinematicsSimulation.update(deltaTime);

    // Update Kinematics Graphs
    if (kinematicsGraph) {
        kinematicsGraph.pushSample();
        kinematicsGraph.render();
    }

    // Sync Objects
    for (const obj of objectsToUpdate) {
        obj.mesh.position.copy(obj.body.position);
        obj.mesh.quaternion.copy(obj.body.quaternion);
    }

    moveJointBody();
    composer.render(); // Essential for Bloom!

    // Throttle FPS counter updates to every ~500ms (was every frame = layout thrashing)
    fpsUpdateAccum += deltaTime;
    if (fpsUpdateAccum >= 0.5) {
        fpsCounterEl.textContent = `FPS: ${Math.round(1 / deltaTime)}`;
        fpsUpdateAccum = 0;
    }
    window.requestAnimationFrame(tick);
};

tick();

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    composer.setSize(window.innerWidth, window.innerHeight);
});

// --- Initialise UI (DOM is ready by this point) ---
kinematicsGraph = new KinematicsGraph(document.getElementById('kinematics-graphs'));
kinematicsUI = new KinematicsUI(kinematicsSimulation, player.controls, kinematicsGraph);

// Initialize Environment
window.changeEnvironment('field');
