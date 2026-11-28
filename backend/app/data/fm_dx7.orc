; Floating-point DX7 voice. Phase modulation is expressed in cycles.
; Envelope, tuning and scaling adapted from MSFA (Apache-2.0).
; Copyright 2012-2013 Google Inc. and 2016-2017 Pascal Gauthier.
; See tools/dx7/README.md for the calibration source and known approximations.
opcode vcs_dx7_level, i, i
 iValue xin
 if iValue < 20 then
  iLevel = giDx7_levellut[iValue]
 else
  iLevel = iValue + 28
 endif
 xout iLevel
endop

opcode vcs_dx7_operator, aaik, i[]iiikkkkki
 iV[], iO, iKey, iVel, kPitch, kBend, kAM, kRelease, kReleaseFloor, iStart xin
 iDiff = iKey - iV[iO+8] - 17
 iSide = (iDiff < 0 ? 0 : 1)
 iGroup = int((abs(iDiff)+1) / 3)
 iCurve = iV[iO+11+iSide]
 iDepth = iV[iO+9+iSide]
 iScale = (iCurve == 0 || iCurve == 3 ? int(iGroup*iDepth*329/4096) : int(giDx7_exp_scale_data[min(iGroup,32)]*iDepth*329/32768))
 iOut vcs_dx7_level iV[iO+16]
 iOut = min(127, iOut + (iCurve < 2 ? -iScale : iScale))*32
 iOut = max(0, iOut + 16*floor(((giDx7_velocity_data[int(iVel/2)]-239)*iV[iO+15]+7)/8))
 iRateScale = int(iV[iO+13] * limit(int(iKey/3)-7, 0, 31)/8)
 iTargets[] init 4
 iSpeeds[] init 4
 iHold[] init 4
 iLastAudibleStage = -1
 iStage = 0
 while iStage < 4 do
  iLevel vcs_dx7_level iV[iO+4+iStage]
  iTargets[iStage] = max(16, int(iLevel/2)*64 + iOut - 4256)/256
  if iTargets[iStage] > 16/256 then
   iLastAudibleStage = iStage
  endif
  iRate = min(63, int(iV[iO+iStage]*41/64) + iRateScale)
  iSpeeds[iStage] = (4 + iRate%4) * 2^(2+int(iRate/4)) * 44100/16777216
  iStaticRate = min(99, iV[iO+iStage]+iRateScale)
  iHold[iStage] = (iStaticRate < 77 ? giDx7_statics[min(iStaticRate,76)] : 20*(99-iStaticRate))/44100
  iStage += 1
 od
 iTail = max(0.006, max(iTargets[0],iTargets[1],iTargets[2],iTargets[3])/iSpeeds[3]+0.006)
 iHz = cpsmidinn(iKey)
 iFine = iV[iO+19]
 iCoarse = iV[iO+18]
 iDetune = iV[iO+20]-7
 iFixed = iV[iO+17]
 if iFixed == 1 then
  iHz = 10^(iCoarse%4+iFine/100)*2^(max(0,iDetune)*13457/16777216)
 else
  iLog = log(iHz)/log(2)
  iHz *= (iCoarse == 0 ? 0.5 : iCoarse)*(1+iFine/100)*2^(0.0209*exp(-0.396*iLog)*iLog*iDetune/7)
 endif
 iPhase = (iV[136] == 1 ? 0 : frac(iStart*iHz))
 aPhase phasor iHz * 2^(kBend/12 + (iFixed == 1 ? 0 : kPitch)), iPhase
 kStage init 0
 kValue init 0
 kWait init -1
 kReleased init 0
 if kRelease == 1 && kReleased == 0 then
  kStage = 3
  kWait = -1
  kReleased = 1
 endif
 if kStage < 3 || (kReleased == 1 && kStage == 3) then
  kTarget = iTargets[kStage]
  if kWait == -1 then
   kWait = (kTarget == kValue ? iHold[kStage] : 0)
   if kStage == 0 && iV[iO+4] == 0 then
    kWait = iHold[0]/20
   endif
  endif
  if kWait > 0 then
   kWait -= 1/kr
  else
   kStep = iSpeeds[kStage]/kr
   if kTarget > kValue then
    kValue = max(kValue, 1716/256)
    kValue = min(kTarget, kValue+kStep*max(1,floor(17-kValue)))
   else
    kValue = max(kTarget, kValue-kStep)
   endif
   if kValue == kTarget then
    kStage += 1
    kWait = -1
   endif
  endif
 endif
 iAMS[] fillarray 0, 0.259, 0.427, 1
 kAtten = (iV[iO+14] == 0 ? 0 : exp(12.2 + 4.48*kAM*iAMS[iV[iO+14]])/16777216)
 kAmp = 2^(kValue*(1-kAtten)-14)
 ; Start each carrier and modulator's release from its last held amplitude.
 ; A slower native release (including a rising L4) passes through untouched.
 kHeldAmp init 0
 if kRelease == 0 then
  kHeldAmp = kAmp
 else
  kAmp = max(kAmp, kHeldAmp*kReleaseFloor)
 endif
 aAmp interp kAmp
 ; A held percussive voice may finish before key-up. Include all future
 ; targets (especially L4), so a delayed attack or rising release survives.
 kSilent = (kValue <= 16/256 && (kStage > iLastAudibleStage || (kReleased == 1 && iTargets[3] <= 16/256)) ? 1 : 0)
 xout aPhase, aAmp, iTail, kSilent
