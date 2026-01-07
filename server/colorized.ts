export const colors = {
  Inverted: 7,

  default: 39,
  black: 30,
  red: 31,
  green: 32,
  yellow: 33,
  blue: 34,
  magenta: 35,
  cyan: 36,
  'light gray': 37,
  'dark gray': 90,
  'light red': 91,
  'light green': 92,
  'light yellow': 93,
  'light blue': 94,
  'light magenta': 95,
  'light cyan': 96,
  white: 97,

  'bg Default': 49,
  'bg Black': 40,
  'bg Red': 41,
  'bg Green': 42,
  'bg Yellow': 43,
  'bg Blue': 44,
  'bg Magenta': 45,
  'bg Cyan': 46,
  'bg Light gray': 47,
  'bg Dark gray': 100,
  'bg Light red': 101,
  'bg Light green': 102,
  'bg Light yellow': 103,
  'bg Light blue': 104,
  'bg Light magenta': 105,
  'bg Light cyan': 106,
  'bg White': 107,
};

export default function () {
  let color = [...arguments];
  let text = color.pop();

  color.map((color) => {
    color = colors[color as keyof typeof colors] || colors['default'];
    text = `\x1b[${color}m${text}\x1b[0m`;
  });
  return text;
}
