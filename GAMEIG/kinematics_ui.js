/**
 * KinematicsUI — dynamic control panel for MotionObject parameter editing.
 *
 * Responsibilities:
 *   - Motion mode selector dropdown
 *   - Dynamic slider rendering per mode (only relevant controls shown)
 *   - Real-time stat updates (reads from object.stats)
 *   - Graph toggle checkboxes
 *   - Air resistance toggle + coefficient slider
 *   - Bounce restitution slider
 *   - ESC closes panel
 *
 * This class does NOT contain physics math — only reads stats from MotionObject.
 */
export class KinematicsUI {
    /**
     * @param {import('./kinematics_sim.js').KinematicsSimulation} simulation
     * @param {import('three/addons/controls/PointerLockControls.js').PointerLockControls} controls
     * @param {import('./kinematics_graph.js').KinematicsGraph} graph
     */
    constructor(simulation, controls, graph) {
        this.simulation = simulation;
        this.controls = controls;
        this.graph = graph;

        /** @type {import('./motion_object.js').MotionObject|null} */
        this.activeObject = null;

        // DOM references
        this.panel = document.getElementById('kinematics-panel');
        this.modeSelect = document.getElementById('kin-mode-select');
        this.slidersContainer = document.getElementById('kin-sliders');
        this.statsContainer = document.getElementById('kin-stats');
        this.launchBtn = document.getElementById('kin-launch-btn');
        this.cancelBtn = document.getElementById('kin-cancel-btn');
        this.resetBtn = document.getElementById('kin-reset-btn');

        // Graph toggles
        this.graphPosToggle = document.getElementById('kin-graph-pos');
        this.graphVelToggle = document.getElementById('kin-graph-vel');
        this.graphAccToggle = document.getElementById('kin-graph-acc');

        this._open = false;
        this._statsInterval = null;

        this._bindEvents();
    }

    /**
     * Wire up event listeners.
     * @private
     */
    _bindEvents() {
        // Mode selector change
        this.modeSelect.addEventListener('change', () => {
            if (this.activeObject) {
                this.activeObject.setParams({ motionType: this.modeSelect.value });
                this._renderSliders();
                this._pushParams();
            }
        });

        // Launch button
        this.launchBtn.addEventListener('click', () => this._onLaunch());

        // Cancel button
        this.cancelBtn.addEventListener('click', () => this.close());

        // Reset button
        this.resetBtn.addEventListener('click', () => {
            if (this.activeObject) {
                this.activeObject.reset();
                this._pushParams();
            }
        });

        // Graph toggles
        if (this.graphPosToggle) {
            this.graphPosToggle.addEventListener('change', () => {
                if (this.graph) this.graph.showPosition = this.graphPosToggle.checked;
            });
        }
        if (this.graphVelToggle) {
            this.graphVelToggle.addEventListener('change', () => {
                if (this.graph) this.graph.showVelocity = this.graphVelToggle.checked;
            });
        }
        if (this.graphAccToggle) {
            this.graphAccToggle.addEventListener('change', () => {
                if (this.graph) this.graph.showAcceleration = this.graphAccToggle.checked;
            });
        }
    }

    /**
     * Open the panel for a target MotionObject.
     * @param {import('./motion_object.js').MotionObject} obj
     */
    open(obj) {
        this.activeObject = obj;
        this._open = true;

        // Unlock pointer for UI interaction
        if (this.controls.isLocked) this.controls.unlock();

        // Set mode selector
        this.modeSelect.value = obj.motionType;

        // Render dynamic sliders
        this._renderSliders();

        // Show panel
        this.panel.classList.add('visible');

        // Start live stat refresh
        this._statsInterval = setInterval(() => this._updateStats(), 100);

        // Connect to graph
        if (this.graph) {
            this.graph.setActiveObject(obj);
        }
    }

    /**
     * Close the panel.
     */
    close() {
        this._open = false;
        this.panel.classList.remove('visible');
        this.activeObject = null;
        if (this._statsInterval) {
            clearInterval(this._statsInterval);
            this._statsInterval = null;
        }
    }

    /**
     * Is the panel currently open?
     * @returns {boolean}
     */
    get isOpen() {
        return this._open;
    }

