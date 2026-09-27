"""Opt-in monophonic phrases shared by host MIDI, MIDI files and score events.

Collectors run before every synthesis instrument. Each held collector nominates
its serial number every control period; the newest nomination wins. Absence is
also meaningful, so hard-killed collectors cannot leave a stuck gate. The voice
consumes and clears the nominations only after *all* note events at the boundary.
No timers, note-off grace period, or Python-side voice state are involved.
"""

from hashlib import sha256
import re

from backend.app.services.compiler_common import CompilationError


def has_legato(patch) -> bool:
    return any(node.opcode == "midi_legato" for node in patch.graph.nodes)


def validate_legato(patch) -> None:
    nodes = [node for node in patch.graph.nodes if node.opcode == "midi_legato"]
    if not nodes:
        return
    if len(nodes) != 1:
        raise CompilationError(["Use exactly one root-level midi_legato node per instrument."])
    if patch.always_on:
        raise CompilationError(["midi_legato requires a MIDI-activated instrument, not Continuous."])
    if not any(node.opcode == "madsr" for node in patch.graph.nodes):
        raise CompilationError(["midi_legato requires a madsr phrase envelope."])
    # Native release opcodes observe the persistent voice, not the phrase gate.
    unsupported = {"mxadsr", "linsegr", "expsegr", "release", "turnoff", "turnoff2", "xtratim"}
    found = sorted({node.opcode for node in patch.graph.nodes} & unsupported)
    if found:
        raise CompilationError(
            ["midi_legato supports madsr phrase releases; incompatible opcodes: " + ", ".join(found)]
        )


def state_prefix(identity: str) -> str:
    return "vcs_legato_" + sha256(identity.encode()).hexdigest()[:20]


# UDOs are emitted once per orchestra, only when legato is used. The ADSR has
# native madsr's linear segments and explicit/default release-time semantics.
LEGATO_OPCODES = """opcode vcs_legato_adsr, k, kiiiki
 kGate, iAttack, iDecay, iSustain, kRelease, iDelay xin
 kAge init 0
 kValue init 0
 kPreviousGate init 0
 kReleaseAge init 0
 kReleaseValue init 0
 if kGate > 0 then
  kTime = kAge - iDelay
  if kTime < 0 then
   kValue = 0
  elseif kTime < iAttack then
   kValue = kTime / max(iAttack, 1 / kr)
  elseif kTime < iAttack + iDecay then
   kValue = 1 + (iSustain - 1) * (kTime - iAttack) / max(iDecay, 1 / kr)
  else
   kValue = iSustain
  endif
  kAge = kAge + 1 / kr
 else
  if kPreviousGate > 0 then
   kReleaseAge = 0
   kReleaseValue = kValue
  endif
  kValue = kReleaseValue * max(0, 1 - kReleaseAge / max(kRelease, 1 / kr))
  kReleaseAge = kReleaseAge + 1 / kr
 endif
 kPreviousGate = kGate
 xout kValue
endop

; Preserve the preceding output sample across phrase reinitialization. This is
; an amplitude declick only, never a pitch ramp or a delayed note decision.
opcode vcs_legato_declick, a, ak
 setksmps 1
 aInput, kPhrase xin
 kPreviousPhrase init 0
 kLast init 0
 kHeld init 0
 kBlend init 1
 if kPhrase != kPreviousPhrase then
  kHeld = kLast
  kBlend = 0
  kPreviousPhrase = kPhrase
 endif
 aOutput = aInput * kBlend + kHeld * (1 - kBlend)
 kLast downsamp aOutput
 kBlend = min(1, kBlend + 1 / (0.002 * sr))
 xout aOutput
endop"""


