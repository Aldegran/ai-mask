#include <Arduino.h>
#include <bluefruit.h>

BLEDis bledis;
BLEHidAdafruit blehid;

struct ButtonConfig {
  uint8_t pin;
  uint8_t keycode;
};

// Buttons are wired between the GPIO pin and GND. Change keycode values here
// when the physical buttons need to emit different keyboard keys.
constexpr ButtonConfig kButtons[] = {
    {0, HID_KEY_1},  // D0 / A0 / P0.02
    {1, HID_KEY_2},  // D1 / A1 / P0.03
    {2, HID_KEY_3},  // D2 / A2 / P0.28
};

constexpr uint8_t kButtonCount = sizeof(kButtons) / sizeof(kButtons[0]);
constexpr uint32_t kDebounceMs = 20;
constexpr const char* kDeviceName = "Glove VR Keyboard";

struct ButtonState {
  bool stablePressed = false;
  bool lastRawPressed = false;
  uint32_t lastRawChangeMs = 0;
};

ButtonState buttonStates[kButtonCount];
volatile bool buttonEventPending = false;

void startAdvertising();
void sendKeyboardReport();

void buttonWakeIsr() {
  buttonEventPending = true;
}

void setupBle() {
  Bluefruit.begin();
  Bluefruit.setTxPower(0);
  Bluefruit.setName(kDeviceName);
  Bluefruit.Periph.setConnectCallback([](uint16_t connHandle) {
    BLEConnection* connection = Bluefruit.Connection(connHandle);
    if (connection) {
      connection->requestConnectionParameter(32, 4, 600);
    }
  });
  Bluefruit.Periph.setDisconnectCallback([](uint16_t, uint8_t) {
    startAdvertising();
  });

  bledis.setManufacturer("ai-mask");
  bledis.setModel("XIAO nRF52840 BLE Keyboard");
  bledis.begin();

  blehid.begin();
  startAdvertising();
}

void startAdvertising() {
  Bluefruit.Advertising.stop();
  Bluefruit.Advertising.clearData();
  Bluefruit.ScanResponse.clearData();

  Bluefruit.Advertising.addFlags(BLE_GAP_ADV_FLAGS_LE_ONLY_GENERAL_DISC_MODE);
  Bluefruit.Advertising.addTxPower();
  Bluefruit.Advertising.addAppearance(BLE_APPEARANCE_HID_KEYBOARD);
  Bluefruit.Advertising.addService(blehid);
  Bluefruit.ScanResponse.addName();

  Bluefruit.Advertising.restartOnDisconnect(true);
  Bluefruit.Advertising.setInterval(160, 244);  // 100-152.5 ms
  Bluefruit.Advertising.setFastTimeout(30);
  Bluefruit.Advertising.start(0);
}

void setupButtons() {
  const uint32_t now = millis();
  for (uint8_t i = 0; i < kButtonCount; ++i) {
    pinMode(kButtons[i].pin, INPUT_PULLUP);
    const bool pressed = digitalRead(kButtons[i].pin) == LOW;
    buttonStates[i].stablePressed = pressed;
    buttonStates[i].lastRawPressed = pressed;
    buttonStates[i].lastRawChangeMs = now;
    attachInterrupt(kButtons[i].pin, buttonWakeIsr, CHANGE);
  }
}

bool updateButtons() {
  bool changed = false;
  const uint32_t now = millis();

  for (uint8_t i = 0; i < kButtonCount; ++i) {
    const bool rawPressed = digitalRead(kButtons[i].pin) == LOW;
    ButtonState& state = buttonStates[i];

    if (rawPressed != state.lastRawPressed) {
      state.lastRawPressed = rawPressed;
      state.lastRawChangeMs = now;
    }

    if ((now - state.lastRawChangeMs) >= kDebounceMs &&
        rawPressed != state.stablePressed) {
      state.stablePressed = rawPressed;
      changed = true;
    }
  }

  return changed;
}

bool processPendingButtonEvent() {
  if (!buttonEventPending) {
    return false;
  }

  buttonEventPending = false;
  bool changed = false;
  const uint32_t deadline = millis() + kDebounceMs + 5;

  do {
    changed = updateButtons() || changed;
    delay(1);
  } while (static_cast<int32_t>(millis() - deadline) < 0);

  return updateButtons() || changed;
}

void sendKeyboardReport() {
  uint8_t keycodes[6] = {0, 0, 0, 0, 0, 0};
  uint8_t reportIndex = 0;

  for (uint8_t i = 0; i < kButtonCount && reportIndex < sizeof(keycodes); ++i) {
    if (buttonStates[i].stablePressed) {
      keycodes[reportIndex++] = kButtons[i].keycode;
    }
  }

  blehid.keyboardReport(0, keycodes);
}

void setup() {
  setupButtons();
  setupBle();
}

void loop() {
  if (processPendingButtonEvent() && Bluefruit.connected()) {
    sendKeyboardReport();
  }

  waitForEvent();
}
