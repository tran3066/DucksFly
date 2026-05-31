/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** WebSocket URL of the DucksFly Colyseus server (see backend/HowToRun.md). */
  readonly VITE_SERVER_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
