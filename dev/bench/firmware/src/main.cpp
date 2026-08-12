// ============================================================
//  OTBench — hardware-in-the-loop tester firmware (classic ESP32)
//
//  A dumb I/O slave for the OpenTurbine bench rig. It is wired pin-to-pin
//  to an ESP32-S3 running OpenTurbine (the DUT). The PC harness drives this
//  board over USB serial and reads back measurements.
//
//  It never contains test logic — it only:
//    - DRIVES the DUT's input pins  (buttons, RPM pulses, analog/threshold sensors)
//    - READS  the DUT's output pins (ESC/pump PWM, relay/solenoid levels)
//
//  Protocol: newline-terminated ASCII, 115200 baud. One reply line per command.
//    PING                 -> OK OTBench <ver>
//    LIST                 -> one "SIG <name> <kind> gpio=<n>" line per signal, then OK
//    RESET                -> all driven outputs to safe/idle, then OK
//    SET <name> <value>   -> drive an output-kind signal, then OK / ERR ...
//                              digital_out_al : value 1=assert(press, LOW), 0=release(Hi-Z)
//                              digital_out    : value !=0 = HIGH (3.3 V), 0 = LOW (0 V)
//                              freq_out       : value = Hz (square wave), 0 = off
//                              dac_out        : value = volts 0..3.3 (true DAC, GPIO25/26)
//    GET <name>           -> read an input-kind signal:
//                              digital_in     : VAL <name> level=<0|1>
//                              pwm_in_*        : VAL <name> us=<high> hz=<f> duty=<d> level=<0|1>
//    STATE                -> VAL STATE <name>=... for every input signal, then OK
//
//  Keep the signal table below in step with bench/pinmap.json.
//  Uses the Arduino-ESP32 3.x LEDC API (ledcAttach / ledcWrite(pin,duty) /
//  ledcWriteTone), matching OpenTurbine's toolchain.
// ============================================================

#include <Arduino.h>
#include <Wire.h>
#include <string.h>    // strtok, strcmp, snprintf
#include <strings.h>   // strcasecmp
#include <stdlib.h>    // atoi, atof
#include "soc/gpio_reg.h"  // GPIO_OUT_W1TS_REG / GPIO_IN1_REG for fast ISR pin access
#include "driver/ledc.h"   // raw ESP-IDF LEDC: explicit per-timer control so N1/N2 are independent

static const char* OTBENCH_VER = "0.9";

// ── Signal kinds ─────────────────────────────────────────────
enum Kind {
    DIGITAL_OUT_AL,   // active-low button: press = drive LOW, release = Hi-Z
    DIGITAL_OUT,      // plain push-pull digital out: !=0 = HIGH, 0 = LOW
    FREQ_OUT,         // square-wave generator (RPM simulation)
    DAC_OUT,          // true DAC analog out (GPIO25/26 only)
    SERVO_OUT,        // 50 Hz servo/RC pulse generator: SET <name> <microseconds>
    PWM_IN_SERVO,     // capture 50 Hz servo pulse (1000-2000 us)
    PWM_IN_LEDC,      // capture high-frequency LEDC PWM (~10 kHz)
    DIGITAL_IN        // read a relay / solenoid level
};

struct Signal {
    const char* name;
    Kind        kind;
    int         gpio;
};

// ── Signal table — MUST match bench/pinmap.json (tester_gpio / tester_kind) ──
#if defined(OTBENCH_S3)
// ROLE-REVERSED build: this runs on the ESP32-S3 acting as the TESTER, wired to a
// classic ESP32 running OpenTurbine (the DUT). Each pin here is the S3 side of the same
// physical jumper (pinmap dut_gpio), with the direction flipped vs the normal build:
// what OpenTurbine drives on the classic side, the S3 now READS; what OpenTurbine reads,
// the S3 now DRIVES. No DAC on the S3, so the two analog inputs (THROTTLE_IN/OILP) are
// omitted. STARTER_OUT omitted (its jumper is the known-dead GPIO17<->GPIO19 path).
static Signal SIGNALS[] = {
    // classic-DUT inputs — the S3 tester drives these (S3 GPIO = pinmap dut_gpio)
    { "START",        DIGITAL_OUT_AL, 13 },
    { "STOP",         DIGITAL_OUT_AL, 15 },
    { "N1",           FREQ_OUT,       14 },
    { "N2",           FREQ_OUT,        8 },
    { "FLAME",        DIGITAL_OUT,     2 },
    { "IDLE_IN",      SERVO_OUT,       5 },
    // classic-DUT outputs — the S3 tester reads these
    { "THROTTLE_OUT", PWM_IN_SERVO,   40 },
    { "OILPUMP_OUT",  PWM_IN_LEDC,    11 },
    { "FUEL_SOL",     DIGITAL_IN,     12 },
    { "IGNITER",      DIGITAL_IN,     21 },
    { "STARTER_EN",   DIGITAL_IN,     39 },
};
#else
//  Normal build (classic ESP32 tester, S3 DUT). Board constraints: GPIO 36/39 unavailable;
//  input-only pins 34-39 and GPIO 16/17 (WROVER PSRAM) avoided; strapping pins avoided.
static Signal SIGNALS[] = {
    // DUT inputs — the tester drives these
    { "START",        DIGITAL_OUT_AL, 13 },
    { "STOP",         DIGITAL_OUT_AL, 14 },
    { "N1",           FREQ_OUT,        4 },
    { "THROTTLE_IN",  DAC_OUT,        25 },   // true DAC
    { "OILP",         DAC_OUT,        26 },   // true DAC
    { "FLAME",        DIGITAL_OUT,    27 },   // threshold sensor -> digital HIGH/LOW
    { "IDLE_IN",      SERVO_OUT,      32 },   // servo/RC pulse gen -> RC-PWM input testing (SET IDLE_IN <us>)
    { "N2",           FREQ_OUT,       18 },   // N2 shaft RPM (governor testing) -> DUT GPIO27; GPIO18 freed when THROTTLE_OUT moved to 17
    // DUT outputs — the tester reads these
    { "THROTTLE_OUT", PWM_IN_SERVO,   17 },   // moved 18->17: tester GPIO18 read no pulse on the bench
    { "STARTER_OUT",  PWM_IN_SERVO,   19 },
    { "OILPUMP_OUT",  PWM_IN_LEDC,    21 },
    { "FUEL_SOL",     DIGITAL_IN,     22 },
    { "IGNITER",      DIGITAL_IN,     23 },
    { "STARTER_EN",   DIGITAL_IN,     33 },
};
#endif
static const int NUM_SIGNALS = sizeof(SIGNALS) / sizeof(SIGNALS[0]);

