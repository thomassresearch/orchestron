import { useId } from "react";
import { MIDI_CHANNELS } from "../../lib/midiControllerChannels";
import type { SequencerUiCopy } from "./sequencerUiCopy";

export function MidiChannelSelector({ channels, onChange, rows = 1, ui }: {
  channels: number[];
  onChange: (channels: number[]) => void;
  rows?: 1 | 2;
  ui: SequencerUiCopy;
}) {
  const hintId = useId();
  return (
    <fieldset className="min-w-0" aria-describedby={hintId}>
      <legend className="mb-1 text-[10px] font-semibold text-slate-400">{ui.midiChannels}</legend>
      <span id={hintId} className="sr-only">{ui.midiChannelsHint}</span>
      <div className="max-w-full overflow-x-auto pb-1">
        <div className={`grid w-max gap-y-1.5 ${rows === 2 ? "grid-cols-8 gap-x-0.5" : "grid-cols-[repeat(16,minmax(0,1fr))] gap-x-1"}`}>
          {MIDI_CHANNELS.map(channel => {
            const checked = channels.includes(channel);
            const lastChannel = checked && channels.length === 1;
            return (
              <label key={channel} title={lastChannel ? ui.midiChannelsRequired : ui.midiChannelLabel(channel)}
                className={`flex flex-col items-center gap-0.5 text-[10px] text-slate-300 ${lastChannel ? "cursor-not-allowed" : "cursor-pointer"} ${rows === 2 ? "w-4" : "w-5"}`}>
                <span className="relative inline-flex h-3.5 w-3.5">
                  <input type="checkbox" checked={checked} disabled={lastChannel}
                    aria-label={ui.midiChannelLabel(channel)}
                    className={`h-3.5 w-3.5 accent-teal-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent disabled:cursor-not-allowed ${lastChannel ? "appearance-none rounded-sm border border-slate-500 bg-slate-950 opacity-100" : ""}`}
                    onChange={() => onChange(checked ? channels.filter(value => value !== channel) : [...channels, channel].sort((a, b) => a - b))} />
                  {lastChannel ? (
                    <svg aria-hidden="true" focusable="false" viewBox="0 0 16 16"
                      className="pointer-events-none absolute inset-0 h-3.5 w-3.5 text-teal-400"
                      fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="m3.5 8 3 3 6-6" />
                    </svg>
                  ) : null}
                </span>
                {channel}
              </label>
            );
          })}
        </div>
      </div>
    </fieldset>
  );
}
