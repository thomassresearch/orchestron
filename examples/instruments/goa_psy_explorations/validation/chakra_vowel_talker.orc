sr = 48000
ksmps = 64
nchnls = 2
0dbfs = 1.0

massign 0, 0
massign 1, 1

chnset 0.41999999999999998, "__vcs_perf_22745e9c2b3bea6b8d8fe4190884f640b850f042e8561a72882422b4f0ea0362"
chnset 4.7000000000000002, "__vcs_perf_8a33a13a4c6ee44959d6ac9aa9101ab2623712020f7860156a55772d7ffe4b90"
chnset 0.34999999999999998, "__vcs_perf_110c3367f4432d4c3fd9f8fc92b4fa670018850afe8c101d8ecd08a485e588e4"

; patch:ffe02d48-dba6-403d-86a5-e6bea7d14cdc name:__patch_cli_preflight__ Chakra Vowel Talker channel:1 always_on:false
instr 1
  i_chakra_space_iout_11 chnget "__vcs_perf_22745e9c2b3bea6b8d8fe4190884f640b850f042e8561a72882422b4f0ea0362"
  i_chakra_talk_iout_10 chnget "__vcs_perf_8a33a13a4c6ee44959d6ac9aa9101ab2623712020f7860156a55772d7ffe4b90"
  i_chakra_vowel_iout_9 chnget "__vcs_perf_110c3367f4432d4c3fd9f8fc92b4fa670018850afe8c101d8ecd08a485e588e4"
  ; node:env_attack_const opcode:const_i
  i_env_attack_const_iout_4 = 0.008
  ; node:env_decay_const opcode:const_i
  i_env_decay_const_iout_5 = 0.24
  ; node:env_release_const opcode:const_i
  i_env_release_const_iout_7 = 0.09
  ; node:env_release_time_const opcode:const_i
  i_env_release_time_const_iout_8 = 0.09
  ; node:env_sustain_const opcode:const_i
  i_env_sustain_const_iout_6 = 0.65
  ; node:fx_tail_guard opcode:linsegr
  k_fx_tail_guard_kenv_7 linsegr 1, 0.001, 1, 4, 0
  ; node:orbit_pan_lfo opcode:lfo
  k_orbit_pan_lfo_kout_8 lfo 1, 0.37, 0
  ; node:pitch_cpsmidi opcode:cpsmidi
  i_pitch_cpsmidi_kfreq_1 cpsmidi
  ; node:velocity_scale_const opcode:const_i
  i_velocity_scale_const_iout_2 = 1.0
  ; node:voice_gain opcode:const_k
  k_voice_gain_kout_3 = 0.26
  ; node:space_amount opcode:k_mul
  k_space_amount_kout_6 = (i_chakra_space_iout_11) * (1)
  ; node:talk_lfo opcode:lfo
  k_talk_lfo_kout_5 lfo 1, i_chakra_talk_iout_10, 0
  ; node:amp_madsr opcode:madsr
  k_amp_madsr_kenv_1 madsr i_env_attack_const_iout_4, i_env_decay_const_iout_5, i_env_sustain_const_iout_6, i_env_release_const_iout_7, 0, i_env_release_time_const_iout_8
  ; node:tail_audio opcode:k_to_a
  a_tail_audio_aout_17 interp k_fx_tail_guard_kenv_7
  ; node:velocity_ampmidi opcode:ampmidi
  i_velocity_ampmidi_iamp_3 ampmidi i_velocity_scale_const_iout_2
  ; node:space_audio opcode:k_to_a
  a_space_audio_aout_8 interp k_space_amount_kout_6
  ; node:amp_velocity_envelope opcode:k_mul
  k_amp_velocity_envelope_kout_2 = (i_velocity_ampmidi_iamp_3) * (k_amp_madsr_kenv_1)
  ; node:voice_amp opcode:k_mul
  k_voice_amp_kout_4 = (k_amp_velocity_envelope_kout_2) * (k_voice_gain_kout_3)
  ; node:voice_vco2 opcode:vco2
  a_voice_vco2_asig_1 vco2 k_voice_amp_kout_4, i_pitch_cpsmidi_kfreq_1, 2, 0.31, 0, 0.5
  ; node:effect_1_butterhp opcode:butterhp
  a_effect_1_butterhp_aout_2 butterhp a_voice_vco2_asig_1, 100, 0
  ; node:formant_low opcode:butterbp
  a_formant_low_aout_5 butterbp a_effect_1_butterhp_aout_2, ((400 + (i_chakra_vowel_iout_9 * 650)) + (130 * k_talk_lfo_kout_5)), 220, 0
  ; node:formant_high opcode:butterbp
  a_formant_high_aout_6 butterbp a_effect_1_butterhp_aout_2, ((1100 + (i_chakra_vowel_iout_9 * 1600)) - (220 * k_talk_lfo_kout_5)), 380, 0
  ; node:vowel_mix opcode:mix2
  a_vowel_mix_aout_7 = ((((0.16 * a_effect_1_butterhp_aout_2) + (2.8 * a_formant_low_aout_5)) + (1.7 * a_formant_high_aout_6))) + (0)
  ; node:echo_filter opcode:butterlp
  a_echo_filter_aout_9 butterlp a_vowel_mix_aout_7, 4200, 0
  ; node:echo_1 opcode:delay
  a_echo_1_aout_10 delay a_echo_filter_aout_9, 0.3103448275862069, 0
  ; node:echo_2 opcode:delay
  a_echo_2_aout_11 delay a_echo_1_aout_10, 0.3103448275862069, 0
  ; node:echo_3 opcode:delay
  a_echo_3_aout_12 delay a_echo_2_aout_11, 0.3103448275862069, 0
  ; node:echo_4 opcode:delay
  a_echo_4_aout_13 delay a_echo_3_aout_12, 0.3103448275862069, 0
  ; node:echo_sum opcode:mix2
  a_echo_sum_aout_14 = (((((0.62000000 * a_echo_1_aout_10) + (0.38440000 * a_echo_2_aout_11)) + (0.23832800 * a_echo_3_aout_12)) + (0.14776336 * a_echo_4_aout_13))) + (0)
  ; node:local_reverb opcode:reverb2
  a_local_reverb_aout_15 reverb2 ((0.45 * a_vowel_mix_aout_7) + (0.55 * a_echo_sum_aout_14)), 1.1, 0.55, 0
  ; node:fx_mix opcode:mix2
  a_fx_mix_aout_16 = ((a_vowel_mix_aout_7 + (a_space_audio_aout_8 * (((0.75 * a_echo_sum_aout_14) + (0.38 * a_local_reverb_aout_15)))))) + (0)
  ; node:output_pan2 opcode:pan2
  a_output_pan2_aleft_3, a_output_pan2_aright_4 pan2 ((0.5 * a_fx_mix_aout_16) * a_tail_audio_aout_17), (0.5 + (0.22 * k_orbit_pan_lfo_kout_8)), 0
  ; node:output_left opcode:outleta
  outleta "left", a_output_pan2_aleft_3
  ; node:output_right opcode:outleta
  outleta "right", a_output_pan2_aright_4
endin
