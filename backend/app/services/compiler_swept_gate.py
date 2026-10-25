"""Instance-local, sample-timed triangle gate with reversible frequency travel."""

from backend.app.services.compiler_common import PatchInstrumentTarget


def swept_gate_header(targets: list[PatchInstrumentTarget]) -> list[str]:
    if any(node.opcode == "swept_gate" for target in targets for node in target.patch.graph.nodes):
        return [SWEPT_GATE_OPCODE]
    return []


SWEPT_GATE_OPCODE = r"""opcode vcs_swept_gate, aa, kiiiik
 setksmps 1
 kCommand, iStartIn, iEndIn, iTimeIn, iThresholdIn, kManual xin
 iStart = limit(iStartIn, .1, 40)
 iEnd = limit(iEndIn, .1, 40)
 iSteps = max(1, round(limit(iTimeIn, .01, 60) * sr))
 iThreshold = limit(iThresholdIn, 0, 1)
 kOn init 0
 kPreviousOn init 0
 kTravel init 0
 kPhase init 0
 kPreviousManual init 0
 kPan init .5
 ; Each instance owns its noise stream and samples only a new manual opening.
 iSeed rnd 1
 kNoise rand 1, iSeed, 1
 kManualOn = (kManual > 0 ? 1 : 0)
 kSample = (kManualOn == 1 && kPreviousManual == 0 ? 1 : 0)
 kRandomPan samphold (kNoise + 1) * .5, kSample, .5
 kPreviousManual = kManualOn
 if kCommand == 127 then
  kOn = 1
 elseif kCommand == 0 then
  kOn = 0
 endif
 if kOn == 1 && kPreviousOn == 0 then
  kTravel = 0
  kPhase = 0
 endif
 kGate = 0
 if kOn == 1 || (kTravel > 0 && iStart != iEnd) then
  kTriangle = 1 - abs(2 * kPhase - 1)
  kPan = kTriangle
  kGate = (kTriangle > iThreshold ? 1 : 0)
  kNextTravel = limit(kTravel + (kOn == 1 ? 1 : -1), 0, iSteps)
  ; Integrate the linear frequency segment exactly over this sample interval.
  kFrequency = iStart + (iEnd - iStart) * (kTravel + kNextTravel) / (2 * iSteps)
  kPhase = frac(kPhase + kFrequency / sr)
  kTravel = kNextTravel
 else
  kTravel = 0
  if kManualOn == 1 then
   kPan = kRandomPan
  endif
 endif
 kPreviousOn = kOn
 aGate = kGate
 aPan = kPan
 xout aGate, aPan
endop"""
