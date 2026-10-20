// Bundles a 'sequence' element's frames into ONE file — see commands.rs's
// save_sequence, which is what a fresh "Replace…" import already goes
// through (CgTemplateDesigner.tsx's importSequence). This file is for the
// OTHER direction: a sequence that was imported BEFORE that existed still
// has its frames as loose individual files in the shared images library
// (one save_image call per frame) — this re-fetches each frame's own
// already-saved bytes and re-bundles them the same way a fresh import would,
// without needing the operator to go pick the original source files again.
import { resolveImageUrl } from './imageUrl';

const isTauriApp = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

/** True when every frame already lives in one packed file (a fresh import,
 *  or a previous run of consolidateSequenceFrames) — nothing to do. */
export function isSequenceConsolidated(frames: string[]): boolean {
  return frames.length > 0 && frames.every((f) => /\/sequences\//.test(f));
}

async function fetchAsBase64(url: string): Promise<string> {
  const res = await fetch(resolveImageUrl(url));
  const buf = await res.arrayBuffer();
  const bytes = new Uint8Array(buf);
  // btoa needs a plain binary string, not raw bytes — chunked to avoid
  // blowing the call stack on a very large single frame (String.fromCharCode
  // with a huge spread arg can hit engine argument-count limits).
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

/** Re-fetches every one of this sequence's current frame URLs (wherever
 *  they're actually served from right now — loose per-frame files, or
 *  already one packed file) and re-bundles them into a single fresh
 *  save_sequence file, returning the new per-frame URLs to store back on
 *  the element. Desktop-only (same as every other native-command-backed
 *  sequence operation) — returns the input unchanged in a browser context. */
export async function consolidateSequenceFrames(frames: string[]): Promise<string[]> {
  if (!isTauriApp || frames.length === 0) return frames;
  const { invoke } = await import('@tauri-apps/api/core');
  const base64Frames = await Promise.all(frames.map(fetchAsBase64));
  const result = await invoke<{ name: string; urls: string[] }>('save_sequence', { frames: base64Frames });
  return result.urls;
}