static const float VREF = 3.3f;

#if !defined(OTBENCH_S3)
// ── Shared-I2C accessory emulator ─────────────────────────────
// Reuses the existing START and STOP jumpers as SDA/SCL during the test, so
// the complete ECU I2C stack can be exercised without changing bench wiring:
//   DUT GPIO13 (SDA) <-> tester GPIO13
//   DUT GPIO15 (SCL) <-> tester GPIO14
// Only one slave is active at a time, matching the serial test campaign.
enum I2cEmuMode : uint8_t { I2C_EMU_OFF, I2C_EMU_TCA9554, I2C_EMU_TLA2528, I2C_EMU_NAU7802 };
static I2cEmuMode g_i2cEmuMode = I2C_EMU_OFF;
static volatile uint8_t g_i2cReg = 0;
static volatile uint8_t g_i2cRegs[32] = {};
static volatile uint8_t g_i2cPhase = 0;
static volatile uint16_t g_tlaRaw = 2048;
static volatile int32_t g_nauRaw = 0;
static constexpr int I2C_EMU_SDA = 13;
static constexpr int I2C_EMU_SCL = 14;

static void i2cEmuReceive(int count) {
    if (count <= 0 || !Wire.available()) return;
    const uint8_t first = Wire.read();
    --count;
    if (g_i2cEmuMode == I2C_EMU_TLA2528 &&
        (first == 0x08 || first == 0x10)) {
        if (count > 0 && Wire.available()) {
            g_i2cReg = Wire.read();
            --count;
        }
        if (first == 0x08 && count > 0 && Wire.available()) {
            g_i2cRegs[g_i2cReg & 0x1F] = Wire.read();
            --count;
        }
    } else {
        g_i2cReg = first;
        while (count-- > 0 && Wire.available()) {
            uint8_t value = Wire.read();
            const uint8_t writtenReg = g_i2cReg;
            if (g_i2cEmuMode == I2C_EMU_NAU7802 && writtenReg == 0x02)
                value &= (uint8_t)~0x04U;  // finish internal calibration immediately
            g_i2cRegs[g_i2cReg & 0x1F] = value;
            g_i2cReg = (uint8_t)(g_i2cReg + 1U);
        }
        if (g_i2cEmuMode == I2C_EMU_NAU7802) {
            // Power-ready and conversion-ready remain asserted after reset or
            // power-up writes; the ECU still performs its real init sequence.
            g_i2cRegs[0x00] |= 0x28U;
        }
    }
    while (Wire.available()) Wire.read();
}

static void i2cEmuRequest() {
    if (g_i2cEmuMode == I2C_EMU_TLA2528 && g_i2cReg == 0x11) {
        const uint16_t wireValue = (uint16_t)(g_tlaRaw & 0x0FFFU) << 4;
        Wire.write((uint8_t)(wireValue >> 8));
        Wire.write((uint8_t)wireValue);
        return;
    }
    if (g_i2cEmuMode == I2C_EMU_NAU7802) {
        // The classic ESP32 slave HAL dispatches receive/request callbacks
        // from a task. Back-to-back STOP-separated master transactions can
        // therefore expose the previous register pointer. Model the exact
        // NAU7802 request order instead: three PU/status reads and one CTRL2
        // calibration read during initialization, then each channel produces
        // PU, 24-bit sample, and CTRL2 channel-select transactions.
        if (g_i2cPhase < 3) {
            Wire.write((uint8_t)0x28);  // PUR + CR
            g_i2cPhase = (uint8_t)(g_i2cPhase + 1U);
        } else if (g_i2cPhase == 3) {
            Wire.write((uint8_t)0x00);  // calibration complete, no error
            g_i2cPhase = 4;
        } else {
            const uint8_t operational = (uint8_t)((g_i2cPhase - 4) % 3);
            if (operational == 0) {
                Wire.write((uint8_t)0x28);  // conversion ready
            } else if (operational == 1) {
                const uint32_t raw = (uint32_t)g_nauRaw & 0x00FFFFFFUL;
                Wire.write((uint8_t)(raw >> 16));
                Wire.write((uint8_t)(raw >> 8));
                Wire.write((uint8_t)raw);
            } else {
                Wire.write((uint8_t)0x00);  // channel-select CTRL2 read
            }
            g_i2cPhase = (uint8_t)(g_i2cPhase + 1U);
        }
        return;
    }
    Wire.write(g_i2cRegs[g_i2cReg & 0x1F]);
}

static void i2cEmuStop() {
    if (g_i2cEmuMode != I2C_EMU_OFF) Wire.end();
    g_i2cEmuMode = I2C_EMU_OFF;
    // Restore the two ordinary active-low switch outputs in their safe state.
    pinMode(I2C_EMU_SDA, INPUT);
    pinMode(I2C_EMU_SCL, INPUT);
}

