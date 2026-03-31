import sys
import json
import threading
from ssd1315 import SSD1315

Icons = {
    'Bluetooth': [0x18,0x54,0x32,0x1C,0x1C,0x32,0x54,0x18],
    'Wifi': [0x0F,0x10,0x27,0x48,0x93,0xA4,0xAB,0xAB],
    'Light': [0x28,0x28,0x00,0x7C,0x44,0x28,0x28,0x38],
    'AI': [0xFF,0x81,0x34,0x54,0x74,0x54,0x81,0xFF],
    'Sound': [0x18,0x66,0x42,0x99,0x99,0x42,0x66,0x18],
    'Sound2': [0x02,0x06,0x7E,0x7E,0x7E,0x7E,0x06,0x02],
    'Audio': [0x02,0x06,0x7A,0x42,0x42,0x7A,0x06,0x02],
    'TTS': [0x00,0x00,0xFF,0x4A,0x4B,0x49,0x4B,0x00],
}

# Привязываем иконки к классу
SSD1315.Icons = Icons

def execute_cmd(oled, cmd):
    c = cmd.get("c")
    
    if c == "clear":
        with oled.scroll_lock:
            oled._icons.clear()
            oled.clear()
            
    elif c == "icon":
        n = cmd.get("n")
        x = cmd.get("x", 0)
        y = cmd.get("y", 0)
        b = cmd.get("b", 0)
        oled.drawIcon(x, y, n, blink=b)
            
    elif c == "text":
        t = cmd.get("t", "")
        x = cmd.get("x", 0)
        y = cmd.get("y", 0)
        with oled.scroll_lock:
            oled.drawString(x, y, t)
            
    elif c == "micro":
        t = cmd.get("t", "")
        x = cmd.get("x", 0)
        y = cmd.get("y", 0)
        with oled.scroll_lock:
            oled.drawString(x, y, t, micro=True)
            
    elif c == "run":
        t = cmd.get("t", "")
        y = cmd.get("y", 0)
        s = cmd.get("s", 40)
        i = cmd.get("i", 1)
        threading.Thread(
            target=oled.drawStringRun, 
            args=(t, y, s, i),
            daemon=True
        ).start()
        
    elif c == "rec":
        x0 = cmd.get("x0", 0)
        y0 = cmd.get("y0", 0)
        x1 = cmd.get("x1", 0)
        y1 = cmd.get("y1", 0)
        co = cmd.get("co", 1)
        f = cmd.get("f", 0)
        with oled.scroll_lock:
            oled.drawRect(x0, y0, x1, y1, fill=bool(f), color=co)
            
    elif c == "lineH":
        x = cmd.get("x", 0)
        y = cmd.get("y", 0)
        l = cmd.get("l", 0)
        co = cmd.get("co", 1)
        with oled.scroll_lock:
            oled.drawRect(x, y, x + l - 1, y, fill=True, color=co)
            
    elif c == "lineV":
        x = cmd.get("x", 0)
        y = cmd.get("y", 0)
        l = cmd.get("l", 0)
        co = cmd.get("co", 1)
        with oled.scroll_lock:
            oled.drawRect(x, y, x, y + l - 1, fill=True, color=co)
            
    elif c == "dot":
        x = cmd.get("x", 0)
        y = cmd.get("y", 0)
        co = cmd.get("co", 1)
        with oled.scroll_lock:
            oled.drawPixel(x, y, co)

def main():
    oled = SSD1315()
    oled.begin()
    
    # Сигнализируем о готовности сервиса
    sys.stdout.write("READY\n")
    sys.stdout.flush()

    try:
        for line in sys.stdin:
            line = line.strip()
            if not line:
                continue
                
            try:
                payload = json.loads(line)
                
                # Если пришел массив — выполняем всё за раз, если объект — как одну команду
                cmds = payload if isinstance(payload, list) else [payload]
                
                for cmd in cmds:
                    execute_cmd(oled, cmd)
                    
                # Обновляем экран ровно один раз после всех команд
                with oled.scroll_lock:
                    oled.display()
                        
            except json.JSONDecodeError:
                pass
            except Exception as e:
                sys.stderr.write(f"Error: {e}\n")
    except KeyboardInterrupt:
        pass # Ignore CTRL+C gracefully
        
    # Make sure we clean up on exit
    oled.clear()
    oled.display()

if __name__ == "__main__":
    main()
