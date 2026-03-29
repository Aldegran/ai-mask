from ssd1315 import SSD1315

Icons = {
    'Bluetooth': [0x18,0x54,0x32,0x1C,0x1C,0x32,0x54,0x18],
    'Wifi': [0x0F,0x10,0x27,0x48,0x93,0xA4,0xAB,0xAB],
    'Light': [0x00,0x18,0xEB,0x88,0xEB,0x18,0x00,0x00],
    'AI': [0xFF,0x81,0x34,0x54,0x74,0x54,0x81,0xFF],
}

# Привязываем иконки к классу
SSD1315.Icons = Icons

def create_custom_icon(oled):
    # 8x8 текстовая матрица для визуального редактирования.
    # '#' - это светящийся пиксель, '.' - пустой. Разрешены пробелы слева.
    matrix_str = """
        ########
        #......#
        ..##.#..
        .#.#.#..
        .###.#..
        .#.#.#..
        #......#
        ########
    """
    
    bmp_array = []
    # Извлекаем только непустые строки и убираем лишние пробелы по краям
    lines = [line.strip() for line in matrix_str.strip().split('\n') if line.strip()]
    
    for line in lines:
        byte_val = 0
        # Обрезаем или дополняем до 8 символов для безопасности
        line = line.ljust(8, '.')[:8]
        for i, char in enumerate(line):
            if char == '#':
                byte_val |= (128 >> i)
        bmp_array.append(byte_val)
        
    hex_strings = [f"0x{b:02X}" for b in bmp_array]
    print(f"[{','.join(hex_strings)}]")
    
    oled.drawBitmap(0, 0, bmp_array, 8, 8, blink=1)
    oled.display()

if __name__ == "__main__":
    oled = SSD1315()
    oled.begin()

    #create_custom_icon(oled)
    
    #oled.setFlip(True, False) # flip horizontally
    #oled.drawRect(0, 0, oled.WIDTH - 1, oled.HEIGHT - 1)
    #oled.drawString(0, 8,   "пір`їна1Ag")
    #oled.drawString(0, 8,  "абвгдеєжзи")
    #oled.drawString(0, 16, "їйклмнопст")
    #oled.drawString(0, 24, "уфхцчшщьюя")
    #oled.drawString(0, 8, "АБВГДЄЖЗІЇ")
    #oled.drawString(0, 16, "КЛМНОПРСТУ")
    #oled.drawString(0, 24, "ФХЦЧШЩИЕЮЯ")
    #oled.drawBitmap(0, 0, Bluetooth, 8, 8, blink=2)
    #oled.drawBitmap(8, 0, Bat, 8, 8, blink=1)
    oled.drawIcon(0, 0, 'AI')
    #oled.display()

    # Add the test for scrolling string
    #oled.drawStringRun("Привіт, це строка що стрімко біжить!", 16, 50, 1)
    
    # Test hiding the static icon
    #oled.drawBitmap(8, 0, Bat, 8, 8, blink=0)
    #oled.drawString(0, 0, "1234567890 +-[]°", micro=True)
    oled.display()
    
    # Let the program sleep so we can see the Bluetooth blinking continues
    #time.sleep(10)


