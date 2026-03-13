// AISystem.swift
// Drives all EnemyNode AI per frame.
// Phase 1: this system exists but GameScene.enemySpawnEnabled = false,
//          so update() is never called.
// Phase 3: set enemySpawnEnabled = true and tune spawning here.

import SpriteKit

final class AISystem {

    private unowned let scene: SKScene

    init(scene: SKScene) {
        self.scene = scene
    }

    // ── Per-frame update ──────────────────────────────────────────────────────

    /// Call once per frame for every active enemy.
    /// Any returned ProjectileNode must be added to the scene by the caller.
    func update(enemies: [EnemyNode],
                playerPosition: CGPoint,
                dt: TimeInterval) -> [ProjectileNode] {
        var newBullets: [ProjectileNode] = []
        for enemy in enemies {
            if let bullet = enemy.update(dt: dt, playerPosition: playerPosition) {
                newBullets.append(bullet)
            }
        }
        return newBullets
    }

    // ── Spawn helpers (Phase 3) ────────────────────────────────────────────────

    /// Spawns `count` enemies of the given subtype in a ring around the player.
    /// Call from WaveSystem when starting a new wave.
    func spawnWave(subtype: EnemySubtype,
                   count: Int,
                   around playerPosition: CGPoint,
                   minDist: CGFloat = 700,
                   maxDist: CGFloat = 1200) -> [EnemyNode] {
        (0..<count).map { _ in
            let angle = CGFloat.random(in: 0...(2 * .pi))
            let dist  = CGFloat.random(in: minDist...maxDist)
            let pos   = CGPoint(x: playerPosition.x + cos(angle) * dist,
                                y: playerPosition.y + sin(angle) * dist)
            return EnemyNode.spawn(subtype: subtype, at: pos)
        }
    }

    /// Mixed wave — escalates with wave number, introducing harder subtypes.
    func spawnMixedWave(wave: Int,
                        around playerPosition: CGPoint) -> [EnemyNode] {
        let base  = WaveConstants.baseEnemiesPerWave
        let count = base + (wave - 1) * WaveConstants.enemiesPerWaveScaling

        // Distribution shifts over time: early waves are mostly basic,
        // later waves mix in all 6 types.
        var pool: [EnemySubtype] = Array(repeating: .basic, count: max(1, 5 - wave))
        if wave >= 2 { pool += Array(repeating: .fastCharger, count: 2) }
        if wave >= 3 { pool += [.skirmisher] }
        if wave >= 4 { pool += [.tank] }
        if wave >= 5 { pool += [.orbiter] }
        if wave >= 6 { pool += [.sniper] }

        return (0..<count).compactMap { _ -> EnemyNode? in
            guard let subtype = pool.randomElement() else { return nil }
            let angle = CGFloat.random(in: 0...(2 * .pi))
            let dist  = CGFloat.random(in: 700...1400)
            let pos   = CGPoint(x: playerPosition.x + cos(angle) * dist,
                                y: playerPosition.y + sin(angle) * dist)
            return EnemyNode.spawn(subtype: subtype, at: pos)
        }
    }
}
