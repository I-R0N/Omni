// AppDelegate.swift
// Standard iOS app entry point — no game logic lives here.

import UIKit

@main
final class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
    ) -> Bool {
        // All setup is in GameViewController / GameScene.
        // Phase 5: initialise Game Center here.
        return true
    }
}
