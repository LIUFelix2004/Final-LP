/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_BSC_RPC: string;
  readonly VITE_ROBINHOOD_RPC: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
