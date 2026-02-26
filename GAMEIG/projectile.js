import * as THREE from 'three';

/**
 * Projectile class — handles kinematics math and state for a single projectile.
 *
 * Physics equations used:
 *   Vx = V * cos(θ)           — horizontal velocity component (constant, no air resistance)
 *   Vy = V * sin(θ)           — initial vertical velocity component
 *   x(t) = x₀ + Vx * t       — horizontal position over time (uniform motion)
 *   y(t) = y₀ + Vy * t - ½gt² — vertical position over time (uniformly accelerated motion)
 *
 * The motion is decomposed into independent horizontal and vertical components.
 * Horizontally, velocity is constant (no drag in base implementation).
 * Vertically, gravity decelerates the projectile, stops it at peak, then accelerates it downward.
 */
export class Projectile {
    /**
     * @param {THREE.Scene} scene    — the Three.js scene to add visuals to
     * @param {THREE.Vector3} position — world-space spawn position
     * @param {object} params        — { velocity, angle, gravity, mass }
     */
    constructor(scene, position, params = {}) {
        this.scene = scene;

        // --- Editable parameters (defaults) ---
        this.initialVelocity = params.velocity ?? 20;   // m/s magnitude
        this.angle = params.angle ?? 45;    // degrees
        this.gravity = params.gravity ?? 9.81;  // m/s² (positive value, applied downward)
        this.mass = params.mass ?? 1;     // kg (for future extensions like drag)

        // --- State ---
        this.launchPosition = position.clone();          // stored origin
        this.elapsedTime = 0;                         // seconds since launch
        this.isLaunched = false;
        this.hasLanded = false;
        this.landedTimer = 0;                         // seconds since landing
        this.groundLevel = 0;                         // y-level considered "ground"

        // Precomputed velocity components (set on launch)
        this.vx = 0;
        this.vy = 0;

        // --- Launch direction (horizontal heading) ---
        // Default: positive-X direction. Overridden by setLaunchDirection().
        this.launchDir = new THREE.Vector3(1, 0, 0);

        // --- Visual: glowing sphere ---
        const radius = 0.35;
        const geo = new THREE.SphereGeometry(radius, 24, 24);
        const mat = new THREE.MeshStandardMaterial({
            color: 0x111111,
            emissive: 0xff6600,
            emissiveIntensity: 2.5,
            roughness: 0.2,
            metalness: 0.8
        });
        this.mesh = geo ? new THREE.Mesh(geo, mat) : null;
        this.mesh.position.copy(position);
        this.mesh.castShadow = true;
        this.scene.add(this.mesh);

        // Tag mesh so raycasting can identify it as a projectile
        this.mesh.userData.isProjectile = true;
        this.mesh.userData.projectileRef = this;

        // --- Trajectory prediction line ---
        this.trajectoryLine = null;

        // --- Ring indicator (shows unlaunched state) ---
        const ringGeo = new THREE.RingGeometry(0.5, 0.6, 32);
        const ringMat = new THREE.MeshBasicMaterial({
            color: 0xff6600,
            side: THREE.DoubleSide,
            transparent: true,
            opacity: 0.6
        });
        this.ring = new THREE.Mesh(ringGeo, ringMat);
        this.ring.rotation.x = -Math.PI / 2;
        this.ring.position.copy(position);
        this.ring.position.y = this.groundLevel + 0.01;
        this.scene.add(this.ring);
    }

    /**
     * Set the horizontal heading direction for the launch.
     * The projectile will travel along this direction in the XZ plane.
     * @param {THREE.Vector3} dir — normalized direction vector (y will be ignored)
     */
    setLaunchDirection(dir) {
        this.launchDir = new THREE.Vector3(dir.x, 0, dir.z).normalize();
    }

    /**
     * Update editable parameters (called by UI when sliders change).
     */
    setParams({ velocity, angle, gravity, mass }) {
        if (velocity !== undefined) this.initialVelocity = velocity;
        if (angle !== undefined) this.angle = angle;
        if (gravity !== undefined) this.gravity = gravity;
        if (mass !== undefined) this.mass = mass;
    }

