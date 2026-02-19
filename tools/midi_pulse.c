#include <CoreFoundation/CoreFoundation.h>
#include <CoreMIDI/CoreMIDI.h>

#include <ctype.h>
#include <errno.h>
#include <inttypes.h>
#include <limits.h>
#include <mach/mach_time.h>
#include <math.h>
#include <signal.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <strings.h>
#include <time.h>

typedef struct {
    const char *destination_spec;
    int channel;
    int note;
    int velocity;
    double interval_ms;
    double gate;
    long long count;
    int report_every;
    bool list_only;
    bool verbose;
} Config;

typedef struct {
    int64_t min_late_ns;
    int64_t max_late_ns;
    long double sum_late_ns;
    long double sum_abs_late_ns;
    uint64_t count;
} JitterStats;

static volatile sig_atomic_t g_keep_running = 1;
static mach_timebase_info_data_t g_timebase = {0, 0};

static void on_signal(int signo) {
    (void)signo;
    g_keep_running = 0;
}

static void print_usage(const char *prog) {
    fprintf(
        stderr,
        "Usage: %s [options]\n"
        "\n"
        "Emit periodic MIDI note on/off messages to a CoreMIDI destination.\n"
        "\n"
        "Options:\n"
        "  --list                         List MIDI output destinations and exit\n"
        "  -d, --dest <name|index>       Destination name (exact/substring) or index\n"
        "  -c, --channel <1-16>          MIDI channel (default: 1)\n"
        "  -n, --note <0-127>            MIDI note number (default: 60)\n"
        "  -v, --velocity <1-127>        Note-on velocity (default: 100)\n"
        "  -i, --interval-ms <ms>        Note period in milliseconds (default: 500)\n"
        "  -g, --gate <0.0-1.0>          Gate fraction of interval (default: 0.5)\n"
        "  -k, --count <N>               Number of notes; 0 means infinite (default: 0)\n"
        "      --report-every <N>        Print note-on jitter stats every N notes (default: 100)\n"
        "      --verbose                 Print per-note timing details\n"
        "  -h, --help                    Show this help\n"
        "\n"
        "Examples:\n"
        "  %s --list\n"
        "  %s --dest 0 --channel 1 --interval-ms 10 --note 60 --gate 0.25 --count 2000\n",
        prog,
        prog,
        prog);
}

static bool parse_int(const char *value, int min_value, int max_value, int *out) {
    char *end = NULL;
    errno = 0;
    long parsed = strtol(value, &end, 10);
    if (errno != 0 || end == value || *end != '\0') {
        return false;
    }
    if (parsed < min_value || parsed > max_value) {
        return false;
    }
    *out = (int)parsed;
    return true;
}

static bool parse_long_long(const char *value, long long min_value, long long max_value, long long *out) {
    char *end = NULL;
    errno = 0;
    long long parsed = strtoll(value, &end, 10);
    if (errno != 0 || end == value || *end != '\0') {
        return false;
    }
    if (parsed < min_value || parsed > max_value) {
        return false;
    }
    *out = parsed;
    return true;
}

static bool parse_double(const char *value, double min_value, double max_value, double *out) {
    char *end = NULL;
    errno = 0;
    double parsed = strtod(value, &end);
    if (errno != 0 || end == value || *end != '\0') {
        return false;
    }
    if (parsed < min_value || parsed > max_value) {
        return false;
    }
    *out = parsed;
    return true;
}

static bool is_unsigned_integer(const char *s) {
    if (s == NULL || *s == '\0') {
        return false;
    }
    for (const unsigned char *p = (const unsigned char *)s; *p != '\0'; ++p) {
        if (!isdigit(*p)) {
            return false;
        }
    }
    return true;
}

