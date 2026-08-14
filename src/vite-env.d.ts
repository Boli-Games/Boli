/// <reference types="vite/client" />

declare module "*.glb?url" {
  const src: string;
  export default src;
}

interface ImportMetaEnv {
  readonly VITE_PARTYKIT_HOST?: string;
  readonly VITE_CLERK_PUBLISHABLE_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