    /**
     * Render dynamic sliders based on current motion mode.
     * @private
     */
    _renderSliders() {
        if (!this.activeObject) return;
        const mode = this.activeObject.motionType;
        let html = '';

        // ── Common: Mass ──
        html += this._slider('kin-mass', 'MASS', 'kg', this.activeObject.mass, 0.1, 50, 0.1);

        // ── Mode-specific sliders ──
        switch (mode) {
            case 'linear':
                html += this._slider('kin-vel-mag', 'VELOCITY', 'm/s', this.activeObject.velocity.length() || 10, 0, 100, 1);
                html += this._slider('kin-dir-angle', 'DIRECTION', '°', 0, 0, 360, 1);
                html += this._slider('kin-vert-angle', 'VERTICAL ANGLE', '°', 0, -90, 90, 1);
                break;

            case 'accelerated':
                html += this._slider('kin-vel-mag', 'INITIAL VELOCITY', 'm/s', this.activeObject.velocity.length() || 10, 0, 100, 1);
                html += this._slider('kin-dir-angle', 'VELOCITY DIRECTION', '°', 0, 0, 360, 1);
                html += this._slider('kin-accel-mag', 'ACCELERATION', 'm/s²', this.activeObject.acceleration.length() || 5, 0, 50, 0.5);
                html += this._slider('kin-accel-dir', 'ACCEL DIRECTION', '°', 0, 0, 360, 1);
                html += this._slider('kin-accel-vert', 'ACCEL VERT ANGLE', '°', 0, -90, 90, 1);
                break;

            case 'freefall':
                html += this._slider('kin-drop-height', 'DROP HEIGHT', 'm', this.activeObject.dropHeight || 20, 1, 100, 1);
                html += this._slider('kin-gravity', 'GRAVITY', 'm/s²', this.activeObject.gravity, 1, 50, 0.5);
                html += this._dragSliders();
                break;

            case 'projectile':
                html += this._slider('kin-vel-mag', 'LAUNCH SPEED', 'm/s', this.activeObject.velocity.length() || 20, 1, 100, 1);
                html += this._slider('kin-dir-angle', 'DIRECTION', '°', 0, 0, 360, 1);
                html += this._slider('kin-vert-angle', 'LAUNCH ANGLE', '°', 45, 0, 90, 1);
                html += this._slider('kin-gravity', 'GRAVITY', 'm/s²', this.activeObject.gravity, 1, 50, 0.5);
                html += this._dragSliders();
                break;

            case 'circular':
                html += this._slider('kin-radius', 'RADIUS', 'm', this.activeObject.circularRadius, 1, 30, 0.5);
                html += this._slider('kin-omega', 'ANGULAR VEL (ω)', 'rad/s', this.activeObject.angularVelocity, 0.1, 10, 0.1);
                html += `<div class="kin-toggle-group">
                    <label>
                        <input type="checkbox" id="kin-clockwise" ${this.activeObject.circularClockwise ? 'checked' : ''}>
                        <span>CLOCKWISE</span>
                    </label>
                </div>`;
                break;

            case 'relative':
                html += this._slider('kin-vel-mag', 'OBJECT VELOCITY', 'm/s', this.activeObject.velocity.length() || 10, 0, 100, 1);
                html += this._slider('kin-dir-angle', 'OBJECT DIRECTION', '°', 0, 0, 360, 1);
                html += this._slider('kin-frame-vel', 'FRAME VELOCITY', 'm/s', this.activeObject.frameVelocity.length() || 5, 0, 50, 1);
                html += this._slider('kin-frame-dir', 'FRAME DIRECTION', '°', 0, 0, 360, 1);
                html += `<div class="kin-toggle-group">
                    <label>
                        <input type="checkbox" id="kin-world-frame" ${this.activeObject.viewInWorldFrame ? 'checked' : ''}>
                        <span>VIEW IN WORLD FRAME</span>
                    </label>
                </div>`;
                break;
        }

        // ── Drag sliders (for non-freefall modes that support it) ──
        if (mode !== 'freefall' && mode !== 'circular' && mode !== 'projectile') {
            html += this._dragSliders();
        }

        // ── Bounce slider (for modes with vertical movement) ──
        if (mode !== 'circular') {
            html += `<div class="kin-toggle-group">
                <label>
                    <input type="checkbox" id="kin-bounce-enabled" ${this.activeObject.bounceEnabled ? 'checked' : ''}>
                    <span>BOUNCE</span>
                </label>
            </div>`;
            html += this._slider('kin-restitution', 'RESTITUTION (e)', '', this.activeObject.restitution, 0, 1, 0.05);
        }

        this.slidersContainer.innerHTML = html;

        // Bind slider events (after innerHTML)
        this._bindSliderEvents();
    }

