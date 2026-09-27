sr = 48000
ksmps = 32
nchnls = 2
0dbfs = 1.0

massign 0, 0
massign 1, 1

chnset 0.074999999999999997, "__vcs_perf_fac9907eb19a3b2a60291daf049a12f91f3429311741e5e6e4860390cd15d740"
chnset 0.55000000000000004, "__vcs_perf_d9296f4cb6de8286a2cc2f5c7a96901156cedd867448400669a07599b79e3ab9"
chnset 0.22, "__vcs_perf_b9eb8e2378e71a8283be3535d2c24b4db5c8aa4e5d4917755fe4482ab0628945"
chnset 4800, "__vcs_perf_fb5fa553c95f4633181a7a4ee175d8756677540d0d02e2e4c60f5eccb4371783"
chnset 9, "__vcs_perf_aed5417248c0c8f242a71bbfec1aed0868cf9a98bfff04087a96b683450a572c"

; patch:ba430924-b678-4854-ab23-eb230562063d name:__patch_cli_preflight__ Lake Bamboo Flute channel:1 always_on:false
; instance:rack-1 csound:1
; description: Breathy bamboo flute revised against Samurai Flute Sample: strong second/third partials, pressure-dependent harmonic bloom, resonant air, soft breath attacks, a small pitch scoop and irregular delayed vibrato. Synthesized without sampled audio. Best E3–D6; the reference character is strongest E3–E5. Velocity shapes loudness, colour and air. Five compatible per-instance controls; dry Stereo Output, route through Master or a shared room reverb.
instr 1
  ; node:breath_attack opcode:expseg
  k_breath_attack_kenv_13 expseg 1, 0.09, 0.3, 0.22, 0.04, 3600, 0.04
  ; node:colour_wander opcode:randomi
  k_colour_wander_kout_11 randomi -0.22, 0.22, 2.1, 3, 0
  ; node:env_attack_const opcode:const_i
  i_env_attack_const_iout_4 = 0.075
  ; node:env_decay_const opcode:const_i
  i_env_decay_const_iout_5 = 0.32
  ; node:env_release_const opcode:const_i
  i_env_release_const_iout_7 = 0.22
  ; node:env_sustain_const opcode:const_i
  i_env_sustain_const_iout_6 = 0.88
  i_flute_attack_iout_8 chnget "__vcs_perf_fac9907eb19a3b2a60291daf049a12f91f3429311741e5e6e4860390cd15d740"
  i_flute_breath_iout_10 chnget "__vcs_perf_d9296f4cb6de8286a2cc2f5c7a96901156cedd867448400669a07599b79e3ab9"
  i_flute_release_iout_9 chnget "__vcs_perf_b9eb8e2378e71a8283be3535d2c24b4db5c8aa4e5d4917755fe4482ab0628945"
  i_flute_tone_iout_11 chnget "__vcs_perf_fb5fa553c95f4633181a7a4ee175d8756677540d0d02e2e4c60f5eccb4371783"
  i_flute_vibrato_iout_12 chnget "__vcs_perf_aed5417248c0c8f242a71bbfec1aed0868cf9a98bfff04087a96b683450a572c"
  ; node:harmonic_bloom opcode:linseg
  k_harmonic_bloom_kenv_12 linseg 0.4, 0.22, 1.12, 0.9, 0.85, 3600, 0.85
  ; node:jet_flutter opcode:randomi
  k_jet_flutter_kout_8 randomi -0.00065, 0.00065, 17, 3, 0
  ; node:pitch_cpsmidi opcode:cpsmidi
  i_pitch_cpsmidi_kfreq_1 cpsmidi
  ; node:pitch_drift opcode:randomi
  k_pitch_drift_kout_7 randomi -0.0026, 0.0026, 1.8, 3, 0
  ; node:pressure opcode:randomi
  k_pressure_kout_10 randomi -0.09, 0.09, 3.2, 3, 0
  ; node:velocity_scale_const opcode:const_i
  i_velocity_scale_const_iout_2 = 1.0
  ; node:vibrato_delay opcode:linseg
  k_vibrato_delay_kenv_3 linseg 0, 0.32, 0, 0.85, 1, 3600, 1
  ; node:vibrato_depth opcode:randomi
  k_vibrato_depth_kout_5 randomi 0.65, 1.2, 1.7, 3, 0
  ; node:vibrato_rate opcode:jitter
  k_vibrato_rate_kout_4 jitter 0.55, 0.45, 1.3
  ; node:pitch_scoop opcode:linseg
  k_pitch_scoop_kenv_9 linseg -1, (.025 + (1.4 * i_flute_attack_iout_8)), 0.08, 0.12, 0, 3600, 0
  ; node:amp_madsr opcode:madsr
  k_amp_madsr_kenv_1 madsr i_flute_attack_iout_8, i_env_decay_const_iout_5, i_env_sustain_const_iout_6, i_flute_release_iout_9, 0, -1
  ; node:velocity_ampmidi opcode:ampmidi
  i_velocity_ampmidi_iamp_3 ampmidi i_velocity_scale_const_iout_2
  ; node:vibrato opcode:lfo
  k_vibrato_kout_6 lfo (((i_flute_vibrato_iout_12 * 0.00057762265) * k_vibrato_delay_kenv_3) * k_vibrato_depth_kout_5), (4.8 + k_vibrato_rate_kout_4), 0
  ; node:amp_velocity_envelope opcode:k_mul
  k_amp_velocity_envelope_kout_2 = (i_velocity_ampmidi_iamp_3) * (k_amp_madsr_kenv_1)
  ; node:bore_1 opcode:oscil3
  a_bore_1_asig_1 oscil3 ((k_amp_velocity_envelope_kout_2 * 0.34) * ((1 + k_pressure_kout_10))), ((i_pitch_cpsmidi_kfreq_1 * 1) * (((((1 + k_vibrato_kout_6) + k_pitch_drift_kout_7) + k_jet_flutter_kout_8) + (.012 * k_pitch_scoop_kenv_9)))), -1, 0
  ; node:bore_2 opcode:oscil3
  a_bore_2_asig_2 oscil3 ((((((k_amp_velocity_envelope_kout_2 * 0.28) * ((1 + k_pressure_kout_10))) * ((0.40 + (0.60 * i_velocity_ampmidi_iamp_3)))) * k_harmonic_bloom_kenv_12) * ((1 + k_colour_wander_kout_11))) / ((1 + (((i_pitch_cpsmidi_kfreq_1 / 1800)) * ((i_pitch_cpsmidi_kfreq_1 / 1800)))))), ((i_pitch_cpsmidi_kfreq_1 * 2) * (((((1 + k_vibrato_kout_6) + k_pitch_drift_kout_7) + k_jet_flutter_kout_8) + (.012 * k_pitch_scoop_kenv_9)))), -1, 0
  ; node:bore_3 opcode:oscil3
  a_bore_3_asig_3 oscil3 ((((((k_amp_velocity_envelope_kout_2 * 0.3) * ((1 + k_pressure_kout_10))) * ((0.40 + (0.60 * i_velocity_ampmidi_iamp_3)))) * k_harmonic_bloom_kenv_12) * ((1 + k_colour_wander_kout_11))) / ((1 + (((i_pitch_cpsmidi_kfreq_1 / 950)) * ((i_pitch_cpsmidi_kfreq_1 / 950)))))), ((i_pitch_cpsmidi_kfreq_1 * 3) * (((((1 + k_vibrato_kout_6) + k_pitch_drift_kout_7) + k_jet_flutter_kout_8) + (.012 * k_pitch_scoop_kenv_9)))), -1, 0
  ; node:bore_4 opcode:oscil3
  a_bore_4_asig_4 oscil3 ((((((k_amp_velocity_envelope_kout_2 * 0.03) * ((1 + k_pressure_kout_10))) * ((0.40 + (0.60 * i_velocity_ampmidi_iamp_3)))) * k_harmonic_bloom_kenv_12) * ((1 + k_colour_wander_kout_11))) / ((1 + (((i_pitch_cpsmidi_kfreq_1 / 950)) * ((i_pitch_cpsmidi_kfreq_1 / 950)))))), ((i_pitch_cpsmidi_kfreq_1 * 4) * (((((1 + k_vibrato_kout_6) + k_pitch_drift_kout_7) + k_jet_flutter_kout_8) + (.012 * k_pitch_scoop_kenv_9)))), -1, 0
  ; node:bore_5 opcode:oscil3
  a_bore_5_asig_5 oscil3 ((((((k_amp_velocity_envelope_kout_2 * 0.024) * ((1 + k_pressure_kout_10))) * ((0.40 + (0.60 * i_velocity_ampmidi_iamp_3)))) * k_harmonic_bloom_kenv_12) * ((1 + k_colour_wander_kout_11))) / ((1 + (((i_pitch_cpsmidi_kfreq_1 / 950)) * ((i_pitch_cpsmidi_kfreq_1 / 950)))))), ((i_pitch_cpsmidi_kfreq_1 * 5) * (((((1 + k_vibrato_kout_6) + k_pitch_drift_kout_7) + k_jet_flutter_kout_8) + (.012 * k_pitch_scoop_kenv_9)))), -1, 0
  ; node:bore_6 opcode:oscil3
  a_bore_6_asig_6 oscil3 ((((((k_amp_velocity_envelope_kout_2 * 0.017) * ((1 + k_pressure_kout_10))) * ((0.40 + (0.60 * i_velocity_ampmidi_iamp_3)))) * k_harmonic_bloom_kenv_12) * ((1 + k_colour_wander_kout_11))) / ((1 + (((i_pitch_cpsmidi_kfreq_1 / 950)) * ((i_pitch_cpsmidi_kfreq_1 / 950)))))), ((i_pitch_cpsmidi_kfreq_1 * 6) * (((((1 + k_vibrato_kout_6) + k_pitch_drift_kout_7) + k_jet_flutter_kout_8) + (.012 * k_pitch_scoop_kenv_9)))), -1, 0
  ; node:bore_7 opcode:oscil3
  a_bore_7_asig_7 oscil3 ((((((k_amp_velocity_envelope_kout_2 * 0.009) * ((1 + k_pressure_kout_10))) * ((0.40 + (0.60 * i_velocity_ampmidi_iamp_3)))) * k_harmonic_bloom_kenv_12) * ((1 + k_colour_wander_kout_11))) / ((1 + (((i_pitch_cpsmidi_kfreq_1 / 950)) * ((i_pitch_cpsmidi_kfreq_1 / 950)))))), ((i_pitch_cpsmidi_kfreq_1 * 7) * (((((1 + k_vibrato_kout_6) + k_pitch_drift_kout_7) + k_jet_flutter_kout_8) + (.012 * k_pitch_scoop_kenv_9)))), -1, 0
  ; node:breath_noise opcode:noise
  a_breath_noise_aout_8 noise ((((k_amp_velocity_envelope_kout_2 * i_flute_breath_iout_10) * .22) * ((.6 + (.4 * i_velocity_ampmidi_iamp_3)))) * (((1 + (2 * k_breath_attack_kenv_13)) + (2 * k_pressure_kout_10)))), 0.12
  ; node:breath_band opcode:butterbp
  a_breath_band_aout_9 butterbp a_breath_noise_aout_8, 2600, 3600, 0
  ; node:bore_air opcode:butterbp
  a_bore_air_aout_10 butterbp a_breath_noise_aout_8, (i_pitch_cpsmidi_kfreq_1 * 2.8), (i_pitch_cpsmidi_kfreq_1 * 1.5), 0
  ; node:warmth opcode:butterlp
  a_warmth_aout_11 butterlp ((((((((a_bore_1_asig_1 + a_bore_2_asig_2) + a_bore_3_asig_3) + a_bore_4_asig_4) + a_bore_5_asig_5) + a_bore_6_asig_6) + a_bore_7_asig_7) + a_breath_band_aout_9) + (.8 * a_bore_air_aout_10)), i_flute_tone_iout_11, 0
  ; node:output_pan2 opcode:pan2
  a_output_pan2_aleft_12, a_output_pan2_aright_13 pan2 (a_warmth_aout_11 * 0.42), 0.5, 0
  ; node:output_left opcode:outleta
  outleta "left", a_output_pan2_aleft_12
  ; node:output_right opcode:outleta
  outleta "right", a_output_pan2_aright_13
endin