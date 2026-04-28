/// <reference types="vite/client" />

interface Window {
  __TAURI_INTERNALS__?: unknown;
  [key: symbol]: unknown;
}