def collector_lines(identity: str, number: int, input_mode: str) -> list[str]:
    prefix = state_prefix(identity)
    lines = [
        f"gi_{prefix}_serial init 0",
        f"gk_{prefix}_winner init 0",
        f"gk_{prefix}_note init 69",
        f"gk_{prefix}_velocity init 0",
        f"gk_{prefix}_channel init 1",
        f"gk_{prefix}_seen init 0",
        f"gk_{prefix}_cancelled init 0",
        "; legato note-event collector (not subject to synthesis maxalloc)",
        f"instr {number}",
        f" gi_{prefix}_serial = gi_{prefix}_serial + 1",
        f" iSerial = gi_{prefix}_serial",
    ]
    if input_mode == "score":
        # p6 preserves event order even when Csound sorts equal-time score lines
        # by duration. The exporter supplies it; handwritten scores may omit it.
        lines += [" iNote = p4", " iVelocity = p5", " iChannel = p7", " iSerial = (p6 > 0 ? p6 : iSerial)"]
    else:
        lines += [" iNote notnum", " iVelocity veloc 0, 127", " iChannel midichn"]
    lines += [
        " xtratim ksmps / sr",
        " kReleased release",
        f" if iSerial <= gk_{prefix}_cancelled then",
        "  turnoff",
        f" elseif kReleased == 0 && iSerial > gk_{prefix}_winner then",
        f"  gk_{prefix}_winner = iSerial",
        f"  gk_{prefix}_note = iNote",
        f"  gk_{prefix}_velocity = iVelocity",
        f"  gk_{prefix}_channel = iChannel",
        " endif",
        "endin",
    ]
    return lines


def panic_listener_lines(identities_and_channels: list[tuple[str, int]]) -> list[str]:
    """Csound handles CC123 natively but needs explicit CC120 handling.

    Count raw note-ons in the same order as automatic MIDI allocation. A panic
    cancels only preceding notes, so a following note-on at this very boundary
    survives. The observer precedes collectors and never emits audio.
    """
    lines = ["alwayson 1", "instr 1", "VCS_LEGATO_MIDI:", " kStatus, kChannel, kData1, kData2 midiin"]
    for identity, channel in identities_and_channels:
        prefix = state_prefix(identity)
        condition = "kChannel > 0" if channel == 0 else f"kChannel == {channel}"
        lines += [
            f" if {condition} then",
            "  if kStatus == 144 && kData2 > 0 then",
            f"   gk_{prefix}_seen = gk_{prefix}_seen + 1",
            "  elseif kStatus == 176 && kData1 == 120 then",
            f"   gk_{prefix}_cancelled = gk_{prefix}_seen",
            "  endif",
            " endif",
        ]
    return [*lines, " if kStatus != 0 kgoto VCS_LEGATO_MIDI", "endin"]


def phrase_prefix(identity: str) -> list[str]:
    prefix = state_prefix(identity)
    return [
        "; Commit the boundary after all collectors, before synthesis.",
        "k_vcs_legato_previous_gate init 0",
        "k_vcs_legato_phrase init 0",
        "k_vcs_legato_release init 0",
        "k_vcs_legato_current_release = 0",
        f"k_vcs_legato_gate = (gk_{prefix}_winner > 0 ? 1 : 0)",
        "k_vcs_legato_start = (k_vcs_legato_gate > k_vcs_legato_previous_gate ? 1 : 0)",
        "k_vcs_legato_previous_gate = k_vcs_legato_gate",
        f"gk_{prefix}_winner = 0",
        "if k_vcs_legato_start == 1 then",
        " k_vcs_legato_phrase = k_vcs_legato_phrase + 1",
        " reinit VCS_LEGATO_PHRASE",
        "endif",
        "VCS_LEGATO_PHRASE:",
        f"i_vcs_legato_note = i(gk_{prefix}_note)",
        f"i_vcs_legato_velocity = i(gk_{prefix}_velocity)",
    ]


def midi_opcode(opcode, env, identity, score_renderer):
    prefix = state_prefix(identity)
    if opcode == "midi_legato":
        return (
            f"{env['kfreq']} = cpsmidinn(gk_{prefix}_note)\n"
            f"{env['kvelocity']} portk gk_{prefix}_velocity / 128, 0.01, i_vcs_legato_velocity / 128"
        )
    if opcode in {"cpsmidi", "ampmidi", "midi_note", "notnum"}:
        rendered = re.sub(r"\bp4\b", "i_vcs_legato_note", score_renderer())
        return re.sub(r"\bp5\b", "i_vcs_legato_velocity", rendered)
    return None