static bool parse_args(int argc, char **argv, Config *cfg) {
    *cfg = (Config){
        .destination_spec = NULL,
        .channel = 1,
        .note = 60,
        .velocity = 100,
        .interval_ms = 500.0,
        .gate = 0.5,
        .count = 0,
        .report_every = 100,
        .list_only = false,
        .verbose = false,
    };

    for (int i = 1; i < argc; ++i) {
        const char *arg = argv[i];
        if (strcmp(arg, "--list") == 0) {
            cfg->list_only = true;
            continue;
        }
        if (strcmp(arg, "--verbose") == 0) {
            cfg->verbose = true;
            continue;
        }
        if (strcmp(arg, "-h") == 0 || strcmp(arg, "--help") == 0) {
            print_usage(argv[0]);
            exit(0);
        }

        if (i + 1 >= argc) {
            fprintf(stderr, "Missing value for option: %s\n", arg);
            return false;
        }

        const char *value = argv[++i];
        if (strcmp(arg, "-d") == 0 || strcmp(arg, "--dest") == 0) {
            cfg->destination_spec = value;
            continue;
        }
        if (strcmp(arg, "-c") == 0 || strcmp(arg, "--channel") == 0) {
            if (!parse_int(value, 1, 16, &cfg->channel)) {
                fprintf(stderr, "Invalid channel: %s (expected 1-16)\n", value);
                return false;
            }
            continue;
        }
        if (strcmp(arg, "-n") == 0 || strcmp(arg, "--note") == 0) {
            if (!parse_int(value, 0, 127, &cfg->note)) {
                fprintf(stderr, "Invalid note: %s (expected 0-127)\n", value);
                return false;
            }
            continue;
        }
        if (strcmp(arg, "-v") == 0 || strcmp(arg, "--velocity") == 0) {
            if (!parse_int(value, 1, 127, &cfg->velocity)) {
                fprintf(stderr, "Invalid velocity: %s (expected 1-127)\n", value);
                return false;
            }
            continue;
        }
        if (strcmp(arg, "-i") == 0 || strcmp(arg, "--interval-ms") == 0) {
            if (!parse_double(value, 0.01, 3600000.0, &cfg->interval_ms)) {
                fprintf(stderr, "Invalid interval: %s (expected 0.01-3600000 ms)\n", value);
                return false;
            }
            continue;
        }
        if (strcmp(arg, "-g") == 0 || strcmp(arg, "--gate") == 0) {
            if (!parse_double(value, 0.0, 1.0, &cfg->gate)) {
                fprintf(stderr, "Invalid gate: %s (expected 0.0-1.0)\n", value);
                return false;
            }
            continue;
        }
        if (strcmp(arg, "-k") == 0 || strcmp(arg, "--count") == 0) {
            if (!parse_long_long(value, 0, LLONG_MAX, &cfg->count)) {
                fprintf(stderr, "Invalid count: %s (expected >= 0)\n", value);
                return false;
            }
            continue;
        }
        if (strcmp(arg, "--report-every") == 0) {
            if (!parse_int(value, 0, INT_MAX, &cfg->report_every)) {
                fprintf(stderr, "Invalid report interval: %s (expected >= 0)\n", value);
                return false;
            }
            continue;
        }

        fprintf(stderr, "Unknown option: %s\n", arg);
        return false;
    }

    return true;
}

static bool cfstring_to_cstring(CFStringRef s, char *dst, size_t dst_size) {
    if (s == NULL || dst == NULL || dst_size == 0) {
        return false;
    }
    return CFStringGetCString(s, dst, dst_size, kCFStringEncodingUTF8);
}

static void endpoint_name(MIDIEndpointRef endpoint, char *dst, size_t dst_size) {
    CFStringRef name = NULL;
    dst[0] = '\0';

    if (MIDIObjectGetStringProperty(endpoint, kMIDIPropertyDisplayName, &name) == noErr && name != NULL) {
        if (cfstring_to_cstring(name, dst, dst_size)) {
            CFRelease(name);
            return;
        }
        CFRelease(name);
    }

    name = NULL;
    if (MIDIObjectGetStringProperty(endpoint, kMIDIPropertyName, &name) == noErr && name != NULL) {
        if (cfstring_to_cstring(name, dst, dst_size)) {
            CFRelease(name);
            return;
        }
        CFRelease(name);
    }

    snprintf(dst, dst_size, "<unknown>");
}

