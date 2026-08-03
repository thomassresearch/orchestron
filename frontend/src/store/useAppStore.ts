import { create } from "zustand";

import { api, isApiError } from "../api/client";
import {
  normalizeBrowserClockLatencySettings,
  resolveDefaultBrowserClockLatencySettings
} from "../lib/browserClockLatencyConfig";
import { normalizeGuiLanguage } from "../lib/guiLanguage";
import type {
  AppPage,
  CompileResponse,
  GuiLanguage,
  NodeInstance,
  Patch,
  PatchGraph,
  PersistedAppState,
  SequencerConfigSnapshot,
  SessionEvent
} from "../types";
import type { AppStore, EditablePatch, InstrumentTabState } from "./appStoreTypes";
import {
  ALWAYS_ON_REQUIRES_INLETA_MESSAGE,
  APP_STATE_PERSIST_DEBOUNCE_MS,
  APP_STATE_VERSION,
  AUDIO_RATE_MAX,
  AUDIO_RATE_MIN,
  CONTROL_RATE_MAX,
  CONTROL_RATE_MIN,
  ENGINE_BUFFER_MAX,
  ENGINE_BUFFER_MIN,
  type PersistWatchState,
  buildPersistedAppStateSnapshot,
  buildSequencerConfigSnapshot,
  capturePersistWatchState,
  clampInt,
  createInstrumentTab,
  defaultEditablePatch,
  defaultParams,
  defaultSequencerInstruments,
  defaultSequencerState,
  emptyPerformanceSequencerState,
  hasPersistableStateChange,
  hydrateEmbeddedPerformancePatches,
  initialBrowserClockLatencySettings,
  initialPatch,
  initialSequencerRuntimeState,
  initialSequencerState,
  initialTab,
  isSequencerRuntimeOnlyUpdate,
  normalizeAppPage,
  normalizeEffectRouteSelections,
  normalizeEffectSourceIds,
  normalizeEngineConfig,
  normalizeInstrumentLevel,
  normalizeMidiInputSelection,
  normalizePatch,
  normalizePersistedInstrumentTabs,
  normalizePersistedSequencerInstruments,
  normalizeSequencerState,
  normalizeSessionInstrumentAssignments,
  parseSequencerConfigSnapshot,
  patchGraphHasOpcode,
  performablePatches,
  randomPosition,
  sameAssignments,
  sequencerInstrumentsForPerformablePatches,
  sequencerRuntimeStateFromSequencer,
  sequencerSnapshotForPersistence,
  updatePatchInTabs,
  withNormalizedEngineConfig
} from "./appStoreModel";
import { createSequencerStoreActions } from "./appStoreSequencerActions";

export { ALWAYS_ON_REQUIRES_INLETA_MESSAGE } from "./appStoreModel";


let persistTimer: ReturnType<typeof setTimeout> | null = null;
let persistInFlight = false;
let pendingPersistSnapshot: PersistedAppState | null = null;
let lastPersistedSignature: string | null = null;
let lastPersistWatchState: PersistWatchState | null = null;
let bootstrapLoadInFlight: Promise<void> | null = null;

