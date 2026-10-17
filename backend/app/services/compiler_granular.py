"""Bounded, instance-local stereo capture/playback primitives.

The ring always records, including while the snapshot is frozen. Table copies
occur only on capture edges; ftgentmp releases all four tables with the instance.
"""

from backend.app.services.compiler_common import PatchInstrumentTarget


def granular_header(targets: list[PatchInstrumentTarget]) -> list[str]:
    if any(n.opcode == 'stereo_capture' for t in targets for n in t.patch.graph.nodes):
        return [CAPTURE_OPCODES]
    return []


CAPTURE_OPCODES = r"""opcode vcs_capture_read, k, kii
 kIndex, iTable, iSize xin
 kIndex = kIndex - floor(kIndex / iSize) * iSize
 kBase = int(kIndex)
 kNext = (kBase + 1) % iSize
 kA table kBase, iTable
 kB table kNext, iTable
 xout kA + (kB - kA) * (kIndex - kBase)
endop

opcode vcs_stereo_capture, aa, aakkkkiiiiiii
 setksmps 1
 aL, aR, kStutterIn, kFreezeIn, kCaptureIn, kGranularIn, iSliceIn, iGrainIn, iDensityIn, iPitchIn, iSpreadIn, iMixIn, iGainIn xin
 iSize = int(sr * 2)
 iLiveL ftgentmp 0, 0, -iSize, -2, 0
 iLiveR ftgentmp 0, 0, -iSize, -2, 0
 iHoldL ftgentmp 0, 0, -iSize, -2, 0
 iHoldR ftgentmp 0, 0, -iSize, -2, 0
 iSlice = int(limit(iSliceIn, .02, 1) * sr)
 iGrain = int(limit(iGrainIn, .005, .2) * sr)
 iDensity = limit(iDensityIn, 1, 80)
 iRatio = pow(2, limit(iPitchIn, -24, 24) / 12)
 iSpread = limit(iSpreadIn, 0, 1)
 iMix = limit(iMixIn, 0, 1)
 iGain = ampdb(limit(iGainIn, -24, 0))
 iFade = max(1, int(.005 * sr))
 iSeam = min(iFade, int(iSlice / 4))
 ; Capture an extra seam so the requested slice remains the repeat period.
 iSlice = iSlice + iSeam
 kWrite init 0
 kStart init 0
 kPhase init 0
 kPrevS init 0
 kPrevF init 0
 kPrevC init 0
 kPrevG init 0
 kPrevActive init 0
 kLastL init 0
 kLastR init 0
 kFromL init 0
 kFromR init 0
 kTransition init 1
 kClock init 0
 kSlot init 0
 kRandom init .1234567
 kAge[] init 16
 kPosition[] init 16
 kOrigin[] init 16
 kHeld[] init 16
 kAlive[] init 16
 kL downsamp aL
 kR downsamp aR
 ; Capture excludes the current sample, matching "most recent history".
 kS = (kStutterIn >= 64 ? 1 : 0)
 kF = (kFreezeIn >= 64 ? 1 : 0)
 kC = (kCaptureIn >= 64 ? 1 : 0)
 kG = (kGranularIn >= 64 ? 1 : 0)
 kActive = max(kS, max(kF, kG))
 kCapture = ((kC > kPrevC || kF > kPrevF || (kS > kPrevS && kF == 0)) ? 1 : 0)
 if kCapture == 1 then
  tablecopy iHoldL, iLiveL
  tablecopy iHoldR, iLiveR
  kStart = kWrite - iSlice
  kPhase = 0
 endif
 if kCapture == 1 || kG != kPrevG || kActive != kPrevActive || kF != kPrevF || kS != kPrevS then
  kFromL = kLastL
  kFromR = kLastR
  kTransition = 0
  kClock = 0
  kSlot = 0
  kClear = 0
  while kClear < 16 do
   kAlive[kClear] = 0
   kClear += 1
  od
 endif
 tablew kL, kWrite, iLiveL
 tablew kR, kWrite, iLiveR
 kWetL = 0
 kWetR = 0
 if kG == 0 && kActive == 1 then
  kWetL vcs_capture_read kStart + kPhase, iHoldL, iSize
  kWetR vcs_capture_read kStart + kPhase, iHoldR, iSize
  if kPhase >= iSlice - iSeam then
   kBlend = (kPhase - (iSlice - iSeam)) / iSeam
   kHeadL vcs_capture_read kStart + kPhase - (iSlice - iSeam), iHoldL, iSize
   kHeadR vcs_capture_read kStart + kPhase - (iSlice - iSeam), iHoldR, iSize
   kWetL = kWetL * (1 - kBlend) + kHeadL * kBlend
   kWetR = kWetR * (1 - kBlend) + kHeadR * kBlend
  endif
  kPhase += 1
  if kPhase >= iSlice then
   kPhase = iSeam
  endif
 elseif kG == 1 then
  if kClock <= 0 then
   kAlive[kSlot] = 1
   kAge[kSlot] = 0
   ; Private deterministic PRNG: never reseed other instruments.
   kRandom = frac(kRandom * 16807 + .314159265)
   kPosition[kSlot] = kRandom * iSpread * iSlice
   kHeld[kSlot] = max(kS, kF)
   kOrigin[kSlot] = (kHeld[kSlot] == 1 ? kStart : kWrite - iSlice)
   kSlot = (kSlot + 1) % 16
   kClock += sr / iDensity
  endif
  kClock -= 1
  kVoice = 0
  kWeight = 0
  while kVoice < 16 do
   if kAlive[kVoice] == 1 then
    kWindow = .5 - .5 * cos(2 * $M_PI * kAge[kVoice] / iGrain)
    kIndex = kOrigin[kVoice] + kPosition[kVoice]
    ; Both branches have independent Csound opcode state; table numbers are i-rate.
    if kHeld[kVoice] == 1 then
     kSampleL vcs_capture_read kIndex, iHoldL, iSize
     kSampleR vcs_capture_read kIndex, iHoldR, iSize
    else
     kSampleL vcs_capture_read kIndex, iLiveL, iSize
     kSampleR vcs_capture_read kIndex, iLiveR, iSize
    endif
    kWetL += kSampleL * kWindow
    kWetR += kSampleR * kWindow
    kWeight += kWindow
    if kPosition[kVoice] >= iSlice - iSeam then
     kBlend = (kPosition[kVoice] - (iSlice - iSeam)) / iSeam
     kHeadIndex = kOrigin[kVoice] + kPosition[kVoice] - (iSlice - iSeam)
     if kHeld[kVoice] == 1 then
      kHeadL vcs_capture_read kHeadIndex, iHoldL, iSize
      kHeadR vcs_capture_read kHeadIndex, iHoldR, iSize
     else
      kHeadL vcs_capture_read kHeadIndex, iLiveL, iSize
      kHeadR vcs_capture_read kHeadIndex, iLiveR, iSize
     endif
     ; Replace the already accumulated sample with its seam crossfade.
     kWetL += (kHeadL - kSampleL) * kBlend * kWindow
     kWetR += (kHeadR - kSampleR) * kBlend * kWindow
    endif
    kPosition[kVoice] = kPosition[kVoice] + iRatio
    if kPosition[kVoice] >= iSlice then
     kPosition[kVoice] = iSeam + (kPosition[kVoice] - iSlice)
    endif
    kAge[kVoice] = kAge[kVoice] + 1
    if kAge[kVoice] >= iGrain then
     kAlive[kVoice] = 0
    endif
   endif
   kVoice += 1
  od
  ; Bounded gain even at the maximum sixteen overlapping grains.
  kWetL /= max(1, kWeight)
  kWetR /= max(1, kWeight)
 endif
 kTargetL = (kActive == 1 ? kL * (1 - iMix) + kWetL * iMix : kL)
 kTargetR = (kActive == 1 ? kR * (1 - iMix) + kWetR * iMix : kR)
 kTransition = min(1, kTransition + 1 / iFade)
 kLastL = kFromL * (1 - kTransition) + kTargetL * kTransition
 kLastR = kFromR * (1 - kTransition) + kTargetR * kTransition
 if iMix == 0 then
  kLastL = kL
  kLastR = kR
 endif
 aOutL = kLastL * iGain
 aOutR = kLastR * iGain
 kWrite = (kWrite + 1) % iSize
 kPrevS = kS
 kPrevF = kF
 kPrevC = kC
 kPrevG = kG
 kPrevActive = kActive
 xout aOutL, aOutR
endop"""