    /**
     * Generate drag-related sliders HTML.
     * @private
     */
    _dragSliders() {
        return `<div class="kin-toggle-group">
            <label>
                <input type="checkbox" id="kin-drag-toggle" ${this.activeObject.dragMode !== 'none' ? 'checked' : ''}>
                <span>AIR RESISTANCE</span>
            </label>
        </div>
        <div class="kin-drag-mode-row" id="kin-drag-mode-row" style="display:${this.activeObject.dragMode !== 'none' ? 'block' : 'none'}">
            <select id="kin-drag-mode-sel" class="kin-mini-select">
                <option value="linear" ${this.activeObject.dragMode === 'linear' ? 'selected' : ''}>Linear (F = -kv)</option>
                <option value="quadratic" ${this.activeObject.dragMode === 'quadratic' ? 'selected' : ''}>Quadratic (F = -kv²)</option>
            </select>
            ${this._slider('kin-drag-coeff', 'DRAG COEFFICIENT', '', this.activeObject.dragCoefficient, 0.01, 5, 0.01)}
        </div>`;
    }

    /**
     * Helper: generate a single slider HTML block.
     * @private
     */
    _slider(id, label, unit, value, min, max, step) {
        const displayVal = typeof value === 'number' ? (Number.isInteger(value) ? value : value.toFixed(2)) : value;
        return `<div class="kin-slider-group">
            <label>${label}: <span id="${id}-val">${displayVal}</span>${unit ? ' ' + unit : ''}</label>
            <input type="range" id="${id}" min="${min}" max="${max}" value="${value}" step="${step}">
        </div>`;
    }

    /**
     * Bind events to dynamically rendered sliders.
     * @private
     */
    _bindSliderEvents() {
        // Generic slider change handler
        const sliderIds = [
            'kin-mass', 'kin-vel-mag', 'kin-dir-angle', 'kin-vert-angle',
            'kin-accel-mag', 'kin-accel-dir', 'kin-accel-vert',
            'kin-drop-height', 'kin-gravity',
            'kin-radius', 'kin-omega',
            'kin-frame-vel', 'kin-frame-dir',
            'kin-drag-coeff', 'kin-restitution'
        ];

        for (const id of sliderIds) {
            const el = document.getElementById(id);
            if (el) {
                el.addEventListener('input', () => {
                    const valEl = document.getElementById(`${id}-val`);
                    if (valEl) valEl.textContent = el.value;
                    this._pushParams();
                });
            }
        }

        // Checkboxes
        const clockwiseEl = document.getElementById('kin-clockwise');
        if (clockwiseEl) {
            clockwiseEl.addEventListener('change', () => this._pushParams());
        }

        const worldFrameEl = document.getElementById('kin-world-frame');
        if (worldFrameEl) {
            worldFrameEl.addEventListener('change', () => this._pushParams());
        }

        const bounceEl = document.getElementById('kin-bounce-enabled');
        if (bounceEl) {
            bounceEl.addEventListener('change', () => this._pushParams());
        }

        // Drag toggle
        const dragToggle = document.getElementById('kin-drag-toggle');
        if (dragToggle) {
            dragToggle.addEventListener('change', () => {
                const row = document.getElementById('kin-drag-mode-row');
                if (row) row.style.display = dragToggle.checked ? 'block' : 'none';
                this._pushParams();
            });
        }

        const dragModeSel = document.getElementById('kin-drag-mode-sel');
        if (dragModeSel) {
            dragModeSel.addEventListener('change', () => this._pushParams());
        }
    }