    /**
     * Precompute velocity components and begin the launch.
     *
     * Vx = V * cos(θ)  — horizontal speed (constant throughout flight)
     * Vy = V * sin(θ)  — initial vertical speed (diminishes under gravity)
     */
    launch() {
        if (this.isLaunched) return;

        const θ = THREE.MathUtils.degToRad(this.angle);

        // Precompute velocity components ONCE — not recalculated per frame
        this.vx = this.initialVelocity * Math.cos(θ);
        this.vy = this.initialVelocity * Math.sin(θ);

        this.elapsedTime = 0;
        this.isLaunched = true;
        this.hasLanded = false;
        this.landedTimer = 0;

        // Remove the ring indicator on launch
        if (this.ring) {
            this.scene.remove(this.ring);
            this.ring.geometry.dispose();
            this.ring.material.dispose();
            this.ring = null;
        }

        // Remove trajectory preview line on launch
        this.clearTrajectoryLine();
    }

    /**
     * Reset projectile to its initial spawn state.
     */
    reset() {
        this.isLaunched = false;
        this.hasLanded = false;
        this.elapsedTime = 0;
        this.landedTimer = 0;
        this.vx = 0;
        this.vy = 0;
        this.mesh.position.copy(this.launchPosition);
    }

    /**
     * Update projectile position using kinematics equations.
     * Called every frame by PhysicsSimulation.
     *
     * @param {number} dt — delta time (already scaled by timeScale)
     * @returns {string} status — 'active' | 'landed' | 'remove'
     */
    update(dt) {
        if (!this.isLaunched) return 'active';

        // --- Landed phase: count down removal timer ---
        if (this.hasLanded) {
            this.landedTimer += dt;
            // Keep visible for ~2 seconds, then signal removal
            if (this.landedTimer >= 2.0) {
                return 'remove';
            }
            // Fade out effect during landed phase
            if (this.mesh.material.opacity !== undefined) {
                this.mesh.material.transparent = true;
                this.mesh.material.opacity = Math.max(0, 1 - (this.landedTimer / 2.0));
            }
            return 'landed';
        }

        // --- In-flight: advance time and compute position ---
        this.elapsedTime += dt;
        const t = this.elapsedTime;

        // --- Extensibility hook: apply drag (no-op by default) ---
        const { vx: adjVx, vy: adjVy } = this.applyDrag(this.vx, this.vy);

        /**
         * Kinematics equations:
         *   x(t) = x₀ + Vx * t
         *     → Horizontal displacement is linear (no horizontal acceleration)
         *
         *   y(t) = y₀ + Vy * t - ½ * g * t²
         *     → Vertical displacement follows parabolic arc
         *     → Vy*t is the "throw upward" component
         *     → ½*g*t² is the gravity pull-down component
         */
        const dx = adjVx * t;              // horizontal distance traveled
        const dy = adjVy * t - 0.5 * this.gravity * t * t;  // vertical position

        // Compute world position:
        // Horizontal displacement is along the launch direction vector
        const newX = this.launchPosition.x + this.launchDir.x * dx;
        const newZ = this.launchPosition.z + this.launchDir.z * dx;
        let newY = this.launchPosition.y + dy;

        // --- Ground clamping: never go below ground level ---
        if (newY <= this.groundLevel) {
            newY = this.groundLevel;
            this.hasLanded = true;
            this.landedTimer = 0;
        }

        this.mesh.position.set(newX, newY, newZ);

        return this.hasLanded ? 'landed' : 'active';
    }

    /**
     * Extensibility hook for air resistance.
     * Override this method to add drag forces.
     * Currently returns velocities unchanged.
     *
     * @param {number} vx — horizontal velocity
     * @param {number} vy — vertical velocity
     * @returns {{ vx: number, vy: number }}
     */
    applyDrag(vx, vy) {
        return { vx, vy };
    }