export const useAppStore = create<AppStore>((set, get) => {
  const commitCurrentPatch = (patch: EditablePatch, extra?: Partial<AppStore>) => {
    const state = get();
    const instrumentTabs = updatePatchInTabs(state.instrumentTabs, state.activeInstrumentTabId, patch);
    set({
      ...extra,
      currentPatch: patch,
      instrumentTabs
    });
  };

  return {
    loading: false,
    error: null,
    hasLoadedBootstrap: false,

    activePage: "instrument",
    guiLanguage: "english",
    browserClockLatencySettings: initialBrowserClockLatencySettings,

    opcodes: [],
    patches: [],
    performances: [],
    midiInputs: [],

    instrumentTabs: [initialTab],
    activeInstrumentTabId: initialTab.id,
    currentPatch: initialPatch,

    sequencer: initialSequencerState,
    sequencerRuntime: initialSequencerRuntimeState,
    sequencerInstruments: [],
    currentPerformanceId: null,
    performanceName: "Untitled Performance",
    performanceDescription: "",

    activeSessionId: null,
    activeSessionState: "idle",
    activeMidiInput: null,
    activeSessionInstruments: [],
    compileOutput: null,

    events: [],

    setActivePage: (page) => {
      set({ activePage: page });
    },

    setGuiLanguage: (language) => {
      set({ guiLanguage: normalizeGuiLanguage(language) });
    },

    setBrowserClockLatencySettings: (settings) => {
      set({
        browserClockLatencySettings: normalizeBrowserClockLatencySettings(
          settings,
          resolveDefaultBrowserClockLatencySettings()
        )
      });
    },

    addInstrumentTab: () => {
      const tab = createInstrumentTab();
      set((state) => ({
        instrumentTabs: [...state.instrumentTabs, tab],
        activeInstrumentTabId: tab.id,
        currentPatch: tab.patch
      }));
    },

    closeInstrumentTab: (tabId) => {
      const state = get();
      if (state.instrumentTabs.length <= 1) {
        const replacement = createInstrumentTab();
        set({
          instrumentTabs: [replacement],
          activeInstrumentTabId: replacement.id,
          currentPatch: replacement.patch
        });
        return;
      }

      const index = state.instrumentTabs.findIndex((tab) => tab.id === tabId);
      if (index < 0) {
        return;
      }

      const nextTabs = state.instrumentTabs.filter((tab) => tab.id !== tabId);
      if (state.activeInstrumentTabId !== tabId) {
        set({ instrumentTabs: nextTabs });
        return;
      }

      const nextActive = nextTabs[Math.max(0, index - 1)] ?? nextTabs[0];
      set({
        instrumentTabs: nextTabs,
        activeInstrumentTabId: nextActive.id,
        currentPatch: nextActive.patch
      });
    },

    setActiveInstrumentTab: (tabId) => {
      const tab = get().instrumentTabs.find((candidate) => candidate.id === tabId);
      if (!tab) {
        return;
      }

      set({
        activeInstrumentTabId: tabId,
        currentPatch: tab.patch
      });
    },

    loadBootstrap: async () => {
      if (get().hasLoadedBootstrap) {
        return;
      }
      if (bootstrapLoadInFlight) {
        return bootstrapLoadInFlight;
      }

      const initialState = get();
      const initialActivePage = initialState.activePage;
      const initialGuiLanguage = initialState.guiLanguage;

      bootstrapLoadInFlight = (async () => {
        set({ loading: true, error: null });
        try {
          const [opcodes, patches, performances, midiInputs, persistedState] = await Promise.all([
            api.listOpcodes(),
            api.listPatches(),
            api.listPerformances(),
            api.listMidiInputs(),
            api
              .getAppState()
              .then((response) => response.state)
              .catch((error: unknown) => {
                if (
                  error instanceof Error &&
                  (error.message.includes("API 404") || error.message.includes("App state not found"))
                ) {
                  return null;
                }
                throw error;
              })
          ]);

          let currentPatch = defaultEditablePatch();
          if (patches.length > 0) {
            const full = await api.getPatch(patches[0].id);
            currentPatch = normalizePatch(full);
          }

          let activePage: AppPage = "instrument";
          let instrumentTabs: InstrumentTabState[] = [createInstrumentTab(currentPatch)];
          let activeInstrumentTabId = instrumentTabs[0].id;
          let sequencer = defaultSequencerState();
          let sequencerRuntime = sequencerRuntimeStateFromSequencer(sequencer);
          let sequencerInstruments = defaultSequencerInstruments(patches, currentPatch);
          let currentPerformanceId: string | null = null;
          let performanceName = "Untitled Performance";
          let performanceDescription = "";
          let guiLanguage: GuiLanguage = "english";
          let browserClockLatencySettings = resolveDefaultBrowserClockLatencySettings();

          const preferredMidi = normalizeMidiInputSelection(get().activeMidiInput, midiInputs);
          let activeMidiInput = preferredMidi ?? midiInputs[0]?.id ?? null;

          if (persistedState && typeof persistedState === "object" && !Array.isArray(persistedState)) {
            const payload = persistedState as Partial<PersistedAppState>;
            if (payload.version === APP_STATE_VERSION) {
              const restoredTabs = normalizePersistedInstrumentTabs(payload.instrumentTabs);
              if (restoredTabs.length > 0) {
                instrumentTabs = restoredTabs;
                activeInstrumentTabId =
                  typeof payload.activeInstrumentTabId === "string" &&
                  instrumentTabs.some((tab) => tab.id === payload.activeInstrumentTabId)
                    ? payload.activeInstrumentTabId
                    : instrumentTabs[0].id;
                currentPatch =
                  instrumentTabs.find((tab) => tab.id === activeInstrumentTabId)?.patch ?? instrumentTabs[0].patch;
              }

              activePage = normalizeAppPage(payload.activePage);
              guiLanguage = normalizeGuiLanguage(payload.guiLanguage);
              browserClockLatencySettings = normalizeBrowserClockLatencySettings(
                payload.browserClockLatencySettings,
                browserClockLatencySettings
              );
              sequencer = normalizeSequencerState(payload.sequencer);
              sequencerRuntime = sequencerRuntimeStateFromSequencer(sequencer);

              const availableInstrumentPatches = performablePatches(patches);
              const fallbackPatchId = availableInstrumentPatches[0]?.id ?? null;
              sequencerInstruments = normalizePersistedSequencerInstruments(
                payload.sequencerInstruments,
                availableInstrumentPatches,
                fallbackPatchId
              );

              currentPerformanceId =
                typeof payload.currentPerformanceId === "string" &&
                performances.some((performance) => performance.id === payload.currentPerformanceId)
                  ? payload.currentPerformanceId
                  : null;
              performanceName =
                typeof payload.performanceName === "string" && payload.performanceName.trim().length > 0
                  ? payload.performanceName
                  : "Untitled Performance";
              performanceDescription =
                typeof payload.performanceDescription === "string" ? payload.performanceDescription : "";

              const persistedMidiInput = normalizeMidiInputSelection(payload.activeMidiInput, midiInputs);
              if (persistedMidiInput) {
                activeMidiInput = persistedMidiInput;
              }
            }
          }

          const latestState = get();
          const activePageChangedDuringBootstrap =
            !latestState.hasLoadedBootstrap && latestState.activePage !== initialActivePage;
          const guiLanguageChangedDuringBootstrap =
            !latestState.hasLoadedBootstrap && latestState.guiLanguage !== initialGuiLanguage;

          const resolvedActivePage = activePageChangedDuringBootstrap ? latestState.activePage : activePage;
          const resolvedGuiLanguage = guiLanguageChangedDuringBootstrap ? latestState.guiLanguage : guiLanguage;

          const baselineSnapshot: PersistedAppState = {
            version: APP_STATE_VERSION,
            activePage: resolvedActivePage,
            guiLanguage: resolvedGuiLanguage,
            browserClockLatencySettings,
            instrumentTabs: instrumentTabs.map((tab) => ({
              id: tab.id,
              patch: {
                id: tab.patch.id,
                name: tab.patch.name,
                description: tab.patch.description,
                is_template: tab.patch.is_template,
                always_on: tab.patch.always_on,
                schema_version: tab.patch.schema_version,
                graph: withNormalizedEngineConfig(tab.patch.graph),
                created_at: tab.patch.created_at,
                updated_at: tab.patch.updated_at
              }
            })),
            activeInstrumentTabId,
            sequencer: sequencerSnapshotForPersistence(sequencer),
            sequencerInstruments: sequencerInstruments.map((binding) => ({
              id: binding.id,
              patchId: binding.patchId,
              midiChannel: clampInt(binding.midiChannel, 0, 16),
              level: normalizeInstrumentLevel(binding.level),
              effectSourceIds: normalizeEffectSourceIds(binding.effectSourceIds),
              effectRoutes: normalizeEffectRouteSelections(binding.effectRoutes)
            })),
            currentPerformanceId,
            performanceName,
            performanceDescription,
            activeMidiInput
          };
          lastPersistedSignature = JSON.stringify(baselineSnapshot);
          lastPersistWatchState = {
            activePage: resolvedActivePage,
            guiLanguage: resolvedGuiLanguage,
            browserClockLatencySettings,
            instrumentTabs,
            activeInstrumentTabId,
            sequencer,
            sequencerInstruments,
            currentPerformanceId,
            performanceName,
            performanceDescription,
            activeMidiInput
          };

          set({
            opcodes,
            patches,
            performances,
            midiInputs,
            activeMidiInput,
            activePage: resolvedActivePage,
            guiLanguage: resolvedGuiLanguage,
            browserClockLatencySettings,
            instrumentTabs,
            activeInstrumentTabId,
            currentPatch,
            sequencer,
            sequencerRuntime,
            sequencerInstruments,
            currentPerformanceId,
            performanceName,
            performanceDescription,
            hasLoadedBootstrap: true,
            loading: false,
            error: null
          });
        } catch (error) {
          set({
            hasLoadedBootstrap: true,
            loading: false,
            error: error instanceof Error ? error.message : "Failed to load bootstrap data"
          });
        } finally {
          bootstrapLoadInFlight = null;
        }
      })();

      return bootstrapLoadInFlight;
    },

    loadPatch: async (patchId) => {
      const existingTab = get().instrumentTabs.find((tab) => tab.patch.id === patchId);
      if (existingTab) {
        set({
          activeInstrumentTabId: existingTab.id,
          currentPatch: existingTab.patch,
          error: null
        });
        return;
      }

      set({ loading: true, error: null });
      try {
        const patch = await api.getPatch(patchId);
        const currentPatch = normalizePatch(patch);
        commitCurrentPatch(currentPatch, { loading: false, error: null });
      } catch (error) {
        set({
          loading: false,
          error: error instanceof Error ? error.message : "Failed to load patch"
        });
      }
    },

    refreshPatches: async () => {
      const patches = await api.listPatches();
      set((state) => ({
        patches,
        sequencerInstruments: sequencerInstrumentsForPerformablePatches(state.sequencerInstruments, patches)
      }));
      return patches;
    },

    refreshPerformances: async () => {
      const performances = await api.listPerformances();
      set({ performances });
      return performances;
    },

    loadPerformance: async (performanceId) => {
      set({ loading: true, error: null });
      try {
        const performance = await api.getPerformance(performanceId);
        const state = get();
        const hydrated = await hydrateEmbeddedPerformancePatches(performance.config, state.patches);
        const availableInstrumentPatches = performablePatches(hydrated.patches);
        const fallbackPatchId =
          availableInstrumentPatches[0]?.id ?? (state.currentPatch.is_template === true ? null : state.currentPatch.id ?? null);
        const parsed = parseSequencerConfigSnapshot(hydrated.snapshot, availableInstrumentPatches, fallbackPatchId);

        set({
          patches: hydrated.patches,
          sequencer: parsed.sequencer,
          sequencerRuntime: sequencerRuntimeStateFromSequencer(parsed.sequencer),
          sequencerInstruments: parsed.instruments,
          currentPerformanceId: performance.id,
          performanceName: performance.name,
          performanceDescription: performance.description,
          loading: false,
          error: null
        });
      } catch (error) {
        set({
          loading: false,
          error: error instanceof Error ? error.message : "Failed to load performance"
        });
      }
    },

    newPatch: () => {
      commitCurrentPatch(defaultEditablePatch());
    },

    newPatchFromTemplate: (template) => {
      const draft = defaultEditablePatch();
      commitCurrentPatch({
        ...draft,
        description: template.description,
        is_template: false,
        always_on: template.always_on === true,
        graph: withNormalizedEngineConfig(JSON.parse(JSON.stringify(template.graph)) as PatchGraph)
      });
    },

    setCurrentPatchMeta: (name, description) => {
      const current = get().currentPatch;
      commitCurrentPatch({
        ...current,
        name,
        description
      });
    },

    setCurrentPatchTemplate: (isTemplate) => {
      const current = get().currentPatch;
      commitCurrentPatch({
        ...current,
        is_template: isTemplate
      });
    },

    setCurrentPatchAlwaysOn: (alwaysOn) => {
      const current = get().currentPatch;
      commitCurrentPatch({
        ...current,
        always_on: alwaysOn
      });
    },

    setCurrentPerformanceMeta: (name, description) => {
      set({
        performanceName: name,
        performanceDescription: description
      });
    },

    clearCurrentPerformanceSelection: () => {
      set({ currentPerformanceId: null });
    },

    newPerformanceWorkspace: async () => {
      const nextSequencer = emptyPerformanceSequencerState();
      set({
        sequencer: nextSequencer,
        sequencerRuntime: sequencerRuntimeStateFromSequencer(nextSequencer),
        sequencerInstruments: [],
        currentPerformanceId: null,
        performanceName: "new performance",
        performanceDescription: "new performance",
        compileOutput: null,
        error: null
      });
    },

    setGraph: (graph) => {
      const current = get().currentPatch;
      commitCurrentPatch({
        ...current,
        graph: withNormalizedEngineConfig(graph)
      });
    },

    addNodeFromOpcode: (opcode, position) => {
      const current = get().currentPatch;
      const index = current.graph.nodes.length;

      const node: NodeInstance = {
        id: crypto.randomUUID(),
        opcode: opcode.name,
        params: defaultParams(opcode),
        position: position ?? randomPosition(index)
      };

      commitCurrentPatch({
        ...current,
        graph: {
          ...current.graph,
          nodes: [...current.graph.nodes, node]
        }
      });
    },

    removeNode: (nodeId) => {
      const current = get().currentPatch;
      commitCurrentPatch({
        ...current,
        graph: {
          ...current.graph,
          nodes: current.graph.nodes.filter((node) => node.id !== nodeId),
          connections: current.graph.connections.filter(
            (connection) => connection.from_node_id !== nodeId && connection.to_node_id !== nodeId
          )
        }
      });
    },

    removeConnection: (connectionIndex) => {
      const current = get().currentPatch;
      commitCurrentPatch({
        ...current,
        graph: {
          ...current.graph,
          connections: current.graph.connections.filter((_, index) => index !== connectionIndex)
        }
      });
    },

    saveCurrentPatch: async () => {
      const current = {
        ...get().currentPatch,
        graph: withNormalizedEngineConfig(get().currentPatch.graph)
      };

      if (current.always_on && !patchGraphHasOpcode(current.graph, "inleta")) {
        commitCurrentPatch(current, { loading: false, error: ALWAYS_ON_REQUIRES_INLETA_MESSAGE });
        return;
      }

      commitCurrentPatch(current, { loading: true, error: null });

      try {
        const payload = {
          name: current.name,
          description: current.description,
          is_template: current.is_template,
          always_on: current.always_on,
          schema_version: current.schema_version,
          graph: current.graph
        };

        let saved: Patch;
        if (current.id) {
          saved = await api.updatePatch(current.id, payload);
        } else {
          saved = await api.createPatch(payload);
        }

        const patches = await api.listPatches();
        const normalizedPatch = normalizePatch(saved);
        const state = get();

        const hasKnownBindings = state.sequencerInstruments.length > 0;
        const sequencerInstruments = hasKnownBindings
          ? sequencerInstrumentsForPerformablePatches(state.sequencerInstruments, patches)
          : defaultSequencerInstruments(patches, normalizedPatch);

        commitCurrentPatch(normalizedPatch, {
          patches,
          sequencerInstruments,
          loading: false,
          error: null
        });
      } catch (error) {
        set({
          loading: false,
          error: error instanceof Error ? error.message : "Failed to save patch"
        });
      }
    },

    saveCurrentPerformance: async () => {
      const state = get();
      const name = state.performanceName.trim();
      if (name.length === 0) {
        set({ error: "Performance name is required." });
        return;
      }

      set({ loading: true, error: null });
      try {
        const snapshot = buildSequencerConfigSnapshot(state.sequencer, state.sequencerInstruments);
        const selectedPatchIds = [
          ...new Set(snapshot.instruments.map((instrument) => instrument.patchId.trim()).filter((patchId) => patchId.length > 0))
        ];
        const selectedPatches = await Promise.all(selectedPatchIds.map((patchId) => api.getPatch(patchId)));
        const patchNameById = new Map(selectedPatches.map((patch) => [patch.id, patch.name]));
        const configWithEmbeddedPatches: SequencerConfigSnapshot = {
          ...snapshot,
          instruments: snapshot.instruments.map((instrument) => ({
            ...instrument,
            patchName: patchNameById.get(instrument.patchId) ?? instrument.patchName
          })),
          patchDefinitions: selectedPatches.map((patch) => ({
            sourcePatchId: patch.id,
            name: patch.name,
            description: patch.description,
            isTemplate: patch.is_template,
            alwaysOn: patch.always_on,
            schema_version: patch.schema_version,
            graph: patch.graph
          }))
        };

        const payload = {
          name,
          description: state.performanceDescription,
          config: configWithEmbeddedPatches
        };

        const saved = state.currentPerformanceId
          ? await api.updatePerformance(state.currentPerformanceId, payload)
          : await api.createPerformance(payload);
        const performances = await api.listPerformances();

        set({
          performances,
          currentPerformanceId: saved.id,
          performanceName: saved.name,
          performanceDescription: saved.description,
          loading: false,
          error: null
        });
      } catch (error) {
        set({
          loading: false,
          error: error instanceof Error ? error.message : "Failed to save performance"
        });
      }
    },

    ...createSequencerStoreActions(set, get),
    applyEngineConfig: async ({ sr, controlRate, softwareBuffer, hardwareBuffer }) => {
      const currentPatch = get().currentPatch;
      const currentEngine = normalizeEngineConfig(currentPatch.graph.engine_config);
      const nextSr = clampInt(sr, AUDIO_RATE_MIN, AUDIO_RATE_MAX);
      const nextControlRate = clampInt(controlRate, CONTROL_RATE_MIN, CONTROL_RATE_MAX);
      const nextSoftwareBuffer = clampInt(softwareBuffer, ENGINE_BUFFER_MIN, ENGINE_BUFFER_MAX);
      const nextHardwareBuffer = clampInt(hardwareBuffer, ENGINE_BUFFER_MIN, ENGINE_BUFFER_MAX);
      const nextKsmps = Math.max(1, Math.round(nextSr / nextControlRate));

      const nextPatch: EditablePatch = {
        ...currentPatch,
        graph: {
          ...currentPatch.graph,
          engine_config: {
            ...currentEngine,
            sr: nextSr,
            control_rate: nextControlRate,
            ksmps: nextKsmps,
            software_buffer: nextSoftwareBuffer,
            hardware_buffer: nextHardwareBuffer
          }
        }
      };

      commitCurrentPatch(nextPatch, { error: null });

      const normalizedGraph = withNormalizedEngineConfig(nextPatch.graph);

      try {
        let persisted: Patch;
        if (nextPatch.id) {
          persisted = await api.updatePatch(nextPatch.id, { graph: normalizedGraph });
        } else {
          persisted = await api.createPatch({
            name: nextPatch.name,
            description: nextPatch.description,
            is_template: nextPatch.is_template,
            always_on: nextPatch.always_on,
            schema_version: nextPatch.schema_version,
            graph: normalizedGraph
          });
        }

        const patches = await api.listPatches();
        const persistedNormalized = normalizePatch(persisted);
        const resolvedPatch: EditablePatch = nextPatch.id
          ? {
              ...nextPatch,
              graph: normalizedGraph,
              created_at: persistedNormalized.created_at,
              updated_at: persistedNormalized.updated_at
            }
          : persistedNormalized;

        const state = get();
        const hasKnownBindings = state.sequencerInstruments.length > 0;
        const sequencerInstruments = hasKnownBindings
          ? sequencerInstrumentsForPerformablePatches(state.sequencerInstruments, patches)
          : defaultSequencerInstruments(patches, resolvedPatch);

        commitCurrentPatch(resolvedPatch, {
          patches,
          sequencerInstruments,
          error: null
        });
      } catch (error) {
        set({
          error: error instanceof Error ? error.message : "Failed to persist engine configuration."
        });
      }
    },

    ensureSession: async () => {
      const requestedAssignments = normalizeSessionInstrumentAssignments(get().sequencerInstruments);
      let sessionId = get().activeSessionId;

      if (sessionId && sameAssignments(requestedAssignments, get().activeSessionInstruments)) {
        try {
          await api.getSession(sessionId);
          return sessionId;
        } catch (error) {
          if (!isApiError(error) || error.status !== 404) {
            throw error;
          }

          set({
            activeSessionId: null,
            activeSessionState: "idle",
            activeSessionInstruments: [],
            compileOutput: null,
            events: []
          });
          sessionId = null;
        }
      }

      if (sessionId && !sameAssignments(requestedAssignments, get().activeSessionInstruments)) {
        try {
          await api.stopSession(sessionId);
        } catch {
          // Ignore if session wasn't running.
        }
        try {
          await api.deleteSession(sessionId);
        } catch {
          // Ignore cleanup failures and continue with a fresh session.
        }

        set({
          activeSessionId: null,
          activeSessionState: "idle",
          activeSessionInstruments: [],
          compileOutput: null,
          events: []
        });
        sessionId = null;
      }

      if (sessionId) {
        return sessionId;
      }

      const session = await api.createSession(requestedAssignments);
      sessionId = session.session_id;

      const midiInput = get().activeMidiInput;
      let boundMidiInput = midiInput;
      if (midiInput) {
        try {
          const boundSession = await api.bindMidiInput(sessionId, midiInput);
          boundMidiInput = boundSession.midi_input ?? midiInput;
        } catch {
          // Keep session creation successful even if MIDI binding fails.
        }
      }

      set({
        activeSessionId: sessionId,
        activeSessionState: session.state,
        activeMidiInput: boundMidiInput,
        activeSessionInstruments: session.instruments.length > 0 ? session.instruments : requestedAssignments
      });

      return sessionId;
    },

    compileSession: async () => {
      set({ loading: true, error: null });
      try {
        const current = {
          ...get().currentPatch,
          graph: withNormalizedEngineConfig(get().currentPatch.graph)
        };

        const patchName = current.name.trim().length > 0 ? current.name.trim() : "Untitled Patch";
        const temporaryPatch = await api.createPatch({
          name: patchName,
          description: current.description,
          is_template: false,
          always_on: current.always_on,
          schema_version: current.schema_version,
          graph: current.graph
        });

        let compileOutput = null as CompileResponse | null;
        try {
          const compileSession = await api.createSession([
            {
              patch_id: temporaryPatch.id,
              midi_channel: 1
            }
          ]);

          const sessionId = compileSession.session_id;
          try {
            const midiInput = get().activeMidiInput;
            if (midiInput) {
              try {
                await api.bindMidiInput(sessionId, midiInput);
              } catch {
                // Keep compile successful even if MIDI binding fails for temporary validation session.
              }
            }

            compileOutput = await api.compileSession(sessionId);
          } finally {
            try {
              await api.deleteSession(sessionId);
            } catch {
              // Best-effort cleanup for temporary compile sessions.
            }
          }
        } finally {
          try {
            await api.deletePatch(temporaryPatch.id);
          } catch {
            // Best-effort cleanup for temporary compile validation patch.
          }
        }

        if (!compileOutput) {
          throw new Error("Failed to compile current patch.");
        }

        set({
          compileOutput,
          loading: false,
          error: null
        });
        return compileOutput;
      } catch (error) {
        set({
          loading: false,
          error: error instanceof Error ? error.message : "Failed to compile session"
        });
        return null;
      }
    },

    startSession: async () => {
      set({ loading: true, error: null });
      try {
        const sessionId = await get().ensureSession();
        const compileOutput = await api.compileSession(sessionId);
        const response = await api.startSession(sessionId);
        set({ compileOutput, activeSessionState: response.state, loading: false });
      } catch (error) {
        set({
          loading: false,
          activeSessionState: "error",
          error: error instanceof Error ? error.message : "Failed to start session"
        });
      }
    },

    stopSession: async () => {
      const sessionId = get().activeSessionId;
      if (!sessionId) {
        return;
      }

      set({ loading: true, error: null });
      try {
        const response = await api.stopSession(sessionId);
        set({ activeSessionState: response.state, loading: false });
      } catch (error) {
        set({
          loading: false,
          activeSessionState: "error",
          error: error instanceof Error ? error.message : "Failed to stop session"
        });
      }
    },

    panicSession: async () => {
      const sessionId = get().activeSessionId;
      if (!sessionId) {
        return;
      }

      set({ loading: true, error: null });
      try {
        await api.panicSession(sessionId);
        set({ loading: false });
      } catch (error) {
        set({
          loading: false,
          error: error instanceof Error ? error.message : "Failed to send panic"
        });
      }
    },

    bindMidiInput: async (midiInput: string) => {
      const sessionId = get().activeSessionId;
      if (!sessionId) {
        set({ activeMidiInput: midiInput });
        return;
      }

      set({ loading: true, error: null });
      try {
        const session = await api.bindMidiInput(sessionId, midiInput);
        set({
          activeSessionState: session.state,
          activeMidiInput: session.midi_input ?? midiInput,
          loading: false
        });
      } catch (error) {
        set({
          loading: false,
          error: error instanceof Error ? error.message : "Failed to bind MIDI input"
        });
      }
    },

    pushEvent: (event: SessionEvent) => {
      const events = get().events;
      set({ events: [...events.slice(-199), event] });
    }
  };
});

