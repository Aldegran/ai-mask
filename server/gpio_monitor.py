
import gpiod
import sys
import time
import os
import datetime
from pathlib import Path

# --- Configuration Constants ---
TARGET_PIN = 17 # BCM Pin Number

def monitor_pin(pin, bias='pull_up', debounce_period_us=50000):
    """
    Universally configures a pin and monitors it for edge events.
    Automatically finds the correct GPIO chip for the given pin.
    """
    
    # --- Internal Helper: Find Chip ---
    def find_gpio_chip(pin_offset):
        # Priority list for Raspberry Pi 5 (gpiochip4) and Pi 4 (gpiochip0)
        priority_chips = ['gpiochip4', 'gpiochip0']
        
        # Check priority chips first
        for chip_name in priority_chips:
            path = f"/dev/{chip_name}"
            if os.path.exists(path):
                try:
                    with gpiod.Chip(path) as chip:
                        info = chip.get_line_info(pin_offset)
                        return path
                except Exception:
                    continue

        # Fallback: scan all available /dev/gpiochip* devices
        p = Path('/dev')
        for child in p.glob('gpiochip*'):
            path = str(child)
            if path.split('/')[-1] in priority_chips: continue 
            
            try:
                with gpiod.Chip(path) as chip:
                    info = chip.get_line_info(pin_offset)
                    return path
            except Exception:
                continue
        return None

    # Implement Discovery
    chip_path = find_gpio_chip(pin)
    if not chip_path:
        raise RuntimeError(f"Could not find GPIO chip for pin {pin}")

    bias_map = {
        'pull_up': gpiod.line.Bias.PULL_UP,
        'pull_down': gpiod.line.Bias.PULL_DOWN,
        'disabled': gpiod.line.Bias.DISABLED
    }
    
    selected_bias = bias_map.get(bias, gpiod.line.Bias.PULL_UP)
    
    # Configure line settings (Input, Edge Both, Bias, Debounce)
    lsettings = gpiod.LineSettings(
        direction=gpiod.line.Direction.INPUT,
        bias=selected_bias,
        edge_detection=gpiod.line.Edge.BOTH,
        debounce_period=datetime.timedelta(microseconds=debounce_period_us)
    )

    # Note: On Raspberry Pi 4 ('bookworm' / Debian 13), gpiod v2 bindings might have slightly different API.
    # The 'request_lines' function takes a consumer string and a Config object or dict.
    # We will use the request_lines helper if available, or manual request.
    
    with gpiod.request_lines(
        path=chip_path,
        consumer="ai-mask-monitor",
        config={pin: lsettings}
    ) as request:
        print(f"Monitoring GPIO {pin} on {chip_path} (Bias: {bias})...", flush=True)

        while True:
            # Wait for events (blocking) - read_edge_events returns list of events
            for event in request.read_edge_events():
                timestamp = event.timestamp_ns
                
                # event.type is an enum (RISING_EDGE or FALLING_EDGE)
                if event.event_type == gpiod.EdgeEvent.Type.RISING_EDGE:
                    print(f"RISING_EDGE {timestamp}", flush=True)
                elif event.event_type == gpiod.EdgeEvent.Type.FALLING_EDGE:
                    print(f"FALLING_EDGE {timestamp}", flush=True)

if __name__ == "__main__":
    import datetime
    try:
        monitor_pin(TARGET_PIN, bias='pull_up')
    except KeyboardInterrupt:
        sys.exit(0)
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)

