import * as THREE from 'three';

/**
 * MotionObject — pure kinematics state + math for a single object.
 *
 * Motion modes:
 *   "linear"      → x(t) = x₀ + v·t                   (constant velocity)
 *   "accelerated" → x(t) = x₀ + u·t + ½a·t²           (full SUVAT)
 *   "freefall"    → y(t) = y₀ - ½g·t²                  (special case, a = (0,-g,0))
 *   "projectile"  → x(t) = x₀ + vx·t, y(t) = y₀ + vy·t - ½g·t²  (2D projectile)
 *   "circular"    → x = cx + r·cos(ωt), z = cz + r·sin(ωt)
 *   "relative"    → v_total = v_object + v_frame
 *
 * Drag modes (optional):
 *   "none"      → no drag
 *   "linear"    → F = -k·v           → a_drag = -k·v / m
 *   "quadratic" → F = -k·|v|²·v̂     → a_drag = -k·|v|·v / m
 *
 * Bounce:
 *   On ground collision (y ≤ 0): v_y = -e · v_y
 *   Stops when |v_y| < threshold
 *
 * This class contains NO DOM logic, NO scene orchestration.
 * Only math and state.
 */
export class MotionObject {
    /**
     * @param {THREE.Scene} scene — Three.js scene for the mesh
     * @param {THREE.Vector3} position — initial world-space position
     * @param {object} [params] — configuration overrides
     */
    constructor(scene, position, params = {}) {
        // --- Visual representation ---
        if (params.mesh) {
            // Use externally provided mesh (e.g. from spawnBox, spawnSphere, etc.)
            this.mesh = params.mesh;
        } else {
            // Create default kinematics sphere
            const radius = params.radius || 0.35;
            const geo = new THREE.SphereGeometry(radius, 24, 24);
            const mat = new THREE.MeshStandardMaterial({
                color: 0x111111,
                emissive: params.color || 0x00ffff,
                emissiveIntensity: 2,
                roughness: 0.1,
                metalness: 0.9
            });
            this.mesh = new THREE.Mesh(geo, mat);
            this.mesh.position.copy(position);
            this.mesh.castShadow = true;
            scene.add(this.mesh);
        }
        this.mesh.userData.isMotionObject = true;
        this.mesh.userData.motionObjectRef = this;
        this.scene = scene;

        // --- Motion type ---
        // "linear" | "accelerated" | "freefall" | "circular" | "relative"
        this.motionType = params.motionType || 'linear';

        // --- Core state ---
        this.position = position.clone();
        this.velocity = new THREE.Vector3(
            params.vx || 0,
            params.vy || 0,
            params.vz || 0
        );
        this.acceleration = new THREE.Vector3(
            params.ax || 0,
            params.ay || 0,
            params.az || 0
        );
        this.mass = params.mass || 1.0;

        // --- Initial conditions (for analytical equations) ---
        this.initialPosition = this.position.clone();
        this.initialVelocity = this.velocity.clone();
        this.elapsedTime = 0;

        // --- Freefall ---
        this.gravity = params.gravity || 9.8;       // positive magnitude
        this.dropHeight = params.dropHeight || position.y;

        // --- Circular motion ---
        this.circularRadius = params.circularRadius || 5;
        this.angularVelocity = params.angularVelocity || 1;  // ω in rad/s
        this.circularClockwise = params.circularClockwise || false;
        this.circularCenter = position.clone();  // orbit center = spawn point

        // --- Relative motion ---
        this.frameVelocity = new THREE.Vector3(
            params.frameVx || 0,
            params.frameVy || 0,
            params.frameVz || 0
        );
        this.viewInWorldFrame = true;  // true = world, false = frame-relative

        // --- Drag ---
        this.dragMode = params.dragMode || 'none';   // "none" | "linear" | "quadratic"
        this.dragCoefficient = params.dragCoefficient || 0.1;

        // --- Bounce ---
        this.restitution = params.restitution || 0.7;  // coefficient of restitution [0,1]
        this.bounceEnabled = params.bounceEnabled !== undefined ? params.bounceEnabled : true;
        this.bounceThreshold = 0.1;  // min velocity to keep bouncing
        this.isStopped = false;

        // --- Lifecycle ---
        this.isLaunched = false;
        this.status = 'idle';  // 'idle' | 'active' | 'stopped' | 'remove'

        // --- Stats (updated each frame for UI) ---
        this.stats = {
            speed: 0,
            displacement: 0,
            accelerationMag: 0,
            centripetalAccel: 0,
            timeToImpact: 0,
            impactVelocity: 0
        };

        // --- Trail (for visual path) ---
        this.trailPoints = [];
        this.trailLine = null;
        this.maxTrailPoints = 200;
    }

