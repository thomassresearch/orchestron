sr = 48000
ksmps = 64
nchnls = 2
0dbfs = 1.0

massign 0, 0
massign 1, 1

chnset 0.22, "__vcs_perf_af39c5d3f49c5fd4ee9d586a9cd8ce86582d880b53b2eed56c92bc6296b8776d"
chnset 2, "__vcs_perf_292e4573473940552e6e558acc151a55c8fdd542a325427b0a0c3ea5e10de6f8"
chnset 1100, "__vcs_perf_d7ed0252188d304dfc751bd8584842357ea87c2e1dd7683b3ef04b43ccd725b9"

; patch:c3901c12-f0e7-4036-afd4-2fdf28955482 name:__patch_cli_preflight__ Furnace Techno Stab channel:1 always_on:false
instr 1
  ; node:env_attack_const opcode:const_i
  i_env_attack_const_iout_4 = 0.003
  ; node:env_release_const opcode:const_i
  i_env_release_const_iout_6 = 0.08
  ; node:env_sustain_const opcode:const_i
  i_env_sustain_const_iout_5 = 0.0
  i_furnace_decay_iout_8 chnget "__vcs_perf_af39c5d3f49c5fd4ee9d586a9cd8ce86582d880b53b2eed56c92bc6296b8776d"
  i_furnace_drive_iout_9 chnget "__vcs_perf_292e4573473940552e6e558acc151a55c8fdd542a325427b0a0c3ea5e10de6f8"
  i_furnace_tone_iout_7 chnget "__vcs_perf_d7ed0252188d304dfc751bd8584842357ea87c2e1dd7683b3ef04b43ccd725b9"
  ; node:pitch_cpsmidi opcode:cpsmidi
  i_pitch_cpsmidi_kfreq_1 cpsmidi
  ; node:saw_gain opcode:const_k
  k_saw_gain_kout_3 = 0.45
  ; node:square_gain opcode:const_k
  k_square_gain_kout_5 = 0.3
  ; node:velocity_scale_const opcode:const_i
  i_velocity_scale_const_iout_2 = 1.0
  ; node:amp_madsr opcode:madsr
  k_amp_madsr_kenv_1 madsr i_env_attack_const_iout_4, i_furnace_decay_iout_8, i_env_sustain_const_iout_5, i_env_release_const_iout_6, 0, -1
  ; node:velocity_ampmidi opcode:ampmidi
  i_velocity_ampmidi_iamp_3 ampmidi i_velocity_scale_const_iout_2
  ; node:amp_velocity_envelope opcode:k_mul
  k_amp_velocity_envelope_kout_2 = (i_velocity_ampmidi_iamp_3) * (k_amp_madsr_kenv_1)
  ; node:saw_amp opcode:k_mul
  k_saw_amp_kout_4 = (k_amp_velocity_envelope_kout_2) * (k_saw_gain_kout_3)
  ; node:square_amp opcode:k_mul
  k_square_amp_kout_6 = (k_amp_velocity_envelope_kout_2) * (k_square_gain_kout_5)
  ; node:saw_vco2 opcode:vco2
  a_saw_vco2_asig_1 vco2 k_saw_amp_kout_4, i_pitch_cpsmidi_kfreq_1, 0, 0.5, 0, 0.5
  ; node:square_vco2 opcode:vco2
  a_square_vco2_asig_2 vco2 k_square_amp_kout_6, i_pitch_cpsmidi_kfreq_1, 2, 0.5, 0.25, 0.5
  ; node:layer_mix_1 opcode:mix2
  a_layer_mix_1_aout_3 = (a_saw_vco2_asig_1) + (a_square_vco2_asig_2)
  ; node:effect_1_distort1 opcode:distort1
  a_effect_1_distort1_aout_4 distort1 a_layer_mix_1_aout_3, i_furnace_drive_iout_9, 0.25, 0, 0, 1
  ; node:effect_2_moogladder2 opcode:moogladder2
  a_effect_2_moogladder2_aout_5 moogladder2 a_effect_1_distort1_aout_4, (i_furnace_tone_iout_7 * ((1 + k_amp_madsr_kenv_1))), 0.28
  ; node:effect_3_butterhp opcode:butterhp
  a_effect_3_butterhp_aout_6 butterhp a_effect_2_moogladder2_aout_5, 100, 0
  ; node:output_pan2 opcode:pan2
  a_output_pan2_aleft_7, a_output_pan2_aright_8 pan2 (a_effect_3_butterhp_aout_6 * 0.85), 0.5, 0
  ; node:output_left opcode:outleta
  outleta "left", a_output_pan2_aleft_7
  ; node:output_right opcode:outleta
  outleta "right", a_output_pan2_aright_8
endin
