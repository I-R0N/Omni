// GameViewController.swift
// The UIViewController that hosts the SpriteKit view.
// Almost all game code is in GameScene.swift; this file is deliberately minimal.

import UIKit
import SpriteKit

final class GameViewController: UIViewController {

    override func viewDidLoad() {
        super.viewDidLoad()

        guard let skView = view as? SKView else {
            fatalError("Root view is not SKView — check Main.storyboard scene class")
        }

        // Performance settings
        skView.ignoresSiblingOrder = true   // zPosition controls draw order
        skView.showsFPS            = false  // set true to see live FPS during dev
        skView.showsNodeCount      = false

        let scene = GameScene(size: view.bounds.size)
        scene.scaleMode = .resizeFill       // fill the screen, no letterboxing

        skView.presentScene(scene)
    }

    // ── Lock to the physical device orientation ────────────────────────────────
    // Space game works in both landscape and portrait; let the player choose.
    override var supportedInterfaceOrientations: UIInterfaceOrientationMask {
        UIDevice.current.userInterfaceIdiom == .phone ? .allButUpsideDown : .all
    }

    // ── Hide the status bar for a full-screen experience ─────────────────────
    override var prefersStatusBarHidden: Bool { true }

    // ── Keep screen awake during gameplay ─────────────────────────────────────
    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        UIApplication.shared.isIdleTimerDisabled = true
    }

    override func viewDidDisappear(_ animated: Bool) {
        super.viewDidDisappear(animated)
        UIApplication.shared.isIdleTimerDisabled = false
    }
}
