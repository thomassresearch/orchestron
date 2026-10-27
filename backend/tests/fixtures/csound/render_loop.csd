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
giSine ftgen 0, 0, 16384, 10, 1
instr 1
 iFrequency cpsmidi
 iAmplitude ampmidi 0.02
 kGain chnget "gain"
 kBrightness ctrl7 1, 74, 0.25, 1
 aEnvelope linsegr 0, 0.001, 1, 0.01, 0
 aTone poscil iAmplitude, iFrequency, giSine
 aSignal = aTone * aEnvelope * kGain * kBrightness
 outs aSignal, -aSignal
 kPeak downsamp abs(aSignal)
 chnset kPeak, "peak"
endin
</CsInstruments>
<CsScore>
f 0 3600
</CsScore>
</CsoundSynthesizer>