static void list_destinations(void) {
    ItemCount count = MIDIGetNumberOfDestinations();
    printf("MIDI destinations: %" PRIuPTR "\n", (uintptr_t)count);

    for (ItemCount i = 0; i < count; ++i) {
        MIDIEndpointRef endpoint = MIDIGetDestination(i);
        if (endpoint == 0) {
            printf("  [%" PRIuPTR "] <unavailable>\n", (uintptr_t)i);
            continue;
        }

        char name[256];
        endpoint_name(endpoint, name, sizeof(name));
        SInt32 unique_id = 0;
        MIDIObjectGetIntegerProperty(endpoint, kMIDIPropertyUniqueID, &unique_id);
        printf("  [%" PRIuPTR "] %s (uid=%d)\n", (uintptr_t)i, name, (int)unique_id);
    }
}

static bool contains_case_insensitive(const char *haystack, const char *needle) {
    if (*needle == '\0') {
        return true;
    }
    const size_t needle_len = strlen(needle);
    for (const char *h = haystack; *h != '\0'; ++h) {
        size_t j = 0;
        while (j < needle_len && h[j] != '\0' &&
               tolower((unsigned char)h[j]) == tolower((unsigned char)needle[j])) {
            ++j;
        }
        if (j == needle_len) {
            return true;
        }
    }
    return false;
}

static bool resolve_destination(const char *spec, MIDIEndpointRef *endpoint_out, ItemCount *index_out, char *name_out, size_t name_size) {
    ItemCount count = MIDIGetNumberOfDestinations();
    if (count == 0) {
        fprintf(stderr, "No MIDI destinations found. Enable IAC Driver or attach a MIDI device.\n");
        return false;
    }

    if (is_unsigned_integer(spec)) {
        char *end = NULL;
        unsigned long idx = strtoul(spec, &end, 10);
        if (end == spec || *end != '\0' || idx >= (unsigned long)count) {
            fprintf(stderr, "Destination index out of range: %s\n", spec);
            return false;
        }
        *index_out = (ItemCount)idx;
        *endpoint_out = MIDIGetDestination(*index_out);
        if (*endpoint_out == 0) {
            fprintf(stderr, "Destination index %lu is unavailable.\n", idx);
            return false;
        }
        endpoint_name(*endpoint_out, name_out, name_size);
        return true;
    }

    bool exact_found = false;
    ItemCount exact_index = 0;
    bool partial_found = false;
    ItemCount partial_index = 0;
    int partial_count = 0;

    for (ItemCount i = 0; i < count; ++i) {
        MIDIEndpointRef endpoint = MIDIGetDestination(i);
        if (endpoint == 0) {
            continue;
        }

        char name[256];
        endpoint_name(endpoint, name, sizeof(name));
        if (strcasecmp(name, spec) == 0) {
            exact_found = true;
            exact_index = i;
            break;
        }
        if (contains_case_insensitive(name, spec)) {
            partial_found = true;
            partial_index = i;
            partial_count += 1;
        }
    }

    if (exact_found) {
        *index_out = exact_index;
        *endpoint_out = MIDIGetDestination(exact_index);
        endpoint_name(*endpoint_out, name_out, name_size);
        return true;
    }
    if (partial_found && partial_count == 1) {
        *index_out = partial_index;
        *endpoint_out = MIDIGetDestination(partial_index);
        endpoint_name(*endpoint_out, name_out, name_size);
        return true;
    }
    if (partial_count > 1) {
        fprintf(stderr, "Destination match is ambiguous for '%s'. Use --list and choose index.\n", spec);
        return false;
    }

    fprintf(stderr, "No MIDI destination matching '%s'. Use --list to inspect options.\n", spec);
    return false;
}

static uint64_t host_to_ns(uint64_t host_ticks) {
    return (uint64_t)(((__uint128_t)host_ticks * g_timebase.numer) / g_timebase.denom);
}

static uint64_t ns_to_host(uint64_t ns) {
    return (uint64_t)(((__uint128_t)ns * g_timebase.denom) / g_timebase.numer);
}

static uint64_t now_host(void) {
    return mach_absolute_time();
}

static int64_t delta_ns_from_host(uint64_t actual, uint64_t target) {
    if (actual >= target) {
        return (int64_t)host_to_ns(actual - target);
    }
    return -(int64_t)host_to_ns(target - actual);
}

