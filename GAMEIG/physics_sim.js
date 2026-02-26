/**
 * PhysicsSimulation — orchestrates all active projectiles.
 *
 * Responsibilities:
 *   - Maintain a registry of active Projectile instances
 *   - Apply timeScale to delta time before passing to each projectile
 *   - Remove projectiles after they signal 'remove' (landed + timeout)
 *
 * This class does NOT contain physics math — that lives in Projectile.
 * It only manages lifecycle and timing.
 */
export class PhysicsSimulation {
    constructor() {
        /** @type {import('./projectile.js').Projectile[]} */
        this.projectiles = [];

        /**
         * Time scale multiplier for all projectile simulation.
         *   1.0 = real-time
         *   0.1 = slow motion (10× slower)
         *   2.0 = fast-forward (2× faster)
         *   0.0 = frozen
         */
        this.timeScale = 1.0;
    }

    /**
     * Register a new projectile for simulation updates.
     * @param {import('./projectile.js').Projectile} projectile
     */
    addProjectile(projectile) {
        this.projectiles.push(projectile);
    }

    /**
     * Remove a specific projectile and dispose its resources.
     * @param {import('./projectile.js').Projectile} projectile
     */
    removeProjectile(projectile) {
        const idx = this.projectiles.indexOf(projectile);
        if (idx > -1) {
            this.projectiles.splice(idx, 1);
        }
        projectile.dispose();
    }

    /**
     * Remove all projectiles and clean up.
     */
    removeAll() {
        for (const p of this.projectiles) {
            p.dispose();
        }
        this.projectiles.length = 0;
    }

    /**
     * Called every frame from the render loop.
     *
     * Applies timeScale to deltaTime so all projectiles can be
     * slowed down, sped up, or frozen uniformly.
     *
     *   scaledDt = deltaTime * timeScale
     *
     * Each projectile.update() returns a status:
     *   'active'  → still flying
     *   'landed'  → on ground, waiting for removal timer
     *   'remove'  → landed timer expired, safe to dispose
     *
     * @param {number} deltaTime — raw frame delta (seconds)
     */
    update(deltaTime) {
        const scaledDt = deltaTime * this.timeScale;

        // Iterate in reverse so splice during iteration is safe
        for (let i = this.projectiles.length - 1; i >= 0; i--) {
            const projectile = this.projectiles[i];
            const status = projectile.update(scaledDt);

            if (status === 'remove') {
                this.projectiles.splice(i, 1);
                projectile.dispose();
            }
        }
    }

    /**
     * Get the count of currently active (non-removed) projectiles.
     * @returns {number}
     */
    get count() {
        return this.projectiles.length;
    }
}
