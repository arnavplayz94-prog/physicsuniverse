import * as THREE from 'three';

/**
 * ProjectileUI — manages the right-click parameter panel for launching objects.
 *
 * Supports TWO target types:
 *   1. Projectile instances (custom kinematics, no Cannon body)
 *   2. Regular physics objects { mesh, body } from objectsToUpdate (Cannon bodies)
 *
 * For Projectile targets → calls projectile.launch() (kinematics-based)
 * For regular objects     → applies velocity directly to the Cannon body
 *
 * Trajectory preview and analytical stats work identically for both,
 * using the same kinematics equations.
 */
export class ProjectileUI {
    /**
     * @param {import('./physics_sim.js').PhysicsSimulation} simulation
     * @param {import('three/addons/controls/PointerLockControls.js').PointerLockControls} controls
     * @param {THREE.Scene} scene — needed for drawing trajectory on regular objects
     */
    constructor(simulation, controls, scene) {
        this.simulation = simulation;
        this.controls = controls;
        this.scene = scene;

        /** Active target — either a Projectile or { mesh, body } */
        this.activeTarget = null;

        /** Whether the active target is a Projectile instance (true) or regular object (false) */
        this.isProjectileType = false;

        /** Launch direction captured when panel opens (for regular objects) */
        this.launchDir = new THREE.Vector3(1, 0, 0);

        /** Trajectory line for regular objects (Projectile manages its own) */
        this.trajectoryLine = null;

        // Cache DOM elements
        this.panel = document.getElementById('projectile-panel');
        this.velSlider = document.getElementById('proj-velocity');
        this.velValue = document.getElementById('proj-vel-val');
        this.angSlider = document.getElementById('proj-angle');
        this.angValue = document.getElementById('proj-ang-val');
        this.gravSlider = document.getElementById('proj-gravity');
        this.gravValue = document.getElementById('proj-grav-val');
        this.massSlider = document.getElementById('proj-mass');
        this.massValue = document.getElementById('proj-mass-val');

        // Stats displays
        this.statFlight = document.getElementById('proj-stat-flight');
        this.statHeight = document.getElementById('proj-stat-height');
        this.statRange = document.getElementById('proj-stat-range');

        // Buttons
        this.launchBtn = document.getElementById('proj-launch-btn');
        this.cancelBtn = document.getElementById('proj-cancel-btn');

        this._bindEvents();
    }

    /**
     * Wire up event listeners.
     * @private
     */
    _bindEvents() {
        // Slider input → update preview + stats
        const onSliderChange = () => this._onParamsChanged();
        this.velSlider.addEventListener('input', onSliderChange);
        this.angSlider.addEventListener('input', onSliderChange);
        this.gravSlider.addEventListener('input', onSliderChange);
        this.massSlider.addEventListener('input', onSliderChange);

        // Launch button
        this.launchBtn.addEventListener('click', (e) => {
            e.stopPropagation(); // Prevent pointer lock re-engage
            this._onLaunch();
        });

        // Cancel button
        this.cancelBtn.addEventListener('click', (e) => {
            e.stopPropagation(); // Prevent pointer lock re-engage
            this.close();
        });

        // Prevent any click inside the panel from triggering pointer lock
        this.panel.addEventListener('click', (e) => {
            e.stopPropagation();
        });
    }

    /**
     * Open the parameter panel for a target object.
     *
     * @param {object} target — either a Projectile or { mesh, body } from objectsToUpdate
     * @param {THREE.Vector3} [launchDir] — horizontal launch direction (for regular objects)
     * @param {number} [worldGravity] — current world gravity magnitude (for regular objects default)
     */
    open(target, launchDir, worldGravity) {
        // Close previous if any
        this._clearTrajectory();

        this.activeTarget = target;

        // Detect if target is a Projectile (has launch() method) or regular object (has body)
        this.isProjectileType = typeof target.launch === 'function';

        // Store launch direction
        if (launchDir) {
            this.launchDir = new THREE.Vector3(launchDir.x, 0, launchDir.z).normalize();
        }

        // Populate sliders with appropriate defaults
        if (this.isProjectileType) {
            // Projectile instance — use its stored params
            this.velSlider.value = target.initialVelocity;
            this.angSlider.value = target.angle;
            this.gravSlider.value = target.gravity;
            this.massSlider.value = target.mass;
        } else {
            // Regular object — sensible defaults, use world gravity
            this.velSlider.value = 20;
            this.angSlider.value = 45;
            this.gravSlider.value = worldGravity || 9.8;
            this.massSlider.value = target.body ? target.body.mass : 1;
        }

        // Update values display and draw preview
        this._onParamsChanged();

        // Show panel
        this.panel.classList.add('visible');

        // Unlock pointer so user can interact with the panel
        if (this.controls.isLocked) {
            this.controls.unlock();
        }
    }

    /**
     * Close the panel without launching.
     */
    close() {
        this._clearTrajectory();
        this.activeTarget = null;
        this.panel.classList.remove('visible');
    }

    /**
     * Get current slider values.
     * @private
     * @returns {{ velocity: number, angle: number, gravity: number, mass: number }}
     */
    _getParams() {
        return {
            velocity: parseFloat(this.velSlider.value),
            angle: parseFloat(this.angSlider.value),
            gravity: parseFloat(this.gravSlider.value),
            mass: parseFloat(this.massSlider.value),
        };
    }

