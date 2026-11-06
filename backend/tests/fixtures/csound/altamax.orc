; Independent dry reference from joel / ebmtranceboy's altamax:
; https://ide.csound.com/editor/pXPRc5Y1vALtxqgszdhI (retrieved 2026-11-06).
; Original synthesis, with sbus_mix replaced by outs and p5 used as output gain.
; The test harness supplies sample rate/block size and note frequency in p4.

instr 1 ; Enough
 icps = p4
 adx3 init 1
 adx2 linseg 9,0.1,6,0.5,2
 adxr linseg 1,2,0
 adx1 linseg 2,2,0
 ic3 = 20
 ic2 = 4
 icr = 9
 ir = 0.0001
 ic1 = 3
 kph3 init 0
 kph2 init 0
 kmodr init 0
 kphr init 0
 kph1 init 0
 kph init 0
 asig = 0
 knsamp = 0
 while knsamp < ksmps do
  kdx1 vaget knsamp, adx1
  kdx2 vaget knsamp, adx2
  kdx3 vaget knsamp, adx3
  kdxr vaget knsamp, adxr
  kph3 += ic3*icps/sr
  kmod3 tab (kph3+1)%1,-1,1
  kph2 += ic2*icps*(1+kdx3*kmod3)/sr
  kmod2 tab (kph2+1)%1,-1,1
  kfreqr = icr*icps*(1+ir*kmodr)
  kphr += kfreqr/sr
  kmodr tab (kphr+1)%1,-1,1
  kph1 += ic1*icps*(1+kdx2*kmod2+kdxr*kmodr)/sr
  kmod1 tab (kph1+1)%1,-1,1
  kfreq = icps*(1+kdx1*kmod1)
  kph += kfreq/sr
  ksig tab (kph+1)%1,-1,1
  vaset ksig,knsamp,asig
  knsamp += 1
 od
 aenv linsegr 1,0.2,0
 aout = aenv*asig/2*p5
 outs aout,aout
endin

instr 2 ; Logan
 awet linseg 0.93,5,0.03
 icps = p4
 imaster = 2*icps
 aphm phasor imaster
 aphm12 phasor imaster/2
 aenv12 = 2*aphm12-aphm
 alpha = 2-awet
 aphmod = 0.5-(aphm-0.5)
 afunc mirror alpha*aphmod,0,1
 aramp = alpha*((2-alpha)*aphmod-afunc)/(alpha-1)/2
 asaw = -aramp*(1/alpha-0.5)
 afunc4 limit (1+1/(1-awet))*aphm,0,1
 apick mirror 2*afunc4,0,1
 abuzine = apick*(0.5-(1-awet)/(2-awet))
 axone = aphm+abuzine
 au mirror 2*axone-0.5,-0.5,0.5
 aone = au*(4*au^2-3)
 axtwo = aphm+asaw
 av mirror 2*axtwo-0.5,-0.5,0.5
 atwo = av*(4*av^2-3)
 aout = (1-aenv12)*aone+aenv12*atwo
 again linsegr 0.06,0.5,0
 outs aout*again*p5,aout*again*p5
endin