    /**
     * Configure motion parameters. Called by UI when sliders change.
     * @param {object} config
     */
    setParams(config) {
        if (config.motionType !== undefined) this.motionType = config.motionType;

        // Velocity
        if (config.velocityMag !== undefined && config.directionAngle !== undefined) {
            const hAngle = THREE.MathUtils.degToRad(config.directionAngle || 0);
            const vAngle = THREE.MathUtils.degToRad(config.verticalAngle || 0);
            const mag = config.velocityMag;
            this.velocity.set(
                mag * Math.cos(vAngle) * Math.sin(hAngle),
                mag * Math.sin(vAngle),
                mag * Math.cos(vAngle) * Math.cos(hAngle)
            );
            this.initialVelocity.copy(this.velocity);
        }
        if (config.vx !== undefined) { this.velocity.x = config.vx; this.initialVelocity.x = config.vx; }
        if (config.vy !== undefined) { this.velocity.y = config.vy; this.initialVelocity.y = config.vy; }
        if (config.vz !== undefined) { this.velocity.z = config.vz; this.initialVelocity.z = config.vz; }

        // Acceleration
        if (config.accelMag !== undefined && config.accelDirection !== undefined) {
            const aAngle = THREE.MathUtils.degToRad(config.accelDirection || 0);
            const aVAngle = THREE.MathUtils.degToRad(config.accelVerticalAngle || 0);
            const aMag = config.accelMag;
            this.acceleration.set(
                aMag * Math.cos(aVAngle) * Math.sin(aAngle),
                aMag * Math.sin(aVAngle),
                aMag * Math.cos(aVAngle) * Math.cos(aAngle)
            );
        }
        if (config.ax !== undefined) this.acceleration.x = config.ax;
        if (config.ay !== undefined) this.acceleration.y = config.ay;
        if (config.az !== undefined) this.acceleration.z = config.az;

        // Freefall
        if (config.gravity !== undefined) this.gravity = config.gravity;
        if (config.dropHeight !== undefined) {
            this.dropHeight = config.dropHeight;
            this.initialPosition.y = config.dropHeight;
            this.position.y = config.dropHeight;
            this.mesh.position.y = config.dropHeight;
        }

        // Circular
        if (config.circularRadius !== undefined) this.circularRadius = config.circularRadius;
        if (config.angularVelocity !== undefined) this.angularVelocity = config.angularVelocity;
        if (config.circularClockwise !== undefined) this.circularClockwise = config.circularClockwise;

        // Relative
        if (config.frameVelocityMag !== undefined && config.frameDirection !== undefined) {
            const fAngle = THREE.MathUtils.degToRad(config.frameDirection);
            this.frameVelocity.set(
                config.frameVelocityMag * Math.sin(fAngle),
                0,
                config.frameVelocityMag * Math.cos(fAngle)
            );
        }
        if (config.viewInWorldFrame !== undefined) this.viewInWorldFrame = config.viewInWorldFrame;

        // Drag
        if (config.dragMode !== undefined) this.dragMode = config.dragMode;
        if (config.dragCoefficient !== undefined) this.dragCoefficient = config.dragCoefficient;

        // Bounce
        if (config.restitution !== undefined) this.restitution = config.restitution;
        if (config.bounceEnabled !== undefined) this.bounceEnabled = config.bounceEnabled;

        this.mass = config.mass || this.mass;
    }

