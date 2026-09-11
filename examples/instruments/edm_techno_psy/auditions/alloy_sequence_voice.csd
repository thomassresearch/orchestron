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

chnset 3, "__vcs_perf_d6b8e921e75840c5f54411eed16832cead4e566be3758a56a7ca0165190ce72e"
chnset 0.14000000000000001, "__vcs_perf_b7c3b87069703ddb1cc9a89cf26bd761743a7722e0e584e15bfa598d82cb9ee5"
chnset 2.4140000000000001, "__vcs_perf_5edd83a73a85d81c48ceacb87e0bdd9052f519883b2de293e4923aee8df9c93c"

; patch:310b7da5-af68-44ea-8b07-06e61cd9fcd5 name:__patch_cli_preflight__ Alloy Sequence Voice channel:1 always_on:false
instr 1
  i_alloy_clang_iout_7 chnget "__vcs_perf_d6b8e921e75840c5f54411eed16832cead4e566be3758a56a7ca0165190ce72e"
  i_alloy_decay_iout_9 chnget "__vcs_perf_b7c3b87069703ddb1cc9a89cf26bd761743a7722e0e584e15bfa598d82cb9ee5"
  i_alloy_ratio_iout_8 chnget "__vcs_perf_5edd83a73a85d81c48ceacb87e0bdd9052f519883b2de293e4923aee8df9c93c"
  ; node:env_attack_const opcode:const_i
  i_env_attack_const_iout_4 = 0.001
  ; node:env_release_const opcode:const_i
  i_env_release_const_iout_6 = 0.04
  ; node:env_sustain_const opcode:const_i
  i_env_sustain_const_iout_5 = 0.0
  ; node:fm_gain opcode:const_k
  k_fm_gain_kout_3 = 0.24
  ; node:pitch_cpsmidi opcode:cpsmidi
  i_pitch_cpsmidi_kfreq_1 cpsmidi
  ; node:velocity_scale_const opcode:const_i
  i_velocity_scale_const_iout_2 = 1.0
  ; node:amp_madsr opcode:madsr
  k_amp_madsr_kenv_1 madsr i_env_attack_const_iout_4, i_alloy_decay_iout_9, i_env_sustain_const_iout_5, i_env_release_const_iout_6, 0, -1
  ; node:velocity_ampmidi opcode:ampmidi
  i_velocity_ampmidi_iamp_3 ampmidi i_velocity_scale_const_iout_2
  ; node:amp_velocity_envelope opcode:k_mul
  k_amp_velocity_envelope_kout_2 = (i_velocity_ampmidi_iamp_3) * (k_amp_madsr_kenv_1)
  ; node:fm_amp opcode:k_mul
  k_fm_amp_kout_4 = (k_amp_velocity_envelope_kout_2) * (k_fm_gain_kout_3)
  ; node:fm_foscili opcode:foscili
  a_fm_foscili_asig_1 foscili k_fm_amp_kout_4, i_pitch_cpsmidi_kfreq_1, 1, i_alloy_ratio_iout_8, (0.5 * (((((i_alloy_clang_iout_7 * ((0.4 + (0.6 * k_amp_madsr_kenv_1))))) + ((0.5 * (((((((((0.42 * sr) / i_pitch_cpsmidi_kfreq_1) - 1)) / i_alloy_ratio_iout_8) - 1)) + abs((((((((0.42 * sr) / i_pitch_cpsmidi_kfreq_1) - 1)) / i_alloy_ratio_iout_8) - 1)))))))) - abs((((i_alloy_clang_iout_7 * ((0.4 + (0.6 * k_amp_madsr_kenv_1))))) - ((0.5 * (((((((((0.42 * sr) / i_pitch_cpsmidi_kfreq_1) - 1)) / i_alloy_ratio_iout_8) - 1)) + abs((((((((0.42 * sr) / i_pitch_cpsmidi_kfreq_1) - 1)) / i_alloy_ratio_iout_8) - 1)))))))))))), 1, 0
  ; node:effect_1_butterhp opcode:butterhp
  a_effect_1_butterhp_aout_2 butterhp a_fm_foscili_asig_1, 220, 0
  ; node:effect_2_butterlp opcode:butterlp
  a_effect_2_butterlp_aout_3 butterlp a_effect_1_butterhp_aout_2, 9000, 0
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
f 0 6.430434782608695
e
</CsScore>
</CsoundSynthesizer>