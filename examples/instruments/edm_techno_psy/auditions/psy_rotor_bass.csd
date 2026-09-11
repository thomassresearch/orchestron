<CsoundSynthesizer>
<CsOptions>
-d -m0
</CsOptions>
<CsInstruments>
sr = 48000
ksmps = 64
nchnls = 2
0dbfs = 1.0

massign 0, 0
massign 1, 1

chnset 0.10000000000000001, "__vcs_perf_51adc2b880646bc567885093a38b9005786015257de28ae91c8a0db01d35e764"
chnset 1.8, "__vcs_perf_e6a310e57ea88db64265830add76c7f3f19b43270542640faec7ba07d6c5f9e6"
chnset 350, "__vcs_perf_0a127deacaa4a3410bf4da2b92dd88501e57e2198900044b4fdebc856ac3ae3f"

; patch:5942b618-6c1b-4de9-a4f7-c6325a5d03e0 name:__patch_cli_preflight__ Psy Rotor Bass channel:1 always_on:false
instr 1
  ; node:env_attack_const opcode:const_i
  i_env_attack_const_iout_4 = 0.002
  ; node:env_release_const opcode:const_i
  i_env_release_const_iout_6 = 0.012
  ; node:env_sustain_const opcode:const_i
  i_env_sustain_const_iout_5 = 0.0
  ; node:pitch_cpsmidi opcode:cpsmidi
  i_pitch_cpsmidi_kfreq_1 cpsmidi
  i_rotor_decay_iout_7 chnget "__vcs_perf_51adc2b880646bc567885093a38b9005786015257de28ae91c8a0db01d35e764"
  i_rotor_drive_iout_9 chnget "__vcs_perf_e6a310e57ea88db64265830add76c7f3f19b43270542640faec7ba07d6c5f9e6"
  i_rotor_tone_iout_8 chnget "__vcs_perf_0a127deacaa4a3410bf4da2b92dd88501e57e2198900044b4fdebc856ac3ae3f"
  ; node:saw_gain opcode:const_k
  k_saw_gain_kout_3 = 0.65
  ; node:velocity_scale_const opcode:const_i
  i_velocity_scale_const_iout_2 = 1.0
  ; node:amp_madsr opcode:madsr
  k_amp_madsr_kenv_1 madsr i_env_attack_const_iout_4, i_rotor_decay_iout_7, i_env_sustain_const_iout_5, i_env_release_const_iout_6, 0, -1
  ; node:velocity_ampmidi opcode:ampmidi
  i_velocity_ampmidi_iamp_3 ampmidi i_velocity_scale_const_iout_2
  ; node:amp_velocity_envelope opcode:k_mul
  k_amp_velocity_envelope_kout_2 = (i_velocity_ampmidi_iamp_3) * (k_amp_madsr_kenv_1)
  ; node:saw_amp opcode:k_mul
  k_saw_amp_kout_4 = (k_amp_velocity_envelope_kout_2) * (k_saw_gain_kout_3)
  ; node:saw_vco2 opcode:vco2
  a_saw_vco2_asig_1 vco2 k_saw_amp_kout_4, i_pitch_cpsmidi_kfreq_1, 0, 0.5, 0, 0.5
  ; node:effect_1_distort1 opcode:distort1
  a_effect_1_distort1_aout_2 distort1 a_saw_vco2_asig_1, i_rotor_drive_iout_9, 0.42, 0, 0, 1
  ; node:effect_2_moogladder2 opcode:moogladder2
  a_effect_2_moogladder2_aout_3 moogladder2 a_effect_1_distort1_aout_2, (i_rotor_tone_iout_8 + ((3500 * k_amp_madsr_kenv_1) * k_amp_madsr_kenv_1)), 0.16
  ; node:output_pan2 opcode:pan2
  a_output_pan2_aleft_4, a_output_pan2_aright_5 pan2 (a_effect_2_moogladder2_aout_3 * 0.85), 0.5, 0
  ; node:output_left opcode:outleta
  outleta "left", a_output_pan2_aleft_4
  ; node:output_right opcode:outleta
  outleta "right", a_output_pan2_aright_5
endin

connect 1, "left", 999, "left"
connect 1, "right", 999, "right"
alwayson 999

instr 999
aLeft inleta "left"
aRight inleta "right"
outs aLeft, aRight
endin

</CsInstruments>
<CsScore>
f 1 0 16384 10 1
f 0 7.943260869565218
e
</CsScore>
</CsoundSynthesizer>