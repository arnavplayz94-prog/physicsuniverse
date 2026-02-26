import * as THREE from 'three';

export function createMoonTexture() {
    const size = 1024;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');

    // 1. Base Grey
    ctx.fillStyle = '#555555';
    ctx.fillRect(0, 0, size, size);

    // 2. Noise (Dust)
    for (let i = 0; i < 50000; i++) {
        const x = Math.random() * size;
        const y = Math.random() * size;
        const shade = Math.random() * 50 + 50; // Grey variation
        ctx.fillStyle = `rgb(${shade}, ${shade}, ${shade})`;
        ctx.fillRect(x, y, 2, 2);
    }

    // 3. Craters (Circles with shadows)
    for (let i = 0; i < 50; i++) {
        const cx = Math.random() * size;
        const cy = Math.random() * size;
        const r = Math.random() * 40 + 10;

        // Shadow offset
        const grad = ctx.createRadialGradient(cx, cy, r * 0.8, cx, cy, r);
        grad.addColorStop(0, '#444');
        grad.addColorStop(0.9, '#333');
        grad.addColorStop(1, '#666'); // Rim

        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fillStyle = grad;
        ctx.fill();

        // Highlight Rim
        ctx.beginPath();
        ctx.arc(cx - r * 0.2, cy - r * 0.2, r, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(200,200,200,0.1)';
        ctx.stroke();
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(4, 4); // Repeat texture
    return texture;
}

export function createGrassTexture() {
    const size = 1024;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');

    // 1. Base Gradient (Deep lush green to vibrant sunlit yellow-green)
    const baseGrad = ctx.createLinearGradient(0, 0, size, size);
    baseGrad.addColorStop(0, '#1c4a16'); // Dark shaded grass
    baseGrad.addColorStop(0.5, '#3b8627'); // Mid green
    baseGrad.addColorStop(1, '#6cb33b'); // Sunlit golden-green
    ctx.fillStyle = baseGrad;
    ctx.fillRect(0, 0, size, size);

    // 2. Fine Grass Blades (Layered strokes)
    // Dark undergrowth
    ctx.globalAlpha = 0.4;
    for (let i = 0; i < 60000; i++) {
        const x = Math.random() * size;
        const y = Math.random() * size;
        ctx.fillStyle = '#11330b';
        ctx.fillRect(x, y, 1 + Math.random(), 4 + Math.random() * 6);
    }

    // Mid-level blades
    ctx.globalAlpha = 0.5;
    for (let i = 0; i < 50000; i++) {
        const x = Math.random() * size;
        const y = Math.random() * size;
        ctx.fillStyle = '#30771e';
        ctx.fillRect(x, y, 1.5, 6 + Math.random() * 8);
    }

    // Golden/Sunlit highlight blades
    ctx.globalAlpha = 0.6;
    for (let i = 0; i < 30000; i++) {
        const x = Math.random() * size;
        const y = Math.random() * size;
        ctx.fillStyle = '#8cc14c'; // Light vibrant green
        // Slight rotation for natural look
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate((Math.random() - 0.5) * 0.2); // +/- ~10 degrees
        ctx.fillRect(0, 0, 1 + Math.random(), 8 + Math.random() * 10);
        ctx.restore();
    }

    // 3. Subtle soft dirt/path noise (Very low opacity)
    ctx.globalAlpha = 0.1;
    for (let i = 0; i < 15; i++) {
        const cx = Math.random() * size;
        const cy = Math.random() * size;
        const r = Math.random() * 80 + 30;

        const dirtGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
        dirtGrad.addColorStop(0, '#5a4625');
        dirtGrad.addColorStop(1, 'transparent');
        ctx.fillStyle = dirtGrad;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fill();
    }

    // Reset alpha
    ctx.globalAlpha = 1.0;

    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;

    // Repeat much more densely (32x instead of 12x or 8x) to remove the "squares" look
    // The tiles become so small that the repetition is indistinguishable
    texture.repeat.set(32, 32);

    // Anisotropy for better viewing at oblique angles (ground level)
    texture.anisotropy = 16;
    texture.colorSpace = THREE.SRGBColorSpace;

    return texture;
}
