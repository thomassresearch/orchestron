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

chnset 0.12, "__vcs_perf_58c1cf71cd408215eff7c6e26852f3623549d185ddcc9938fe499318b14c5912"
chnset 0.65000000000000002, "__vcs_perf_492cd740e748bdf0c8fa1001ce6d5e9fb7a14068d0bf2eca69d1c0e00d8cd3c6"
chnset 8, "__vcs_perf_ee56fe241ab28e72319c0433f02c4dc5bd0e6be81181184d0a793e908561c959"

; patch:54e537c4-7773-4f79-bc3e-f15aa4e1f710 name:__patch_cli_preflight__ Astral Laser Zaps channel:1 always_on:false
instr 1
  i_astral_decay_iout_9 chnget "__vcs_perf_58c1cf71cd408215eff7c6e26852f3623549d185ddcc9938fe499318b14c5912"
  i_astral_space_iout_10 chnget "__vcs_perf_492cd740e748bdf0c8fa1001ce6d5e9fb7a14068d0bf2eca69d1c0e00d8cd3c6"
  i_astral_sweep_iout_8 chnget "__vcs_perf_ee56fe241ab28e72319c0433f02c4dc5bd0e6be81181184d0a793e908561c959"
  ; node:env_attack_const opcode:const_i
  i_env_attack_const_iout_4 = 0.001
  ; node:env_release_const opcode:const_i
  i_env_release_const_iout_6 = 0.025
  ; node:env_release_time_const opcode:const_i
  i_env_release_time_const_iout_7 = 0.025
  ; node:env_sustain_const opcode:const_i
  i_env_sustain_const_iout_5 = 0.0
  ; node:fx_tail_guard opcode:linsegr
  k_fx_tail_guard_kenv_8 linsegr 1, 0.001, 1, 3.6, 0
  ; node:orbit_pan_lfo opcode:lfo
  k_orbit_pan_lfo_kout_9 lfo 1, 0.37, 0
  ; node:pitch_cpsmidi opcode:cpsmidi
  i_pitch_cpsmidi_kfreq_1 cpsmidi
  ; node:velocity_scale_const opcode:const_i
  i_velocity_scale_const_iout_2 = 1.0
  ; node:voice_gain opcode:const_k
  k_voice_gain_kout_3 = 0.24
  ; node:laser_sweep_env opcode:expseg
  k_laser_sweep_env_kenv_5 expseg 1, i_astral_decay_iout_9, 0.0001
  ; node:space_amount opcode:k_mul
  k_space_amount_kout_7 = (i_astral_space_iout_10) * (1)
  ; node:amp_madsr opcode:madsr
  k_amp_madsr_kenv_1 madsr i_env_attack_const_iout_4, i_astral_decay_iout_9, i_env_sustain_const_iout_5, i_env_release_const_iout_6, 0, i_env_release_time_const_iout_7
  ; node:tail_audio opcode:k_to_a
  a_tail_audio_aout_19 interp k_fx_tail_guard_kenv_8
  ; node:velocity_ampmidi opcode:ampmidi
  i_velocity_ampmidi_iamp_3 ampmidi i_velocity_scale_const_iout_2
  ; node:voice_pitch opcode:k_mul
  k_voice_pitch_kout_6 = ((i_pitch_cpsmidi_kfreq_1 * ((1 + (((i_astral_sweep_iout_8 - 1)) * k_laser_sweep_env_kenv_5))))) * (1)
  ; node:space_audio opcode:k_to_a
  a_space_audio_aout_6 interp k_space_amount_kout_7
  ; node:amp_velocity_envelope opcode:k_mul
  k_amp_velocity_envelope_kout_2 = (i_velocity_ampmidi_iamp_3) * (k_amp_madsr_kenv_1)
  ; node:voice_amp opcode:k_mul
  k_voice_amp_kout_4 = (k_amp_velocity_envelope_kout_2) * (k_voice_gain_kout_3)
  ; node:voice_foscili opcode:foscili
  a_voice_foscili_asig_1 foscili k_voice_amp_kout_4, (0.5 * (((k_voice_pitch_kout_6 + 12000) - abs((k_voice_pitch_kout_6 - 12000))))), 1, 1, (0.5 * (((((0.2 + k_amp_madsr_kenv_1)) + ((0.5 * (((((((((0.4 * sr) / ((0.5 * (((k_voice_pitch_kout_6 + 12000) - abs((k_voice_pitch_kout_6 - 12000))))))) - 1)) / 1) - 1)) + abs((((((((0.4 * sr) / ((0.5 * (((k_voice_pitch_kout_6 + 12000) - abs((k_voice_pitch_kout_6 - 12000))))))) - 1)) / 1) - 1)))))))) - abs((((0.2 + k_amp_madsr_kenv_1)) - ((0.5 * (((((((((0.4 * sr) / ((0.5 * (((k_voice_pitch_kout_6 + 12000) - abs((k_voice_pitch_kout_6 - 12000))))))) - 1)) / 1) - 1)) + abs((((((((0.4 * sr) / ((0.5 * (((k_voice_pitch_kout_6 + 12000) - abs((k_voice_pitch_kout_6 - 12000))))))) - 1)) / 1) - 1)))))))))))), 1, 0
  ; node:effect_1_butterhp opcode:butterhp
  a_effect_1_butterhp_aout_2 butterhp a_voice_foscili_asig_1, 100, 0
  ; node:effect_2_butterlp opcode:butterlp
  a_effect_2_butterlp_aout_3 butterlp a_effect_1_butterhp_aout_2, 9500, 0
  ; node:echo_filter opcode:butterlp
  a_echo_filter_aout_7 butterlp a_effect_2_butterlp_aout_3, 4200, 0
  ; node:echo_1 opcode:delay
  a_echo_1_aout_8 delay a_echo_filter_aout_7, 0.075, 0
  ; node:echo_2 opcode:delay
  a_echo_2_aout_9 delay a_echo_1_aout_8, 0.075, 0
  ; node:echo_3 opcode:delay
  a_echo_3_aout_10 delay a_echo_2_aout_9, 0.075, 0
  ; node:echo_4 opcode:delay
  a_echo_4_aout_11 delay a_echo_3_aout_10, 0.075, 0
  ; node:echo_5 opcode:delay
  a_echo_5_aout_12 delay a_echo_4_aout_11, 0.075, 0
  ; node:echo_6 opcode:delay
  a_echo_6_aout_13 delay a_echo_5_aout_12, 0.075, 0
  ; node:echo_7 opcode:delay
  a_echo_7_aout_14 delay a_echo_6_aout_13, 0.075, 0
  ; node:echo_8 opcode:delay
  a_echo_8_aout_15 delay a_echo_7_aout_14, 0.075, 0
  ; node:echo_sum opcode:mix2
  a_echo_sum_aout_16 = (((((((((0.62000000 * a_echo_1_aout_8) + (0.38440000 * a_echo_2_aout_9)) + (0.23832800 * a_echo_3_aout_10)) + (0.14776336 * a_echo_4_aout_11)) + (0.09161328 * a_echo_5_aout_12)) + (0.05680024 * a_echo_6_aout_13)) + (0.03521615 * a_echo_7_aout_14)) + (0.02183401 * a_echo_8_aout_15))) + (0)
  ; node:local_reverb opcode:reverb2
  a_local_reverb_aout_17 reverb2 ((0.45 * a_effect_2_butterlp_aout_3) + (0.55 * a_echo_sum_aout_16)), 1.4, 0.55, 0
  ; node:fx_mix opcode:mix2
  a_fx_mix_aout_18 = ((a_effect_2_butterlp_aout_3 + (a_space_audio_aout_6 * (((0.75 * a_echo_sum_aout_16) + (0.38 * a_local_reverb_aout_17)))))) + (0)
  ; node:output_pan2 opcode:pan2
  a_output_pan2_aleft_4, a_output_pan2_aright_5 pan2 ((0.65 * a_fx_mix_aout_18) * a_tail_audio_aout_19), (0.5 + (0.22 * k_orbit_pan_lfo_kout_9)), 0
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
f 0 8.61
e
</CsScore>
</CsoundSynthesizer>