// Constants.swift
// Port of constants.ts — all tuning values in one place.
// Change numbers here, not scattered throughout the code.

import SpriteKit

// ─── Player ───────────────────────────────────────────────────────────────────

struct PlayerConstants {
    /// Maximum speed in points/second. Maps to TS PLAYER_MOVEMENT_CONFIG.maxSpeed = 250.
    static let maxSpeed:        CGFloat       = 400
    /// Force applied per second when player is pressing a direction.
    static let thrustForce:     CGFloat       = 900
    /// SpriteKit linearDamping — 0 = no drag, 1 = instant stop.
    /// 0.5 gives a drifty-but-controllable space feel at 60 fps.
    static let linearDamping:   CGFloat       = 0.5
    static let angularDamping:  CGFloat       = 10    // no spin from physics
    static let mass:            CGFloat       = 1.0
    static let radius:          CGFloat       = 22    // collision circle
    static let spriteSize:      CGFloat       = 44
    static let maxHealth:       CGFloat       = 100
    /// Seconds of invincibility immediately after spawning / respawning.
    static let spawnGracePeriod: TimeInterval  = 1.5
}

// ─── Weapons — port of WEAPONS constant map ───────────────────────────────────

struct WeaponConstants {
    static let all: [WeaponType: WeaponConfig] = [
        .blaster: WeaponConfig(
            type: .blaster, name: "Blaster",
            cooldown: 0.12, speed: 700, damage: 2,
            lifetime: 2.0,
            color: .cyan, projectileSize: 5,
            count: 1, spreadDegrees: 2,
            recoilMultiplier: 0.5,
            isHoming: false, burstCount: 1, burstDelay: 0
        ),
        .shotgun: WeaponConfig(
            type: .shotgun, name: "Shotgun",
            cooldown: 0.55, speed: 500, damage: 1,
            lifetime: 0.7,
            color: .orange, projectileSize: 4,
            count: 6, spreadDegrees: 35,
            recoilMultiplier: 2.0,
            isHoming: false, burstCount: 1, burstDelay: 0
        ),
        .cannon: WeaponConfig(
            type: .cannon, name: "Cannon",
            cooldown: 0.55, speed: 550, damage: 5,
            lifetime: 2.5,
            color: UIColor(red: 0.2, green: 1, blue: 0.2, alpha: 1),
            projectileSize: 12,
            count: 1, spreadDegrees: 0,
            recoilMultiplier: 4.0,
            isHoming: false, burstCount: 1, burstDelay: 0
        ),
        .homing: WeaponConfig(
            type: .homing, name: "Homing",
            cooldown: 0.35, speed: 420, damage: 2,
            lifetime: 3.5,
            color: UIColor(red: 1, green: 0.3, blue: 1, alpha: 1),
            projectileSize: 7,
            count: 1, spreadDegrees: 8,
            recoilMultiplier: 0.8,
            isHoming: true, burstCount: 1, burstDelay: 0
        ),
        .burst: WeaponConfig(
            type: .burst, name: "Burst",
            cooldown: 0.45, speed: 620, damage: 1,
            lifetime: 1.6,
            color: .yellow, projectileSize: 4,
            count: 1, spreadDegrees: 1,
            recoilMultiplier: 0.6,
            isHoming: false, burstCount: 3, burstDelay: 0.07
        ),
    ]

    /// Ordered list for cycling — maps to TS WEAPON_LIST constant.
    static let cycleOrder: [WeaponType] = [.blaster, .shotgun, .cannon, .homing, .burst]
}

// ─── Enemies ──────────────────────────────────────────────────────────────────

struct EnemyConstants {
    static let radius:           CGFloat = 20
    static let spriteSize:       CGFloat = 40
    static let weaponCooldown:   TimeInterval = 1.4
    static let weaponDamage:     CGFloat = 5
    static let weaponSpeed:      CGFloat = 350
    static let weaponLifetime:   TimeInterval = 2.5
    static let weaponSpreadDeg:  CGFloat = 4
    /// Reaction delay in seconds before enemy actually aims at player (simulates reaction time).
    static let reactionDelayMin: TimeInterval = 0.3
    static let reactionDelayMax: TimeInterval = 0.8
}

// ─── Asteroids ────────────────────────────────────────────────────────────────

struct AsteroidConstants {
    static let targetCount:       Int     = 100
    static let spawnMinDist:      CGFloat = 600
    static let spawnMaxDist:      CGFloat = 2500
    static let despawnDistanceSq: CGFloat = 3500 * 3500
    static let spawnBatchPerFrame: Int    = 3

    static let minSize:  CGFloat = 18
    static let maxSize:  CGFloat = 90
    static let minSpeed: CGFloat = 15
    static let maxSpeed: CGFloat = 60
    /// Asteroids bigger than this split when destroyed.
    static let splitThreshold: CGFloat = 30
}

// ─── Camera ───────────────────────────────────────────────────────────────────

struct CameraConstants {
    /// How quickly the camera follows the player (0 = instant, 1 = never moves).
    /// lerp factor applied each frame.
    static let followLerpFactor: CGFloat = 0.12
    static let shakeDecayRate:   CGFloat = 8.0   // shake units lost per second
}

// ─── Background ───────────────────────────────────────────────────────────────

struct BackgroundConstants {
    static let starLayerCount:    Int = 6
    static let starsPerLayer:     Int = 120
    static let nebulaCount:       Int = 12
    static let shootingStarMinInterval: TimeInterval = 2.5
    static let shootingStarMaxInterval: TimeInterval = 7.0
}

// ─── Scoring (Phase 4) ────────────────────────────────────────────────────────

struct ScoreConstants {
    static let killBasic:       Int = 100
    static let killCharger:     Int = 150
    static let killTank:        Int = 300
    static let killSkirmisher:  Int = 200
    static let killOrbiter:     Int = 175
    static let killSniper:      Int = 250
    static let asteroidDestroy: Int = 10
    static let waveBonus:       Int = 500  // multiplied by wave number
}

// ─── Waves (Phase 4 stubs) ────────────────────────────────────────────────────

struct WaveConstants {
    static let baseEnemiesPerWave: Int = 5
    static let enemiesPerWaveScaling: Int = 3   // +3 enemies per wave
    static let betweenWaveDuration: TimeInterval = 4.0
}
