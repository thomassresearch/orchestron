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

chnset 0.34999999999999998, "__vcs_perf_51546cfee554f69ee3ad0f20e99d0af1be64708900c1677c50d4b94abae595c7"
chnset 750, "__vcs_perf_da3cc3c9c94d268b3e3fa64ce121482c5019c79bbe0140e5fc5331be5b5dba0d"
chnset 145, "__vcs_perf_82bdb5d665532721ee1cc74a09bfab859ec1adc0f471086f405d99a0142ef0f3"

; patch:f438210f-9ccd-45ff-9d96-8e46ff588d1f name:__patch_cli_preflight__ Mandala Acid Lead channel:1 always_on:false
instr 1
  ; node:env_attack_const opcode:const_i
  i_env_attack_const_iout_4 = 0.004
  ; node:env_decay_const opcode:const_i
  i_env_decay_const_iout_5 = 0.22
  ; node:env_release_const opcode:const_i
  i_env_release_const_iout_7 = 0.055
  ; node:env_release_time_const opcode:const_i
  i_env_release_time_const_iout_8 = 0.055
  ; node:env_sustain_const opcode:const_i
  i_env_sustain_const_iout_6 = 0.45
  ; node:fx_tail_guard opcode:linsegr
  k_fx_tail_guard_kenv_6 linsegr 1, 0.001, 1, 4, 0
  i_mandala_space_iout_11 chnget "__vcs_perf_51546cfee554f69ee3ad0f20e99d0af1be64708900c1677c50d4b94abae595c7"
  i_mandala_squelch_iout_9 chnget "__vcs_perf_da3cc3c9c94d268b3e3fa64ce121482c5019c79bbe0140e5fc5331be5b5dba0d"
  i_mandala_tempo_iout_10 chnget "__vcs_perf_82bdb5d665532721ee1cc74a09bfab859ec1adc0f471086f405d99a0142ef0f3"
  ; node:orbit_pan_lfo opcode:lfo
  k_orbit_pan_lfo_kout_7 lfo 1, 0.37, 0
  ; node:pitch_cpsmidi opcode:cpsmidi
  i_pitch_cpsmidi_kfreq_1 cpsmidi
  ; node:velocity_scale_const opcode:const_i
  i_velocity_scale_const_iout_2 = 1.0
  ; node:voice_gain opcode:const_k
  k_voice_gain_kout_3 = 0.55
  ; node:amp_madsr opcode:madsr
  k_amp_madsr_kenv_1 madsr i_env_attack_const_iout_4, i_env_decay_const_iout_5, i_env_sustain_const_iout_6, i_env_release_const_iout_7, 0, i_env_release_time_const_iout_8
  ; node:tail_audio opcode:k_to_a
  a_tail_audio_aout_16 interp k_fx_tail_guard_kenv_6
  ; node:space_amount opcode:k_mul
  k_space_amount_kout_5 = (i_mandala_space_iout_11) * (1)
  ; node:velocity_ampmidi opcode:ampmidi
  i_velocity_ampmidi_iamp_3 ampmidi i_velocity_scale_const_iout_2
  ; node:space_audio opcode:k_to_a
  a_space_audio_aout_7 interp k_space_amount_kout_5
  ; node:amp_velocity_envelope opcode:k_mul
  k_amp_velocity_envelope_kout_2 = (i_velocity_ampmidi_iamp_3) * (k_amp_madsr_kenv_1)
  ; node:voice_amp opcode:k_mul
  k_voice_amp_kout_4 = (k_amp_velocity_envelope_kout_2) * (k_voice_gain_kout_3)
  ; node:voice_vco2 opcode:vco2
  a_voice_vco2_asig_1 vco2 k_voice_amp_kout_4, i_pitch_cpsmidi_kfreq_1, 0, 0.5, 0, 0.5
  ; node:effect_1_distort1 opcode:distort1
  a_effect_1_distort1_aout_2 distort1 a_voice_vco2_asig_1, 2.3, 0.26, 0, 0, 1
  ; node:effect_2_moogladder2 opcode:moogladder2
  a_effect_2_moogladder2_aout_3 moogladder2 a_effect_1_distort1_aout_2, (i_mandala_squelch_iout_9 + ((4200 * k_amp_madsr_kenv_1) * k_amp_madsr_kenv_1)), 0.56
  ; node:effect_3_butterhp opcode:butterhp
  a_effect_3_butterhp_aout_4 butterhp a_effect_2_moogladder2_aout_3, 85, 0
  ; node:echo_filter opcode:butterlp
  a_echo_filter_aout_8 butterlp a_effect_3_butterhp_aout_4, 4200, 0
  ; node:echo_1 opcode:delay
  a_echo_1_aout_9 delay a_echo_filter_aout_8, (45 / i_mandala_tempo_iout_10), 0
  ; node:echo_2 opcode:delay
  a_echo_2_aout_10 delay a_echo_1_aout_9, (45 / i_mandala_tempo_iout_10), 0
  ; node:echo_3 opcode:delay
  a_echo_3_aout_11 delay a_echo_2_aout_10, (45 / i_mandala_tempo_iout_10), 0
  ; node:echo_4 opcode:delay
  a_echo_4_aout_12 delay a_echo_3_aout_11, (45 / i_mandala_tempo_iout_10), 0
  ; node:echo_sum opcode:mix2
  a_echo_sum_aout_13 = (((((0.62000000 * a_echo_1_aout_9) + (0.38440000 * a_echo_2_aout_10)) + (0.23832800 * a_echo_3_aout_11)) + (0.14776336 * a_echo_4_aout_12))) + (0)
  ; node:local_reverb opcode:reverb2
  a_local_reverb_aout_14 reverb2 ((0.45 * a_effect_3_butterhp_aout_4) + (0.55 * a_echo_sum_aout_13)), 0.85, 0.55, 0
  ; node:fx_mix opcode:mix2
  a_fx_mix_aout_15 = ((a_effect_3_butterhp_aout_4 + (a_space_audio_aout_7 * (((0.75 * a_echo_sum_aout_13) + (0.38 * a_local_reverb_aout_14)))))) + (0)
  ; node:output_pan2 opcode:pan2
  a_output_pan2_aleft_5, a_output_pan2_aright_6 pan2 ((0.8 * a_fx_mix_aout_15) * a_tail_audio_aout_16), (0.5 + (0.22 * k_orbit_pan_lfo_kout_7)), 0
  ; node:output_left opcode:outleta
  outleta "left", a_output_pan2_aleft_5
  ; node:output_right opcode:outleta
  outleta "right", a_output_pan2_aright_6
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
f 0 8.181896551724138
e
</CsScore>
</CsoundSynthesizer>