    /**
     * Start the motion simulation.
     */
    launch() {
        this.isLaunched = true;
        this.status = 'active';
        this.elapsedTime = 0;
        this.isStopped = false;

        // Store initial conditions for analytical computation
        this.initialPosition.copy(this.position);
        this.initialVelocity.copy(this.velocity);

        // Freefall: override acceleration to pure gravity
        if (this.motionType === 'freefall') {
            this.acceleration.set(0, -this.gravity, 0);
            this.velocity.set(0, 0, 0);
            this.initialVelocity.set(0, 0, 0);
        }

        // Projectile: set acceleration to gravity downward, keep initial velocity
        if (this.motionType === 'projectile') {
            this.acceleration.set(0, -this.gravity, 0);
        }

        // Circular: position starts at (center.x + r, center.y, center.z)
        if (this.motionType === 'circular') {
            this.circularCenter.copy(this.position);
            this.position.x = this.circularCenter.x + this.circularRadius;
            this.position.z = this.circularCenter.z;
            this.initialPosition.copy(this.position);
        }
    }

    /**
     * Reset to initial state.
     */
    reset() {
        this.position.copy(this.initialPosition);
        this.velocity.copy(this.initialVelocity);
        this.mesh.position.copy(this.initialPosition);
        this.elapsedTime = 0;
        this.isLaunched = false;
        this.isStopped = false;
        this.status = 'idle';
        this.trailPoints = [];
        this._clearTrail();
    }

    /**
     * Main update — called each frame with scaled dt.
     *
     * @param {number} dt — delta time (already scaled by timeScale)
     * @returns {string} status — 'active' | 'stopped' | 'remove'
     */
    update(dt) {
        if (!this.isLaunched || this.isStopped) return this.status;

        this.elapsedTime += dt;

        switch (this.motionType) {
            case 'linear':
                this._updateLinear(dt);
                break;
            case 'accelerated':
                this._updateAccelerated(dt);
                break;
            case 'freefall':
                this._updateFreefall(dt);
                break;
            case 'projectile':
                this._updateProjectile(dt);
                break;
            case 'circular':
                this._updateCircular(dt);
                break;
            case 'relative':
                this._updateRelative(dt);
                break;
            default:
                this._updateLinear(dt);
        }

        // Sync mesh
        this.mesh.position.copy(this.position);

        // Update trail
        this._updateTrail();

        // Update stats
        this._computeStats();

        return this.status;
    }

    // ================================================================
    // MOTION UPDATE METHODS (analytical + dt-based)
    // ================================================================

    /**
     * Uniform linear motion: x(t) = x₀ + v·t
     * No acceleration. Velocity is constant.
     */
    _updateLinear(dt) {
        // Apply drag if enabled (modifies velocity)
        this._applyDrag(dt);

        // Analytical: position from initial conditions + elapsed time
        // But with drag, we must integrate incrementally
        if (this.dragMode === 'none') {
            // Pure analytical
            const t = this.elapsedTime;
            this.position.x = this.initialPosition.x + this.initialVelocity.x * t;
            this.position.y = this.initialPosition.y + this.initialVelocity.y * t;
            this.position.z = this.initialPosition.z + this.initialVelocity.z * t;
        } else {
            // Incremental (drag already modified velocity)
            this.position.x += this.velocity.x * dt;
            this.position.y += this.velocity.y * dt;
            this.position.z += this.velocity.z * dt;
        }

        // Ground collision
        this._handleGroundCollision();
    }

    /**
     * Uniformly accelerated motion (SUVAT):
     *   v = u + a·t
     *   s = u·t + ½·a·t²
     *   v² = u² + 2·a·s
     *
     * Uses analytical equation for position accuracy.
     */
    _updateAccelerated(dt) {
        // Apply drag
        this._applyDrag(dt);

        if (this.dragMode === 'none') {
            // Analytical position: s = x₀ + u·t + ½·a·t²
            const t = this.elapsedTime;
            this.position.x = this.initialPosition.x + this.initialVelocity.x * t + 0.5 * this.acceleration.x * t * t;
            this.position.y = this.initialPosition.y + this.initialVelocity.y * t + 0.5 * this.acceleration.y * t * t;
            this.position.z = this.initialPosition.z + this.initialVelocity.z * t + 0.5 * this.acceleration.z * t * t;

            // Analytical velocity: v = u + a·t
            this.velocity.x = this.initialVelocity.x + this.acceleration.x * t;
            this.velocity.y = this.initialVelocity.y + this.acceleration.y * t;
            this.velocity.z = this.initialVelocity.z + this.acceleration.z * t;
        } else {
            // Incremental (drag makes analytical intractable)
            this.velocity.x += this.acceleration.x * dt;
            this.velocity.y += this.acceleration.y * dt;
            this.velocity.z += this.acceleration.z * dt;
            this.position.x += this.velocity.x * dt;
            this.position.y += this.velocity.y * dt;
            this.position.z += this.velocity.z * dt;
        }

        // Ground collision
        this._handleGroundCollision();
    }

