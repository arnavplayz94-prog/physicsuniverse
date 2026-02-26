/**
 * KinematicsGraph — lightweight canvas-based real-time graph system.
 *
 * Renders up to three graphs:
 *   - Position vs Time
 *   - Velocity vs Time
 *   - Acceleration vs Time
 *
 * Uses a ring buffer for data storage (capped at MAX_SAMPLES).
 * Non-blocking: skips frames if performance is tight.
 *
 * Does NOT block the main loop.
 */
export class KinematicsGraph {
    /**
     * @param {HTMLElement} container — parent element for the canvas(es)
     */
    constructor(container) {
        this.container = container;

        /** @type {import('./motion_object.js').MotionObject|null} */
        this.activeObject = null;

        // Toggle visibility
        this.showPosition = true;
        this.showVelocity = true;
        this.showAcceleration = false;

        // Ring buffer data
        this.MAX_SAMPLES = 300;
        this.timeData = [];
        this.posData = [];
        this.velData = [];
        this.accData = [];

        // Canvas setup
        this.canvasWidth = 220;
        this.canvasHeight = 100;

        // Create canvases
        this.posCanvas = this._createCanvas('graph-pos', 'Position (m)');
        this.velCanvas = this._createCanvas('graph-vel', 'Velocity (m/s)');
        this.accCanvas = this._createCanvas('graph-acc', 'Acceleration (m/s²)');

        // Render throttle
        this._lastRender = 0;
        this._renderInterval = 50; // ms between renders (~20fps for graphs)
    }

    /**
     * Create a labelled canvas element.
     * @private
     */
    _createCanvas(id, label) {
        const wrapper = document.createElement('div');
        wrapper.className = 'kin-graph-wrapper';
        wrapper.id = id + '-wrapper';

        const labelEl = document.createElement('div');
        labelEl.className = 'kin-graph-label';
        labelEl.textContent = label;
        wrapper.appendChild(labelEl);

        const canvas = document.createElement('canvas');
        canvas.id = id;
        canvas.width = this.canvasWidth;
        canvas.height = this.canvasHeight;
        canvas.className = 'kin-graph-canvas';
        wrapper.appendChild(canvas);

        this.container.appendChild(wrapper);
        return canvas;
    }

    /**
     * Set or clear the active object to graph.
     * @param {import('./motion_object.js').MotionObject|null} obj
     */
    setActiveObject(obj) {
        this.activeObject = obj;
        this.clearData();
    }

    /**
     * Clear all data buffers.
     */
    clearData() {
        this.timeData = [];
        this.posData = [];
        this.velData = [];
        this.accData = [];
    }

    /**
     * Push a sample from the active object. Called each frame.
     */
    pushSample() {
        if (!this.activeObject || !this.activeObject.isLaunched) return;

        const obj = this.activeObject;
        const t = obj.elapsedTime;
        const posY = obj.position.y;
        const velMag = obj.velocity.length();
        const accMag = obj.acceleration.length();

        // For freefall/accelerated, compute instantaneous acceleration properly
        let acc = accMag;
        if (obj.motionType === 'freefall') acc = obj.gravity;
        if (obj.motionType === 'circular') acc = obj.stats.centripetalAccel;

        this.timeData.push(t);
        this.posData.push(posY);
        this.velData.push(velMag);
        this.accData.push(acc);

        // Ring buffer cap
        if (this.timeData.length > this.MAX_SAMPLES) {
            this.timeData.shift();
            this.posData.shift();
            this.velData.shift();
            this.accData.shift();
        }
    }

    /**
     * Render all visible graphs. Call from render loop.
     * Throttled to ~20fps to avoid performance impact.
     */
    render() {
        const now = performance.now();
        if (now - this._lastRender < this._renderInterval) return;
        this._lastRender = now;

        // Update visibility
        this.posCanvas.parentElement.style.display = this.showPosition ? 'block' : 'none';
        this.velCanvas.parentElement.style.display = this.showVelocity ? 'block' : 'none';
        this.accCanvas.parentElement.style.display = this.showAcceleration ? 'block' : 'none';

        // Show/hide container
        if (!this.showPosition && !this.showVelocity && !this.showAcceleration) {
            this.container.style.display = 'none';
            return;
        }
        this.container.style.display = 'flex';

        if (this.timeData.length < 2) return;

        if (this.showPosition) this._drawGraph(this.posCanvas, this.timeData, this.posData, '#00ffff');
        if (this.showVelocity) this._drawGraph(this.velCanvas, this.timeData, this.velData, '#ff8800');
        if (this.showAcceleration) this._drawGraph(this.accCanvas, this.timeData, this.accData, '#ff3366');
    }

    /**
     * Draw a single graph on a canvas.
     * @private
     * @param {HTMLCanvasElement} canvas
     * @param {number[]} xData — time values
     * @param {number[]} yData — value data
     * @param {string} color — line color
     */
    _drawGraph(canvas, xData, yData, color) {
        const ctx = canvas.getContext('2d');
        const w = canvas.width;
        const h = canvas.height;
        const padding = 5;
        const plotW = w - padding * 2;
        const plotH = h - padding * 2;

        // Clear
        ctx.clearRect(0, 0, w, h);

        // Background
        ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
        ctx.fillRect(0, 0, w, h);

        // Grid lines
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
        ctx.lineWidth = 0.5;
        for (let i = 0; i <= 4; i++) {
            const gy = padding + (plotH / 4) * i;
            ctx.beginPath();
            ctx.moveTo(padding, gy);
            ctx.lineTo(w - padding, gy);
            ctx.stroke();
        }

        if (yData.length < 2) return;

        // Find data range
        let yMin = Infinity, yMax = -Infinity;
        for (const v of yData) {
            if (v < yMin) yMin = v;
            if (v > yMax) yMax = v;
        }
        // Prevent flat line
        if (yMax - yMin < 0.01) {
            yMin -= 1;
            yMax += 1;
        }
        const xMin = xData[0];
        const xMax = xData[xData.length - 1];
        const xRange = Math.max(xMax - xMin, 0.01);

        // Draw line
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5;
        ctx.shadowColor = color;
        ctx.shadowBlur = 4;
        ctx.beginPath();

        for (let i = 0; i < xData.length; i++) {
            const px = padding + ((xData[i] - xMin) / xRange) * plotW;
            const py = padding + plotH - ((yData[i] - yMin) / (yMax - yMin)) * plotH;

            if (i === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
        }
        ctx.stroke();
        ctx.shadowBlur = 0;

        // Current value label
        const lastVal = yData[yData.length - 1];
        ctx.fillStyle = color;
        ctx.font = '10px monospace';
        ctx.textAlign = 'right';
        ctx.fillText(lastVal.toFixed(1), w - padding, padding + 10);

        // Axis labels (min/max)
        ctx.fillStyle = 'rgba(255,255,255,0.3)';
        ctx.font = '8px monospace';
        ctx.textAlign = 'left';
        ctx.fillText(yMax.toFixed(1), padding, padding + 8);
        ctx.fillText(yMin.toFixed(1), padding, h - padding);
    }
}
