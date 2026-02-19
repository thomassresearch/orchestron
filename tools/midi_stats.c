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
    long long count;
    int report_every;
    bool list_only;
} Config;

typedef struct {
    int64_t min_ns;
    int64_t max_ns;
    long double sum_ns;
    long double sum_sq_ns;
    uint64_t count;
} IntervalStats;

typedef struct {
    int64_t min_ns;
    int64_t max_ns;
    long double sum_ns;
    long double sum_abs_ns;
    long double sum_sq_ns;
    uint64_t count;
} JitterStats;

typedef struct {
    bool have_previous;
    MIDITimeStamp previous_timestamp;
    bool have_reference_interval;
    int64_t reference_interval_ns;
    uint64_t events_seen;
    uint64_t intervals_seen;
    IntervalStats interval;
    JitterStats jitter;
} SeriesStats;

typedef struct {
    Config cfg;
    uint64_t events_seen;
    uint64_t timestamped_events;
    uint64_t untimestamped_events;
    SeriesStats effective_series;
    SeriesStats timestamped_series;
    JitterStats arrival_vs_timestamp;
} RuntimeState;

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
        "Receive MIDI note-on events on macOS CoreMIDI and report interval/jitter stats.\n"
        "\n"
        "Options:\n"
        "  --list                         List MIDI input sources and exit\n"
        "  -d, --dest <name|index>       Source name (exact/substring) or index\n"
        "  -c, --channel <1-16>          MIDI channel filter (default: 1)\n"
        "  -k, --count <N>               Number of events before exit; 0 means infinite (default: 0)\n"
        "      --report-every <N>        Print stats every N matching events (default: 100)\n"
        "  -h, --help                    Show this help\n"
        "\n"
        "Example:\n"
        "  %s --dest 0 --channel 1 --report-every 250\n",
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
        .count = 0,
        .report_every = 100,
        .list_only = false,
    };

    for (int i = 1; i < argc; ++i) {
        const char *arg = argv[i];
        if (strcmp(arg, "--list") == 0) {
            cfg->list_only = true;
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
        if (strcmp(arg, "-k") == 0 || strcmp(arg, "--count") == 0) {
            if (!parse_long_long(value, 0, LLONG_MAX, &cfg->count)) {
                fprintf(stderr, "Invalid count: %s (expected >= 0)\n", value);
                return false;
            }
            continue;
        }
        if (strcmp(arg, "--report-every") == 0) {
            if (!parse_int(value, 1, INT_MAX, &cfg->report_every)) {
                fprintf(stderr, "Invalid report interval: %s (expected >= 1)\n", value);
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

static void list_sources(void) {
    ItemCount count = MIDIGetNumberOfSources();
    printf("MIDI sources: %" PRIuPTR "\n", (uintptr_t)count);

    for (ItemCount i = 0; i < count; ++i) {
        MIDIEndpointRef endpoint = MIDIGetSource(i);
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

static bool resolve_source(const char *spec, MIDIEndpointRef *endpoint_out, ItemCount *index_out, char *name_out, size_t name_size) {
    ItemCount count = MIDIGetNumberOfSources();
    if (count == 0) {
        fprintf(stderr, "No MIDI sources found. Ensure a sender is connected or IAC Driver is enabled.\n");
        return false;
    }

    if (is_unsigned_integer(spec)) {
        char *end = NULL;
        unsigned long idx = strtoul(spec, &end, 10);
        if (end == spec || *end != '\0' || idx >= (unsigned long)count) {
            fprintf(stderr, "Source index out of range: %s\n", spec);
            return false;
        }
        *index_out = (ItemCount)idx;
        *endpoint_out = MIDIGetSource(*index_out);
        if (*endpoint_out == 0) {
            fprintf(stderr, "Source index %lu is unavailable.\n", idx);
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
        MIDIEndpointRef endpoint = MIDIGetSource(i);
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
        *endpoint_out = MIDIGetSource(exact_index);
        endpoint_name(*endpoint_out, name_out, name_size);
        return true;
    }
    if (partial_found && partial_count == 1) {
        *index_out = partial_index;
        *endpoint_out = MIDIGetSource(partial_index);
        endpoint_name(*endpoint_out, name_out, name_size);
        return true;
    }
    if (partial_count > 1) {
        fprintf(stderr, "Source match is ambiguous for '%s'. Use --list and choose index.\n", spec);
        return false;
    }

    fprintf(stderr, "No MIDI source matching '%s'. Use --list to inspect options.\n", spec);
    return false;
}

static uint64_t host_to_ns(uint64_t host_ticks) {
    return (uint64_t)(((__uint128_t)host_ticks * g_timebase.numer) / g_timebase.denom);
}

static int64_t delta_ns_from_host(uint64_t newer, uint64_t older) {
    if (newer >= older) {
        return (int64_t)host_to_ns(newer - older);
    }
    return -(int64_t)host_to_ns(older - newer);
}

static uint64_t now_host(void) {
    return mach_absolute_time();
}

static void interval_init(IntervalStats *stats) {
    stats->min_ns = INT64_MAX;
    stats->max_ns = INT64_MIN;
    stats->sum_ns = 0.0L;
    stats->sum_sq_ns = 0.0L;
    stats->count = 0;
}

static void interval_add(IntervalStats *stats, int64_t value_ns) {
    if (value_ns < stats->min_ns) {
        stats->min_ns = value_ns;
    }
    if (value_ns > stats->max_ns) {
        stats->max_ns = value_ns;
    }
    long double value = (long double)value_ns;
    stats->sum_ns += value;
    stats->sum_sq_ns += value * value;
    stats->count += 1;
}

static void jitter_init(JitterStats *stats) {
    stats->min_ns = INT64_MAX;
    stats->max_ns = INT64_MIN;
    stats->sum_ns = 0.0L;
    stats->sum_abs_ns = 0.0L;
    stats->sum_sq_ns = 0.0L;
    stats->count = 0;
}

static void jitter_add(JitterStats *stats, int64_t value_ns) {
    if (value_ns < stats->min_ns) {
        stats->min_ns = value_ns;
    }
    if (value_ns > stats->max_ns) {
        stats->max_ns = value_ns;
    }
    long double value = (long double)value_ns;
    stats->sum_ns += value;
    stats->sum_abs_ns += fabsl(value);
    stats->sum_sq_ns += value * value;
    stats->count += 1;
}

static void series_init(SeriesStats *series) {
    series->have_previous = false;
    series->previous_timestamp = 0;
    series->have_reference_interval = false;
    series->reference_interval_ns = 0;
    series->events_seen = 0;
    series->intervals_seen = 0;
    interval_init(&series->interval);
    jitter_init(&series->jitter);
}

static void series_add_event(SeriesStats *series, MIDITimeStamp timestamp) {
    if (!series->have_previous) {
        series->have_previous = true;
        series->previous_timestamp = timestamp;
        series->events_seen = 1;
        return;
    }

    int64_t interval_ns = delta_ns_from_host((uint64_t)timestamp, (uint64_t)series->previous_timestamp);
    series->previous_timestamp = timestamp;
    series->events_seen += 1;

    if (!series->have_reference_interval) {
        series->reference_interval_ns = interval_ns;
        series->have_reference_interval = true;
    }

    int64_t jitter_ns = interval_ns - series->reference_interval_ns;
    interval_add(&series->interval, interval_ns);
    jitter_add(&series->jitter, jitter_ns);
    series->intervals_seen += 1;
}

static long double stats_stddev(long double sum, long double sum_sq, uint64_t count) {
    if (count == 0) {
        return 0.0L;
    }
    long double mean = sum / (long double)count;
    long double variance = (sum_sq / (long double)count) - (mean * mean);
    if (variance < 0.0L) {
        variance = 0.0L;
    }
    return sqrtl(variance);
}

static void print_series_report(const char *label, const SeriesStats *series) {
    if (series->interval.count == 0 || series->jitter.count == 0) {
        printf("%s intervals: insufficient data (need at least 2 events)\n", label);
        return;
    }

    long double interval_mean_ms = (series->interval.sum_ns / (long double)series->interval.count) / 1000000.0L;
    long double interval_std_ms =
        stats_stddev(series->interval.sum_ns, series->interval.sum_sq_ns, series->interval.count) / 1000000.0L;
    long double interval_min_ms = (long double)series->interval.min_ns / 1000000.0L;
    long double interval_max_ms = (long double)series->interval.max_ns / 1000000.0L;

    long double jitter_mean_ms = (series->jitter.sum_ns / (long double)series->jitter.count) / 1000000.0L;
    long double jitter_abs_mean_ms = (series->jitter.sum_abs_ns / (long double)series->jitter.count) / 1000000.0L;
    long double jitter_std_ms =
        stats_stddev(series->jitter.sum_ns, series->jitter.sum_sq_ns, series->jitter.count) / 1000000.0L;
    long double jitter_min_ms = (long double)series->jitter.min_ns / 1000000.0L;
    long double jitter_max_ms = (long double)series->jitter.max_ns / 1000000.0L;
    long double reference_ms = (long double)series->reference_interval_ns / 1000000.0L;

    printf(
        "%s intervals=%" PRIu64
        " interval(ms): mean=%0.4Lf std=%0.4Lf min=%0.4Lf max=%0.4Lf"
        " | jitter_vs_first(ms): ref=%0.4Lf mean=%0.4Lf abs_mean=%0.4Lf std=%0.4Lf min=%0.4Lf max=%0.4Lf\n",
        label,
        series->intervals_seen,
        interval_mean_ms,
        interval_std_ms,
        interval_min_ms,
        interval_max_ms,
        reference_ms,
        jitter_mean_ms,
        jitter_abs_mean_ms,
        jitter_std_ms,
        jitter_min_ms,
        jitter_max_ms);
}

static void print_lateness_report(const JitterStats *stats) {
    if (stats->count == 0) {
        printf("arrival_vs_timestamp(ms): no timestamped events\n");
        return;
    }

    long double mean_ms = (stats->sum_ns / (long double)stats->count) / 1000000.0L;
    long double abs_mean_ms = (stats->sum_abs_ns / (long double)stats->count) / 1000000.0L;
    long double std_ms = stats_stddev(stats->sum_ns, stats->sum_sq_ns, stats->count) / 1000000.0L;
    long double min_ms = (long double)stats->min_ns / 1000000.0L;
    long double max_ms = (long double)stats->max_ns / 1000000.0L;

    printf(
        "arrival_vs_timestamp(ms): mean=%0.4Lf abs_mean=%0.4Lf std=%0.4Lf min=%0.4Lf max=%0.4Lf samples=%" PRIu64 "\n",
        mean_ms,
        abs_mean_ms,
        std_ms,
        min_ms,
        max_ms,
        stats->count);
}

static void print_report(const RuntimeState *state, bool final_report) {
    long double timestamp_ratio = 0.0L;
    if (state->events_seen > 0) {
        timestamp_ratio = ((long double)state->timestamped_events / (long double)state->events_seen) * 100.0L;
    }

    printf(
        "%s events=%" PRIu64 " timestamped=%" PRIu64 " untimestamped=%" PRIu64 " ts_ratio=%0.2Lf%%\n",
        final_report ? "final" : "report",
        state->events_seen,
        state->timestamped_events,
        state->untimestamped_events,
        timestamp_ratio);

    print_series_report("effective_event_time", &state->effective_series);
    print_series_report("timestamp_only", &state->timestamped_series);
    print_lateness_report(&state->arrival_vs_timestamp);
    fflush(stdout);
}

static void on_matching_event(RuntimeState *state, MIDITimeStamp packet_timestamp, MIDITimeStamp arrival_timestamp) {
    bool has_packet_timestamp = packet_timestamp != 0;
    MIDITimeStamp effective_timestamp = has_packet_timestamp ? packet_timestamp : arrival_timestamp;

    state->events_seen += 1;
    if (has_packet_timestamp) {
        state->timestamped_events += 1;
        series_add_event(&state->timestamped_series, packet_timestamp);
        int64_t arrival_lateness_ns = delta_ns_from_host((uint64_t)arrival_timestamp, (uint64_t)packet_timestamp);
        jitter_add(&state->arrival_vs_timestamp, arrival_lateness_ns);
    } else {
        state->untimestamped_events += 1;
    }

    series_add_event(&state->effective_series, effective_timestamp);

    if (state->cfg.report_every > 0 && (state->events_seen % (uint64_t)state->cfg.report_every) == 0) {
        print_report(state, false);
    }

    if (state->cfg.count > 0 && (long long)state->events_seen >= state->cfg.count) {
        g_keep_running = 0;
    }
}

static int midi_channel_message_length(UInt8 status) {
    UInt8 hi = status & 0xF0U;
    if (hi == 0xC0U || hi == 0xD0U) {
        return 2;
    }
    return 3;
}

static int midi_system_message_length(UInt8 status) {
    switch (status) {
        case 0xF1U:
        case 0xF3U:
            return 2;
        case 0xF2U:
            return 3;
        case 0xF6U:
        case 0xF8U:
        case 0xFAU:
        case 0xFBU:
        case 0xFCU:
        case 0xFEU:
        case 0xFFU:
            return 1;
        default:
            return 0;
    }
}

static void process_packet_bytes(
    RuntimeState *state,
    MIDITimeStamp packet_timestamp,
    MIDITimeStamp arrival_timestamp,
    const Byte *data,
    size_t length) {
    size_t i = 0;
    while (i < length) {
        UInt8 status = data[i];
        if ((status & 0x80U) == 0U) {
            i += 1;
            continue;
        }

        if (status >= 0xF0U) {
            if (status == 0xF0U) {
                i += 1;
                while (i < length && data[i] != 0xF7U) {
                    i += 1;
                }
                if (i < length) {
                    i += 1;
                }
                continue;
            }
            int system_len = midi_system_message_length(status);
            if (system_len == 0) {
                i += 1;
                continue;
            }
            if (i + (size_t)system_len > length) {
                break;
            }
            i += (size_t)system_len;
            continue;
        }

        int msg_len = midi_channel_message_length(status);
        if (i + (size_t)msg_len > length) {
            break;
        }

        int channel = (int)(status & 0x0FU) + 1;
        UInt8 hi = status & 0xF0U;
        if (channel == state->cfg.channel && hi == 0x90U && msg_len == 3) {
            UInt8 velocity = data[i + 2];
            if (velocity > 0U) {
                on_matching_event(state, packet_timestamp, arrival_timestamp);
            }
        }
        i += (size_t)msg_len;
    }
}

static void midi_read_proc(const MIDIPacketList *pktlist, void *read_proc_refcon, void *src_conn_refcon) {
    (void)src_conn_refcon;
    RuntimeState *state = (RuntimeState *)read_proc_refcon;
    if (state == NULL || pktlist == NULL || !g_keep_running) {
        return;
    }

    const MIDIPacket *packet = &pktlist->packet[0];
    for (UInt32 i = 0; i < pktlist->numPackets && g_keep_running; ++i) {
        MIDITimeStamp arrival_timestamp = (MIDITimeStamp)now_host();
        process_packet_bytes(state, packet->timeStamp, arrival_timestamp, packet->data, packet->length);
        packet = MIDIPacketNext(packet);
    }
}

int main(int argc, char **argv) {
    Config cfg;
    if (!parse_args(argc, argv, &cfg)) {
        print_usage(argv[0]);
        return 2;
    }

    if (cfg.list_only) {
        list_sources();
        return 0;
    }

    if (cfg.destination_spec == NULL) {
        fprintf(stderr, "Missing source. Use --dest <name|index>.\n");
        print_usage(argv[0]);
        return 2;
    }

    mach_timebase_info(&g_timebase);
    if (g_timebase.denom == 0) {
        fprintf(stderr, "Unable to read mach timebase.\n");
        return 1;
    }

    MIDIEndpointRef source = 0;
    ItemCount source_index = 0;
    char source_name[256];
    if (!resolve_source(cfg.destination_spec, &source, &source_index, source_name, sizeof(source_name))) {
        return 1;
    }

    RuntimeState state = {0};
    state.cfg = cfg;
    series_init(&state.effective_series);
    series_init(&state.timestamped_series);
    jitter_init(&state.arrival_vs_timestamp);

    MIDIClientRef client = 0;
    MIDIPortRef input_port = 0;
    OSStatus status = MIDIClientCreate(CFSTR("VisualCSound MIDI Stats Client"), NULL, NULL, &client);
    if (status != noErr) {
        fprintf(stderr, "MIDIClientCreate failed: %d\n", (int)status);
        return 1;
    }

    status = MIDIInputPortCreate(client, CFSTR("VisualCSound MIDI Stats In"), midi_read_proc, &state, &input_port);
    if (status != noErr) {
        fprintf(stderr, "MIDIInputPortCreate failed: %d\n", (int)status);
        MIDIClientDispose(client);
        return 1;
    }

    status = MIDIPortConnectSource(input_port, source, NULL);
    if (status != noErr) {
        fprintf(stderr, "MIDIPortConnectSource failed: %d\n", (int)status);
        MIDIPortDispose(input_port);
        MIDIClientDispose(client);
        return 1;
    }

    signal(SIGINT, on_signal);
    signal(SIGTERM, on_signal);

    printf(
        "Listening source [%" PRIuPTR "]: %s | channel=%d report_every=%d count=%lld\n",
        (uintptr_t)source_index,
        source_name,
        cfg.channel,
        cfg.report_every,
        cfg.count);
    printf("Tracking note-on events (velocity > 0). Press Ctrl+C to stop.\n");
    fflush(stdout);

    while (g_keep_running) {
        struct timespec req = {.tv_sec = 0, .tv_nsec = 100000000L};
        nanosleep(&req, NULL);
    }

    MIDIPortDisconnectSource(input_port, source);
    MIDIPortDispose(input_port);
    MIDIClientDispose(client);

    print_report(&state, true);
    return 0;
}
