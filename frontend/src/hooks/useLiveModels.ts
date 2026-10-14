// Fetches the live per-provider model lists once per page load (the
// server asks each CLI what it serves — see arz/model_catalog.py) and
// re-renders the caller when they land. Pickers keep calling
// modelsForProvider(); this hook only makes sure the cache is hydrated.

import { useEffect, useState } from "react";
import { api } from "@/api/client";
import { setLiveModels, subscribeLiveModels } from "@/utils/models";

let _loaded: Promise<void> | null = null;

export function refreshLiveModels(force = false): Promise<void> {
  if (_loaded && !force) return _loaded;
  _loaded = api
    .getModels(force)
    .then((r) => setLiveModels(r.providers))
    .catch(() => { _loaded = null; }); // keep static fallbacks; retry next mount
  return _loaded;
}

export function useLiveModels(): void {
  const [, force] = useState(0);
  useEffect(() => {
    const unsub = subscribeLiveModels(() => force((x) => (x + 1) % 1_000_000));
    void refreshLiveModels();
    return unsub;
  }, []);
}