static void sleep_until_host(uint64_t target_host) {
    while (g_keep_running) {
        uint64_t current = now_host();
        if (current >= target_host) {
            return;
        }

        uint64_t remaining_ns = host_to_ns(target_host - current);
        if (remaining_ns > 2000000ULL) {
            uint64_t sleep_ns = remaining_ns - 500000ULL;
            struct timespec req = {
                .tv_sec = (time_t)(sleep_ns / 1000000000ULL),
                .tv_nsec = (long)(sleep_ns % 1000000000ULL),
            };
            nanosleep(&req, NULL);
        } else if (remaining_ns > 100000ULL) {
            struct timespec req = {.tv_sec = 0, .tv_nsec = (long)(remaining_ns / 2ULL)};
            nanosleep(&req, NULL);
        }
    }
}

static OSStatus send_short_at(
    MIDIPortRef port,
    MIDIEndpointRef destination,
    MIDITimeStamp timestamp,
    UInt8 status,
    UInt8 data1,
    UInt8 data2) {
    Byte buffer[256];
    MIDIPacketList *packet_list = (MIDIPacketList *)buffer;
    MIDIPacket *packet = MIDIPacketListInit(packet_list);
    Byte data[3] = {status, data1, data2};
    packet = MIDIPacketListAdd(packet_list, sizeof(buffer), packet, timestamp, (ByteCount)sizeof(data), data);
    if (packet == NULL) {
        return -1;
    }
    return MIDISend(port, destination, packet_list);
}

static void stats_init(JitterStats *stats) {
    stats->min_late_ns = INT64_MAX;
    stats->max_late_ns = INT64_MIN;
    stats->sum_late_ns = 0.0L;
    stats->sum_abs_late_ns = 0.0L;
    stats->count = 0;
}

static void stats_add(JitterStats *stats, int64_t late_ns) {
    if (late_ns < stats->min_late_ns) {
        stats->min_late_ns = late_ns;
    }
    if (late_ns > stats->max_late_ns) {
        stats->max_late_ns = late_ns;
    }
    stats->sum_late_ns += (long double)late_ns;
    stats->sum_abs_late_ns += fabsl((long double)late_ns);
    stats->count += 1;
}

static void stats_print(const JitterStats *stats, uint64_t note_count) {
    if (stats->count == 0) {
        return;
    }
    long double mean_ms = (stats->sum_late_ns / (long double)stats->count) / 1000000.0L;
    long double abs_mean_ms = (stats->sum_abs_late_ns / (long double)stats->count) / 1000000.0L;
    long double min_ms = (long double)stats->min_late_ns / 1000000.0L;
    long double max_ms = (long double)stats->max_late_ns / 1000000.0L;
    printf(
        "note_on=%" PRIu64 " late(ms): mean=%0.4Lf abs_mean=%0.4Lf min=%0.4Lf max=%0.4Lf\n",
        note_count,
        mean_ms,
        abs_mean_ms,
        min_ms,
        max_ms);
    fflush(stdout);
}

