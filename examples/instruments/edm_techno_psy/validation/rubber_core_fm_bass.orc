sr = 48000
ksmps = 64
nchnls = 2
0dbfs = 1.0

massign 0, 0
massign 1, 1

chnset 0.25, "__vcs_perf_1520b26cd0336ffa6067ea3d4d85924d2d393c78106e9ea4b1716d73783d53a0"
chnset 2, "__vcs_perf_84460b4c8e67fb21dbd2ac48ad7ecb7fa66f763cbd324896042cde15accab694"
chnset 900, "__vcs_perf_588750bd5d258d6125df58b50c043218badeee430b0bda9f7148f6ce89972aed"

; patch:e0d59839-4103-4f45-a0a5-769866e975e4 name:__patch_cli_preflight__ Rubber Core FM Bass channel:1 always_on:false
instr 1
  ; node:body_gain opcode:const_k
  k_body_gain_kout_5 = 0.14
  ; node:env_attack_const opcode:const_i
  i_env_attack_const_iout_4 = 0.003
  ; node:env_release_const opcode:const_i
  i_env_release_const_iout_6 = 0.05
  ; node:env_sustain_const opcode:const_i
  i_env_sustain_const_iout_5 = 0.15
  ; node:fm_gain opcode:const_k
  k_fm_gain_kout_3 = 0.24
  ; node:pitch_cpsmidi opcode:cpsmidi
  i_pitch_cpsmidi_kfreq_1 cpsmidi
  i_rubber_decay_iout_9 chnget "__vcs_perf_1520b26cd0336ffa6067ea3d4d85924d2d393c78106e9ea4b1716d73783d53a0"
  i_rubber_growl_iout_7 chnget "__vcs_perf_84460b4c8e67fb21dbd2ac48ad7ecb7fa66f763cbd324896042cde15accab694"
  i_rubber_tone_iout_8 chnget "__vcs_perf_588750bd5d258d6125df58b50c043218badeee430b0bda9f7148f6ce89972aed"
  ; node:velocity_scale_const opcode:const_i
  i_velocity_scale_const_iout_2 = 1.0
  ; node:amp_madsr opcode:madsr
  k_amp_madsr_kenv_1 madsr i_env_attack_const_iout_4, i_rubber_decay_iout_9, i_env_sustain_const_iout_5, i_env_release_const_iout_6, 0, -1
  ; node:velocity_ampmidi opcode:ampmidi
  i_velocity_ampmidi_iamp_3 ampmidi i_velocity_scale_const_iout_2
  ; node:amp_velocity_envelope opcode:k_mul
  k_amp_velocity_envelope_kout_2 = (i_velocity_ampmidi_iamp_3) * (k_amp_madsr_kenv_1)
  ; node:fm_amp opcode:k_mul
  k_fm_amp_kout_4 = (k_amp_velocity_envelope_kout_2) * (k_fm_gain_kout_3)
  ; node:body_amp opcode:k_mul
  k_body_amp_kout_6 = (k_amp_velocity_envelope_kout_2) * (k_body_gain_kout_5)
  ; node:fm_foscili opcode:foscili
  a_fm_foscili_asig_1 foscili k_fm_amp_kout_4, i_pitch_cpsmidi_kfreq_1, 1, 2, (0.5 * (((((i_rubber_growl_iout_7 * ((0.2 + (0.8 * k_amp_madsr_kenv_1))))) + ((0.5 * (((((((((0.42 * sr) / i_pitch_cpsmidi_kfreq_1) - 1)) / 2) - 1)) + abs((((((((0.42 * sr) / i_pitch_cpsmidi_kfreq_1) - 1)) / 2) - 1)))))))) - abs((((i_rubber_growl_iout_7 * ((0.2 + (0.8 * k_amp_madsr_kenv_1))))) - ((0.5 * (((((((((0.42 * sr) / i_pitch_cpsmidi_kfreq_1) - 1)) / 2) - 1)) + abs((((((((0.42 * sr) / i_pitch_cpsmidi_kfreq_1) - 1)) / 2) - 1)))))))))))), 1, 0
  ; node:body_oscili opcode:oscili
  a_body_oscili_asig_2 oscili k_body_amp_kout_6, i_pitch_cpsmidi_kfreq_1, 1
  ; node:layer_mix_1 opcode:mix2
  a_layer_mix_1_aout_3 = (a_fm_foscili_asig_1) + (a_body_oscili_asig_2)
  ; node:effect_1_moogladder2 opcode:moogladder2
  a_effect_1_moogladder2_aout_4 moogladder2 a_layer_mix_1_aout_3, (i_rubber_tone_iout_8 + ((1700 * k_amp_madsr_kenv_1) * k_amp_madsr_kenv_1)), 0.12
  ; node:output_pan2 opcode:pan2
  a_output_pan2_aleft_5, a_output_pan2_aright_6 pan2 (a_effect_1_moogladder2_aout_4 * 0.85), 0.5, 0
  ; node:output_left opcode:outleta
  outleta "left", a_output_pan2_aleft_5
  ; node:output_right opcode:outleta
  outleta "right", a_output_pan2_aright_6
endin
