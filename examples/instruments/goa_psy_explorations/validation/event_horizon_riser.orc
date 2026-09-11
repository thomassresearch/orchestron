sr = 48000
ksmps = 64
nchnls = 2
0dbfs = 1.0

massign 0, 0
massign 1, 1

chnset 2.3999999999999999, "__vcs_perf_5c9431c3322bf4f1bff0fcb438a50c6173f0fd7711caedf2fcbc62efb7722bcd"
chnset 0.71999999999999997, "__vcs_perf_1eb6be4d4b651bad0cd546a59fe47a4c5620747d4f1e85a50edb86833686cd93"
chnset 0.59999999999999998, "__vcs_perf_c9b37f73b3e4f3ef5ee9be032eea4c5f8cd77f31b8d604a813dea2715a5b46d2"

; patch:706461e4-3a3d-426a-af4a-934514da4ae2 name:__patch_cli_preflight__ Event Horizon Riser channel:1 always_on:false
instr 1
  ; node:air_gain opcode:const_k
  k_air_gain_kout_5 = 0.13
  ; node:env_decay_const opcode:const_i
  i_env_decay_const_iout_4 = 0.3
  ; node:env_release_const opcode:const_i
  i_env_release_const_iout_6 = 0.18
  ; node:env_release_time_const opcode:const_i
  i_env_release_time_const_iout_7 = 0.18
  ; node:env_sustain_const opcode:const_i
  i_env_sustain_const_iout_5 = 0.85
  ; node:fx_tail_guard opcode:linsegr
  k_fx_tail_guard_kenv_10 linsegr 1, 0.001, 1, 7.2, 0
  i_horizon_rise_iout_8 chnget "__vcs_perf_5c9431c3322bf4f1bff0fcb438a50c6173f0fd7711caedf2fcbc62efb7722bcd"
  i_horizon_space_iout_10 chnget "__vcs_perf_1eb6be4d4b651bad0cd546a59fe47a4c5620747d4f1e85a50edb86833686cd93"
  i_horizon_tension_iout_9 chnget "__vcs_perf_c9b37f73b3e4f3ef5ee9be032eea4c5f8cd77f31b8d604a813dea2715a5b46d2"
  ; node:orbit_pan_lfo opcode:lfo
  k_orbit_pan_lfo_kout_11 lfo 1, 0.37, 0
  ; node:pitch_cpsmidi opcode:cpsmidi
  i_pitch_cpsmidi_kfreq_1 cpsmidi
  ; node:velocity_scale_const opcode:const_i
  i_velocity_scale_const_iout_2 = 1.0
  ; node:voice_gain opcode:const_k
  k_voice_gain_kout_3 = 0.14
  ; node:tail_audio opcode:k_to_a
  a_tail_audio_aout_17 interp k_fx_tail_guard_kenv_10
  ; node:amp_madsr opcode:madsr
  k_amp_madsr_kenv_1 madsr i_horizon_rise_iout_8, i_env_decay_const_iout_4, i_env_sustain_const_iout_5, i_env_release_const_iout_6, 0, i_env_release_time_const_iout_7
  ; node:rise_ramp opcode:linseg
  k_rise_ramp_kenv_7 linseg 0, i_horizon_rise_iout_8, 1
  ; node:space_amount opcode:k_mul
  k_space_amount_kout_9 = (i_horizon_space_iout_10) * (1)
  ; node:velocity_ampmidi opcode:ampmidi
  i_velocity_ampmidi_iamp_3 ampmidi i_velocity_scale_const_iout_2
  ; node:voice_pitch opcode:k_mul
  k_voice_pitch_kout_8 = ((i_pitch_cpsmidi_kfreq_1 * ((0.5 + (((1 + (2.5 * i_horizon_tension_iout_9))) * k_rise_ramp_kenv_7))))) * (1)
  ; node:space_audio opcode:k_to_a
  a_space_audio_aout_8 interp k_space_amount_kout_9
  ; node:amp_velocity_envelope opcode:k_mul
  k_amp_velocity_envelope_kout_2 = (i_velocity_ampmidi_iamp_3) * (k_amp_madsr_kenv_1)
  ; node:voice_amp opcode:k_mul
  k_voice_amp_kout_4 = (k_amp_velocity_envelope_kout_2) * (k_voice_gain_kout_3)
  ; node:air_amp opcode:k_mul
  k_air_amp_kout_6 = (k_amp_velocity_envelope_kout_2) * (k_air_gain_kout_5)
  ; node:voice_foscili opcode:foscili
  a_voice_foscili_asig_1 foscili k_voice_amp_kout_4, (0.5 * (((k_voice_pitch_kout_8 + 12000) - abs((k_voice_pitch_kout_8 - 12000))))), 1, 2, (0.5 * (((((0.2 + ((6 * i_horizon_tension_iout_9) * k_rise_ramp_kenv_7))) + ((0.5 * (((((((((0.4 * sr) / ((0.5 * (((k_voice_pitch_kout_8 + 12000) - abs((k_voice_pitch_kout_8 - 12000))))))) - 1)) / 2) - 1)) + abs((((((((0.4 * sr) / ((0.5 * (((k_voice_pitch_kout_8 + 12000) - abs((k_voice_pitch_kout_8 - 12000))))))) - 1)) / 2) - 1)))))))) - abs((((0.2 + ((6 * i_horizon_tension_iout_9) * k_rise_ramp_kenv_7))) - ((0.5 * (((((((((0.4 * sr) / ((0.5 * (((k_voice_pitch_kout_8 + 12000) - abs((k_voice_pitch_kout_8 - 12000))))))) - 1)) / 2) - 1)) + abs((((((((0.4 * sr) / ((0.5 * (((k_voice_pitch_kout_8 + 12000) - abs((k_voice_pitch_kout_8 - 12000))))))) - 1)) / 2) - 1)))))))))))), 1, 0
  ; node:air_noise opcode:noise
  a_air_noise_aout_2 noise (k_air_amp_kout_6 * ((0.1 + (0.9 * i_horizon_tension_iout_9)))), 0.15
  ; node:layer_mix_1 opcode:mix2
  a_layer_mix_1_aout_3 = (a_voice_foscili_asig_1) + (a_air_noise_aout_2)
  ; node:effect_1_butterhp opcode:butterhp
  a_effect_1_butterhp_aout_4 butterhp a_layer_mix_1_aout_3, 200, 0
  ; node:effect_2_butterlp opcode:butterlp
  a_effect_2_butterlp_aout_5 butterlp a_effect_1_butterhp_aout_4, (700 + (k_rise_ramp_kenv_7 * ((2000 + (8000 * i_horizon_tension_iout_9))))), 0
  ; node:echo_filter opcode:butterlp
  a_echo_filter_aout_9 butterlp a_effect_2_butterlp_aout_5, 4200, 0
  ; node:echo_1 opcode:delay
  a_echo_1_aout_10 delay a_echo_filter_aout_9, 0.29, 0
  ; node:echo_2 opcode:delay
  a_echo_2_aout_11 delay a_echo_1_aout_10, 0.29, 0
  ; node:echo_3 opcode:delay
  a_echo_3_aout_12 delay a_echo_2_aout_11, 0.29, 0
  ; node:echo_4 opcode:delay
  a_echo_4_aout_13 delay a_echo_3_aout_12, 0.29, 0
  ; node:echo_sum opcode:mix2
  a_echo_sum_aout_14 = (((((0.62000000 * a_echo_1_aout_10) + (0.38440000 * a_echo_2_aout_11)) + (0.23832800 * a_echo_3_aout_12)) + (0.14776336 * a_echo_4_aout_13))) + (0)
  ; node:local_reverb opcode:reverb2
  a_local_reverb_aout_15 reverb2 ((0.45 * a_effect_2_butterlp_aout_5) + (0.55 * a_echo_sum_aout_14)), 3.2, 0.55, 0
  ; node:fx_mix opcode:mix2
  a_fx_mix_aout_16 = ((a_effect_2_butterlp_aout_5 + (a_space_audio_aout_8 * (((0.75 * a_echo_sum_aout_14) + (0.38 * a_local_reverb_aout_15)))))) + (0)
  ; node:output_pan2 opcode:pan2
  a_output_pan2_aleft_6, a_output_pan2_aright_7 pan2 ((0.58 * a_fx_mix_aout_16) * a_tail_audio_aout_17), (0.5 + (0.22 * k_orbit_pan_lfo_kout_11)), 0
  ; node:output_left opcode:outleta
  outleta "left", a_output_pan2_aleft_6
  ; node:output_right opcode:outleta
  outleta "right", a_output_pan2_aright_7
endin