endop

opcode fm_dx7, ak, iikii[]oo
 iNote, iVelocityIn, kBend, iGainDb, iEditorVoice[], iPresetIn, iMaxRelease xin
 iPreset = limit(round(iPresetIn), 0, lenarray(giDx7Presets))
 if iPreset == 0 then
  iVoice[] = iEditorVoice
 else
  iVoice[] getrow giDx7Presets, iPreset - 1
 endif
 iKey = limit(round(iNote),0,127) + iVoice[144]-24
 iVelocity = round(limit(iVelocityIn,0,1)*127)
 iGain = ampdb(limit(iGainDb,-90,0))/6
 iAlgorithm = iVoice[134]+1
 iFeedback = (iVoice[135] == 0 ? 0 : 2^(iVoice[135]-8))
 iStart times
 kSleeping init 0
 if kSleeping == 1 kgoto DX7_SILENT
 kGate release
 iEdgeRelease = 0.010
 kReleaseAge init 0
 kReleaseFloor = 0
 if kGate == 1 then
  kReleaseAge += 1/kr
  kRemaining = max(0, 1 - kReleaseAge/iEdgeRelease)
  kReleaseFloor = kRemaining*kRemaining*(3 - 2*kRemaining)
 endif
 iSpeed = max(1,int(iVoice[137]*165/64))
 iLfoHz = iSpeed*(11+max(0,int((iSpeed-160)/16)))*25190424/4294967296
 iLfoPhase = (iVoice[141] == 1 ? 0.5 : frac(iStart*iLfoHz))
 kPhase phasor iLfoHz, iLfoPhase
 if iVoice[142] == 0 then
  kLfo = 1 - abs(2*kPhase-1)
 elseif iVoice[142] == 1 then
  kLfo = 1-frac(kPhase+0.5)
 elseif iVoice[142] == 2 then
  kLfo = frac(kPhase+0.5)
 elseif iVoice[142] == 3 then
  kLfo = (kPhase < 0.5 ? 1 : 0)
 elseif iVoice[142] == 4 then
  kLfo = 0.5+0.5*sin(2*$M_PI*kPhase)
 else
  kAge timeinsts
  kCycle = floor(kAge*iLfoHz+(iVoice[141] == 1 ? 0.5 : iStart*iLfoHz))
  kHash = sin(kCycle*78.233+1.23)*43758.5453
  kLfo = kHash-floor(kHash)
 endif
 iD = 99-iVoice[138]
 iInc = (16+iD%16)*2^(1+int(iD/16))
 iWait = (iD == 99 ? 0 : 85.25/iInc)
 iRamp = (iD == 99 ? 0.000001 : 85.25/max(128,int(iInc/128)*128))
 kAge timeinsts
 kDepth = limit((kAge-iWait)/iRamp,0,1)
 iPMS[] fillarray 0,10,20,33,55,92,153,255
 kVibrato = (kLfo-0.5)*kDepth*int(iVoice[139]*165/64)*iPMS[iVoice[143]]/32768
 kAM = kDepth*(1-kLfo)*int(iVoice[140]*165/64)/256
 iPitch[] init 4
 iPitchSpeed[] init 4
 iIdx = 0
 while iIdx < 4 do
  iPitch[iIdx] = giDx7_pitchenv_tab[iVoice[130+iIdx]]/32
  iPitchSpeed[iIdx] = giDx7_pitchenv_rate[iVoice[126+iIdx]]/21.3
  iIdx += 1
 od
 kPitchEnv init iPitch[3]
 kStage init 0
 kOff init 0
 if kGate == 1 && kOff == 0 then
  kStage = 3
  kOff = 1
 endif
 if kStage < 3 || (kOff == 1 && kStage == 3) then
  kTarget = iPitch[kStage]
  kPitchEnv += limit(kTarget-kPitchEnv,-iPitchSpeed[kStage]/kr,iPitchSpeed[kStage]/kr)
  if kPitchEnv == kTarget then
   kStage += 1
  endif
 endif
 kPitch = kPitchEnv+kVibrato