static bool i2cEmuBegin(I2cEmuMode mode, int32_t value) {
    i2cEmuStop();
    memset((void*)g_i2cRegs, 0, sizeof(g_i2cRegs));
    uint8_t address = 0;
    if (mode == I2C_EMU_TCA9554) {
        address = 0x20;
        g_i2cRegs[0x00] = (uint8_t)value;
        g_i2cRegs[0x03] = 0xFF;
    } else if (mode == I2C_EMU_TLA2528) {
        address = 0x10;
        g_i2cRegs[0x00] = 0x80;  // device-status signature used by discovery
        g_tlaRaw = (uint16_t)constrain(value, 0L, 4095L);
    } else if (mode == I2C_EMU_NAU7802) {
        address = 0x2A;
        g_i2cRegs[0x00] = 0x28;  // power-ready + conversion-ready
        g_nauRaw = constrain(value, -8388351L, 8388350L);
    } else {
        return false;
    }
    g_i2cReg = 0;
    g_i2cPhase = 0;
    Wire.onReceive(i2cEmuReceive);
    Wire.onRequest(i2cEmuRequest);
    if (!Wire.begin(address, I2C_EMU_SDA, I2C_EMU_SCL, 400000)) return false;
    g_i2cEmuMode = mode;
    return true;
}
#endif

// ── LEDC (raw ESP-IDF) — each FREQ_OUT / SERVO_OUT gets its OWN timer+channel ──
// The Arduino ledcAttach/ledcWriteTone wrappers kept reusing a single timer, so N1
// and N2 clobbered each other. Assigning an explicit LEDC timer per signal (via
// ledc_timer_config with distinct timer_num) makes them fully independent.
static int8_t sigLedcChan[NUM_SIGNALS];   // LEDC channel (== timer) for this signal, or -1
static ledc_timer_bit_t sigFreqResolution[NUM_SIGNALS];
static bool sigLedcAttached[NUM_SIGNALS];

static inline int sigIndex(const Signal& s) { return (int)(&s - SIGNALS); }

// Servo PWM resolution differs by SoC: the ESP32-S3's LEDC tops out at 14-bit (the same
// clock wall that makes 16-bit@50 Hz fail on the S3), the classic ESP32 does 16-bit.
#if defined(OTBENCH_S3)
static const ledc_timer_bit_t SERVO_RES      = LEDC_TIMER_14_BIT;
static const uint32_t         SERVO_MAX_DUTY = 16383;   // 2^14 - 1
#else
static const ledc_timer_bit_t SERVO_RES      = LEDC_TIMER_16_BIT;
static const uint32_t         SERVO_MAX_DUTY = 65535;   // 2^16 - 1
#endif

static void ledcSetupSignal(int idx, const Signal& s, int chan) {
    sigLedcChan[idx] = (int8_t)chan;
    const bool servo = (s.kind == SERVO_OUT);
    ledc_timer_config_t tc = {};
    tc.speed_mode      = LEDC_LOW_SPEED_MODE;
    tc.duty_resolution = servo ? SERVO_RES : LEDC_TIMER_10_BIT;
    tc.timer_num       = (ledc_timer_t)chan;      // own timer per signal
    tc.freq_hz         = servo ? 50 : 1000;
    tc.clk_cfg         = LEDC_AUTO_CLK;
    ledc_timer_config(&tc);
    if (!servo) sigFreqResolution[chan] = LEDC_TIMER_10_BIT;
    ledc_channel_config_t cc = {};
    cc.gpio_num   = s.gpio;
    cc.speed_mode = LEDC_LOW_SPEED_MODE;
    cc.channel    = (ledc_channel_t)chan;
    cc.intr_type  = LEDC_INTR_DISABLE;
    cc.timer_sel  = (ledc_timer_t)chan;           // bind channel to its own timer
    cc.duty       = 0;
    cc.hpoint     = 0;
    ledc_channel_config(&cc);
    sigLedcAttached[idx] = true;
}

static inline void ledcSetDuty(int chan, uint32_t duty) {
    ledc_set_duty(LEDC_LOW_SPEED_MODE, (ledc_channel_t)chan, duty);
    ledc_update_duty(LEDC_LOW_SPEED_MODE, (ledc_channel_t)chan);
}

// A fixed 10-bit LEDC timer cannot divide the classic ESP32 clock far enough
// for low-RPM simulation: a requested 33 Hz signal was quantised to about
// 150 Hz.  Keep high frequencies available, but use a finer timer resolution
// below that range so every requested bench RPM is physically generated.
static ledc_timer_bit_t freqResolutionFor(float hz) {
    // 16-bit reaches the sub-20 Hz range; 14-bit keeps useful resolution up
    // to roughly 4.8 kHz; 12-bit covers the 500,000 RPM / 1 PPR test case.
#if defined(OTBENCH_S3)
    if (hz < 20.0f) return LEDC_TIMER_14_BIT; // S3 LEDC has no 16-bit mode
#else
    if (hz < 20.0f) return LEDC_TIMER_16_BIT;
#endif
    if (hz <= 4000.0f) return LEDC_TIMER_14_BIT;
    return LEDC_TIMER_12_BIT;
}

static bool ledcConfigureFrequencyTimer(int chan, float hz) {
    const ledc_timer_bit_t resolution = freqResolutionFor(hz);
    // ledc_timer_config() resets the timer. Repeating it for every step in a
    // simulated spool ramp inserts brief zero/high-frequency artifacts that
    // are not present in a real magnetic pickup. If the resolution band has
    // not changed, update only the divider and leave the channel running.
    if (sigFreqResolution[chan] == resolution &&
        ledc_set_freq(LEDC_LOW_SPEED_MODE, (ledc_timer_t)chan,
                      (uint32_t)(hz + 0.5f)) > 0)
        return true;
    ledc_timer_config_t tc = {};
    tc.speed_mode      = LEDC_LOW_SPEED_MODE;
    tc.duty_resolution = resolution;
    tc.timer_num       = (ledc_timer_t)chan;
    tc.freq_hz         = (uint32_t)(hz + 0.5f);
    tc.clk_cfg         = LEDC_AUTO_CLK;
    if (ledc_timer_config(&tc) != ESP_OK) return false;
    sigFreqResolution[chan] = resolution;
    return true;
}

#if !defined(OTBENCH_S3)   // MAX6675 emulator uses classic-ESP32 register layout; the S3
                           // role-reversed tester doesn't emulate the thermocouple.
