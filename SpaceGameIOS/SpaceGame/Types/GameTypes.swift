// GameTypes.swift
// Port of types.ts — all enums and value types used across the game.
//
// Swift notes for TypeScript readers:
//   • enum cases use lowerCamelCase (Swift convention)
//   • struct = value type (copied on assignment), class = reference type
//   • CGFloat is the SpriteKit floating-point type (same as Double on 64-bit)
//   • CGPoint / CGVector are the SpriteKit equivalents of Vector2

import SpriteKit

// ─── Game state ──────────────────────────────────────────────────────────────

enum GameState {
    case menu
    case playing
    case paused
    case gameOver
}

// ─── Entity classification ───────────────────────────────────────────────────

enum EntityType {
    case player
    case enemy
    case playerProjectile
    case enemyProjectile
    case asteroid
    case particle
    case powerUp        // Phase 2
}

// ─── Enemy subtypes — port of EnemySubtype enum ──────────────────────────────
//
//  Basic      — straight chase, medium speed
//  FastCharger — aggressive rush, high speed, low health
//  Tank       — slow, 3× health, high damage
//  Skirmisher — maintains preferred distance, strafes
//  Orbiter    — circles the player
//  Sniper     — holds distance, fires precise shots

enum EnemySubtype: CaseIterable {
    case basic
    case fastCharger
    case tank
    case skirmisher
    case orbiter
    case sniper

    var displayName: String {
        switch self {
        case .basic:       return "Scout"
        case .fastCharger: return "Charger"
        case .tank:        return "Dreadnought"
        case .skirmisher:  return "Skirmisher"
        case .orbiter:     return "Orbiter"
        case .sniper:      return "Sniper"
        }
    }

    var baseHealth: CGFloat {
        switch self {
        case .tank:  return 3
        default:     return 1
        }
    }

    var baseSpeed: CGFloat {
        switch self {
        case .fastCharger: return 280
        case .tank:        return 120
        case .skirmisher:  return 240
        case .orbiter:     return 180
        case .sniper:      return 160
        default:           return 200
        }
    }

    var color: UIColor {
        switch self {
        case .basic:       return .systemRed
        case .fastCharger: return .systemBlue
        case .tank:        return .systemGray
        case .skirmisher:  return .systemGreen
        case .orbiter:     return .systemPurple
        case .sniper:      return .systemYellow
        }
    }

    var visionRange: CGFloat { 900 }
    var preferredDistance: CGFloat {
        switch self {
        case .skirmisher: return 350
        case .sniper:     return 600
        case .orbiter:    return 250
        default:          return 0
        }
    }
}

// ─── Weapon types — port of WeaponType enum ──────────────────────────────────

enum WeaponType: CaseIterable {
    case blaster
    case shotgun
    case cannon
    case homing
    case burst
}

// ─── Weapon configuration — port of WeaponConfig interface ───────────────────

struct WeaponConfig {
    let type: WeaponType
    let name: String
    let cooldown: TimeInterval       // seconds between shots
    let speed: CGFloat               // points per second
    let damage: CGFloat
    let lifetime: TimeInterval       // seconds before projectile expires
    let color: UIColor
    let projectileSize: CGFloat      // radius
    let count: Int                   // projectiles per shot
    let spreadDegrees: CGFloat       // cone half-angle
    let recoilMultiplier: CGFloat    // impulse applied backward to player
    let isHoming: Bool
    let burstCount: Int              // shots per burst
    let burstDelay: TimeInterval     // seconds between burst shots
}

// ─── Physics collision bitmasks ──────────────────────────────────────────────
//
// SpriteKit uses UInt32 bitmasks for collision filtering.
// contactTestBitMask = which categories trigger didBegin(_:)
// collisionBitMask   = which categories cause physical push-back
// categoryBitMask    = what this body IS

struct PhysicsCategory {
    static let none:           UInt32 = 0b00000000
    static let player:         UInt32 = 0b00000001
    static let enemy:          UInt32 = 0b00000010
    static let playerBullet:   UInt32 = 0b00000100
    static let enemyBullet:    UInt32 = 0b00001000
    static let asteroid:       UInt32 = 0b00010000
    static let powerUp:        UInt32 = 0b00100000  // Phase 2
}

// ─── Power-up types (Phase 2 stubs) ──────────────────────────────────────────

enum PowerUpType: CaseIterable {
    case shield          // absorb one hit
    case speedBoost      // +50% max speed
    case damageMultiplier// ×2 weapon damage
    case rapidFire       // ÷2 weapon cooldown
    case tripleShot      // +2 extra projectiles

    var displayName: String {
        switch self {
        case .shield:            return "SHIELD"
        case .speedBoost:        return "SPEED +"
        case .damageMultiplier:  return "DMG ×2"
        case .rapidFire:         return "RAPID FIRE"
        case .tripleShot:        return "TRIPLE SHOT"
        }
    }

    var color: UIColor {
        switch self {
        case .shield:            return .systemCyan
        case .speedBoost:        return .systemGreen
        case .damageMultiplier:  return .systemOrange
        case .rapidFire:         return .systemYellow
        case .tripleShot:        return .systemPurple
        }
    }
}

// ─── Active power-up state (Phase 2) ─────────────────────────────────────────

struct ActivePowerUp {
    let type: PowerUpType
    // Power-ups last until death, not timed — so no duration field needed here.
    // Phase 4+ could add a duration if desired.
}