    /**
     * Read all UI values and push them to the active MotionObject.
     * @private
     */
    _pushParams() {
        if (!this.activeObject) return;
        const mode = this.modeSelect.value;
        const config = { motionType: mode };

        // Mass
        const massEl = document.getElementById('kin-mass');
        if (massEl) config.mass = parseFloat(massEl.value);

        // Velocity magnitude + direction (shared by linear, accelerated, relative)
        const velMagEl = document.getElementById('kin-vel-mag');
        const dirAngleEl = document.getElementById('kin-dir-angle');
        const vertAngleEl = document.getElementById('kin-vert-angle');
        if (velMagEl && dirAngleEl) {
            config.velocityMag = parseFloat(velMagEl.value);
            config.directionAngle = parseFloat(dirAngleEl.value);
            config.verticalAngle = vertAngleEl ? parseFloat(vertAngleEl.value) : 0;
        }

        // Acceleration (accelerated mode)
        const accelMagEl = document.getElementById('kin-accel-mag');
        const accelDirEl = document.getElementById('kin-accel-dir');
        const accelVertEl = document.getElementById('kin-accel-vert');
        if (accelMagEl && accelDirEl) {
            config.accelMag = parseFloat(accelMagEl.value);
            config.accelDirection = parseFloat(accelDirEl.value);
            config.accelVerticalAngle = accelVertEl ? parseFloat(accelVertEl.value) : 0;
        }

        // Freefall
        const dropEl = document.getElementById('kin-drop-height');
        const gravEl = document.getElementById('kin-gravity');
        if (dropEl) config.dropHeight = parseFloat(dropEl.value);
        if (gravEl) config.gravity = parseFloat(gravEl.value);

        // Circular
        const radiusEl = document.getElementById('kin-radius');
        const omegaEl = document.getElementById('kin-omega');
        const clockEl = document.getElementById('kin-clockwise');
        if (radiusEl) config.circularRadius = parseFloat(radiusEl.value);
        if (omegaEl) config.angularVelocity = parseFloat(omegaEl.value);
        if (clockEl) config.circularClockwise = clockEl.checked;

        // Relative
        const frameVelEl = document.getElementById('kin-frame-vel');
        const frameDirEl = document.getElementById('kin-frame-dir');
        const worldFrameEl = document.getElementById('kin-world-frame');
        if (frameVelEl && frameDirEl) {
            config.frameVelocityMag = parseFloat(frameVelEl.value);
            config.frameDirection = parseFloat(frameDirEl.value);
        }
        if (worldFrameEl) config.viewInWorldFrame = worldFrameEl.checked;

        // Drag
        const dragToggle = document.getElementById('kin-drag-toggle');
        const dragModeSel = document.getElementById('kin-drag-mode-sel');
        const dragCoeffEl = document.getElementById('kin-drag-coeff');
        if (dragToggle) {
            if (!dragToggle.checked) {
                config.dragMode = 'none';
            } else if (dragModeSel) {
                config.dragMode = dragModeSel.value;
            }
        }
        if (dragCoeffEl) config.dragCoefficient = parseFloat(dragCoeffEl.value);

        // Bounce
        const bounceEl = document.getElementById('kin-bounce-enabled');
        const restEl = document.getElementById('kin-restitution');
        if (bounceEl) config.bounceEnabled = bounceEl.checked;
        if (restEl) config.restitution = parseFloat(restEl.value);

        this.activeObject.setParams(config);
    }

    /**
     * Update the live stats display.
     * @private
     */
    _updateStats() {
        if (!this.activeObject) return;
        const s = this.activeObject.stats;
        const mode = this.activeObject.motionType;

        let html = '';
        html += this._stat('Speed', `${s.speed.toFixed(2)} m/s`);
        html += this._stat('Displacement', `${s.displacement.toFixed(2)} m`);

        if (mode === 'accelerated') {
            html += this._stat('Acceleration', `${s.accelerationMag.toFixed(2)} m/s²`);
        }
        if (mode === 'circular') {
            html += this._stat('Centripetal Accel', `${s.centripetalAccel.toFixed(2)} m/s²`);
        }
        if (mode === 'freefall') {
            html += this._stat('Time to Impact', `${s.timeToImpact.toFixed(2)} s`);
            html += this._stat('Impact Velocity', `${s.impactVelocity.toFixed(2)} m/s`);
        }
        if (mode === 'projectile') {
            html += this._stat('Time of Flight', `${s.timeToImpact.toFixed(2)} s`);
            html += this._stat('Max Height', `${(s.maxHeight || 0).toFixed(2)} m`);
            html += this._stat('Range', `${(s.range || 0).toFixed(2)} m`);
            html += this._stat('Impact Velocity', `${s.impactVelocity.toFixed(2)} m/s`);
        }
        if (mode === 'relative') {
            const totalVel = this.activeObject.velocity.clone().add(this.activeObject.frameVelocity);
            html += this._stat('Total Velocity', `${totalVel.length().toFixed(2)} m/s`);
        }

        html += this._stat('Elapsed Time', `${this.activeObject.elapsedTime.toFixed(2)} s`);
        html += this._stat('Status', this.activeObject.status.toUpperCase());

        this.statsContainer.innerHTML = html;
    }

    /**
     * Helper: generate a single stat row.
     * @private
     */
    _stat(label, value) {
        return `<div class="kin-stat"><span>${label}</span><span>${value}</span></div>`;
    }

    /**
     * Launch the active object.
     * @private
     */
    _onLaunch() {
        if (!this.activeObject) return;
        this._pushParams();
        this.activeObject.launch();
        this.close();
    }
}
