"""Sample-local, voice-local physical string primitives shared by all emitters."""

from backend.app.services.compiler_common import PatchInstrumentTarget


def waveguide_header(targets: list[PatchInstrumentTarget]) -> list[str]:
    if any(n.opcode == "waveguide_string" for t in targets for n in t.patch.graph.nodes):
        return [WAVEGUIDE_OPCODES]
    return []


# All delay read/write pairs are contained in one UDO invocation. Neither graph
# topological order nor the parent instrument's ksmps can change their association.
WAVEGUIDE_OPCODES = r"""opcode vcs_wg_rail, aa, aiiiiiik
 setksmps 1
 aExc, iFreq, iDecay, iCutoff, iDisp, iObserve, iWeight, kGate xin
 iOmega = 2 * $M_PI * iFreq / sr
 iB = 2 - cos(2 * $M_PI * iCutoff / sr)
 iPole = iB - sqrt(iB * iB - 1)
 iAP1 = -.55 * iDisp
 iAP2 = -.25 * iDisp
 iLossPhase = taninv2(iPole * sin(iOmega), 1 - iPole * cos(iOmega))
 iPhase1 = 2 * taninv((1 - iAP1) / (1 + iAP1) * tan(iOmega / 2))
 iPhase2 = 2 * taninv((1 - iAP2) / (1 + iAP2) * tan(iOmega / 2))
 iDelay = max(1 / sr, (2 * $M_PI - iLossPhase - iPhase1 - iPhase2) / (2 * $M_PI * iFreq))
 iGain = min(.99995, exp(log(.001) / (iFreq * iDecay)))
 kLP init 0
 kX1 init 0
 kY1 init 0
 kX2 init 0
 kY2 init 0
 kLast init 0
 aBuffer delayr .1
 aLoop deltap3 iDelay
 aObserve deltap3 max(1 / sr, iDelay * iObserve)
 aOpposite deltap3 max(1 / sr, iDelay * (1 - iObserve))
 kInput downsamp aLoop
 kLP = (1 - iPole) * kInput + iPole * kLP
 kAP1 = iAP1 * kLP + kX1 - iAP1 * kY1
 kX1 = kLP
 kY1 = kAP1
 kAP2 = iAP2 * kAP1 + kX2 - iAP2 * kY2
 kX2 = kAP1
 kY2 = kAP2
 ; Unit slope at the origin; saturation cannot increase loop energy.
 aFeedback = tanh(.12 * kAP2) / .12 * iGain * (1 - .08 * (1 - limit(kGate, 0, 1)))
 delayw aExc * iWeight + aFeedback
 aMotion = (aObserve - aOpposite) * .5
 aBridge = (kInput - kLast) / max(.02, iOmega)
 kLast = kInput
 xout aMotion, aBridge
endop

opcode vcs_waveguide_string, aa, aiiiiiiiik
 setksmps 1
 aExc, iFreqIn, iDecayIn, iCutoffIn, iPluckIn, iObserveIn, iDispIn, iVariationIn, iSeedIn, kGate xin
 iFreq = limit(iFreqIn, 20, sr / 12)
 iDecay = limit(iDecayIn, .05, 30)
 iCutoff = limit(iCutoffIn, 100, sr * .45)
 iDisp = limit(iDispIn, 0, 1)
 iVariation = limit(iVariationIn, 0, 1)
 ; A private init-only PRNG: never call seed or reset the orchestra's RNG.
 iSeed = iSeedIn
 if iSeed == 0 then
  iSeed = 1 + int(rnd(2147483645))
 endif
 iR1 = frac(abs(iSeed) * .61803398875)
 iR2 = frac((iR1 + .314159265) * 16807)
 iR3 = frac((iR2 + .271828182) * 16807)
 iPluck = limit(iPluckIn + (iR1 - .5) * .025 * iVariation, .02, .48)
 iObserve = limit(iObserveIn, .02, .48)
 iContact = 1 + (iR2 - .5) * .10 * iVariation
 iEnergy = 1 + (iR3 - .5) * .08 * iVariation
 aContact butterlp aExc, min(sr * .45, iCutoff * iContact)
 aOffset vdelay3 aContact, 1000 * iPluck / iFreq, 100
 aDrive = (aContact - aOffset) * iEnergy
 ; Note-off damps both feedback loops; the parent madsr also gates the body.
 aOne, aBridgeOne vcs_wg_rail aDrive, iFreq, iDecay, iCutoff, iDisp, iObserve, .78, kGate
 aTwo, aBridgeTwo vcs_wg_rail aDrive, iFreq, iDecay * .72, iCutoff * .82, iDisp * .72, iObserve, .22, kGate
 aMotion dcblock2 (aOne + aTwo) * limit(kGate, 0, 1)
 aBridge dcblock2 (aBridgeOne + aBridgeTwo) * limit(kGate, 0, 1)
 xout aMotion, aBridge
endop"""
