import { create } from 'zustand'
import type { AutoQueueStatus } from '@/types'

type AutoQueueStore = {
  status: AutoQueueStatus
  setStatus: (s: AutoQueueStatus) => void
}

export const useAutoQueueStore = create<AutoQueueStore>((set) => ({
  status: {
    enabled: false,
    current_matches: 0,
    max_matches: 0,
    state: 'idle',
    wait_seconds_left: null,
  },
  setStatus: (status) => set({ status }),
}))
