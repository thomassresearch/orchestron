import {expect, it} from "vitest";
import {cartridgeNames, readDx7Banks} from "./dx7Banks";
import {performanceControllersForGraph} from "./performanceControllers";
import type {PatchListItem} from "../types";
import {authoredFormatVersions, buildSequencerConfigSnapshot, normalizeSessionInstrumentAssignments, parseSequencerConfigSnapshot} from "../store/appStoreModel";

it("restores independent cartridges and both DX7 selectors when importing a new patch", () => {
  const raw = new Uint8Array(4104);
  raw.set([240, 67, 0, 9, 32, 0]);
  raw.set(Array.from("Cartridge1", c => c.charCodeAt(0)), 124);
  raw[4102] = (-raw.slice(6,4102).reduce((sum,v) => sum + v, 0)) & 127;
  raw[4103] = 247;
  const bank = {name: "test.syx", data: btoa(String.fromCharCode(...raw))};
  const patch: PatchListItem = {always_on:false, instrument_type:"melody", audio_inlet_names:[], audio_outlet_names:[], id:"dx7", name:"DX7", description:"", is_template:false, schema_version:1, updated_at:"",
    performance_controllers:performanceControllersForGraph({nodes:[{id:"dx7",opcode:"fm_dx7",params:{},position:{x:0,y:0}}],
      connections:[],ui_layout:{}}, true)};
  const row = {id:"one", patchId:patch.id, midiChannel:1, dx7Banks:{"16":bank},
    performanceControllerValues:{__dx7_program:1, __dx7_bank:16}};
  const config = {version:29, instruments:[row, {id:"two", patchId:patch.id, midiChannel:2}], sequencer:{}};
  const {sequencer, instruments} = parseSequencerConfigSnapshot(config,[patch],null);
  expect(authoredFormatVersions(sequencer,instruments)).toEqual({performance:29,recovery:11});
  expect(buildSequencerConfigSnapshot(sequencer,instruments).instruments[0]).toMatchObject(row);
  const [one,two] = normalizeSessionInstrumentAssignments(instruments);
  expect(one.dx7_banks).toEqual(row.dx7Banks);
  expect(two.dx7_banks).toBeUndefined();
  expect(cartridgeNames(bank.data)[0]).toBe("Cartridge1");
  expect(() => readDx7Banks({"0":bank})).toThrow();
});
