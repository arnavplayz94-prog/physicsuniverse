
// ... (Previous Imports)
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

// ... (Configuration & Scene Setup)

// --- POST-PROCESSING ---
const renderScene = new RenderPass(scene, camera);

const bloomPass = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 1.5, 0.4, 0.85);
bloomPass.threshold = 0;
bloomPass.strength = 1.2; // Glowing Intensity
bloomPass.radius = 0.5;

const composer = new EffectComposer(renderer);
composer.addPass(renderScene);
composer.addPass(bloomPass);

// --- VISUAL MATERIALS ---
// Update spawning functions to use Neon/Emissive materials
function randomColor() {
    return SETTINGS.colors[Math.floor(Math.random() * SETTINGS.colors.length)];
}

const neonMaterial = (color) => {
    return new THREE.MeshStandardMaterial({
        color: 0x111111, // Dark base
        emissive: color,
        emissiveIntensity: 2, // Glow power!
        roughness: 0.1,
        metalness: 0.8
    });
};

const glassMaterial = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    metalness: 0,
    roughness: 0,
    transmission: 1, // Glass-like
    thickness: 0.5,
});

// ... (Update Spawn Functions to use neonMaterial)

window.spawnBox = () => {
    const size = Math.random() * 1 + 0.5;
    const geometry = new THREE.BoxGeometry(size, size, size);
    const color = randomColor();
    // 80% chance for neon, 20% for glass
    const material = Math.random() > 0.2 ? neonMaterial(color) : glassMaterial;

    // ... (rest of spawn logic)
};

// ... (Update Render Loop to use composer.render())

const tick = () => {
    // ... (Physics & Logic)

    // Render via Composer (for Bloom)
    controls.update();
    composer.render(); // Replaces renderer.render(scene, camera)

    // ...
};