// ── MAX6675 thermocouple emulator (SPI slave) ────────────────
// The DUT (OpenTurbine, Adafruit MAX6675 lib) is the SPI master and bit-bangs
// slowly. We watch its CLK/CS and clock a fake 16-bit word out on MISO:
//   bit15=0 (dummy) | bits14..3 = temp/0.25 (12-bit) | bit2 = open-circuit flag | bits1..0 = 0
// Wire: S3 TOT CLK(GPIO36)->tester 34, CS(GPIO18)->tester 35, MISO(GPIO37)<-tester 16.
#define TOT_SCK_PIN   34   // input  <- S3 TOT CLK
#define TOT_CS_PIN    35   // input  <- S3 TOT CS
#define TOT_MISO_PIN  16   // output -> S3 TOT MISO

static volatile uint16_t g_totWord    = 0xFFFF;  // all-1s = open-circuit until SET
static volatile bool     g_totEnabled = false;
static volatile int      g_totBit     = -1;

static inline void IRAM_ATTR misoWrite(int bit) {
    if (bit) REG_WRITE(GPIO_OUT_W1TS_REG, (1u << TOT_MISO_PIN));   // MISO pin < 32
    else     REG_WRITE(GPIO_OUT_W1TC_REG, (1u << TOT_MISO_PIN));
}
static inline bool IRAM_ATTR csIsLow() {
    return ((REG_READ(GPIO_IN1_REG) >> (TOT_CS_PIN - 32)) & 1) == 0;  // CS pin 32-39
}

static void IRAM_ATTR totCsISR() {
    if (csIsLow()) {                       // selected: present MSB
        g_totBit = 15;
        misoWrite(g_totEnabled ? ((g_totWord >> 15) & 1) : 1);
    } else {                               // deselected: idle high (reads as open)
        g_totBit = -1;
        misoWrite(1);
    }
}
static void IRAM_ATTR totSckISR() {        // advance one bit per rising edge
    if (g_totBit < 0) return;
    g_totBit = (int8_t)(g_totBit - 1);
    if (g_totBit >= 0) misoWrite(g_totEnabled ? ((g_totWord >> g_totBit) & 1) : 1);
}

static void totBegin() {
    pinMode(TOT_SCK_PIN, INPUT);
    pinMode(TOT_CS_PIN, INPUT);
    pinMode(TOT_MISO_PIN, OUTPUT);
    misoWrite(1);
    attachInterrupt(digitalPinToInterrupt(TOT_CS_PIN), totCsISR, CHANGE);
    attachInterrupt(digitalPinToInterrupt(TOT_SCK_PIN), totSckISR, RISING);
}

// Set the emulated temperature (°C). open=true asserts the open-circuit flag.
static void totSet(float celsius, bool open) {
    if (open) { g_totWord = (1u << 2); g_totEnabled = true; return; }
    int counts = (int)(celsius / 0.25f + 0.5f);
    if (counts < 0) counts = 0;
    if (counts > 4095) counts = 4095;
    g_totWord = ((uint16_t)counts) << 3;
    g_totEnabled = true;
}
#endif   // !OTBENCH_S3 (MAX6675 emulator)

#if defined(OTBENCH_S3)
// Digital-sensor emulator for the role-reversed bench. Existing protected
// jumpers are temporarily repurposed while the classic ESP32 is the DUT:
// classic 13 -> S3 13 clock, classic 14 -> S3 15 CS,
// classic 4 <- S3 14 data, and classic 25 -> S3 4 MAX31856 MOSI.
static constexpr int EMU_CLK = 13, EMU_CS = 15, EMU_DATA = 14, EMU_MOSI = 4;
static void initSignals();
enum EmuMode : uint8_t { EMU_NONE, EMU_MAX6675, EMU_MAX31855, EMU_MAX31856, EMU_HX711 };
static volatile EmuMode g_emuMode = EMU_NONE;
static volatile uint32_t g_emuWord = 0;
static volatile int8_t g_emuBit = -1;
static volatile uint8_t g_56Regs[16] = {};
static volatile uint8_t g_56Addr = 0, g_56In = 0, g_56Byte = 0;
static volatile int8_t g_56Bit = 7;
static volatile bool g_56Write = false;
static volatile uint32_t g_56Transactions = 0;
static volatile uint32_t g_hxWord = 0, g_hxReadyAt = 0;
static volatile uint8_t g_hxPulse = 0;
static volatile bool g_hxWaiting = false;

static inline void IRAM_ATTR emuDataWrite(bool high) {
    REG_WRITE(high ? GPIO_OUT_W1TS_REG : GPIO_OUT_W1TC_REG, 1u << EMU_DATA);
}
static inline bool IRAM_ATTR emuPinHigh(int pin) {
    return (REG_READ(GPIO_IN_REG) & (1u << pin)) != 0;
}

static void IRAM_ATTR emuCsISR() {
    if (g_emuMode == EMU_MAX6675 || g_emuMode == EMU_MAX31855) {
        if (!emuPinHigh(EMU_CS)) {
            g_emuBit = g_emuMode == EMU_MAX6675 ? 15 : 31;
            emuDataWrite((g_emuWord >> g_emuBit) & 1u);
        } else {
            g_emuBit = -1;
            emuDataWrite(true);
        }
    } else if (g_emuMode == EMU_MAX31856) {
        if (!emuPinHigh(EMU_CS)) {
            g_56Addr = 0; g_56In = 0; g_56Bit = 7; g_56Byte = 0; g_56Write = false;
            emuDataWrite(false);
        } else {
            ++g_56Transactions;
            emuDataWrite(true);
        }
    }
}

