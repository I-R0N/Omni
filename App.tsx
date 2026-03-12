
/**
 * App.tsx — Space Survival Game (feature branch: claude/iphone-space-game-engine)
 *
 * This branch replaces the original OmniVerse multi-layer explorer with a
 * focused iPhone space survival game engine.  The original GameEngine.ts and
 * map classes are UNTOUCHED in this repo for reference; the space game uses
 * SpaceGameEngine + InfiniteSpaceMap instead.
 *
 * Git note:
 *   main branch → deployed to Netlify (original OmniVerse explorer)
 *   this branch  → space survival game (safe to develop without touching main)
 *
 * iPhone testing (during development):
 *   1. Run: npm run dev           (already configured to bind 0.0.0.0:3000)
 *   2. Find your machine's local IP:  ip addr | grep "inet "
 *   3. On iPhone (same WiFi): open Safari → http://<your-ip>:3000
 *   4. "Add to Home Screen" for a full-screen, no-browser-chrome experience
 *
 * Phase roadmap:
 *   Phase 1 ← HERE   Simple engine: player movement, infinite asteroid field
 *   Phase 2          Weapon upgrades + persistent power-ups
 *   Phase 3          Enemy types + AI-driven spawning
 *   Phase 4          Wave system, scoring, game-over screen
 *   Phase 5          Sound, haptics, Capacitor iOS build, polish
 */

import React, { useEffect, useRef, useState } from 'react';
import { SpaceGameEngine } from './engine/SpaceGameEngine';
import { EngineStats, MapType, GameState } from './types';
import SpaceUIOverlay from './components/SpaceUIOverlay';

const App: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<SpaceGameEngine | null>(null);

  const [stats, setStats] = useState<EngineStats>({
    fps: 0,
    entityCount: 0,
    currentMapName: 'Deep Space',
    currentMapType: MapType.SOLAR_SYSTEM,
    currentWeapon: 'Blaster',
    gameState: GameState.MENU,
    playerHealth: 100,
    playerMaxHealth: 100
  });

  useEffect(() => {
    if (!canvasRef.current) return;

    const engine = new SpaceGameEngine((newStats) => {
      setStats(newStats);
    });

    const handleResize = () => {
      if (!canvasRef.current) return;
      const canvas = canvasRef.current;
      const dpr = window.devicePixelRatio || 1;
      const width = window.innerWidth;
      const height = window.innerHeight;

      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);

      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.scale(dpr, dpr);
      }
    };

    const ctx = canvasRef.current.getContext('2d')!;
    engine.initCanvas(ctx);
    handleResize();
    engine.start();
    engineRef.current = engine;

    window.addEventListener('resize', handleResize);

    return () => {
      engine.stop();
      window.removeEventListener('resize', handleResize);
    };
  }, []);

  const handleCycleWeapon = () => engineRef.current?.cycleWeapon();
  const handleStart      = () => engineRef.current?.startGame();
  const handlePause      = () => engineRef.current?.pauseGame();
  const handleResume     = () => engineRef.current?.resumeGame();
  const handleRestart    = () => engineRef.current?.restartGame();

  return (
    <div className="relative w-full h-screen bg-black overflow-hidden select-none touch-none">
      <canvas
        ref={canvasRef}
        className="block w-full h-full"
        // Prevent iOS rubber-band scroll and double-tap zoom on the canvas
        style={{ touchAction: 'none' }}
      />
      <SpaceUIOverlay
        stats={stats}
        onCycleWeapon={handleCycleWeapon}
        onStart={handleStart}
        onPause={handlePause}
        onResume={handleResume}
        onRestart={handleRestart}
      />
    </div>
  );
};

export default App;
