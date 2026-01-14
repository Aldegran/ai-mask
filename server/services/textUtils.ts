export function numberToUkrainianText(num: number): string {
    if (num === 0) return "нуль";
    if (num < 0) return "мінус " + numberToUkrainianText(-num);

    const ones = ["", "один", "два", "три", "чотири", "п'ять", "шість", "сім", "вісім", "дев'ять"];
    const teens = ["десять", "одинадцять", "дванадцять", "тринадцять", "чотирнадцять", "п'ятнадцять", "шістнадцять", "сімнадцять", "вісімнадцять", "дев'ятнадцять"];
    const tens = ["", "", "двадцять", "тридцять", "сорок", "п'ятдесят", "шістдесят", "сімдесят", "вісімдесят", "дев'яносто"];
    const hundreds = ["", "сто", "двісті", "триста", "чотириста", "п'ятсот", "шістсот", "сімсот", "вісімсот", "дев'ятсот"];

    let words: string[] = [];

    // Thousands
    if (num >= 1000) {
        let thousand = Math.floor(num / 1000);
        num %= 1000;
        
        // Handle 1000-9999 specifics strictly as per request limit < 10000
        if (thousand === 1) words.push("тисяча");
        else if (thousand === 2) words.push("дві тисячі");
        else if (thousand === 3 || thousand === 4) words.push(ones[thousand] + " тисячі");
        else words.push(ones[thousand] + " тисяч"); // Simple logic for < 10000 (5,6,7,8,9)
    }

    // Hundreds
    if (num >= 100) {
        const hundred = Math.floor(num / 100);
        words.push(hundreds[hundred]);
        num %= 100;
    }

    // Tens and units
    if (num >= 20) {
        const ten = Math.floor(num / 10);
        words.push(tens[ten]);
        num %= 10;
        if (num > 0) words.push(ones[num]);
    } else if (num >= 10) {
        words.push(teens[num - 10]);
        num = 0;
    } else if (num > 0) {
        words.push(ones[num]);
    }

    return words.join(" ");
}

export function preprocessText(text: string): string {
    // 1. Replace symbols (math operations only)
    // Replace "+" with "плюс" only if it is surrounded by spaces or at start/end
    let processed = text
        .replace(/(^|\s)\+(\s|$)/g, "$1плюс$2") 
        .replace(/(^|\s)-(\s|$)/g, "$1м+інус$2");

    // Replace inline "+" with combining acute accent (U+0301) for stress
    // Example: "прив+іт" -> "приві́т"
    processed = processed.replace(/\+/g, '\u0301');

    // 2. Find and replace numbers
    processed = processed.replace(/\b\d+\b/g, (match) => {
        const num = parseInt(match, 10);
        if (num <= 10000) {
            return numberToUkrainianText(num);
        }
        return match;
    });

    // Cleanup spaces
    return processed.replace(/\s+/g, ' ').trim();
}
