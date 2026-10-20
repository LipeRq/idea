// 金額計算用の10進の掛け算と四捨五入。
// 0.95 や 0.12 のような小数は2進の浮動小数点では正確に表せないため、手計算ではちょうど .5 になる
// 金額が 0.4999… になって切り捨てられ、見積明細の計算式と1円ずれることがある
// (例:0.01h × 0.95 × 30個 × 6,500円/h = 1,852.5円 → Math.round では1,852円)。
// そこで、入力の数値を画面に出る10進の表記のまま整数(BigInt)に直して掛け、最後に1回だけ四捨五入する。

type Decimal = { units: bigint; scale: number }; // 値 = units ÷ 10^scale

// tsconfig の target(ES2017)では BigInt のリテラル(1n)が使えないため、定数で持つ
const ZERO = BigInt(0);
const ONE = BigInt(1);
const TWO = BigInt(2);
const TEN = BigInt(10);

function toDecimal(value: number): Decimal {
  if (!Number.isFinite(value)) throw new RangeError("計算できない数値です");
  // String() は値を正確に表す最短の10進表記を返す(1e-7 や 1.5e+21 の指数表記もある)
  const [mantissa, exponent = "0"] = String(value).toLowerCase().split("e");
  const negative = mantissa.startsWith("-");
  const [int, frac = ""] = mantissa.replace("-", "").split(".");
  let digits = int + frac;
  let scale = frac.length - Number(exponent);
  if (scale < 0) {
    digits += "0".repeat(-scale);
    scale = 0;
  }
  const units = BigInt(digits);
  return { units: negative ? -units : units, scale };
}

/**
 * factors をすべて掛けた値を、小数 digits 桁に四捨五入して返す(0.5 は0から遠い方へ)。
 * 例:roundProduct([0.01, 0.95, 30, 6500]) = 1853、roundProduct([0.0225], 3) = 0.023
 */
export function roundProduct(factors: number[], digits = 0): number {
  let units = ONE;
  let scale = 0;
  for (const f of factors) {
    const d = toDecimal(f);
    units *= d.units;
    scale += d.scale;
  }
  const shift = scale - digits;
  let rounded: bigint;
  if (shift <= 0) {
    rounded = units * TEN ** BigInt(-shift);
  } else {
    const divisor = TEN ** BigInt(shift);
    const abs = units < ZERO ? -units : units;
    const q = (abs * TWO + divisor) / (TWO * divisor);
    rounded = units < ZERO ? -q : q;
  }
  return digits === 0 ? Number(rounded) : Number(rounded) / 10 ** digits;
}

/** 10進で足し算する(0.1 + 0.2 = 0.3)。寸法+取り代のように、足してから掛ける値に使う */
export function addDecimal(a: number, b: number): number {
  return Number((a + b).toPrecision(15));
}