static void IRAM_ATTR emuClkISR() {
    const bool high = emuPinHigh(EMU_CLK);
    if (g_emuMode == EMU_MAX6675 || g_emuMode == EMU_MAX31855) {
        if (emuPinHigh(EMU_CS) || g_emuBit < 0) return;
        --g_emuBit;
        if (g_emuBit >= 0) emuDataWrite((g_emuWord >> g_emuBit) & 1u);
    } else if (g_emuMode == EMU_MAX31856) {
        if (emuPinHigh(EMU_CS)) return;
        // The DUT samples MISO shortly after the falling edge. Prepare each
        // response bit on the preceding rising edge; using the falling-edge
        // ISR to change MISO races the master's one-microsecond sample delay.
        if (!high) {
            if (emuPinHigh(EMU_MOSI)) g_56In |= (uint8_t)(1u << g_56Bit);
            return;
        }
        if (g_56Bit == 0) {
            if (g_56Byte == 0) {
                g_56Addr = g_56In & 0x7Fu;
                g_56Write = (g_56In & 0x80u) != 0;
            } else if (g_56Write) {
                const uint8_t reg = (uint8_t)((g_56Addr + g_56Byte - 1u) & 0x0Fu);
                g_56Regs[reg] = g_56In;
            }
            ++g_56Byte; g_56Bit = 7; g_56In = 0;
        } else {
            --g_56Bit;
        }
        if (g_56Byte > 0 && !g_56Write) {
            const uint8_t reg = (uint8_t)((g_56Addr + g_56Byte - 1u) & 0x0Fu);
            emuDataWrite((g_56Regs[reg] >> g_56Bit) & 1u);
        } else emuDataWrite(false);
    } else if (g_emuMode == EMU_HX711) {
        if (g_hxWaiting) return;
        // A real HX711 changes DOUT after each rising SCK edge. DOUT being LOW
        // before the first edge is only the data-ready indication, not bit 23.
        if (high) {
            if (g_hxPulse < 24)
                emuDataWrite((g_hxWord >> (23 - g_hxPulse)) & 1u);
        } else if (++g_hxPulse >= 24) {
            emuDataWrite(true);
            g_hxPulse = 0;
            g_hxWaiting = true;
            g_hxReadyAt = millis() + 50;
        }
    }
}

static void emuStop() {
    detachInterrupt(digitalPinToInterrupt(EMU_CLK));
    detachInterrupt(digitalPinToInterrupt(EMU_CS));
    g_emuMode = EMU_NONE;
    g_hxWaiting = false;
    pinMode(EMU_DATA, INPUT);
    pinMode(EMU_MOSI, INPUT);
    initSignals();
}

static void emuBegin(EmuMode mode) {
    if (g_emuMode != EMU_NONE) emuStop();
    ledcDetach(EMU_DATA); // N1 normally owns this S3 pin
    for (int i = 0; i < NUM_SIGNALS; ++i)
        if (SIGNALS[i].gpio == EMU_DATA) sigLedcAttached[i] = false;
    pinMode(EMU_CLK, INPUT);
    pinMode(EMU_CS, INPUT_PULLUP);
    pinMode(EMU_MOSI, INPUT);
    pinMode(EMU_DATA, OUTPUT);
    emuDataWrite(true);
    g_emuMode = mode;
    attachInterrupt(digitalPinToInterrupt(EMU_CLK), emuClkISR,
                    (mode == EMU_MAX31856 || mode == EMU_HX711) ? CHANGE : RISING);
    if (mode != EMU_HX711) attachInterrupt(digitalPinToInterrupt(EMU_CS), emuCsISR, CHANGE);
}

static void emuSetThermocouple(EmuMode mode, const char* value) {
    emuBegin(mode);
    const bool fault = !strcasecmp(value, "open") || !strcasecmp(value, "fault");
    const float c = atof(value);
    if (mode == EMU_MAX6675) {
        int counts = constrain((int)lroundf(c / 0.25f), 0, 4095);
        g_emuWord = fault ? (1u << 2) : ((uint32_t)counts << 3);
    } else if (mode == EMU_MAX31855) {
        int counts = constrain((int)lroundf(c / 0.25f), -8192, 8191);
        g_emuWord = fault ? 0x00010001u : ((uint32_t)(counts & 0x3FFF) << 18);
    } else {
        int32_t counts = (int32_t)lroundf(c / 0.0078125f);
        uint32_t raw = ((uint32_t)counts & 0x7FFFFu) << 5;
        g_56Regs[0x0C] = (uint8_t)(raw >> 16);
        g_56Regs[0x0D] = (uint8_t)(raw >> 8);
        g_56Regs[0x0E] = (uint8_t)raw;
        g_56Regs[0x0F] = fault ? 0x01 : 0x00;
    }
}

static void emuSetHx711(const char* value) {
    int32_t counts = (int32_t)strtol(value, nullptr, 0);
    if (counts > 8388607) counts = 8388607;
    if (counts < -8388608) counts = -8388608;
    if (g_emuMode != EMU_HX711) emuBegin(EMU_HX711);
    // A new bench value is the next conversion, not a chip disconnect.
    // Rebuilding the interrupt emulator can race an in-progress DUT read and
    // strand DOUT high. Replace the sample atomically on the live interface.
    noInterrupts();
    emuDataWrite(true);
    g_hxWord = (uint32_t)counts & 0xFFFFFFu;
    g_hxPulse = 0;
    g_hxWaiting = false;
    emuDataWrite(false);
    interrupts();
}

#endif

// ── Helpers ──────────────────────────────────────────────────
static const char* kindName(Kind k) {
    switch (k) {
        case DIGITAL_OUT_AL: return "digital_out_al";
        case DIGITAL_OUT:    return "digital_out";
        case FREQ_OUT:       return "freq_out";
        case DAC_OUT:        return "dac_out";
        case SERVO_OUT:      return "servo_out";
        case PWM_IN_SERVO:   return "pwm_in_servo";
        case PWM_IN_LEDC:    return "pwm_in_ledc";
        case DIGITAL_IN:     return "digital_in";
    }
    return "?";
}
static bool isOutputKind(Kind k) {
    return k == DIGITAL_OUT_AL || k == DIGITAL_OUT || k == FREQ_OUT || k == DAC_OUT || k == SERVO_OUT;
}