int main(int argc, char **argv) {
    Config cfg;
    if (!parse_args(argc, argv, &cfg)) {
        print_usage(argv[0]);
        return 2;
    }

    if (cfg.list_only) {
        list_destinations();
        return 0;
    }

    if (cfg.destination_spec == NULL) {
        fprintf(stderr, "Missing destination. Use --dest <name|index>.\n");
        print_usage(argv[0]);
        return 2;
    }

    mach_timebase_info(&g_timebase);
    if (g_timebase.denom == 0) {
        fprintf(stderr, "Unable to read mach timebase.\n");
        return 1;
    }

    MIDIEndpointRef destination = 0;
    ItemCount destination_index = 0;
    char destination_name[256];
    if (!resolve_destination(cfg.destination_spec, &destination, &destination_index, destination_name, sizeof(destination_name))) {
        return 1;
    }

    MIDIClientRef client = 0;
    MIDIPortRef output_port = 0;
    OSStatus status = MIDIClientCreate(CFSTR("VisualCSound MIDI Pulse Client"), NULL, NULL, &client);
    if (status != noErr) {
        fprintf(stderr, "MIDIClientCreate failed: %d\n", (int)status);
        return 1;
    }
    status = MIDIOutputPortCreate(client, CFSTR("VisualCSound MIDI Pulse Out"), &output_port);
    if (status != noErr) {
        fprintf(stderr, "MIDIOutputPortCreate failed: %d\n", (int)status);
        MIDIClientDispose(client);
        return 1;
    }

    signal(SIGINT, on_signal);
    signal(SIGTERM, on_signal);

    const uint8_t channel_zero_based = (uint8_t)(cfg.channel - 1);
    const uint8_t note = (uint8_t)cfg.note;
    const uint8_t velocity = (uint8_t)cfg.velocity;
    const uint64_t interval_ns = (uint64_t)llround(cfg.interval_ms * 1000000.0);
    const uint64_t gate_ns = (uint64_t)llround((long double)interval_ns * cfg.gate);
    const uint64_t interval_host = ns_to_host(interval_ns);
    const uint64_t gate_host = ns_to_host(gate_ns);
    uint64_t schedule_lead_ns = interval_ns / 2ULL;
    if (schedule_lead_ns > 2000000ULL) {
        schedule_lead_ns = 2000000ULL;
    }
    const uint64_t schedule_lead_host = ns_to_host(schedule_lead_ns);

    printf(
        "Destination [%" PRIuPTR "]: %s | channel=%d note=%d velocity=%d interval=%.3fms gate=%.3f count=%lld lead=%0.3Lfms\n",
        (uintptr_t)destination_index,
        destination_name,
        cfg.channel,
        cfg.note,
        cfg.velocity,
        cfg.interval_ms,
        cfg.gate,
        cfg.count,
        (long double)schedule_lead_ns / 1000000.0L);
    printf("Press Ctrl+C to stop.\n");
    fflush(stdout);

    JitterStats stats;
    stats_init(&stats);

    bool note_is_on = false;
    uint64_t sent_notes = 0;
    uint64_t start_host = now_host() + ns_to_host(500000000ULL);

    for (long long i = 0; g_keep_running && (cfg.count == 0 || i < cfg.count); ++i) {
        uint64_t on_target = start_host + (uint64_t)i * interval_host;
        uint64_t dispatch_target = on_target;
        if (dispatch_target > schedule_lead_host) {
            dispatch_target -= schedule_lead_host;
        }
        sleep_until_host(dispatch_target);
        if (!g_keep_running) {
            break;
        }

        uint64_t dispatch_now = now_host();
        int64_t late_ns = delta_ns_from_host(dispatch_now, on_target);
        status = send_short_at(
            output_port,
            destination,
            (MIDITimeStamp)on_target,
            (uint8_t)(0x90U | channel_zero_based),
            note,
            velocity);
        if (status != noErr) {
            fprintf(stderr, "Failed to send note_on: %d\n", (int)status);
            break;
        }
        note_is_on = true;
        sent_notes += 1;
        stats_add(&stats, late_ns);

        if (cfg.verbose) {
            printf("on #%" PRIu64 " late=%0.4Lfms\n", sent_notes, (long double)late_ns / 1000000.0L);
            fflush(stdout);
        }
        if (cfg.report_every > 0 && sent_notes % (uint64_t)cfg.report_every == 0) {
            stats_print(&stats, sent_notes);
        }

        uint64_t off_target = on_target + gate_host;
        status = send_short_at(
            output_port,
            destination,
            (MIDITimeStamp)off_target,
            (uint8_t)(0x80U | channel_zero_based),
            note,
            0);
        if (status != noErr) {
            fprintf(stderr, "Failed to send note_off: %d\n", (int)status);
            break;
        }
        note_is_on = false;
    }

    if (note_is_on) {
        send_short_at(output_port, destination, (MIDITimeStamp)now_host(), (uint8_t)(0x80U | channel_zero_based), note, 0);
    }

    send_short_at(output_port, destination, (MIDITimeStamp)now_host(), (uint8_t)(0xB0U | channel_zero_based), 123, 0);
    send_short_at(output_port, destination, (MIDITimeStamp)now_host(), (uint8_t)(0xB0U | channel_zero_based), 120, 0);

    stats_print(&stats, sent_notes);

    MIDIPortDispose(output_port);
    MIDIClientDispose(client);
    return 0;
}
