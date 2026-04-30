// Single source of truth for "which Ollama models has the user actually
// pulled?". Populates a module-global cache so every picker on the page
// agrees on the list without each one independently fetching.
//
// Usage:
//   const { models, loading, refresh } = useOllamaInstalledModels();
//
// Pickers can also just call modelsForProvider("ollama") — once any
// component on the page has used this hook, the cache is hydrated and
// modelsForProvider returns the real list.

import { useCallback, useEffect, useState } from "react";
import {
  getOllamaInstalledModels,
  setOllamaInstalledModels,
  subscribeOllamaInstalled,
  type ModelEntry,
} from "@/utils/models";
import { api } from "@/api/client";

let _inFlight: Promise<void> | null = null;

async function _refresh(): Promise<void> {
  if (_inFlight) return _inFlight;
  _inFlight = (async () => {
    try {
      const status = await api.getInstallerStatus();
      const installed: ModelEntry[] = (status.ollama_installed_models || []).map((m) => ({
        id: m.name,
        label: m.name,
      }));
      setOllamaInstalledModels(installed);
    } catch {
      // Leave whatever's in the cache; consumers fall back to OLLAMA_MODELS.
    } finally {
      _inFlight = null;
    }
  })();
  return _inFlight;
}

export function useOllamaInstalledModels(): {
  models: ModelEntry[] | null;
  loading: boolean;
  refresh: () => Promise<void>;
} {
  const [, force] = useState(0);
  const [loading, setLoading] = useState(getOllamaInstalledModels() === null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try { await _refresh(); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    const unsub = subscribeOllamaInstalled(() => force((x) => (x + 1) % 1_000_000));
    if (getOllamaInstalledModels() === null) {
      void refresh();
    } else {
      setLoading(false);
    }
    return unsub;
  }, [refresh]);

  return { models: getOllamaInstalledModels(), loading, refresh };
}