static Signal* findSignal(const char* name) {
    for (int i = 0; i < NUM_SIGNALS; i++)
        if (strcasecmp(name, SIGNALS[i].name) == 0) return &SIGNALS[i];
    return nullptr;
}

// Put one signal into its safe/idle state.
static void safeState(const Signal& s) {
    switch (s.kind) {
        case DIGITAL_OUT_AL:                       // released -> Hi-Z, DUT pull-up holds high
            pinMode(s.gpio, INPUT);
            break;
        case DIGITAL_OUT:                          // defined LOW at boot (no flame / min idle)
            pinMode(s.gpio, OUTPUT);
            digitalWrite(s.gpio, LOW);
            break;
        case FREQ_OUT:
        case SERVO_OUT: {
            int ch = sigLedcChan[sigIndex(s)];
            if (ch >= 0) ledcSetDuty(ch, 0);       // duty 0 -> line low / no pulse
            break;
        }
        case DAC_OUT:
#if !defined(OTBENCH_S3)
            dacWrite(s.gpio, 0);                   // 0 V
#endif
            break;
        case PWM_IN_SERVO:
        case PWM_IN_LEDC:
        case DIGITAL_IN:
            pinMode(s.gpio, INPUT);
            break;
    }
}

static void initSignals() {
    // Each FREQ_OUT / SERVO_OUT gets its own LEDC timer+channel (timer_num == channel), so
    // N1 and N2 are fully independent — changing one timer's frequency never touches the other.
    for (int i = 0; i < NUM_SIGNALS; i++) {
        sigLedcChan[i] = -1;
        sigFreqResolution[i] = LEDC_TIMER_10_BIT;
        sigLedcAttached[i] = false;
    }
    int nextCh = 0;
    for (int i = 0; i < NUM_SIGNALS; i++) {
        Signal& s = SIGNALS[i];
        if (s.kind == FREQ_OUT || s.kind == SERVO_OUT) {
            ledcSetupSignal(i, s, nextCh++);
        }
        safeState(s);
    }
}

// ── Output application ───────────────────────────────────────
static bool applyOutput(const Signal& s, const char* valStr, String& err) {
    switch (s.kind) {
        case DIGITAL_OUT_AL: {
            int v = atoi(valStr);
            if (v != 0) { pinMode(s.gpio, OUTPUT); digitalWrite(s.gpio, LOW); } // pressed
            else        { pinMode(s.gpio, INPUT); }                              // released (Hi-Z)
            return true;
        }
        case DIGITAL_OUT: {
            float v = atof(valStr);
            pinMode(s.gpio, OUTPUT);
            digitalWrite(s.gpio, v != 0.0f ? HIGH : LOW);
            return true;
        }
        case FREQ_OUT: {
            // Change only THIS signal's timer frequency (its own timer), so N1 and N2 are
            // independent. Reconfigure resolution too: low RPM needs a much
            // larger divider than a fixed 10-bit LEDC timer permits.
            int ch = sigLedcChan[sigIndex(s)];
            float hz = atof(valStr);
            if (hz < 1.0f) {
                ledcSetDuty(ch, 0);                                    // stop -> line low
            } else {
                // Changing a live timer's frequency must not detach/recreate
                // its channel: that inserts a zero-RPM hole into every ramp
                // step and can create false ECU underspeed trips. Reattach
                // only after an emulator or static-level command actually
                // repurposed the GPIO.
                if (!sigLedcAttached[sigIndex(s)])
                    ledcSetupSignal(sigIndex(s), s, ch);
                if (!ledcConfigureFrequencyTimer(ch, hz)) {
                    err = "frequency outside LEDC timer range";
                    return false;
                }
                const uint8_t bits = (uint8_t)sigFreqResolution[ch];
                ledcSetDuty(ch, 1UL << (bits - 1));                     // 50% duty
            }
            return true;
        }
        case DAC_OUT: {
#if !defined(OTBENCH_S3)
            float volts = constrain((float)atof(valStr), 0.0f, VREF);
            dacWrite(s.gpio, (int)(volts / VREF * 255.0f + 0.5f));
#else
            err = "no DAC on the S3 tester";
            return false;   // S3 has no DAC — analog inputs aren't drivable in this build
#endif
            return true;
        }
        case SERVO_OUT: {
            // The S3 has no DAC. Static HIGH/LOW lets the role-reversed bench
            // prove an ADC1 input at both rails on the same protected jumper;
            // numeric values retain the normal RC-pulse behavior.
            int ch = sigLedcChan[sigIndex(s)];
            if (!strcasecmp(valStr, "high") || !strcasecmp(valStr, "low")) {
                const bool high = !strcasecmp(valStr, "high");
                ledc_stop(LEDC_LOW_SPEED_MODE, (ledc_channel_t)ch, high ? 1 : 0);
                pinMode(s.gpio, OUTPUT);
                digitalWrite(s.gpio, high ? HIGH : LOW);
                return true;
            }
            // Value is the pulse width in microseconds (0 = no pulse). 50 Hz frame = 20000 us,
            // 16-bit resolution -> duty = us / 20000 * 65535.
            // Reconfigure the channel in case a previous static-level command
            // stopped it.
            ledcSetupSignal(sigIndex(s), s, ch);
            float us = constrain((float)atof(valStr), 0.0f, 20000.0f);
            uint32_t duty = (uint32_t)(us / 20000.0f * (float)SERVO_MAX_DUTY + 0.5f);
            ledcSetDuty(ch, duty);
            return true;
        }
        default:
            err = "not an output signal";
            return false;
    }
}

