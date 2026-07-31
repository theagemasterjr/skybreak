import * as THREE from 'three';

// ---------------------------------------------------------------------------
// TrainingDummy: a stationary practice target implementing the ENEMY
// interface (lives in game.enemies so every real attack/ability hits it
// unmodified). Never dies — it flashes, pops damage numbers, and regens.
// ---------------------------------------------------------------------------

const _v1 = new THREE.Vector3();

export class TrainingDummy {
  constructor(game, position, label, { maxHp = 100 } = {}) {
    this.game = game;
    this.type = 'dummy';
    this.position = position.clone();
    this.vel = new THREE.Vector3();
    this.radius = 0.55;
    this.height = 1.9;
    this.alive = true;          // dummies never "die" — they just take a hit and recover
    this.readyToRemove = false;
    this.shieldedBy = null;
    this.elite = false;
    this.flying = false;
    this.maxHp = maxHp;
    this.hp = this.maxHp;
    this.flashT = 0;
    this.regenDelay = 0;
    this.label = label;
    this.home = this.position.clone();   // drift back here after being launched

    const group = new THREE.Group();
    const wood = new THREE.MeshStandardMaterial({ color: 0x7a5636, roughness: 0.9, flatShading: true });
    const sack = new THREE.MeshStandardMaterial({ color: 0xcaa76a, roughness: 0.95, flatShading: true });
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.16, 1.9, 7), wood);
    post.position.y = 0.95;
    group.add(post);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.32, 8, 6), sack);
    head.position.y = 1.85;
    group.add(head);
    const mkArm = (side) => {
      const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.85, 6), wood);
      arm.rotation.z = side * 1.15;
      arm.position.set(side * 0.42, 1.35, 0);
      group.add(arm);
    };
    mkArm(-1); mkArm(1);
    this.targetMat = new THREE.MeshStandardMaterial({
      color: 0xdd3a3a, emissive: 0x220000, roughness: 0.6, flatShading: true, side: THREE.DoubleSide,
    });
    const bullseye = new THREE.Mesh(new THREE.CircleGeometry(0.34, 12), this.targetMat);
    bullseye.position.set(0, 1.15, 0.17);
    group.add(bullseye);
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.36, 0.46, 12),
      new THREE.MeshStandardMaterial({ color: 0xf2ece0, roughness: 0.7, flatShading: true, side: THREE.DoubleSide })
    );
    ring.position.set(0, 1.15, 0.16);
    group.add(ring);
    this.model = group;
    this.model.position.copy(this.position);
    game.scene.add(this.model);
    this.baseEmissive = this.targetMat.emissive.clone();

    // hp bar (matches Enemy's two-sprite pattern)
    const barGroup = new THREE.Group();
    const bgMat = new THREE.SpriteMaterial({ color: 0x111318, depthWrite: false, transparent: true, opacity: 0.85 });
    const fgMat = new THREE.SpriteMaterial({ color: 0x66ccff, depthWrite: false, transparent: true, opacity: 0.95 });
    this.barBg = new THREE.Sprite(bgMat);
    this.barFg = new THREE.Sprite(fgMat);
    this.barW = 1.3;
    this.barBg.scale.set(this.barW, 0.13, 1);
    this.barFg.scale.set(this.barW * 0.97, 0.1, 1);
    barGroup.add(this.barBg);
    barGroup.add(this.barFg);
    game.scene.add(barGroup);
    this.barGroup = barGroup;

    // floating name label
    const canvas = document.createElement('canvas');
    canvas.width = 256; canvas.height = 48;
    const cx = canvas.getContext('2d');
    cx.font = '700 30px Segoe UI, sans-serif';
    cx.fillStyle = '#f6eee0';
    cx.textAlign = 'center';
    cx.fillText(label, 128, 34);
    const tex = new THREE.CanvasTexture(canvas);
    const nameSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false, transparent: true }));
    nameSprite.scale.set(1.8, 0.34, 1);
    game.scene.add(nameSprite);
    this.nameSprite = nameSprite;
  }

  center(target) {
    return target.copy(this.position).setY(this.position.y + this.height * 0.5);
  }

  takeDamage(dmg, opts = {}) {
    this.hp = Math.max(0, this.hp - dmg);
    this.flashT = 0.15;
    this.regenDelay = 1.2;   // pause regen briefly after every hit so combos read
    const g = this.game;
    const c = this.center(_v1).clone();
    if (g.hud) {
      g.hud.spawnDamageNumber(c, dmg, { big: dmg >= 40 });
      g.hud.hitMarker(false);
    }
    if (dmg >= 25) {
      g.effects.impactBurst(c, { size: 2 + Math.min(2.5, dmg * 0.03) });
      g.hitstop(0.04);
    }
    if (this.hp <= 0) {
      g.effects.burst(c, { count: 20, color: 0xffffff, color2: 0x888899, speed: 7, size: 0.28, life: 0.4 });
      this.hp = 0;
    }
    g.emitTut?.('dummyHit', { dummy: this, dmg, opts });
  }

  update(dt) {
    if (this.flashT > 0) {
      this.flashT -= dt;
      this.targetMat.emissive.setHex(0xff4444);
    } else {
      this.targetMat.emissive.lerp(this.baseEmissive, Math.min(1, dt * 6));
    }
    // slow auto-regen so the dummy is always ready to practice on again
    if (this.regenDelay > 0) this.regenDelay -= dt;
    else if (this.hp < this.maxHp) this.hp = Math.min(this.maxHp, this.hp + this.maxHp * 0.35 * dt);

    // some abilities launch or drag targets around — glide back home once
    // the action stops so the range is always set up for the next combo
    if (this.regenDelay <= 0 && this.position.distanceToSquared(this.home) > 0.01) {
      this.position.lerp(this.home, Math.min(1, dt * 2.5));
      this.vel.set(0, 0, 0);
    }
    this.model.position.copy(this.position);

    const top = this.position.clone(); top.y += this.height + 0.55;
    this.barGroup.position.copy(top);
    const frac = this.hp / this.maxHp;
    this.barFg.scale.x = this.barW * 0.97 * Math.max(0.001, frac);
    this.barFg.position.x = -this.barW * 0.5 * (1 - frac);
    this.nameSprite.position.copy(top).add(_v1.set(0, 0.32, 0));
  }

  dispose() {
    this.game.scene.remove(this.model, this.barGroup, this.nameSprite);
    this.model.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
    this.barBg.material.dispose();
    this.barFg.material.dispose();
    this.nameSprite.material.map.dispose();
    this.nameSprite.material.dispose();
  }
}
