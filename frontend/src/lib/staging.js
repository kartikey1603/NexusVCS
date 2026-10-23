import { useCallback, useEffect, useRef, useState } from 'react';
import { get, post, del } from './api.js';

export function useStagedChanges(repositoryId) {
  const [changes, setChanges] = useState([]);
  const [loading, setLoading] = useState(true);
  const [pushing, setPushing] = useState(false);
  const pushingRef = useRef(false); // guards a double Push click firing before state re-renders

  const reload = useCallback(async () => {
    if (!repositoryId) return;
    setLoading(true);
    try {
      const { changes: list } = await get(`/api/repositories/${repositoryId}/changes`);
      setChanges(list);
    } catch {
      // A read-only visitor (or anyone without write access) has no staging area to see --
      // treat "can't fetch staged changes" the same as "there are none" rather than surfacing
      // an auth error for a panel they can't use anyway.
      setChanges([]);
    } finally {
      setLoading(false);
    }
  }, [repositoryId]);

  useEffect(() => { reload(); }, [reload]);

  const discard = useCallback(async (changeId) => {
    await del(`/api/repositories/${repositoryId}/changes/${changeId}`);
    await reload();
  }, [repositoryId, reload]);

  const push = useCallback(async (message) => {
    if (pushingRef.current) return null;
    pushingRef.current = true;
    setPushing(true);
    try {
      const result = await post(`/api/repositories/${repositoryId}/push`, { message });
      await reload();
      return result;
    } finally {
      pushingRef.current = false;
      setPushing(false);
    }
  }, [repositoryId, reload]);

  return { changes, loading, pushing, reload, discard, push };
}
