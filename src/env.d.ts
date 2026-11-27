/// <reference types="vite/client" />

// Shared CommonJS modules from electron/, bundled into the web version.
declare module "*.cjs" {
  const mod: any;
  export default mod;
}
