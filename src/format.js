// Number formatting shared by the workspace and its two report pages.
export const number = (value, digits = 0) => value.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });

// a true minus sign, and none on a value that rounds to zero
export const signed = (value, digits = 0) => `${value < 0 && Number(value.toFixed(digits)) ? "−" : ""}${number(Math.abs(value), digits)}`;

// 3.4e-13 as 3 × 10⁻¹³
export function power(value) {
  if (!value) return "0";
  const exponent = Math.floor(Math.log10(value));
  return `${Math.round(value / 10 ** exponent)} × 10${exponent < 0 ? "⁻" : ""}${[...String(Math.abs(exponent))].map((digit) => "⁰¹²³⁴⁵⁶⁷⁸⁹"[digit]).join("")}`;
}
