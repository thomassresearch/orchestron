; Complete fm_dx7 after the generated carrier mix and envelope bounds.
iTail = max(iTail, iEdgeRelease + 0.005)
iLimit = (iMaxRelease <= 0 ? iTail : limit(iMaxRelease, 1, 120))
iDuration = min(iTail, iLimit)
iFade = (iLimit < iTail ? min(0.25, iDuration * 0.1) : 0.005)
; Csound rounds the lifetime to control blocks. Reserve the block in which
; the interpolated gain reaches zero, even with a coarse control interval.
xtratim iDuration + 1/kr

; Measure from this note's key-up. Other release extenders in the graph
; can keep the instrument alive, but cannot stretch this voice's fade.
kQuietAge init 0
; The operator amplitudes interpolate across the block that ends the taper.
if kSilent == 1 && (kGate == 0 || kReleaseAge >= iEdgeRelease + 1/kr) then
 kQuietAge += 1/kr
endif
aReleaseAge interp kReleaseAge
aQuietAge interp kQuietAge
aGain = limit((iDuration - aReleaseAge) / iFade, 0, 1)
if iLimit < iTail then
 aGain = aGain * aGain * (3 - 2 * aGain)
endif
aGain *= limit(1 - aQuietAge / 0.005, 0, 1)
; Let the last interpolated block reach zero before the caller retires.
kDone = (kReleaseAge >= iDuration + 1/kr || kQuietAge >= 0.005 + 1/kr ? 1 : 0)
; Apply the onset ramp after FM so the original modulation index is preserved.
aAttack linseg 0, 0.004, 1
aAttack = aAttack*aAttack*(3 - 2*aAttack)
aVoice = aMix * iGain * aGain * aAttack
kSleeping = kDone
kgoto DX7_OUTPUT
DX7_SILENT:
; Mixed instruments may still be rendering another source or effect tail.
aVoice = 0
kDone = 1
DX7_OUTPUT:
xout aVoice, kDone
endop

; Public signatures use the same voice in live, MIDI and SCORE orchestras.
opcode fm_dx7, ak, iikii[]o
 iKey, iVelocity, kBend, iGain, iVoice[], iMaxRelease xin
 aVoice, kDone vcs_dx7_voice iKey, iVelocity, kBend, iGain, iVoice, iMaxRelease
 xout aVoice, kDone
endop

opcode fm_dx7, a, iikii[]o
 iKey, iVelocity, kBend, iGain, iVoice[], iMaxRelease xin
 aVoice, kDone vcs_dx7_voice iKey, iVelocity, kBend, iGain, iVoice, iMaxRelease
 xout aVoice
endop