async function flushPersistedAppState(): Promise<void> {
  if (persistInFlight) {
    return;
  }

  const snapshot = pendingPersistSnapshot;
  if (!snapshot) {
    return;
  }

  pendingPersistSnapshot = null;
  const signature = JSON.stringify(snapshot);
  if (signature === lastPersistedSignature) {
    return;
  }

  persistInFlight = true;
  try {
    await api.saveAppState(snapshot);
    lastPersistedSignature = signature;
  } catch {
    // Retry failed saves when the next state change occurs.
    pendingPersistSnapshot = snapshot;
  } finally {
    persistInFlight = false;
    if (pendingPersistSnapshot) {
      if (persistTimer !== null) {
        clearTimeout(persistTimer);
      }
      persistTimer = setTimeout(() => {
        persistTimer = null;
        void flushPersistedAppState();
      }, APP_STATE_PERSIST_DEBOUNCE_MS);
    }
  }
}

function schedulePersistedAppState(snapshot: PersistedAppState): void {
  pendingPersistSnapshot = snapshot;
  if (persistTimer !== null) {
    clearTimeout(persistTimer);
  }
  persistTimer = setTimeout(() => {
    persistTimer = null;
    void flushPersistedAppState();
  }, APP_STATE_PERSIST_DEBOUNCE_MS);
}

useAppStore.subscribe((state) => {
  if (!state.hasLoadedBootstrap) {
    return;
  }

  const watchState = capturePersistWatchState(state);
  if (!hasPersistableStateChange(watchState, lastPersistWatchState)) {
    return;
  }
  if (isSequencerRuntimeOnlyUpdate(watchState, lastPersistWatchState)) {
    // Runtime transport ticks should not trigger full persisted snapshot rebuilds.
    // Sequencer edits made while running are still captured on the next non-runtime transition (e.g. stop).
    return;
  }

  const snapshot = buildPersistedAppStateSnapshot(state);
  lastPersistWatchState = watchState;

  schedulePersistedAppState(snapshot);
});
