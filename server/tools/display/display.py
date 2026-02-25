import board
import neopixel
import sys
import time
import struct

# --- CONFIGURATION (Pi 4B) ---
PIN = board.D18 
WIDTH = 16
HEIGHT = 32
NUM_PIXELS = WIDTH * HEIGHT
BRIGHTNESS = 0.2
ORDER = neopixel.GRB
ZIGZAG = True

# Initialize pixels
pixels = neopixel.NeoPixel(PIN, NUM_PIXELS, brightness=BRIGHTNESS, auto_write=False, pixel_order=ORDER)

# --- GLOBAL STATE ---
LAMP_MODE = False
LAMP_MASK = None

def load_lamp_mask():
    global LAMP_MASK
    try:
        with open('lamp.hex', 'rb') as f:
            LAMP_MASK = f.read(NUM_PIXELS)
        if len(LAMP_MASK) != NUM_PIXELS:
            sys.stderr.write("Warn: lamp.hex size check failed\n")
            LAMP_MASK = None
    except:
        LAMP_MASK = None

# Load mask on startup
load_lamp_mask()

# --- PALETTE GENERATION (xterm-256 compatible) ---
PALETTE = []


# 0-15: Standard Colors
STD_COLORS = [
    (0,0,0), (128,0,0), (0,128,0), (128,128,0), (0,0,128), (128,0,128), (0,128,128), (192,192,192),
    (128,128,128), (255,0,0), (0,255,0), (255,255,0), (0,0,255), (255,0,255), (0,255,255), (255,255,255)
]
PALETTE.extend(STD_COLORS)

# 16-231: 6x6x6 Color Cube
steps = [0, 95, 135, 175, 215, 255]
for r in steps:
    for g in steps:
        for b in steps:
            PALETTE.append((r, g, b))

# 232-255: Grayscale Ramp
for i in range(24):
    v = 8 + (i * 10)
    PALETTE.append((v, v, v))

def get_pixel_index(x, y):
    if x < 0 or x >= WIDTH or y < 0 or y >= HEIGHT:
        return None
    
    # Horizontal Rows ZigZag Logic
    # Row 0: L->R, Row 1: R->L, etc.
    if (y % 2 == 0):
        return (y * WIDTH) + x
    else:
        return (y * WIDTH) + (WIDTH - 1 - x)

def clear():
    pixels.fill((0, 0, 0))
    pixels.show()

def draw_frame(data):
    """
    data: bytes object of length 512.
    Each byte is an index into PALETTE.
    """
    if len(data) != NUM_PIXELS:
        return

    # Map the byte array to pixels
    # Protocol assumes data comes in Row-Major order (Row 0, then Row 1...)
    # We map (x,y) from the linear buffer index `i` to the physical `idx` via get_pixel_index
    
    # data[i] corresponds to pixel at:
    # x = i % WIDTH
    # y = i // WIDTH
    
    for i in range(NUM_PIXELS):
        color_idx = data[i]
        
        # --- LAMP MASK OVERLAY ---
        # If LAMP_MODE is ON and this pixel is set in the mask (non-black), force the mask color.
        # But wait, original logic was "Apply Mask" (additive?).
        # User said: "if new data comes and lamp is ON, mask applies automatically".
        # This implies the lamp mask replaces/overrides whatever is at that pixel position?
        # Or mixes? Usually lamp = "always on pixels".
        # Let's assume OVERRIDE: If mask pixel != 0, use mask pixel. Else use data.
        
        if LAMP_MODE and LAMP_MASK and i < len(LAMP_MASK):
            mask_val = LAMP_MASK[i]
            if mask_val != 0:
                color_idx = mask_val
        
        # Safety check for index
        # NOTE: If we used mask_val, it might be > Palette size. Clamp it.
        if color_idx >= len(PALETTE): color_idx = 0
        
        rgb = PALETTE[color_idx]
        
        y = i // WIDTH
        x = i % WIDTH
        
        phys_idx = get_pixel_index(x, y)
        if phys_idx is not None:
            pixels[phys_idx] = rgb
            
    pixels.show()

def apply_mask(mode):
    """
    mode: b'L' (ON), b'N' (OFF)
    """
    global LAMP_MODE, LAMP_MASK

#(re-writing the function to be complete and clean)
    load_lamp_mask() # Reload in case file changed
    
    if mode == b'L':
        LAMP_MODE = True
        if LAMP_MASK is None: return

        for i in range(NUM_PIXELS):
            mask_val = LAMP_MASK[i]
            if mask_val != 0:
                color_idx = mask_val
                if color_idx < len(PALETTE):
                    rgb = PALETTE[color_idx]
                    y = i // WIDTH
                    x = i % WIDTH
                    phys_idx = get_pixel_index(x, y)
                    if phys_idx is not None:
                        pixels[phys_idx] = rgb
        pixels.show()

    elif mode == b'N':
        LAMP_MODE = False
        if LAMP_MASK is None: return

        for i in range(NUM_PIXELS):
            mask_val = LAMP_MASK[i]
            if mask_val != 0:
                # Turn OFF (Black)
                y = i // WIDTH
                x = i % WIDTH
                phys_idx = get_pixel_index(x, y)
                if phys_idx is not None:
                    pixels[phys_idx] = (0, 0, 0)
        pixels.show()


def main():

    # Use binary mode for stdin/stdout to avoid encoding issues
    stdin = sys.stdin.buffer
    
    # Signal readiness?
    sys.stdout.write("READY\n")
    sys.stdout.flush()

    while True:
        try:
            # Read 1 byte command
            cmd = stdin.read(1)
            if not cmd:
                break # EOF
            
            if cmd == b'C': # Clear
                clear()
                # Optional: Ack
                # sys.stdout.write("OK\n")
                # sys.stdout.flush()
                
            elif cmd == b'D': # Draw
                # Read 512 bytes
                data = stdin.read(NUM_PIXELS)
                while len(data) < NUM_PIXELS:
                    chunk = stdin.read(NUM_PIXELS - len(data))
                    if not chunk: break
                    data += chunk
                
                if len(data) == NUM_PIXELS:
                    draw_frame(data)

            elif cmd == b'L': # Lamp ON
                # Apply mask (L)
                apply_mask(b'L')

            elif cmd == b'N': # Lamp OFF
                apply_mask(b'N')
                
            # Ignore newlines or other garbage between commands if they appear
            # But strict protocol is better.
                
        except KeyboardInterrupt:
            clear()
            break
        except Exception as e:
            # Log to stderr to avoid corrupting protocol if we used stdout for data
            sys.stderr.write(f"Error: {e}\n")
            pass

if __name__ == '__main__':
    main()
