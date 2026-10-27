<CsoundSynthesizer>
<CsOptions>
-n -d -m0
</CsOptions>
<CsInstruments>
sr = 48000
ksmps = 1
nchnls = 2
0dbfs = 1
massign 0, 0
massign 1, 1
instr 1
 kGain chnget "gain"
 kValue ctrl7 1, 74, 0.25, 0.5
 aSignal = kValue * kGain
 outs aSignal, -aSignal
endin
</CsInstruments>
<CsScore>
f 0 3600
</CsScore>
</CsoundSynthesizer>
