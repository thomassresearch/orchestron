# Documentation screenshot coverage

Updated 2026-09-07 for commit `b487abd` (audio routing and persistent Perform mixer). Captured from the built application with Playwright in a separate browser session and temporary database. Images are real UI captures, cropped to the relevant panel. The capture database is separate from the user library. English labels match the English manual.

| Gap found | Capture | Documentation |
| --- | --- | --- |
| No illustration of built-in creation without saved templates | `instrument_builtin_patch_chooser.png` | Patch Toolbar and Instrument Tabs |
| No grouped stereo blocks or audio-interface metadata | `instrument_stereo_audio_interface.png` | Graph Editor |
| No prepared isolated effect preview with test source | `instrument_audition_isolated_effect.png` | Runtime Panel / Audition |
| Outstanding browser-clock Runtime screenshot placeholder | `instrument_runtime_panel_browser_clock_active.png` | Runtime Panel and Compilation Workflow |
| No explicit rack-instance selection for performance preview | `instrument_audition_performance_instance.png` | Runtime Panel / Audition |
| No mixer faders, pre/post send, dedicated insert or pinned Master | `perform_mixer_sends_inserts_master.png` | Audio Mixer and Routing; Performance overview |
| No exact channel mappings, destination matrix or routing diagram | `perform_audio_routing_matrix_diagram.png` | Audio Mixer and Routing |
| No routing diagnostics / silent-strip explanation | `perform_routing_diagnostics_silent_path.png` | Audio Mixer and Routing |
| Old rack screenshot predates mixer and continuous-instance controls | Refreshed `perform_instrument_rack_transport_controls.png` | Instrument Rack and Engine Transport |
| Old toolbar screenshot predates Activation and built-in creation | Refreshed `instrument_patch_toolbar_tabs_actions.png` | Patch Toolbar and Instrument Tabs |
| Existing MIDI dropdown image had an extra `.png` suffix and a broken manual link | Renamed to `instrument_runtime_panel_midi_input_dropdown_open.png` | MIDI Setup and Inputs |

The example uses Sine Lead and the built-in pass-through Audio effect named Stereo Return. The return and insert are separate instances of that same saved patch. Mixer screenshots show stopped transport, so meters read silence. The diagnostics image temporarily mutes Sine Lead. Both audition screenshots show successful preparation; they do not claim playback is running.

The Runtime panel capture shows an active browser-clock session, with no notes playing. The session was stopped after capture. Older screenshots for unrelated workflows remain in place.
