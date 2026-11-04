import { create } from 'zustand';
import type { StructureDraft } from './structure';
/** Session-only; deliberately excluded from performance and app-state serializers. */
export const useStructureDraft = create<{draft:StructureDraft|null}>(()=>({draft:null}));
