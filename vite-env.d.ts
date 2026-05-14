declare module 'virtual:nebula-manifest' {
  const paths: string[];
  export default paths;
}

// Build-time constants injected by vite.config.ts `define`.
// `__APP_VERSION__` is the short git SHA of HEAD at build time (or
// 'dev' when git isn't available); `__BUILD_TIME__` is an ISO
// timestamp.  Both are baked into the bundle as string literals.
declare const __APP_VERSION__: string;
declare const __BUILD_TIME__: string;
