import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';

export class PlayerController {
    constructor(scene, world, camera, domElement) {
        this.scene = scene;
        this.world = world;
        this.camera = camera;
        this.domElement = domElement;

        // Configuration
        this.walkSpeed = 30;
        this.flySpeed = 60;
        this.jumpForce = 8;
        this.height = 1.8;
        this.isFlying = true; // Start in creative flight
        this.isThirdPerson = false;

        // Physics Body — used for walking mode collisions
        const shape = new CANNON.Sphere(0.5);
        this.body = new CANNON.Body({
            mass: 1,
            position: new CANNON.Vec3(0, 10, 0),
            shape: shape,
            linearDamping: 0.9,
            fixedRotation: true // Prevent body from tumbling
        });
        this.body.allowSleep = false;
        this.world.addBody(this.body);

        // Flying mode: make body KINEMATIC so the physics solver
        // cannot interfere with our position at all.
        // Kinematic bodies:
        //   - Are NOT affected by forces, gravity, or collisions
        //   - Can be positioned manually each frame
        //   - Still push dynamic objects out of the way
        //   - Do NOT get pushed back by dynamic objects
        this.body.type = CANNON.Body.KINEMATIC;

        // Camera Y tracking — used in walking mode to smooth ground-contact bounces
        this._cameraY = 10 + 1.6;

        // Velocity tracking for flying mode (bypasses physics engine entirely)
        this._flyVelX = 0;
        this._flyVelY = 0;
        this._flyVelZ = 0;

        // Visual Mesh (Avatar)
        this.mesh = new THREE.Group();

        // Body (Capsule-ish)
        const bodyGeo = new THREE.CapsuleGeometry(0.4, 0.8, 4, 8);
        const bodyMat = new THREE.MeshStandardMaterial({ color: 0x00ffcc, roughness: 0.2 });
        this.avatarBody = new THREE.Mesh(bodyGeo, bodyMat);
        this.avatarBody.position.y = 0.9;
        this.mesh.add(this.avatarBody);

        // Head (Visor)
        const headGeo = new THREE.BoxGeometry(0.4, 0.3, 0.4);
        const headMat = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0x00ffcc, emissiveIntensity: 0.5 });
        this.avatarHead = new THREE.Mesh(headGeo, headMat);
        this.avatarHead.position.y = 1.6;
        this.avatarHead.position.z = -0.2;
        this.mesh.add(this.avatarHead);

        this.mesh.visible = false; // Hide in 1st person
        this.scene.add(this.mesh);

        // Controls
        this.controls = new PointerLockControls(camera, document.body);
        this.input = {
            forward: false,
            backward: false,
            left: false,
            right: false,
            up: false, // Space
            down: false, // Shift
        };

        this.setupInputs();

        // Pre-allocate reusable vectors (avoids new THREE.Vector3 every frame → less GC)
        this._inputVec = new THREE.Vector3();
        this._camDir = new THREE.Vector3();
        this._camRight = new THREE.Vector3();
        this._moveDir = new THREE.Vector3();
        this._upVec = new THREE.Vector3(0, 1, 0);
        this._targetPos = new THREE.Vector3();
        this._offset = new THREE.Vector3();
    }

    setupInputs() {
        // Simple Lock Logic: Click anywhere to start (EXCEPT UI)
        document.addEventListener('click', (e) => {
            // Check if clicking on UI (Selector, Buttons, Kinematics Panel)
            if (e.target.closest('.env-selector') || e.target.closest('button') || e.target.tagName === 'SELECT' || e.target.closest('#kinematics-panel')) {
                return;
            }

            if (!this.controls.isLocked) {
                try {
                    this.controls.lock();
                } catch (error) {
                    console.error("Pointer Lock Error:", error);
                }
            }
        });

        // Key Listeners
        document.addEventListener('keydown', (e) => this.onKey(e, true));
        document.addEventListener('keyup', (e) => this.onKey(e, false));
    }

    onKey(event, isDown) {
        switch (event.code) {
            case 'KeyW': this.input.forward = isDown; break;
            case 'KeyS': this.input.backward = isDown; break;
            case 'KeyA': this.input.left = isDown; break;
            case 'KeyD': this.input.right = isDown; break;
            case 'Space':
                if (isDown && !this.input.up) { // Just pressed
                    if (this.isFlying) {
                        this.input.up = true;
                    } else {
                        this.jump();
                    }
                } else if (!isDown) {
                    this.input.up = false;
                }
                break;
            case 'ShiftLeft': this.input.down = isDown; break;
            case 'KeyF':
                if (isDown) this.toggleFlight();
                break;
            case 'KeyC':
                if (isDown) this.toggleCamera();
                break;
        }
    }

    jump() {
        this.body.velocity.y = this.jumpForce;
    }

    toggleFlight() {
        this.isFlying = !this.isFlying;
        if (this.isFlying) {
            // Switch to KINEMATIC — physics solver cannot touch us
            this.body.type = CANNON.Body.KINEMATIC;
            this.body.velocity.set(0, 0, 0);
            this._flyVelX = 0;
            this._flyVelY = 0;
            this._flyVelZ = 0;
        } else {
            // Switch to DYNAMIC — gravity and collisions work normally
            this.body.type = CANNON.Body.DYNAMIC;
            this.body.mass = 1;
            this.body.updateMassProperties();
            this.body.linearDamping = 0.9;
            this._cameraY = this.body.position.y + 1.6;
        }
        console.log("Flight Mode:", this.isFlying);
    }

    toggleCamera() {
        this.isThirdPerson = !this.isThirdPerson;
        this.mesh.visible = this.isThirdPerson; // Show avatar in 3rd person
    }

    update(dt) {
        if (!this.controls.isLocked) return;

        // Compute movement direction from camera orientation
        this._inputVec.set(0, 0, 0);
        if (this.input.forward) this._inputVec.z -= 1;
        if (this.input.backward) this._inputVec.z += 1;
        if (this.input.left) this._inputVec.x -= 1;
        if (this.input.right) this._inputVec.x += 1;

        const hasInput = this._inputVec.lengthSq() > 0;

        // Camera-relative direction
        this.camera.getWorldDirection(this._camDir);
        this._camDir.y = 0;
        this._camDir.normalize();

        this._camRight.crossVectors(this._camDir, this._upVec);

        this._moveDir.set(0, 0, 0);
        this._moveDir.addScaledVector(this._camDir, -this._inputVec.z);
        this._moveDir.addScaledVector(this._camRight, this._inputVec.x);
        this._moveDir.normalize();

        if (this.isFlying) {
            // ===== FLYING MODE =====
            // Body is KINEMATIC — we move position directly.
            // The physics solver has ZERO influence on our position.
            // This is exactly how Minecraft creative flight works.

            const speed = this.flySpeed;
            const decel = 0.85; // Deceleration factor per frame (at 60fps)

            if (hasInput) {
                this._flyVelX = this._moveDir.x * speed;
                this._flyVelZ = this._moveDir.z * speed;
            } else {
                this._flyVelX *= decel;
                this._flyVelZ *= decel;
                // Kill tiny residuals
                if (Math.abs(this._flyVelX) < 0.01) this._flyVelX = 0;
                if (Math.abs(this._flyVelZ) < 0.01) this._flyVelZ = 0;
            }

            // Vertical
            if (this.input.up) {
                this._flyVelY = speed * 0.5;
            } else if (this.input.down) {
                this._flyVelY = -speed * 0.5;
            } else {
                this._flyVelY = 0; // Instant stop — no drift at all
            }

            // Move body position directly (bypassing physics engine)
            this.body.position.x += this._flyVelX * dt;
            this.body.position.y += this._flyVelY * dt;
            this.body.position.z += this._flyVelZ * dt;

        } else {
            // ===== WALKING MODE =====
            // Body is DYNAMIC — physics engine handles gravity + ground collision.
            const speed = this.walkSpeed;

            if (hasInput) {
                this.body.wakeUp();
                this.body.velocity.x = this._moveDir.x * speed;
                this.body.velocity.z = this._moveDir.z * speed;
            }
        }

        // Sync Avatar Visuals
        this.mesh.position.copy(this.body.position);

        // Update Camera Position
        const bx = this.body.position.x;
        const by = this.body.position.y;
        const bz = this.body.position.z;

        if (this.isThirdPerson) {
            const k = 0.5;
            const mix = 1.0 - Math.pow(1.0 - k, dt * 60);
            this._offset.set(0, 2, 4);
            this._offset.applyQuaternion(this.camera.quaternion);
            this._targetPos.set(bx + this._offset.x, by + this._offset.y, bz + this._offset.z);
            this.camera.position.lerp(this._targetPos, mix);
        } else {
            // First-person: Minecraft-style rigid lock
            if (this.isFlying) {
                // Flying: position is 100% player-controlled, use directly
                this.camera.position.set(bx, by + 1.6, bz);
            } else {
                // Walking: smooth Y to absorb ground-contact solver micro-bounces
                const targetY = by + 1.6;
                this._cameraY += (targetY - this._cameraY) * 0.3;
                this.camera.position.set(bx, this._cameraY, bz);
            }
        }
    }
}