    /**
     * Called when any slider value changes.
     * Updates display, pushes params, redraws trajectory, recalculates stats.
     * @private
     */
    _onParamsChanged() {
        if (!this.activeTarget) return;

        const { velocity, angle, gravity, mass } = this._getParams();

        // Update display labels
        this.velValue.textContent = velocity.toFixed(0);
        this.angValue.textContent = angle.toFixed(0);
        this.gravValue.textContent = gravity.toFixed(1);
        this.massValue.textContent = mass.toFixed(1);

        if (this.isProjectileType) {
            // Push values to the Projectile instance
            this.activeTarget.setParams({ velocity, angle, gravity, mass });
            // Redraw trajectory (Projectile manages its own line)
            this.activeTarget.drawTrajectoryLine();
            // Compute stats from Projectile
            const stats = this.activeTarget.computeStats();
            this._displayStats(stats);
        } else {
            // Regular object — compute trajectory and stats externally
            const launchPos = new THREE.Vector3().copy(this.activeTarget.body.position);
            this._drawTrajectoryForRegularObject(launchPos, velocity, angle, gravity);
            const stats = this._computeStats(velocity, angle, gravity);
            this._displayStats(stats);
        }
    }

    /**
     * Display stats in the panel.
     * @private
     */
    _displayStats(stats) {
        this.statFlight.textContent = stats.flightTime.toFixed(2) + 's';
        this.statHeight.textContent = stats.maxHeight.toFixed(2) + 'm';
        this.statRange.textContent = stats.range.toFixed(2) + 'm';
    }

    /**
     * Compute analytical stats (same equations as Projectile.computeStats).
     *
     *   T = 2 * Vy / g       — time of flight
     *   H = Vy² / (2g)       — maximum height
     *   R = V² * sin(2θ) / g — horizontal range
     *
     * @private
     */
    _computeStats(velocity, angleDeg, gravity) {
        const θ = THREE.MathUtils.degToRad(angleDeg);
        const vy = velocity * Math.sin(θ);

        const flightTime = (2 * vy) / gravity;
        const maxHeight = (vy * vy) / (2 * gravity);
        const range = (velocity * velocity * Math.sin(2 * θ)) / gravity;

        return {
            flightTime: Math.max(0, flightTime),
            maxHeight: Math.max(0, maxHeight),
            range: Math.max(0, range)
        };
    }

    /**
     * Draw trajectory preview for a regular (Cannon body) object.
     * Uses the same kinematics equations, purely local — no state mutation.
     * @private
     */
    _drawTrajectoryForRegularObject(launchPos, velocity, angleDeg, gravity) {
        this._clearTrajectory();

        const θ = THREE.MathUtils.degToRad(angleDeg);
        const vx = velocity * Math.cos(θ);
        const vy = velocity * Math.sin(θ);

        const groundLevel = 0;
        const numPoints = 60;

        // Estimate flight time (with launch height considered)
        const estimatedT = (vy + Math.sqrt(vy * vy + 2 * gravity * Math.max(0, launchPos.y - groundLevel))) / gravity;
        const dtSim = Math.max(estimatedT / numPoints, 0.01);

        const points = [];
        for (let i = 0; i <= numPoints; i++) {
            const t = i * dtSim;
            const dx = vx * t;
            const dy = vy * t - 0.5 * gravity * t * t;

            const px = launchPos.x + this.launchDir.x * dx;
            const pz = launchPos.z + this.launchDir.z * dx;
            let py = launchPos.y + dy;

            if (py <= groundLevel && i > 0) {
                py = groundLevel;
                points.push(new THREE.Vector3(px, py, pz));
                break;
            }
            points.push(new THREE.Vector3(px, py, pz));
        }

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
        this.trajectoryLine.computeLineDistances();
        this.scene.add(this.trajectoryLine);
    }

    /**
     * Remove trajectory line (for regular objects).
     * @private
     */
    _clearTrajectory() {
        // Clear trajectory for Projectile targets
        if (this.activeTarget && this.isProjectileType && typeof this.activeTarget.clearTrajectoryLine === 'function') {
            this.activeTarget.clearTrajectoryLine();
        }
        // Clear trajectory for regular targets (managed by this class)
        if (this.trajectoryLine) {
            this.scene.remove(this.trajectoryLine);
            this.trajectoryLine.geometry.dispose();
            this.trajectoryLine.material.dispose();
            this.trajectoryLine = null;
        }
    }

    /**
     * Launch the active target and close the panel.
     * @private
     */
    _onLaunch() {
        if (!this.activeTarget) return;

        const { velocity, angle, gravity, mass } = this._getParams();
        const θ = THREE.MathUtils.degToRad(angle);

        if (this.isProjectileType) {
            // Dedicated Projectile — uses its own kinematics engine
            this.activeTarget.launch();
        } else {
            // Regular Cannon body — apply computed velocity directly
            // Vx = V * cos(θ) — horizontal speed along launch direction
            // Vy = V * sin(θ) — vertical speed (upward)
            const vx = velocity * Math.cos(θ);
            const vy = velocity * Math.sin(θ);

            const body = this.activeTarget.body;
            body.velocity.set(
                this.launchDir.x * vx,  // X component along launch direction
                vy,                      // Upward component
                this.launchDir.z * vx   // Z component along launch direction
            );
            body.wakeUp();
        }

        this._clearTrajectory();
        this.activeTarget = null;
        this.panel.classList.remove('visible');
    }

    /**
     * Check if the panel is currently open.
     * @returns {boolean}
     */
    get isOpen() {
        return this.panel.classList.contains('visible');
    }
}
