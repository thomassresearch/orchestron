opcode vcs_mixer_ramp, a, ki
 setksmps 1
 kTarget, iInitial xin
 kValue init iInitial
 kPrevious init iInitial
 kRemaining init 0
 if kTarget != kPrevious then
  kRemaining = 0.02
  kPrevious = kTarget
 endif
 if kRemaining > 0 then
  kValue = kValue + (kTarget - kValue) / max(1, kRemaining * kr)
  kRemaining = max(0, kRemaining - 1 / kr)
 else
  kValue = kTarget
 endif
 aValue interp kValue
 if timeinstk() == 1 then
  aValue = iInitial
 endif
 xout aValue
endop
