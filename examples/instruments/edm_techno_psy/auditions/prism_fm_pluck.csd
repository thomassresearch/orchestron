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

chnset 1.2, "__vcs_perf_a84cfb34121a8673e3e7ddca161923d21a66b35192bcff05adc250e99a3f4a8d"
chnset 0.34999999999999998, "__vcs_perf_ec244b40d6601a5bcd01000c01a324ee2921aedeb2604ee5d165b3be415b31c8"
chnset 0.14999999999999999, "__vcs_perf_9ae840821e7a0fa87cf13a400261f925e6e26ebdacda538615bc1a8398877065"

; patch:775093a8-f979-4aba-b88e-e3b4fdd37534 name:__patch_cli_preflight__ Prism FM Pluck channel:1 always_on:false
instr 1
  ; node:env_attack_const opcode:const_i
  i_env_attack_const_iout_4 = 0.002
  ; node:env_sustain_const opcode:const_i
  i_env_sustain_const_iout_5 = 0.0
  ; node:fm_gain opcode:const_k
  k_fm_gain_kout_3 = 0.25
  ; node:pitch_cpsmidi opcode:cpsmidi
  i_pitch_cpsmidi_kfreq_1 cpsmidi
  i_prism_color_iout_6 chnget "__vcs_perf_a84cfb34121a8673e3e7ddca161923d21a66b35192bcff05adc250e99a3f4a8d"
  i_prism_decay_iout_7 chnget "__vcs_perf_ec244b40d6601a5bcd01000c01a324ee2921aedeb2604ee5d165b3be415b31c8"
  i_prism_release_iout_8 chnget "__vcs_perf_9ae840821e7a0fa87cf13a400261f925e6e26ebdacda538615bc1a8398877065"
  ; node:velocity_scale_const opcode:const_i
  i_velocity_scale_const_iout_2 = 1.0
  ; node:amp_madsr opcode:madsr
  k_amp_madsr_kenv_1 madsr i_env_attack_const_iout_4, i_prism_decay_iout_7, i_env_sustain_const_iout_5, i_prism_release_iout_8, 0, -1
  ; node:velocity_ampmidi opcode:ampmidi
  i_velocity_ampmidi_iamp_3 ampmidi i_velocity_scale_const_iout_2
  ; node:amp_velocity_envelope opcode:k_mul
  k_amp_velocity_envelope_kout_2 = (i_velocity_ampmidi_iamp_3) * (k_amp_madsr_kenv_1)
  ; node:fm_amp opcode:k_mul
  k_fm_amp_kout_4 = (k_amp_velocity_envelope_kout_2) * (k_fm_gain_kout_3)
  ; node:fm_foscili opcode:foscili
  a_fm_foscili_asig_1 foscili k_fm_amp_kout_4, i_pitch_cpsmidi_kfreq_1, 1, 3, (0.5 * (((((i_prism_color_iout_6 * ((0.12 + (0.88 * k_amp_madsr_kenv_1))))) + ((0.5 * (((((((((0.42 * sr) / i_pitch_cpsmidi_kfreq_1) - 1)) / 3) - 1)) + abs((((((((0.42 * sr) / i_pitch_cpsmidi_kfreq_1) - 1)) / 3) - 1)))))))) - abs((((i_prism_color_iout_6 * ((0.12 + (0.88 * k_amp_madsr_kenv_1))))) - ((0.5 * (((((((((0.42 * sr) / i_pitch_cpsmidi_kfreq_1) - 1)) / 3) - 1)) + abs((((((((0.42 * sr) / i_pitch_cpsmidi_kfreq_1) - 1)) / 3) - 1)))))))))))), 1, 0
  ; node:effect_1_butterhp opcode:butterhp
  a_effect_1_butterhp_aout_2 butterhp a_fm_foscili_asig_1, 100, 0
  ; node:effect_2_butterlp opcode:butterlp
  a_effect_2_butterlp_aout_3 butterlp a_effect_1_butterhp_aout_2, 10000, 0
  ; node:output_pan2 opcode:pan2
  a_output_pan2_aleft_4, a_output_pan2_aright_5 pan2 (a_effect_2_butterlp_aout_3 * 0.85), 0.5, 0
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
f 0 7.530434782608696
e
</CsScore>
</CsoundSynthesizer>