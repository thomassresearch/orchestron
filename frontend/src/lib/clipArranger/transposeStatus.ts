import { create } from 'zustand';
import type { ClipTransposePending, SessionSequencerStatus } from '../../types';

/** Runtime acknowledgments only; never copied into performance or editor state. */
export const useTransposeStatus = create<{ byLane: Record<string,ClipTransposePending> }>(()=>({byLane:{}}));
export function syncTransposeStatus(status: SessionSequencerStatus) {
  const byLane: Record<string,ClipTransposePending> = {};
  if(status.running)for(const track of [...status.tracks,...(status.score_tracks??[])])if(track.transpose_pending)byLane[track.track_id]=track.transpose_pending;
  for(const arp of status.arpeggiators??[])if(arp.transpose_pending)byLane[arp.arpeggiator_id]=arp.transpose_pending;
  if(JSON.stringify(byLane)!==JSON.stringify(useTransposeStatus.getState().byLane))useTransposeStatus.setState({byLane});
}