// ── Measurement ──────────────────────────────────────────────
// Capture a complete HIGH + LOW frame with explicit edge waits.  pulseIn()
// occasionally returned a zero low phase on the classic tester's servo input,
// which made a valid 50 Hz, 1.5 ms pulse look like a 667 Hz full-duty signal.
static bool capturePwm(const Signal& s, unsigned long timeoutUs,
                       unsigned long& high, unsigned long& low) {
    // Each phase receives the advertised timeout. A single shared budget can
    // legitimately exceed 30 ms for a 50 Hz frame when sampling begins during
    // HIGH, then waits for the following LOW and next HIGH phases.
    auto waitFor = [&](int level) {
        const uint32_t started = micros();
        while (digitalRead(s.gpio) == level)
            if ((uint32_t)(micros() - started) >= timeoutUs) return false;
        return true;
    };
    if (!waitFor(HIGH)) return false;
    if (!waitFor(LOW)) return false;
    const uint32_t highStart = micros();
    while (digitalRead(s.gpio) == HIGH)
        if ((uint32_t)(micros() - highStart) >= timeoutUs) return false;
    high = (uint32_t)(micros() - highStart);
    const uint32_t lowStart = micros();
    while (digitalRead(s.gpio) == LOW)
        if ((uint32_t)(micros() - lowStart) >= timeoutUs) return false;
    low = (uint32_t)(micros() - lowStart);
    return true;
}

static void measurePwm(const Signal& s, unsigned long timeoutUs, char* out, size_t outLen) {
    unsigned long high = 0, low = 0;
    capturePwm(s, timeoutUs, high, low);
    int level = digitalRead(s.gpio);
    unsigned long period = high + low;
    float hz   = period > 0 ? 1000000.0f / (float)period : 0.0f;
    float duty = period > 0 ? (float)high / (float)period : (level ? 1.0f : 0.0f);
    snprintf(out, outLen, "VAL %s us=%lu hz=%.1f duty=%.3f level=%d",
             s.name, high, hz, duty, level);
}

static void readSignal(const Signal& s, char* out, size_t outLen) {
    switch (s.kind) {
        case DIGITAL_IN:
            snprintf(out, outLen, "VAL %s level=%d", s.name, digitalRead(s.gpio));
            break;
        case PWM_IN_SERVO:
            measurePwm(s, 30000UL, out, outLen);   // 50 Hz -> 20 ms period
            break;
        case PWM_IN_LEDC:
            measurePwm(s, 2500UL, out, outLen);     // ~10 kHz -> 100 us period
            break;
        default:
            snprintf(out, outLen, "ERR %s is not an input signal", s.name);
            break;
    }
}

// Compact single-token field for STATE (no "VAL name " prefix).
static void readField(const Signal& s, char* out, size_t outLen) {
    if (s.kind == DIGITAL_IN) {
        snprintf(out, outLen, "%s=%d", s.name, digitalRead(s.gpio));
    } else {
        unsigned long timeoutUs = (s.kind == PWM_IN_LEDC) ? 2500UL : 30000UL;
        unsigned long high = 0, low = 0;
        capturePwm(s, timeoutUs, high, low);
        int level = digitalRead(s.gpio);
        unsigned long period = high + low;
        float duty = period > 0 ? (float)high / (float)period : (level ? 1.0f : 0.0f);
        float hz   = period > 0 ? 1000000.0f / (float)period : 0.0f;
        snprintf(out, outLen, "%s_us=%lu %s_hz=%.1f %s_duty=%.3f %s_level=%d",
                 s.name, high, s.name, hz, s.name, duty, s.name, level);
    }
}

