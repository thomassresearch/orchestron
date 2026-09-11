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

chnset 0.13, "__vcs_perf_df6b9c911ef90e0cd68d776948b3d1349e2f9f21d2be8f540d4fee4f292a49e0"
chnset 2.5, "__vcs_perf_c953ec932e7bc39ff63973dbec86391bee92540951d265eb23b9ca59b793bbad"
chnset 1400, "__vcs_perf_8fbe08cefccb9b53905b7ec4a39cbc19262a745c1def572dbfdfe7d81cc619e6"

; patch:aa209e75-3c0f-4687-85c3-48f0cf7329cd name:__patch_cli_preflight__ Undertow Motion Pad channel:1 always_on:false
instr 1
  ; node:env_attack_const opcode:const_i
  i_env_attack_const_iout_4 = 0.6
  ; node:env_decay_const opcode:const_i
  i_env_decay_const_iout_5 = 1.5
  ; node:env_sustain_const opcode:const_i
  i_env_sustain_const_iout_6 = 0.7
  ; node:pitch_cpsmidi opcode:cpsmidi
  i_pitch_cpsmidi_kfreq_1 cpsmidi
  ; node:pulse_gain opcode:const_k
  k_pulse_gain_kout_5 = 0.09
  ; node:triangle_gain opcode:const_k
  k_triangle_gain_kout_3 = 0.14
  i_undertow_motion_iout_8 chnget "__vcs_perf_df6b9c911ef90e0cd68d776948b3d1349e2f9f21d2be8f540d4fee4f292a49e0"
  i_undertow_release_iout_9 chnget "__vcs_perf_c953ec932e7bc39ff63973dbec86391bee92540951d265eb23b9ca59b793bbad"
  i_undertow_tone_iout_7 chnget "__vcs_perf_8fbe08cefccb9b53905b7ec4a39cbc19262a745c1def572dbfdfe7d81cc619e6"
  ; node:velocity_scale_const opcode:const_i
  i_velocity_scale_const_iout_2 = 1.0
  ; node:undertow_lfo opcode:lfo
  k_undertow_lfo_kout_7 lfo 1, i_undertow_motion_iout_8, 0
  ; node:amp_madsr opcode:madsr
  k_amp_madsr_kenv_1 madsr i_env_attack_const_iout_4, i_env_decay_const_iout_5, i_env_sustain_const_iout_6, i_undertow_release_iout_9, 0, -1
  ; node:velocity_ampmidi opcode:ampmidi
  i_velocity_ampmidi_iamp_3 ampmidi i_velocity_scale_const_iout_2
  ; node:amp_velocity_envelope opcode:k_mul
  k_amp_velocity_envelope_kout_2 = (i_velocity_ampmidi_iamp_3) * (k_amp_madsr_kenv_1)
  ; node:triangle_amp opcode:k_mul
  k_triangle_amp_kout_4 = (k_amp_velocity_envelope_kout_2) * (k_triangle_gain_kout_3)
  ; node:pulse_amp opcode:k_mul
  k_pulse_amp_kout_6 = (k_amp_velocity_envelope_kout_2) * (k_pulse_gain_kout_5)
  ; node:triangle_vco2 opcode:vco2
  a_triangle_vco2_asig_1 vco2 k_triangle_amp_kout_4, i_pitch_cpsmidi_kfreq_1, 12, 0.5, 0, 0.5
  ; node:pulse_vco2 opcode:vco2
  a_pulse_vco2_asig_2 vco2 k_pulse_amp_kout_6, i_pitch_cpsmidi_kfreq_1, 2, (0.5 + (0.18 * k_undertow_lfo_kout_7)), 0.25, 0.5
  ; node:layer_mix_1 opcode:mix2
  a_layer_mix_1_aout_3 = (a_triangle_vco2_asig_1) + (a_pulse_vco2_asig_2)
  ; node:effect_1_butterhp opcode:butterhp
  a_effect_1_butterhp_aout_4 butterhp a_layer_mix_1_aout_3, 70, 0
  ; node:effect_2_moogladder2 opcode:moogladder2
  a_effect_2_moogladder2_aout_5 moogladder2 a_effect_1_butterhp_aout_4, (i_undertow_tone_iout_7 * ((1 + (0.3 * k_undertow_lfo_kout_7)))), 0.18
  ; node:output_pan2 opcode:pan2
  a_output_pan2_aleft_6, a_output_pan2_aright_7 pan2 (a_effect_2_moogladder2_aout_5 * 0.85), 0.5, 0
  ; node:output_left opcode:outleta
  outleta "left", a_output_pan2_aleft_6
  ; node:output_right opcode:outleta
  outleta "right", a_output_pan2_aright_7
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
f 0 15.5
e
</CsScore>
</CsoundSynthesizer>