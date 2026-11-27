// Offline dry reference. Build with Dexed v0.9.4 sources (see README.md).
#include "EngineMkI.h"
#include "msfa/dx7note.h"
#include "msfa/exp2.h"
#include "msfa/freqlut.h"
#include "msfa/lfo.h"
#include "msfa/sin.h"
#include <array>
#include <cstdlib>
#include <fstream>

int main(int argc, char **argv) {
    // Single voice SysEx, MIDI key, velocity, gate frames, total frames, raw f32 output.
    if (argc != 7) return 2;
    std::ifstream input(argv[1], std::ios::binary);
    std::array<unsigned char, 163> dump{};
    if (!input.read(reinterpret_cast<char*>(dump.data()), dump.size()) || input.peek() != EOF ||
        dump[0] != 0xf0 || dump[1] != 0x43 || dump[3] != 0 || dump.back() != 0xf7) return 3;
    auto *voice = dump.data() + 6;
    constexpr int sr = 48000;
    Exp2::init(); Sin::init(); Freqlut::init(sr); Lfo::init(sr); PitchEnv::init(sr); Env::init_sr(sr);
    EngineMkI markI;
    Controllers controls{};
    controls.core = &markI;
    controls.masterTune = 0;
    controls.values_[kControllerPitch] = 8192;
    controls.eg_mod = 127;
    static Lfo lfo{};
    lfo.reset(voice + 137);
    lfo.keydown();
    static Dx7Note note{};
    note.init(voice, std::atoi(argv[2]) + voice[144] - 24, std::atoi(argv[3]));
    if (voice[136]) note.oscSync();
    std::ofstream output(argv[6], std::ios::binary);
    const int gate = std::atoi(argv[4]), frames = std::atoi(argv[5]);
    for (int pos = 0; pos < frames; pos += N) {
        if (pos == gate) note.keyup();
        int32_t buffer[N]{};
        note.compute(buffer, lfo.getsample(), lfo.getdelay(), &controls);
        for (int i = 0; i < N && pos + i < frames; ++i) {
            float sample = buffer[i] / 16777216.f;
            output.write(reinterpret_cast<const char*>(&sample), sizeof(sample));
        }
    }
    return output ? 0 : 4;
}
