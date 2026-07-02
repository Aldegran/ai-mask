# Glove BLE Keyboard

PlatformIO firmware for Seeed Studio XIAO nRF52840 used as a BLE HID keyboard.

## Wiring

Wire every button between the GPIO pin and `GND`.

| Button | XIAO pin | MCU pin | Default key |
| ------ | -------- | ------- | ----------- |
| 1 | D0 / A0 | P0.02 | `1` |
| 2 | D1 / A1 | P0.03 | `2` |
| 3 | D2 / A2 | P0.28 | `3` |

The firmware enables internal pull-ups, so no external pull-up resistors are required for the first prototype.

## Behavior

- Device name: `Glove VR Keyboard`
- BLE profile: HID keyboard
- Button press sends key down
- Button release sends key up
- Key mapping is configured in `kButtons` in `src/main.cpp`