// ── Command dispatch ─────────────────────────────────────────
static void handleLine(char* line) {
    char* cmd = strtok(line, " \t");
    if (!cmd) return;

    if (strcasecmp(cmd, "PING") == 0) {
        Serial.printf("OK OTBench %s\n", OTBENCH_VER);
        return;
    }
    if (strcasecmp(cmd, "LIST") == 0) {
        for (int i = 0; i < NUM_SIGNALS; i++)
            Serial.printf("SIG %s %s gpio=%d\n", SIGNALS[i].name,
                          kindName(SIGNALS[i].kind), SIGNALS[i].gpio);
        Serial.println("OK");
        return;
    }
    if (strcasecmp(cmd, "RESET") == 0) {
#if defined(OTBENCH_S3)
        if (g_emuMode != EMU_NONE) emuStop();
#else
        i2cEmuStop();
#endif
        for (int i = 0; i < NUM_SIGNALS; i++) safeState(SIGNALS[i]);
        Serial.println("OK");
        return;
    }
#if !defined(OTBENCH_S3)
    if (strcasecmp(cmd, "I2CEMU") == 0) {
        char* kind = strtok(nullptr, " \t");
        char* val  = strtok(nullptr, " \t");
        if (!kind) {
            Serial.println("ERR usage: I2CEMU <TCA9554|TLA2528|NAU7802|OFF|STATUS> <value>");
            return;
        }
        if (!strcasecmp(kind, "OFF")) {
            i2cEmuStop();
            Serial.println("OK");
            return;
        }
        if (!strcasecmp(kind, "STATUS")) {
            Serial.printf("OK mode=%u reg=%02X phase=%u tca_in=%02X tca_out=%02X tla=%u nau=%ld\n",
                          (unsigned)g_i2cEmuMode, (unsigned)g_i2cReg,
                          (unsigned)g_i2cPhase,
                          (unsigned)g_i2cRegs[0], (unsigned)g_i2cRegs[1],
                          (unsigned)g_tlaRaw, (long)g_nauRaw);
            return;
        }
        if (!val) {
            Serial.println("ERR emulator value required");
            return;
        }
        I2cEmuMode mode = I2C_EMU_OFF;
        if (!strcasecmp(kind, "TCA9554")) mode = I2C_EMU_TCA9554;
        else if (!strcasecmp(kind, "TLA2528")) mode = I2C_EMU_TLA2528;
        else if (!strcasecmp(kind, "NAU7802")) mode = I2C_EMU_NAU7802;
        else {
            Serial.println("ERR unknown I2C emulator");
            return;
        }
        if (i2cEmuBegin(mode, strtol(val, nullptr, 0))) Serial.println("OK");
        else Serial.println("ERR I2C emulator start failed");
        return;
    }
#endif
#if defined(OTBENCH_S3)
    if (strcasecmp(cmd, "EMU") == 0) {
        char* kind = strtok(nullptr, " \t");
        char* val  = strtok(nullptr, " \t");
        if (!kind) { Serial.println("ERR usage: EMU <MAX6675|MAX31855|MAX31856|HX711|OFF> <value>"); return; }
        if (!strcasecmp(kind, "OFF")) {
            if (g_emuMode != EMU_NONE) emuStop();
            // EMU_DATA normally doubles as the S3 tester's N1 output.  The
            // generic safe state drives that signal LOW, which looks like a
            // permanently-ready HX711 and makes the DUT clock zero samples.
            // EMU OFF means the emulated converter is physically absent, so
            // release DOUT and let the DUT's pull-up report missing data.
            pinMode(EMU_DATA, INPUT);
            for (int i = 0; i < NUM_SIGNALS; ++i)
                if (SIGNALS[i].gpio == EMU_DATA) sigLedcAttached[i] = false;
            Serial.println("OK");
            return;
        }
        if (!strcasecmp(kind, "STATUS")) {
            Serial.printf("OK mode=%u tx=%lu cr0=%02X cr1=%02X addr=%02X byte=%u write=%u\n",
                          (unsigned)g_emuMode, (unsigned long)g_56Transactions,
                          (unsigned)g_56Regs[0], (unsigned)g_56Regs[1],
                          (unsigned)g_56Addr, (unsigned)g_56Byte,
                          g_56Write ? 1u : 0u);
            return;
        }
        if (!val) { Serial.println("ERR emulator value required"); return; }
        if (!strcasecmp(kind, "MAX6675"))       emuSetThermocouple(EMU_MAX6675, val);
        else if (!strcasecmp(kind, "MAX31855")) emuSetThermocouple(EMU_MAX31855, val);
        else if (!strcasecmp(kind, "MAX31856")) emuSetThermocouple(EMU_MAX31856, val);
        else if (!strcasecmp(kind, "HX711"))    emuSetHx711(val);
        else { Serial.println("ERR unknown emulator"); return; }
        Serial.println("OK");
        return;
    }
#endif
    if (strcasecmp(cmd, "STATE") == 0) {
        char buf[96];
        String out = "VAL STATE";
        for (int i = 0; i < NUM_SIGNALS; i++) {
            if (isOutputKind(SIGNALS[i].kind)) continue;
            readField(SIGNALS[i], buf, sizeof(buf));
            out += " ";
            out += buf;
        }
        Serial.println(out);
        Serial.println("OK");
        return;
    }
    if (strcasecmp(cmd, "SET") == 0) {
        char* name = strtok(nullptr, " \t");
        char* val  = strtok(nullptr, " \t");
        if (!name || !val) { Serial.println("ERR usage: SET <name> <value>"); return; }
#if !defined(OTBENCH_S3)
        if (strcasecmp(name, "TOT") == 0) {         // MAX6675 thermocouple emulator
            if      (strcasecmp(val, "open") == 0) { totSet(0, true); }
            else if (strcasecmp(val, "off")  == 0) { g_totEnabled = false; }
            else                                    { totSet(atof(val), false); }
            Serial.println("OK");
            return;
        }
#endif
        Signal* s = findSignal(name);
        if (!s) { Serial.printf("ERR unknown signal %s\n", name); return; }
        if (!isOutputKind(s->kind)) { Serial.printf("ERR %s is not an output\n", name); return; }
        String err;
        if (applyOutput(*s, val, err)) Serial.println("OK");
        else                          Serial.printf("ERR %s\n", err.c_str());
        return;
    }
    if (strcasecmp(cmd, "GET") == 0) {
        char* name = strtok(nullptr, " \t");
        if (!name) { Serial.println("ERR usage: GET <name>"); return; }
#if !defined(OTBENCH_S3)
        if (strcasecmp(name, "TOT") == 0) {
            Serial.printf("VAL TOT celsius=%.2f enabled=%d word=0x%04X\n",
                          (g_totWord >> 3) * 0.25f, g_totEnabled ? 1 : 0, g_totWord);
            return;
        }
#endif
        Signal* s = findSignal(name);
        if (!s) { Serial.printf("ERR unknown signal %s\n", name); return; }
        if (isOutputKind(s->kind)) { Serial.printf("ERR %s is not an input\n", name); return; }
        char buf[96];
        readSignal(*s, buf, sizeof(buf));
        Serial.println(buf);
        return;
    }
    Serial.printf("ERR unknown command %s\n", cmd);
}

// ── Arduino entry points ─────────────────────────────────────
static char   lineBuf[128];
static size_t lineLen = 0;

void setup() {
    Serial.begin(115200);
    delay(200);
    initSignals();
#if !defined(OTBENCH_S3)
    totBegin();
    Serial.printf("OK OTBench %s ready (%d signals + TOT thermocouple)\n", OTBENCH_VER, NUM_SIGNALS);
#else
    Serial.printf("OK OTBench %s ready (%d signals, S3 role-reversed tester)\n", OTBENCH_VER, NUM_SIGNALS);
#endif
}

void loop() {
#if defined(OTBENCH_S3)
    if (g_emuMode == EMU_HX711 && g_hxWaiting &&
        (int32_t)(millis() - g_hxReadyAt) >= 0) {
        g_hxWaiting = false;
        emuDataWrite(false);
    }
#endif
    while (Serial.available()) {
        char c = (char)Serial.read();
        if (c == '\r') continue;
        if (c == '\n') {
            lineBuf[lineLen] = '\0';
            if (lineLen > 0) handleLine(lineBuf);
            lineLen = 0;
        } else if (lineLen < sizeof(lineBuf) - 1) {
            lineBuf[lineLen++] = c;
        } else {
            lineLen = 0;
            Serial.println("ERR line too long");
        }
    }
}
