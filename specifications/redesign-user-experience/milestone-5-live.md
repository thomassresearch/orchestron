# Milestone 5 · Live in the Perform preview

The optional Perform preview now has a playable launcher. Open **Live**, select a physical pad on a Manual device and press **Play** in its row. Open **Keyboard** to play alongside it. Clicking another pad leaves the keyboard open. **Edit** explicitly replaces it with the pad editor. The regular Perform page remains the default.

## Device and keyboard behavior

| Action | Result |
| --- | --- |
| Select a pad with the device stopped or with Arrangement as its source | Changes the physical edit target. On a clip lane, the playing field identifies the scheduled pattern by name. |
| Tap a pad on a running Manual device | Selects it for editing and queues the launch. The row distinguishes the editing, queued and playing pads. A tap on the active pad cancels the queued launch. Melodic, drum and controller devices retain their pattern boundary. Score uses its next-bar or end-of-score setting. Arpeggiators use their next-cycle or next-bar setting and require input notes to sound. |
| Hold a chord and choose another launch device | The keyboard keeps its piano-roll identity, channel, octave position and held pitches. On a phone or in the expanded keyboard dock, the device picker and eight pads stay directly above the keys. |
| Release a key, leave the window, close the keyboard or switch views | Releases owned notes. Overlapping keys share pitches until their final owner releases. Returning restores control settings and starts with released keys. |
| Edit and save | Direct physical-pad edits use the existing live-edit timing. The dock compares the selected pad with the last explicit performance Save or Load. Without a saved comparison it identifies **Save Performance** as the action that keeps the edits. **Apply** updates a reusable workspace definition and the arpeggiator preset buttons identify the preset as their target. |
| Add a live device to a clip song | Creates an independent device alongside the clip lanes. The performance snapshot preserves its playback source and authored pads. The existing clip lanes retain their arrangement. |

The right Inspector identifies the selected device, its MIDI destination and its source. **Remove device** removes an independent device. Clip lanes are managed in Arrange. The Live overview hosts the manual MIDI controllers. Their channel selectors, value controls and gesture routing use the existing controller implementation.

## Replay the browser checks

Start the [isolated preview](../../frontend/tests/performance/README.md#clip-arranger-acceptance), open `/tests/performance/workspace.html` in Chromium and choose **Perform**. Import and save both [baseline fixtures](milestone-1-baseline.md) in the temporary library. Start each script with its named performance loaded, the engine stopped, English selected and a 1440 × 900 viewport.

| Starting performance | Playwright script | Evidence |
| --- | --- | --- |
| UX Baseline Legacy | [Held chord and MIDI controls](../../frontend/tests/performance/verify-workspace-live.js) | Holds MIDI 60, 63 and 67 on channel 2 through pad 1 → 2 → 3. Checks queued and sounding markers, song seek/stop, one release per pitch and no replay on return. Repeats at 390 × 844 using two simultaneous Chromium touch contacts. Drags a CC knob and checks the messages on its selected MIDI channel. |
| UX Baseline Legacy | [Device launchers](../../frontend/tests/performance/verify-workspace-live-devices.js) | Independently starts Score, drummer, controller and arpeggiator devices, switches each to pad 2, and stops each. Feeds the arpeggiator from the keyboard on its input channel. Opens the ordinary application and checks its Perform entry. |
| UX Baseline Clip | [Save and reload](../../frontend/tests/performance/verify-workspace-live-save.js) | Clones the fixture in the temporary library, adds a Manual melodic device, edits pad 4, checks its unsaved and saved labels, and reloads. Compares the restored source, pad edit and original clip lanes, plays pad 4, then removes the device while its keyboard stays open. |

Run the scripts from the repository root using `playwright-cli run-code --filename` followed by the script path. The held-chord script writes the [desktop launcher](../../screenshots/perform-workspace-live-launcher.png) and [compact keyboard](../../screenshots/perform-workspace-live-keyboard.png) screenshots. The [Arrange checks](milestone-4-arrange.md#replay-the-browser-checks) also cover a dirty clip draft on the same device as the edited Live pad.

The launch checks use native Csound and browser-clock playback. They observe runtime markers and outbound MIDI. Phone coverage uses Chromium touch emulation.
