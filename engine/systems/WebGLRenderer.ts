/**
 * Prototype WebGL renderer (Three.js).  Owns its own canvas (stacked
 * BEHIND the existing Canvas2D one in App.tsx) and renders the layers
 * that benefit most from instancing / shaders:
 *
 *   1. Solid background fill + procedural parallax starfield (one shader
 *      pass replacing the BackgroundManager star-band tiling — 32
 *      drawImage calls/frame today).
 *   2. Nebula background puffs as instanced billboards.
 *   3. Static structure tiles (glass / reinforced / heavy / indestructible
 *      / nebula) as one InstancedMesh per variant.  All tiles for the
 *      whole map upload once on map load; per-frame work is just an
 *      `aActive` byte per tile (gating gl_Position) plus a camera-uniform
 *      update.  The Canvas2D RenderSystem skips its own background pass
 *      and its static-tile fast-paths whenever this renderer is enabled.
 *
 * Everything else (entities, projectiles, particles, trails, HUD,
 * minimap, damage text, debug overlays) stays on Canvas2D, which now
 * runs against a transparent canvas layered ON TOP of this one.
 *
 * Toggle live via the DBG → WebGL button.
 */
import * as THREE from 'three';
import { GameEntity, EntityType, CameraState, MapType, Vector2 } from '../../types';
import { MAP_WIDTH, MAP_HEIGHT, HALF_MAP_WIDTH, HALF_MAP_HEIGHT } from '../toroidal';

// Background starfield is procedural (hash-based stars in fragment
// shader) — avoids a sampler-array uniform that's awkward across WebGL
// versions, and keeps the BG cost O(1) per pixel regardless of star
// count.  Three parallax layers approximate the BackgroundManager
// near/mid/far feel.

interface InstancedTileGroup {
    variant: string;
    mesh: THREE.InstancedMesh;
    activeAttr: THREE.InstancedBufferAttribute;
    entities: GameEntity[];   // index = instance id
    activeBytes: Float32Array; // length = capacity
    capacity: number;
}

