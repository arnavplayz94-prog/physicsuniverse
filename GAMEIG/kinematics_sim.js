/**
 * KinematicsSimulation — orchestrator for MotionObject instances.
 *
 * Responsibilities:
 *   - Maintain a registry of active MotionObject instances
 *   - Apply global timeScale to delta time before passing to each object
 *   - Remove objects after they signal 'remove'
 *   - Handle cleanup
 *
 * This class does NOT contain UI code — purely lifecycle + timing.
 * It does NOT interfere with the existing PhysicsSimulation or Projectile system.
 */
export class KinematicsSimulation {
    constructor() {
        /** @type {import('./motion_object.js').MotionObject[]} */
        this.motionObjects = [];

        /**
         * Time scale multiplier for all motion objects.
         *   1.0 = real-time
         *   0.1 = slow motion (10× slower)
         *   2.0 = fast-forward (2× faster)
         *   0.0 = frozen
         */
        this.timeScale = 1.0;
    }

    /**
     * Register a new MotionObject for simulation updates.
     * @param {import('./motion_object.js').MotionObject} obj
     */
    addObject(obj) {
        this.motionObjects.push(obj);
    }

    /**
     * Remove a specific MotionObject and dispose its resources.
     * @param {import('./motion_object.js').MotionObject} obj
     */
    removeObject(obj) {
        const idx = this.motionObjects.indexOf(obj);
        if (idx > -1) {
            this.motionObjects.splice(idx, 1);
        }
        obj.dispose();
    }

    /**
     * Remove all motion objects and clean up.
     */
    removeAll() {
        for (const obj of this.motionObjects) {
            obj.dispose();
        }
        this.motionObjects.length = 0;
    }

    /**
     * Called every frame from the render loop.
     *
     * Applies timeScale to deltaTime so all objects can be
     * slowed down, sped up, or frozen uniformly.
     *
     *   scaledDt = deltaTime * timeScale
     *
     * Each object.update() returns a status:
     *   'idle'    → not launched yet
     *   'active'  → still moving
     *   'stopped' → hit ground / stopped
     *   'remove'  → flagged for removal
     *
     * @param {number} deltaTime — raw frame delta (seconds)
     */
    update(deltaTime) {
        const scaledDt = deltaTime * this.timeScale;

        // Iterate in reverse so splice during iteration is safe
        for (let i = this.motionObjects.length - 1; i >= 0; i--) {
            const obj = this.motionObjects[i];
            const status = obj.update(scaledDt);

            if (status === 'remove') {
                this.motionObjects.splice(i, 1);
                obj.dispose();
            }
        }
    }

    /**
     * Get the count of currently active (non-removed) objects.
     * @returns {number}
     */
    get count() {
        return this.motionObjects.length;
    }
}
