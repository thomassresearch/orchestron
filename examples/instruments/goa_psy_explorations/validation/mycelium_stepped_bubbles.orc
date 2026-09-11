sr = 48000
ksmps = 64
nchnls = 2
0dbfs = 1.0

massign 0, 0
massign 1, 1

chnset 0.55000000000000004, "__vcs_perf_c68f92972a13f225cb841671bc6ba5cb9c895378e6c31178d933474051f4f671"
chnset 7, "__vcs_perf_e2a3c72120346e10db65b8529b6241458b9f4b358c02870942319b9706f34fdc"
chnset 0.5, "__vcs_perf_5a570d330480d4ba309cbc3375af626d052728bd8f68b14144ed4bf08cc2dc14"

; patch:a81813db-8a48-4bf6-9657-c7f6d5599f2b name:__patch_cli_preflight__ Mycelium Stepped Bubbles channel:1 always_on:false
instr 1
  ; node:env_attack_const opcode:const_i
  i_env_attack_const_iout_4 = 0.008
  ; node:env_decay_const opcode:const_i
  i_env_decay_const_iout_5 = 0.18
  ; node:env_release_const opcode:const_i
  i_env_release_const_iout_7 = 0.075
  ; node:env_release_time_const opcode:const_i
  i_env_release_time_const_iout_8 = 0.075
  ; node:env_sustain_const opcode:const_i
  i_env_sustain_const_iout_6 = 0.7
  ; node:fx_tail_guard opcode:linsegr
  k_fx_tail_guard_kenv_10 linsegr 1, 0.001, 1, 4.8, 0
  i_mycelium_mutation_iout_10 chnget "__vcs_perf_c68f92972a13f225cb841671bc6ba5cb9c895378e6c31178d933474051f4f671"
  i_mycelium_rate_iout_9 chnget "__vcs_perf_e2a3c72120346e10db65b8529b6241458b9f4b358c02870942319b9706f34fdc"
  i_mycelium_space_iout_11 chnget "__vcs_perf_5a570d330480d4ba309cbc3375af626d052728bd8f68b14144ed4bf08cc2dc14"
  ; node:orbit_pan_lfo opcode:lfo
  k_orbit_pan_lfo_kout_11 lfo 1, 0.37, 0
  ; node:pitch_cpsmidi opcode:cpsmidi
  i_pitch_cpsmidi_kfreq_1 cpsmidi
  ; node:velocity_scale_const opcode:const_i
  i_velocity_scale_const_iout_2 = 1.0
  ; node:voice_gain opcode:const_k
  k_voice_gain_kout_3 = 0.22
  ; node:amp_madsr opcode:madsr
  k_amp_madsr_kenv_1 madsr i_env_attack_const_iout_4, i_env_decay_const_iout_5, i_env_sustain_const_iout_6, i_env_release_const_iout_7, 0, i_env_release_time_const_iout_8
  ; node:tail_audio opcode:k_to_a
  a_tail_audio_aout_15 interp k_fx_tail_guard_kenv_10
  ; node:step_lfo_a opcode:lfo
  k_step_lfo_a_kout_5 lfo 1, i_mycelium_rate_iout_9, 0
  ; node:step_lfo_b opcode:lfo
  k_step_lfo_b_kout_6 lfo 1, (i_mycelium_rate_iout_9 * 0.731), 0
  ; node:space_amount opcode:k_mul
  k_space_amount_kout_9 = (i_mycelium_space_iout_11) * (1)
  ; node:velocity_ampmidi opcode:ampmidi
  i_velocity_ampmidi_iamp_3 ampmidi i_velocity_scale_const_iout_2
  ; node:stepped_value opcode:k_mul
  k_stepped_value_kout_7 = (floor(((((k_step_lfo_a_kout_5 + k_step_lfo_b_kout_6) + 2)) * 2))) * (1)
  ; node:space_audio opcode:k_to_a
  a_space_audio_aout_6 interp k_space_amount_kout_9
  ; node:amp_velocity_envelope opcode:k_mul
  k_amp_velocity_envelope_kout_2 = (i_velocity_ampmidi_iamp_3) * (k_amp_madsr_kenv_1)
  ; node:voice_pitch opcode:k_mul
  k_voice_pitch_kout_8 = ((i_pitch_cpsmidi_kfreq_1 * ((1 + (i_mycelium_mutation_iout_10 * (((k_stepped_value_kout_7 * 0.375) - 0.75))))))) * (1)
  ; node:voice_amp opcode:k_mul
  k_voice_amp_kout_4 = (k_amp_velocity_envelope_kout_2) * (k_voice_gain_kout_3)
  ; node:voice_foscili opcode:foscili
  a_voice_foscili_asig_1 foscili (k_voice_amp_kout_4 * ((0.25 + (0.75 * abs(k_step_lfo_a_kout_5))))), (0.5 * (((k_voice_pitch_kout_8 + 12000) - abs((k_voice_pitch_kout_8 - 12000))))), 1, 2.71, (0.5 * (((((0.5 + (2.5 * i_mycelium_mutation_iout_10))) + ((0.5 * (((((((((0.4 * sr) / ((0.5 * (((k_voice_pitch_kout_8 + 12000) - abs((k_voice_pitch_kout_8 - 12000))))))) - 1)) / 2.71) - 1)) + abs((((((((0.4 * sr) / ((0.5 * (((k_voice_pitch_kout_8 + 12000) - abs((k_voice_pitch_kout_8 - 12000))))))) - 1)) / 2.71) - 1)))))))) - abs((((0.5 + (2.5 * i_mycelium_mutation_iout_10))) - ((0.5 * (((((((((0.4 * sr) / ((0.5 * (((k_voice_pitch_kout_8 + 12000) - abs((k_voice_pitch_kout_8 - 12000))))))) - 1)) / 2.71) - 1)) + abs((((((((0.4 * sr) / ((0.5 * (((k_voice_pitch_kout_8 + 12000) - abs((k_voice_pitch_kout_8 - 12000))))))) - 1)) / 2.71) - 1)))))))))))), 1, 0
  ; node:effect_1_moogladder2 opcode:moogladder2
  a_effect_1_moogladder2_aout_2 moogladder2 a_voice_foscili_asig_1, (700 + (k_stepped_value_kout_7 * 600)), 0.28
  ; node:effect_2_butterhp opcode:butterhp
  a_effect_2_butterhp_aout_3 butterhp a_effect_1_moogladder2_aout_2, 100, 0
  ; node:echo_filter opcode:butterlp
  a_echo_filter_aout_7 butterlp a_effect_2_butterhp_aout_3, 4200, 0
  ; node:echo_1 opcode:delay
  a_echo_1_aout_8 delay a_echo_filter_aout_7, 0.21, 0
  ; node:echo_2 opcode:delay
  a_echo_2_aout_9 delay a_echo_1_aout_8, 0.21, 0
  ; node:echo_3 opcode:delay
  a_echo_3_aout_10 delay a_echo_2_aout_9, 0.21, 0
  ; node:echo_4 opcode:delay
  a_echo_4_aout_11 delay a_echo_3_aout_10, 0.21, 0
  ; node:echo_sum opcode:mix2
  a_echo_sum_aout_12 = (((((0.62000000 * a_echo_1_aout_8) + (0.38440000 * a_echo_2_aout_9)) + (0.23832800 * a_echo_3_aout_10)) + (0.14776336 * a_echo_4_aout_11))) + (0)
  ; node:local_reverb opcode:reverb2
  a_local_reverb_aout_13 reverb2 ((0.45 * a_effect_2_butterhp_aout_3) + (0.55 * a_echo_sum_aout_12)), 1.8, 0.55, 0
  ; node:fx_mix opcode:mix2
  a_fx_mix_aout_14 = ((a_effect_2_butterhp_aout_3 + (a_space_audio_aout_6 * (((0.75 * a_echo_sum_aout_12) + (0.38 * a_local_reverb_aout_13)))))) + (0)
  ; node:output_pan2 opcode:pan2
  a_output_pan2_aleft_4, a_output_pan2_aright_5 pan2 ((0.65 * a_fx_mix_aout_14) * a_tail_audio_aout_15), (0.5 + (0.22 * k_orbit_pan_lfo_kout_11)), 0
  ; node:output_left opcode:outleta
  outleta "left", a_output_pan2_aleft_4
  ; node:output_right opcode:outleta
  outleta "right", a_output_pan2_aright_5
endin