export class WebGLRenderer {
    private renderer: THREE.WebGLRenderer | null = null;
    private scene: THREE.Scene = new THREE.Scene();
    private camera: THREE.OrthographicCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, -1, 1);
    private canvas: HTMLCanvasElement | null = null;
    private enabled: boolean = false;

    private widthCss: number = 0;
    private heightCss: number = 0;
    private dpr: number = 1;

    // Background pass: a fullscreen-quad mesh whose fragment shader
    // generates a procedural parallax starfield from the camera uniform.
    // No textures, no per-frame state — just shader math per pixel.
    private bgMesh: THREE.Mesh | null = null;
    private bgMaterial: THREE.ShaderMaterial | null = null;

    // Tile pass: one InstancedMesh per shardVariant.  Hex geometry
    // (matches HEX_SIZE = 22) shared across all groups; per-instance
    // matrix carries world position + tint, per-instance `aActive` byte
    // gates gl_Position so destroyed tiles vanish without a rebuild.
    private tileGroups: Map<string, InstancedTileGroup> = new Map();
    private tileMaterial: THREE.ShaderMaterial | null = null;
    private tileGeometry: THREE.BufferGeometry | null = null;

    // Per-frame perf — read by GameEngine.recordRenderPerf and surfaced
    // in the DBG overlay alongside the existing renderMs / nebulaMs.
    public lastWebGLMs: number = 0;
    public lastVisibleTileCount: number = 0;
    public lastTotalTileCount: number = 0;

    constructor() {
        // Background scene is rendered first via autoClear; then the tile
        // pass uses depthTest=false so tiles always land on top of the
        // starfield regardless of z.
        this.scene.background = null;
    }

    public setCanvas(canvas: HTMLCanvasElement | null): void {
        if (this.canvas === canvas) return;
        this.canvas = canvas;
        if (this.renderer) {
            this.renderer.dispose();
            this.renderer = null;
        }
        if (!canvas) return;
        this.renderer = new THREE.WebGLRenderer({
            canvas,
            antialias: false,        // We're flat 2D — no perceptible diff and big perf cost.
            alpha: false,            // Opaque background; saves an alpha blend per pixel.
            powerPreference: 'high-performance',
        });
        this.renderer.setClearColor(0x000000, 1);
        this.dpr = window.devicePixelRatio || 1;
        this.renderer.setPixelRatio(this.dpr);
        if (this.widthCss > 0 && this.heightCss > 0) {
            this.renderer.setSize(this.widthCss, this.heightCss, false);
        }
        this.initBackground();
        this.initTileMaterial();
    }

    public setEnabled(v: boolean): void {
        this.enabled = v;
        if (this.canvas) {
            // Hide the WebGL canvas entirely when disabled so it doesn't
            // hold the previous frame on screen behind the now-opaque
            // Canvas2D (which would just be wasted, but is also confusing
            // if anything goes wrong with z-ordering).
            this.canvas.style.display = v ? 'block' : 'none';
        }
    }

    public isEnabled(): boolean { return this.enabled; }

    public resize(widthCss: number, heightCss: number): void {
        this.widthCss = widthCss;
        this.heightCss = heightCss;
        this.dpr = window.devicePixelRatio || 1;
        if (this.renderer) {
            this.renderer.setPixelRatio(this.dpr);
            this.renderer.setSize(widthCss, heightCss, false);
        }
        if (this.bgMaterial) {
            this.bgMaterial.uniforms.uResolution.value.set(widthCss, heightCss);
        }
    }

    /**
     * Called from GameEngine.loadMap.  Walks the full entity list,
     * extracts every static structure tile (mass=Infinity), and builds
     * one InstancedMesh per shardVariant.  All instances are baked once
     * here; per-frame the renderer only updates the `aActive` byte per
     * tile (cheap) and the camera uniform.  Calling this with a new
     * entity list disposes the previous groups.
     */
    public setStaticTiles(entities: GameEntity[]): void {
        // Tear down existing groups
        for (const g of this.tileGroups.values()) {
            g.mesh.geometry.dispose();
            (g.mesh.material as THREE.Material).dispose?.();
            this.scene.remove(g.mesh);
        }
        this.tileGroups.clear();
        if (!this.tileMaterial || !this.tileGeometry) return;

        // Bucket by variant
        const buckets = new Map<string, GameEntity[]>();
        for (const e of entities) {
            if (e.type !== EntityType.STRUCTURE) continue;
            if (e.mass !== Infinity) continue;
            const v = e.shardVariant ?? 'glass-tile';
            let list = buckets.get(v);
            if (!list) { list = []; buckets.set(v, list); }
            list.push(e);
        }

        let total = 0;
        for (const [variant, list] of buckets) {
            const capacity = list.length;
            // Each group gets its own geometry clone so we can attach
            // its own InstancedBufferAttribute; the underlying vertex
            // data is shared (small) and the instance buffer is the
            // expensive part anyway.
            const geom = this.tileGeometry.clone();
            const mesh = new THREE.InstancedMesh(geom, this.tileMaterial, capacity);
            mesh.frustumCulled = false; // We do our own torus-aware cull in shader.
            mesh.renderOrder = 1;
            mesh.matrixAutoUpdate = false;

            const dummy = new THREE.Object3D();
            const colorAttr = new Float32Array(capacity * 3);
            const activeBytes = new Float32Array(capacity);
            for (let i = 0; i < capacity; i++) {
                const e = list[i];
                dummy.position.set(e.position.x, e.position.y, 0);
                // Hex orientation matches TileGenerator's pointy-top hexes
                // (createNebulaTileEntity / buildStructureTile use the same
                // polygon).  Our geometry is already pointy-top so no
                // rotation is needed.
                dummy.scale.set(e.size.x, e.size.y, 1);
                dummy.updateMatrix();
                mesh.setMatrixAt(i, dummy.matrix);
                const [r, g, b] = hexToRgb01(e.color);
                colorAttr[i * 3 + 0] = r;
                colorAttr[i * 3 + 1] = g;
                colorAttr[i * 3 + 2] = b;
                activeBytes[i] = e.active ? 1 : 0;
            }
            mesh.instanceMatrix.needsUpdate = true;

            const colorBufAttr = new THREE.InstancedBufferAttribute(colorAttr, 3);
            geom.setAttribute('aColor', colorBufAttr);
            const activeAttr = new THREE.InstancedBufferAttribute(activeBytes, 1);
            activeAttr.setUsage(THREE.DynamicDrawUsage);
            geom.setAttribute('aActive', activeAttr);

            this.scene.add(mesh);
            this.tileGroups.set(variant, {
                variant, mesh, activeAttr,
                entities: list, activeBytes, capacity,
            });
            total += capacity;
        }
        this.lastTotalTileCount = total;
    }

    /**
     * Per-frame entry point.  Updates the camera uniform, syncs each
     * tile group's `aActive` attribute from its entities, and fires
     * one render pass.  No-op when disabled, so it can be called
     * unconditionally from GameEngine.draw().
     */
    public render(camera: CameraState): void {
        if (!this.enabled || !this.renderer) {
            this.lastWebGLMs = 0;
            return;
        }
        const t0 = performance.now();

        // Sync per-instance active flags
        let visible = 0;
        for (const g of this.tileGroups.values()) {
            const bytes = g.activeBytes;
            const ents = g.entities;
            let dirty = false;
            for (let i = 0; i < g.capacity; i++) {
                const want: number = ents[i].active ? 1 : 0;
                if (bytes[i] !== want) {
                    bytes[i] = want;
                    dirty = true;
                }
                if (want) visible++;
            }
            if (dirty) g.activeAttr.needsUpdate = true;
        }
        this.lastVisibleTileCount = visible;

        // Camera uniforms — both background and tile shaders read from
        // these.  The orthographic projection is identity-mapped to NDC;
        // world→screen happens in the vertex shader using camera +
        // halfExtent + torus wrap.
        const halfWWorld = (this.widthCss / 2) / camera.zoom;
        const halfHWorld = (this.heightCss / 2) / camera.zoom;
        const camX = camera.position.x + (camera.shakeOffset?.x ?? 0);
        const camY = camera.position.y + (camera.shakeOffset?.y ?? 0);

        if (this.bgMaterial) {
            const u = this.bgMaterial.uniforms;
            u.uCamera.value.set(camX, camY);
            u.uZoom.value = camera.zoom;
        }
        if (this.tileMaterial) {
            const u = this.tileMaterial.uniforms;
            u.uCamera.value.set(camX, camY);
            u.uHalfWorld.value.set(halfWWorld, halfHWorld);
            u.uMapSize.value.set(MAP_WIDTH, MAP_HEIGHT);
            u.uHalfMap.value.set(HALF_MAP_WIDTH, HALF_MAP_HEIGHT);
        }

        this.renderer.render(this.scene, this.camera);
        this.lastWebGLMs = performance.now() - t0;
    }

    // ── Internals ────────────────────────────────────────────────────────

    private initBackground(): void {
        if (!this.renderer) return;

        const geom = new THREE.PlaneGeometry(2, 2);
        this.bgMaterial = new THREE.ShaderMaterial({
            depthTest: false,
            depthWrite: false,
            uniforms: {
                uCamera: { value: new THREE.Vector2(0, 0) },
                uZoom: { value: 1 },
                uResolution: { value: new THREE.Vector2(this.widthCss, this.heightCss) },
            },
            vertexShader: `
                varying vec2 vUv;
                void main() {
                    vUv = uv;
                    gl_Position = vec4(position.xy, 0.0, 1.0);
                }
            `,
            fragmentShader: `
                precision highp float;
                varying vec2 vUv;
                uniform vec2 uCamera;
                uniform vec2 uResolution;

                // 2D hash → [0,1].  Cheap, decent distribution; good enough
                // for the "is this cell a star?" decision.
                float hash21(vec2 p) {
                    p = fract(p * vec2(123.34, 456.21));
                    p += dot(p, p + 45.32);
                    return fract(p.x * p.y);
                }

                // One parallax star layer.  Tiles screen-space into cells of
                // CELL pixels, each cell may contain one randomly-placed
                // star with random brightness.  Camera offset is scaled by
                // a per-layer parallax factor so layers drift at different
                // rates as the player moves.
                vec3 starLayer(vec2 px, float parallax, float density, float brightness, vec3 tint) {
                    float CELL = 60.0;
                    vec2 p = (px - uCamera * parallax * 0.2) / CELL;
                    vec2 cell = floor(p);
                    vec2 sub = fract(p);
                    float seed = hash21(cell);
                    if (seed > density) return vec3(0.0);
                    // Star position inside the cell (deterministic per cell)
                    vec2 starPos = vec2(hash21(cell + 1.7), hash21(cell + 4.3));
                    float d = distance(sub, starPos);
                    float r = 0.04 + 0.05 * hash21(cell + 7.1);
                    float falloff = smoothstep(r, 0.0, d);
                    float bright = brightness * (0.4 + 0.6 * hash21(cell + 9.5));
                    return tint * falloff * bright;
                }

                void main() {
                    // Pixel coords in CSS pixels, origin top-left.
                    vec2 px = vec2(vUv.x, 1.0 - vUv.y) * uResolution;
                    vec3 acc = vec3(0.0);
                    // Far / mid / near layers — depth, density, brightness
                    acc += starLayer(px, 0.05, 0.40, 0.45, vec3(0.85, 0.90, 1.00));
                    acc += starLayer(px + vec2(371.0, 119.0), 0.20, 0.30, 0.70, vec3(1.00, 0.95, 0.85));
                    acc += starLayer(px + vec2(817.0, 503.0), 0.55, 0.15, 1.00, vec3(1.00, 0.80, 0.55));
                    gl_FragColor = vec4(acc, 1.0);
                }
            `,
        });
        this.bgMesh = new THREE.Mesh(geom, this.bgMaterial);
        this.bgMesh.frustumCulled = false;
        this.bgMesh.renderOrder = 0;
        this.scene.add(this.bgMesh);
    }

    private initTileMaterial(): void {
        // Pointy-top hex (matches TileGenerator polygon: top vertex up,
        // 6 vertices at angles 90°, 30°, -30°, -90°, -150°, 150° from
        // center).  Side length = HEX_SIZE = 22 — but we don't bake
        // size into the geometry; the per-instance scale carries it
        // (size.x / size.y, set in setStaticTiles).
        // Geometry is a unit hex (apex-distance = 0.5 in both axes) so
        // dummy.scale.set(size.x, size.y, 1) renders at the desired size.
        const verts: number[] = [];
        const idx: number[] = [];
        const n = 6;
        // Center vertex (0, 0)
        verts.push(0, 0, 0);
        for (let i = 0; i < n; i++) {
            const a = Math.PI / 2 - (i * Math.PI * 2) / n; // pointy-top
            verts.push(Math.cos(a) * 0.5, Math.sin(a) * 0.5, 0);
        }
        for (let i = 0; i < n; i++) {
            idx.push(0, 1 + i, 1 + ((i + 1) % n));
        }
        const geom = new THREE.BufferGeometry();
        geom.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
        geom.setIndex(idx);
        this.tileGeometry = geom;

        this.tileMaterial = new THREE.ShaderMaterial({
            depthTest: false,
            depthWrite: false,
            transparent: true,
            uniforms: {
                uCamera: { value: new THREE.Vector2(0, 0) },
                uHalfWorld: { value: new THREE.Vector2(1, 1) },
                uMapSize: { value: new THREE.Vector2(MAP_WIDTH, MAP_HEIGHT) },
                uHalfMap: { value: new THREE.Vector2(HALF_MAP_WIDTH, HALF_MAP_HEIGHT) },
            },
            vertexShader: `
                // ShaderMaterial does NOT auto-include the THREE chunk
                // that declares instanceMatrix when USE_INSTANCING is on,
                // so declare it ourselves.  Three.js sets up the buffer
                // binding automatically because the mesh is InstancedMesh.
                attribute mat4 instanceMatrix;
                attribute vec3 aColor;
                attribute float aActive;
                uniform vec2 uCamera;
                uniform vec2 uHalfWorld;
                uniform vec2 uMapSize;
                uniform vec2 uHalfMap;
                varying vec3 vColor;
                varying float vDiscard;

                void main() {
                    vColor = aColor;
                    if (aActive < 0.5) {
                        // Collapse off-screen — single tri-area waste, no
                        // fragment work.  Cheaper than per-frame matrix
                        // rewrites for tiles that flip active state.
                        gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
                        vDiscard = 1.0;
                        return;
                    }
                    vDiscard = 0.0;

                    // Instance world position lives in instanceMatrix's
                    // translation; pull it directly to apply torus wrap
                    // before any further transforms.
                    vec3 worldPos = (instanceMatrix * vec4(position, 1.0)).xyz;
                    vec2 d = worldPos.xy - uCamera;
                    if (d.x >  uHalfMap.x) worldPos.x -= uMapSize.x;
                    else if (d.x < -uHalfMap.x) worldPos.x += uMapSize.x;
                    if (d.y >  uHalfMap.y) worldPos.y -= uMapSize.y;
                    else if (d.y < -uHalfMap.y) worldPos.y += uMapSize.y;

                    vec2 ndc = (worldPos.xy - uCamera) / uHalfWorld;
                    // Three.js NDC y is up, our world y is down — invert.
                    gl_Position = vec4(ndc.x, -ndc.y, 0.0, 1.0);
                }
            `,
            fragmentShader: `
                precision highp float;
                varying vec3 vColor;
                varying float vDiscard;
                void main() {
                    if (vDiscard > 0.5) discard;
                    gl_FragColor = vec4(vColor, 1.0);
                }
            `,
        });
    }
}

// ── Helpers ──────────────────────────────────────────────────────────────

function hexToRgb01(hex: string): [number, number, number] {
    const h = (hex || '#888888').replace('#', '');
    const safe = h.length === 6 ? h : '888888';
    return [
        parseInt(safe.substring(0, 2), 16) / 255,
        parseInt(safe.substring(2, 4), 16) / 255,
        parseInt(safe.substring(4, 6), 16) / 255,
    ];
}