    /**
     * Free fall: special case of accelerated motion with a = (0, -g, 0).
     *   y(t) = y₀ - ½g·t²
     *   v(t) = -g·t
     *
     * Impact detection via quadratic: y₀ - ½g·t² = 0
     *   t_impact = sqrt(2·y₀ / g)
     */
    _updateFreefall(dt) {
        // Apply drag
        this._applyDrag(dt);

        if (this.dragMode === 'none') {
            // Analytical
            const t = this.elapsedTime;
            const g = this.gravity;
            this.position.y = this.initialPosition.y - 0.5 * g * t * t;
            this.velocity.y = -g * t;
            // Horizontal stays constant (no initial horizontal velocity in freefall)
            this.position.x = this.initialPosition.x;
            this.position.z = this.initialPosition.z;
        } else {
            // Incremental with drag
            this.velocity.y += (-this.gravity) * dt;
            this.position.x += this.velocity.x * dt;
            this.position.y += this.velocity.y * dt;
            this.position.z += this.velocity.z * dt;
        }

        // Ground collision
        this._handleGroundCollision();
    }

    /**
     * Projectile motion:
     *   x(t) = x₀ + vx·t
     *   y(t) = y₀ + vy·t - ½g·t²
     *   z(t) = z₀ + vz·t
     *   vx = const, vy = vy₀ - g·t, vz = const
     */
    _updateProjectile(dt) {
        this._applyDrag(dt);

        if (this.dragMode === 'none') {
            // Analytical
            const t = this.elapsedTime;
            const g = this.gravity;
            this.position.x = this.initialPosition.x + this.initialVelocity.x * t;
            this.position.y = this.initialPosition.y + this.initialVelocity.y * t - 0.5 * g * t * t;
            this.position.z = this.initialPosition.z + this.initialVelocity.z * t;

            this.velocity.x = this.initialVelocity.x;
            this.velocity.y = this.initialVelocity.y - g * t;
            this.velocity.z = this.initialVelocity.z;
        } else {
            // Incremental with drag
            this.velocity.y += (-this.gravity) * dt;
            this.position.x += this.velocity.x * dt;
            this.position.y += this.velocity.y * dt;
            this.position.z += this.velocity.z * dt;
        }

        // Ground collision
        this._handleGroundCollision();
    }

    /**
     * Circular motion:
     *   x(t) = cx + r·cos(ω·t)
     *   z(t) = cz + r·sin(ω·t)   (or -sin for clockwise)
     *   a_c  = v² / r = ω²·r     (centripetal acceleration)
     */
    _updateCircular(dt) {
        const t = this.elapsedTime;
        const r = this.circularRadius;
        const w = this.angularVelocity;
        const sign = this.circularClockwise ? -1 : 1;

        // Analytical position on circle
        this.position.x = this.circularCenter.x + r * Math.cos(sign * w * t);
        this.position.z = this.circularCenter.z + r * Math.sin(sign * w * t);
        this.position.y = this.circularCenter.y;

        // Tangential velocity (derivative of position)
        this.velocity.x = -r * w * Math.sin(sign * w * t) * sign;
        this.velocity.z = r * w * Math.cos(sign * w * t) * sign;
        this.velocity.y = 0;
    }

    /**
     * Relative motion:
     *   v_total = v_object + v_frame
     *
     * The object moves with its own velocity, but position can be viewed
     * in world frame or frame-relative coordinates.
     */
    _updateRelative(dt) {
        // Apply drag
        this._applyDrag(dt);

        // Total velocity in world frame
        const totalVel = this.velocity.clone().add(this.frameVelocity);

        // Incremental position update (in world frame)
        this.position.x += totalVel.x * dt;
        this.position.y += totalVel.y * dt;
        this.position.z += totalVel.z * dt;

        // If viewing in frame-relative, offset the mesh position
        if (!this.viewInWorldFrame) {
            // Subtract the frame displacement from visual position
            const frameDisp = this.frameVelocity.clone().multiplyScalar(this.elapsedTime);
            this.mesh.position.copy(this.position).sub(frameDisp);
            return; // skip default mesh sync
        }

        // Ground collision
        this._handleGroundCollision();
    }

