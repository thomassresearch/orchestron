sr = 48000
ksmps = 64
nchnls = 2
0dbfs = 1.0

massign 0, 0
massign 1, 1

chnset 0.80000000000000004, "__vcs_perf_4739831dced7766d771405f7f51a5ba510e599d30d5abe4c3f7b5a078239ac55"
chnset 210, "__vcs_perf_d7882e462ed3d5c74e1db8f3022fed4017654a2e83143dca9740ea46619357c1"
chnset 0.65000000000000002, "__vcs_perf_958b24894ffa68a5c5ee098d3fc6e8de71176f9061fea3ce310d55d2e9b7015f"

; patch:8784df28-9bea-49b0-9a93-7b343b7abb25 name:__patch_cli_preflight__ Orbit FM Bleeps channel:1 always_on:false
instr 1
  ; node:env_attack_const opcode:const_i
  i_env_attack_const_iout_4 = 0.0015
  ; node:env_decay_const opcode:const_i
  i_env_decay_const_iout_5 = 0.075
  ; node:env_release_const opcode:const_i
  i_env_release_const_iout_7 = 0.025
  ; node:env_release_time_const opcode:const_i
  i_env_release_time_const_iout_8 = 0.025
  ; node:env_sustain_const opcode:const_i
  i_env_sustain_const_iout_6 = 0.0
  ; node:fx_tail_guard opcode:linsegr
  k_fx_tail_guard_kenv_7 linsegr 1, 0.001, 1, 4.6, 0
  i_orbit_chirp_iout_9 chnget "__vcs_perf_4739831dced7766d771405f7f51a5ba510e599d30d5abe4c3f7b5a078239ac55"
  i_orbit_delay_iout_10 chnget "__vcs_perf_d7882e462ed3d5c74e1db8f3022fed4017654a2e83143dca9740ea46619357c1"
  ; node:orbit_pan_lfo opcode:lfo
  k_orbit_pan_lfo_kout_8 lfo 1, 0.37, 0
  i_orbit_space_iout_11 chnget "__vcs_perf_958b24894ffa68a5c5ee098d3fc6e8de71176f9061fea3ce310d55d2e9b7015f"
  ; node:pitch_cpsmidi opcode:cpsmidi
  i_pitch_cpsmidi_kfreq_1 cpsmidi
  ; node:velocity_scale_const opcode:const_i
  i_velocity_scale_const_iout_2 = 1.0
  ; node:voice_gain opcode:const_k
  k_voice_gain_kout_3 = 0.24
  ; node:amp_madsr opcode:madsr
  k_amp_madsr_kenv_1 madsr i_env_attack_const_iout_4, i_env_decay_const_iout_5, i_env_sustain_const_iout_6, i_env_release_const_iout_7, 0, i_env_release_time_const_iout_8
  ; node:tail_audio opcode:k_to_a
  a_tail_audio_aout_17 interp k_fx_tail_guard_kenv_7
  ; node:space_amount opcode:k_mul
  k_space_amount_kout_6 = (i_orbit_space_iout_11) * (1)
  ; node:velocity_ampmidi opcode:ampmidi
  i_velocity_ampmidi_iamp_3 ampmidi i_velocity_scale_const_iout_2
  ; node:voice_pitch opcode:k_mul
  k_voice_pitch_kout_5 = ((i_pitch_cpsmidi_kfreq_1 * ((1 + ((i_orbit_chirp_iout_9 * k_amp_madsr_kenv_1) * k_amp_madsr_kenv_1))))) * (1)
  ; node:space_audio opcode:k_to_a
  a_space_audio_aout_6 interp k_space_amount_kout_6
  ; node:amp_velocity_envelope opcode:k_mul
  k_amp_velocity_envelope_kout_2 = (i_velocity_ampmidi_iamp_3) * (k_amp_madsr_kenv_1)
  ; node:voice_amp opcode:k_mul
  k_voice_amp_kout_4 = (k_amp_velocity_envelope_kout_2) * (k_voice_gain_kout_3)
  ; node:voice_foscili opcode:foscili
  a_voice_foscili_asig_1 foscili k_voice_amp_kout_4, (0.5 * (((k_voice_pitch_kout_5 + 12000) - abs((k_voice_pitch_kout_5 - 12000))))), 1, 1.414, (0.5 * (((((0.3 + (1.5 * k_amp_madsr_kenv_1))) + ((0.5 * (((((((((0.4 * sr) / ((0.5 * (((k_voice_pitch_kout_5 + 12000) - abs((k_voice_pitch_kout_5 - 12000))))))) - 1)) / 1.414) - 1)) + abs((((((((0.4 * sr) / ((0.5 * (((k_voice_pitch_kout_5 + 12000) - abs((k_voice_pitch_kout_5 - 12000))))))) - 1)) / 1.414) - 1)))))))) - abs((((0.3 + (1.5 * k_amp_madsr_kenv_1))) - ((0.5 * (((((((((0.4 * sr) / ((0.5 * (((k_voice_pitch_kout_5 + 12000) - abs((k_voice_pitch_kout_5 - 12000))))))) - 1)) / 1.414) - 1)) + abs((((((((0.4 * sr) / ((0.5 * (((k_voice_pitch_kout_5 + 12000) - abs((k_voice_pitch_kout_5 - 12000))))))) - 1)) / 1.414) - 1)))))))))))), 1, 0
  ; node:effect_1_butterhp opcode:butterhp
  a_effect_1_butterhp_aout_2 butterhp a_voice_foscili_asig_1, 170, 0
  ; node:effect_2_butterlp opcode:butterlp
  a_effect_2_butterlp_aout_3 butterlp a_effect_1_butterhp_aout_2, 9000, 0
  ; node:echo_filter opcode:butterlp
  a_echo_filter_aout_7 butterlp a_effect_2_butterlp_aout_3, 4200, 0
  ; node:echo_1 opcode:delay
  a_echo_1_aout_8 delay a_echo_filter_aout_7, (i_orbit_delay_iout_10 * 0.001), 0
  ; node:echo_2 opcode:delay
  a_echo_2_aout_9 delay a_echo_1_aout_8, (i_orbit_delay_iout_10 * 0.001), 0
  ; node:echo_3 opcode:delay
  a_echo_3_aout_10 delay a_echo_2_aout_9, (i_orbit_delay_iout_10 * 0.001), 0
  ; node:echo_4 opcode:delay
  a_echo_4_aout_11 delay a_echo_3_aout_10, (i_orbit_delay_iout_10 * 0.001), 0
  ; node:echo_5 opcode:delay
  a_echo_5_aout_12 delay a_echo_4_aout_11, (i_orbit_delay_iout_10 * 0.001), 0
  ; node:echo_6 opcode:delay
  a_echo_6_aout_13 delay a_echo_5_aout_12, (i_orbit_delay_iout_10 * 0.001), 0
  ; node:echo_sum opcode:mix2
  a_echo_sum_aout_14 = (((((((0.62000000 * a_echo_1_aout_8) + (0.38440000 * a_echo_2_aout_9)) + (0.23832800 * a_echo_3_aout_10)) + (0.14776336 * a_echo_4_aout_11)) + (0.09161328 * a_echo_5_aout_12)) + (0.05680024 * a_echo_6_aout_13))) + (0)
  ; node:local_reverb opcode:reverb2
  a_local_reverb_aout_15 reverb2 ((0.45 * a_effect_2_butterlp_aout_3) + (0.55 * a_echo_sum_aout_14)), 0.8, 0.55, 0
  ; node:fx_mix opcode:mix2
  a_fx_mix_aout_16 = ((a_effect_2_butterlp_aout_3 + (a_space_audio_aout_6 * (((0.75 * a_echo_sum_aout_14) + (0.38 * a_local_reverb_aout_15)))))) + (0)
  ; node:output_pan2 opcode:pan2
  a_output_pan2_aleft_4, a_output_pan2_aright_5 pan2 ((0.75 * a_fx_mix_aout_16) * a_tail_audio_aout_17), (0.5 + (0.22 * k_orbit_pan_lfo_kout_8)), 0
  ; node:output_left opcode:outleta
  outleta "left", a_output_pan2_aleft_4
  ; node:output_right opcode:outleta
  outleta "right", a_output_pan2_aright_5
endin
