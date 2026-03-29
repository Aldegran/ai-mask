import smbus
from time import sleep

def scan_i2c():
    bus = smbus.SMBus(1) # 1 indicates /dev/i2c-1
    devices = []
    print("Scanning I2C bus...")
    for addr in range(0x03, 0x77):
        try:
            bus.write_quick(addr)
            devices.append(addr)
        except OSError:
            pass
    return devices

if __name__ == "__main__":
    devices = scan_i2c()
    if not devices:
        print("No I2C devices found.")
    else:
        print("I2C devices found:")
        for addr in devices:
            print(f"- 0x{addr:02X}")
        
    if 0x3C in devices:
        print("\nOLED display (0x3C) found!")
    else:
        print("\nOLED display (0x3C) NOT found.")