    // ================================================================
    // DRAG SYSTEM
    // ================================================================

    /**
     * Apply drag force to velocity (modifies this.velocity).
     *
     * Linear:    a_drag = -k · v / m
     * Quadratic: a_drag = -k · |v| · v / m
     *
     * @param {number} dt
     */
    _applyDrag(dt) {
        if (this.dragMode === 'none') return;

        const k = this.dragCoefficient;
        const m = this.mass;
        const speed = this.velocity.length();

        if (speed < 0.001) return; // avoid division by zero

        if (this.dragMode === 'linear') {
            // F = -k·v  →  a = -k·v/m  →  dv = -k·v/m · dt
            this.velocity.x -= (k * this.velocity.x / m) * dt;
            this.velocity.y -= (k * this.velocity.y / m) * dt;
            this.velocity.z -= (k * this.velocity.z / m) * dt;
        } else if (this.dragMode === 'quadratic') {
            // F = -k·|v|²·v̂  →  a = -k·|v|·v/m  →  dv = -k·|v|·v/m · dt
            this.velocity.x -= (k * speed * this.velocity.x / m) * dt;
            this.velocity.y -= (k * speed * this.velocity.y / m) * dt;
            this.velocity.z -= (k * speed * this.velocity.z / m) * dt;
        }
    }

    // ================================================================
    // BOUNCE / GROUND COLLISION
    // ================================================================

    /**
     * Ground collision with coefficient of restitution.
     *   v_after = -e · v_before
     * Stops bouncing if |v_y| < threshold.
     */
    _handleGroundCollision() {
        if (this.position.y <= 0 && this.velocity.y < 0) {
            this.position.y = 0;

            if (this.bounceEnabled && this.restitution > 0) {
                // Coefficient of restitution
                this.velocity.y = -this.restitution * this.velocity.y;

                // Stop if velocity too small
                if (Math.abs(this.velocity.y) < this.bounceThreshold) {
                    this.velocity.y = 0;
                    this.isStopped = true;
                    this.status = 'stopped';
                }

                // After bounce, we must reset initial conditions for analytical accuracy
                // (subsequent motion starts from new initial state)
                this.initialPosition.copy(this.position);
                this.initialVelocity.copy(this.velocity);
                this.elapsedTime = 0;
            } else {
                // No bounce — just stop
                this.velocity.y = 0;
                this.isStopped = true;
                this.status = 'stopped';
            }
        }
    }

    // ================================================================
    // STATS
    // ================================================================

    /**
     * Compute live stats for UI display.
     */
    _computeStats() {
        const speed = this.velocity.length();
        const disp = this.position.clone().sub(this.initialPosition).length();

        this.stats.speed = speed;
        this.stats.displacement = disp;
        this.stats.accelerationMag = this.acceleration.length();

        // Circular: centripetal acceleration = v²/r = ω²·r
        if (this.motionType === 'circular') {
            const w = this.angularVelocity;
            const r = this.circularRadius;
            this.stats.centripetalAccel = w * w * r;
        }

        // Freefall: time to impact & impact velocity
        if (this.motionType === 'freefall' && this.initialPosition.y > 0 && this.gravity > 0) {
            const tImpact = Math.sqrt(2 * this.dropHeight / this.gravity);
            this.stats.timeToImpact = Math.max(0, tImpact - this.elapsedTime);
            this.stats.impactVelocity = this.gravity * tImpact;
        }

        // Projectile stats
        if (this.motionType === 'projectile' && this.gravity > 0) {
            const vy0 = this.initialVelocity.y;
            const g = this.gravity;
            // Time of flight: when y returns to initial height
            // y₀ + vy·t - ½g·t² = y₀  →  t(vy - ½g·t) = 0  →  t = 2·vy/g
            const tFlight = vy0 > 0 ? (2 * vy0 / g) : 0;
            this.stats.timeToImpact = Math.max(0, tFlight - this.elapsedTime);
            // Max height: vy² / (2g)
            const maxH = vy0 > 0 ? (vy0 * vy0) / (2 * g) : 0;
            this.stats.maxHeight = maxH;
            // Range: vx * tFlight
            const vHoriz = Math.sqrt(this.initialVelocity.x ** 2 + this.initialVelocity.z ** 2);
            this.stats.range = vHoriz * tFlight;
            this.stats.impactVelocity = Math.sqrt(vHoriz ** 2 + (vy0 - g * tFlight) ** 2);
        }
    }

