import { create } from 'zustand';

// Informational toasts for changes that arrived via cloudSync's pull from
// ANOTHER venue's device — not this device's own edits, which already have
// their own immediate on-screen feedback. Deliberately NOT persisted, same
// reasoning as undoStore: these are a live "heads up, something changed
// elsewhere" nudge, not a durable log — SyncNotificationToast.tsx renders
// the newest one and lets it expire on its own.
export interface SyncNotification {
  id: string;
  message: string;
  timestamp: number;
}

interface SyncNotificationStore {
  /** Newest first. */
  queue: SyncNotification[];
  pushNotification: (message: string) => void;
  removeNotification: (id: string) => void;
}

const MAX_QUEUED = 10;

export const useSyncNotificationStore = create<SyncNotificationStore>()((set) => ({
  queue: [],

  pushNotification: (message) => set(s => ({
    queue: [{ id: crypto.randomUUID(), message, timestamp: Date.now() }, ...s.queue].slice(0, MAX_QUEUED),
  })),

  removeNotification: (id) => set(s => ({ queue: s.queue.filter(e => e.id !== id) })),
}));
