; One registry per compiled instrument. Each logical slot stores owner,
; released RMS (-1 while held), and the last control cycle it rendered.
; Grow only as notes arrive, even when maxalloc has a very large value.
gkDx7Slots_SCOPE[] init 3
gkDx7Serial_SCOPE init 0
opcode vcs_dx7_allocation_SCOPE, ak, ikk
 iLimit, kLevel, kDone xin
 ; Csound can grow arrays only at init time. Reserve at most one slot
 ; per live instrument instance, including simultaneous note starts.
 iActive active int(p1)
 iSize = 3 * min(iLimit, iActive+1)
 if iSize > lenarray:i(gkDx7Slots_SCOPE) then
  trim_i gkDx7Slots_SCOPE, iSize
 endif
 kSlot init -1
 kTicket init 0
 kNow timek
 kReleased release
 kLast lastcycle
 kStolenAge init 0
 kStop = kDone
 if iLimit > 0 then
  if kSlot < 0 then
   kSize = lenarray:k(gkDx7Slots_SCOPE)
   kOldest = 0
   kQuietest = -1
   kScan = 0
   while kScan < kSize do
    kOwner = gkDx7Slots_SCOPE[kScan]
    if kOwner == 0 || gkDx7Slots_SCOPE[kScan+2] < kNow-1 then
     kSlot = kScan
     kgoto claimed
    endif
    if gkDx7Slots_SCOPE[kScan+1] >= 0 then
     if kQuietest < 0 then
      kQuietest = kScan
     elseif gkDx7Slots_SCOPE[kScan+1] < gkDx7Slots_SCOPE[kQuietest+1] then
      kQuietest = kScan
     endif
    endif
    if kOwner < gkDx7Slots_SCOPE[kOldest] then
     kOldest = kScan
    endif
    kScan += 3
   od
   kSlot = (kQuietest >= 0 ? kQuietest : kOldest)
claimed:
   gkDx7Serial_SCOPE += 1
   kTicket = gkDx7Serial_SCOPE
   gkDx7Slots_SCOPE[kSlot] = kTicket
  endif
  if gkDx7Slots_SCOPE[kSlot] == kTicket then
   gkDx7Slots_SCOPE[kSlot+1] = (kReleased == 1 ? kLevel : -1)
   gkDx7Slots_SCOPE[kSlot+2] = kNow
   if kDone == 1 || kLast == 1 then
    gkDx7Slots_SCOPE[kSlot] = 0
   endif
  else
   ; The successor already owns the slot. Fade only this outgoing note.
   if kStolenAge >= 0.008 then
    kStop = 1
   endif
   kStolenAge += 1/kr
  endif
 endif
 aStolenAge interp kStolenAge
 aFade = limit(1 - aStolenAge/0.008, 0, 1)
 xout aFade, kStop
endop