    // ================================================================
    // TRAIL
    // ================================================================

    _updateTrail() {
        this.trailPoints.push(this.position.clone());
        if (this.trailPoints.length > this.maxTrailPoints) {
            this.trailPoints.shift();
        }

        // Rebuild trail line geometry
        if (this.trailPoints.length > 2) {
            this._clearTrail();
            const geometry = new THREE.BufferGeometry().setFromPoints(this.trailPoints);
            const material = new THREE.LineBasicMaterial({
                color: 0x00ffff,
                transparent: true,
                opacity: 0.4
            });
            this.trailLine = new THREE.Line(geometry, material);
            this.scene.add(this.trailLine);
        }
    }

    _clearTrail() {
        if (this.trailLine) {
            this.scene.remove(this.trailLine);
            this.trailLine.geometry.dispose();
            this.trailLine.material.dispose();
            this.trailLine = null;
        }
    }

    // ================================================================
    // PREVIEW (non-mutating)
    // ================================================================

    /**
     * Compute predicted trajectory points WITHOUT modifying state.
     * @param {number} [numPoints=60]
     * @returns {THREE.Vector3[]}
     */
    computePreviewPoints(numPoints = 60) {
        const points = [];
        const dt = 0.05;  // preview time step
        const pos = this.position.clone();
        const vel = this.velocity.clone();

        for (let i = 0; i < numPoints; i++) {
            const t = i * dt;
            let px, py, pz;

            switch (this.motionType) {
                case 'linear':
                    px = this.initialPosition.x + this.initialVelocity.x * t;
                    py = this.initialPosition.y + this.initialVelocity.y * t;
                    pz = this.initialPosition.z + this.initialVelocity.z * t;
                    break;
                case 'accelerated':
                    px = this.initialPosition.x + this.initialVelocity.x * t + 0.5 * this.acceleration.x * t * t;
                    py = this.initialPosition.y + this.initialVelocity.y * t + 0.5 * this.acceleration.y * t * t;
                    pz = this.initialPosition.z + this.initialVelocity.z * t + 0.5 * this.acceleration.z * t * t;
                    break;
                case 'freefall':
                    px = this.initialPosition.x;
                    py = this.initialPosition.y - 0.5 * this.gravity * t * t;
                    pz = this.initialPosition.z;
                    break;
                case 'projectile':
                    px = this.initialPosition.x + this.initialVelocity.x * t;
                    py = this.initialPosition.y + this.initialVelocity.y * t - 0.5 * this.gravity * t * t;
                    pz = this.initialPosition.z + this.initialVelocity.z * t;
                    break;
                case 'circular': {
                    const sign = this.circularClockwise ? -1 : 1;
                    px = this.circularCenter.x + this.circularRadius * Math.cos(sign * this.angularVelocity * t);
                    py = this.circularCenter.y;
                    pz = this.circularCenter.z + this.circularRadius * Math.sin(sign * this.angularVelocity * t);
                    break;
                }
                case 'relative': {
                    const totalVx = this.velocity.x + this.frameVelocity.x;
                    const totalVz = this.velocity.z + this.frameVelocity.z;
                    px = this.initialPosition.x + totalVx * t;
                    py = this.initialPosition.y + this.velocity.y * t;
                    pz = this.initialPosition.z + totalVz * t;
                    break;
                }
                default:
                    px = this.initialPosition.x + this.initialVelocity.x * t;
                    py = this.initialPosition.y + this.initialVelocity.y * t;
                    pz = this.initialPosition.z + this.initialVelocity.z * t;
            }

            if (py < 0) py = 0;
            points.push(new THREE.Vector3(px, py, pz));
            if (py <= 0 && i > 0 && this.motionType !== 'circular') break;
        }

        return points;
    }

    // ================================================================
    // CLEANUP
    // ================================================================

    /**
     * Dispose all Three.js resources.
     */
    dispose() {
        if (this.mesh) {
            this.scene.remove(this.mesh);
            this.mesh.geometry.dispose();
            this.mesh.material.dispose();
            this.mesh = null;
        }
        this._clearTrail();
    }
}
