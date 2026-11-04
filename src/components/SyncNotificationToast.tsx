import { useEffect, useRef, useState } from 'react';
import { X, Cloud } from 'lucide-react';
import { useSyncNotificationStore } from '../stores/syncNotificationStore';

const TOAST_DURATION_MS = 6000;

// Brief pop-up for a change that arrived from ANOTHER venue's device via
// cloudSync's pull (see pullAll's own notifyChange calls) — informational
// only, the change has already applied by the time this shows. Same
// "newest one, auto-dismiss" shape as UndoToast, stacked just above it so
// the two never overlap.
export function SyncNotificationToast() {
  const queue = useSyncNotificationStore(s => s.queue);
  const removeNotification = useSyncNotificationStore(s => s.removeNotification);
  const [visibleId, setVisibleId] = useState<string | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSeenId = useRef<string | null>(null);

  useEffect(() => {
    const top = queue[0];
    if (top && top.id !== lastSeenId.current) {
      lastSeenId.current = top.id;
      setVisibleId(top.id);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => setVisibleId(null), TOAST_DURATION_MS);
    }
  }, [queue]);

  useEffect(() => () => { if (timeoutRef.current) clearTimeout(timeoutRef.current); }, []);

  const entry = visibleId ? queue.find(e => e.id === visibleId) : undefined;
  if (!entry) return null;

  return (
    <div className="sync-toast-overlay">
      <div className="sync-toast-card">
        <Cloud size={13} strokeWidth={2} className="sync-toast-icon" />
        <span className="sync-toast-label">{entry.message}</span>
        <button
          className="sync-toast-close"
          onClick={() => { removeNotification(entry.id); setVisibleId(null); }}
          title="Dismiss"
        ><X size={14} strokeWidth={2} /></button>
      </div>
    </div>
  );
}