    /**
     * Compute predicted trajectory points WITHOUT modifying projectile state.
     * Uses a purely local simulation loop.
     *
     * @param {number} [numPoints=60] — max points to compute
     * @returns {THREE.Vector3[]} array of world-space positions
     */
    computeTrajectoryPoints(numPoints = 60) {
        const θ = THREE.MathUtils.degToRad(this.angle);
        const vx = this.initialVelocity * Math.cos(θ);
        const vy = this.initialVelocity * Math.sin(θ);

        const points = [];
        // Estimate total flight time: T = 2*Vy/g (for flat ground, from launch height)
        // Add extra margin for launches above ground
        const estimatedFlightTime = (vy + Math.sqrt(vy * vy + 2 * this.gravity * (this.launchPosition.y - this.groundLevel))) / this.gravity;
        const dtSim = Math.max(estimatedFlightTime / numPoints, 0.01);

        for (let i = 0; i <= numPoints; i++) {
            const t = i * dtSim;
            const dx = vx * t;
            const dy = vy * t - 0.5 * this.gravity * t * t;

            const px = this.launchPosition.x + this.launchDir.x * dx;
            const pz = this.launchPosition.z + this.launchDir.z * dx;
            let py = this.launchPosition.y + dy;

            // Stop when trajectory reaches ground
            if (py <= this.groundLevel && i > 0) {
                py = this.groundLevel;
                points.push(new THREE.Vector3(px, py, pz));
                break;
            }
            points.push(new THREE.Vector3(px, py, pz));
        }

        return points;
    }

    /**
     * Draw / redraw the predicted trajectory as a dashed line.
     */
    drawTrajectoryLine() {
        this.clearTrajectoryLine();

        const points = this.computeTrajectoryPoints();
        if (points.length < 2) return;

        const geometry = new THREE.BufferGeometry().setFromPoints(points);
        const material = new THREE.LineDashedMaterial({
            color: 0xff8800,
            dashSize: 0.3,
            gapSize: 0.15,
            transparent: true,
            opacity: 0.7
        });

        this.trajectoryLine = new THREE.Line(geometry, material);
        this.trajectoryLine.computeLineDistances(); // required for dashed lines
        this.scene.add(this.trajectoryLine);
    }

    /**
     * Remove trajectory line from the scene.
     */
    clearTrajectoryLine() {
        if (this.trajectoryLine) {
            this.scene.remove(this.trajectoryLine);
            this.trajectoryLine.geometry.dispose();
            this.trajectoryLine.material.dispose();
            this.trajectoryLine = null;
        }
    }

    /**
     * Compute analytical stats for the current parameters.
     * These are ideal values (flat ground, no drag):
     *
     *   Time of flight   T = 2 * Vy / g
     *   Maximum height   H = Vy² / (2g)
     *   Range            R = V² * sin(2θ) / g
     *
     * @returns {{ flightTime: number, maxHeight: number, range: number }}
     */
    computeStats() {
        const θ = THREE.MathUtils.degToRad(this.angle);
        const vy = this.initialVelocity * Math.sin(θ);

        // T = 2 * Vy / g  — total time the projectile is airborne
        const flightTime = (2 * vy) / this.gravity;

        // H = Vy² / (2g)  — peak height above launch point
        const maxHeight = (vy * vy) / (2 * this.gravity);

        // R = V² * sin(2θ) / g  — horizontal distance (flat ground)
        const range = (this.initialVelocity * this.initialVelocity * Math.sin(2 * θ)) / this.gravity;

        return {
            flightTime: Math.max(0, flightTime),
            maxHeight: Math.max(0, maxHeight),
            range: Math.max(0, range)
        };
    }

    /**
     * Clean up all Three.js resources.
     */
    dispose() {
        this.clearTrajectoryLine();

        if (this.mesh) {
            this.scene.remove(this.mesh);
            this.mesh.geometry.dispose();
            this.mesh.material.dispose();
            this.mesh = null;
        }

        if (this.ring) {
            this.scene.remove(this.ring);
            this.ring.geometry.dispose();
            this.ring.material.dispose();
            this.ring = null;
        }
    }
}
