// evaluation/chiSquareAnalyzer.js
//
// Uji chi-square Westfeld–Pfitzmann ("pairs of values") per kanal, ditulis
// tanpa library.
//
// ── Ide ──────────────────────────────────────────────────────────────────────
// LSB replacement dengan bit acak menyamakan frekuensi pasangan nilai
// (2k, 2k+1). Bila pesan memenuhi sebagian besar citra, h[2k] ≈ h[2k+1].
//
// Untuk pasangan k = 0..127:
//     observed_k = h[2k]
//     expected_k = (h[2k] + h[2k+1]) / 2
//     χ²         = Σ (observed_k − expected_k)² / expected_k
//     df         = (jumlah kategori yang dipakai) − 1
//     p          = P(X ≥ χ²),  X ~ χ²(df)      (ekor atas)
//
// p tinggi  → frekuensi pasangan sangat seimbang (konsisten dengan LSB yang
//             terisi acak); p rendah → pasangan tidak seimbang (khas cover alami).
//
// ── Catatan ──────────────────────────────────────────────────────────────────
//   • Pasangan dengan expected = 0 dilewati (tidak punya informasi).
//   • minExpected (default 0 = tanpa penggabungan) menggabungkan pasangan
//     bertetangga hingga expected ≥ minExpected, seperti praktik chi-square
//     klasik (Westfeld memakai ambang kecil, mis. 4–5). Dengan 0, hasil sama
//     persis dengan rumus langsung pada 128 pasangan.
//   • Semua pasangan sama persis (h[2k] = h[2k+1]) → χ² = 0, p = 1.

/** log Γ(x), aproksimasi Lanczos (g=7, n=9), akurat ~1e-15. */
function logGamma(x) {
  const c = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028,
    771.32342877765313, -176.61502916214059, 12.507343278686905,
    -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
  ];
  if (x < 0.5) {
    // refleksi: Γ(x)Γ(1−x) = π / sin(πx)
    return Math.log(Math.PI / Math.sin(Math.PI * x)) - logGamma(1 - x);
  }
  x -= 1;
  let a = c[0];
  const t = x + 7.5;
  for (let i = 1; i < 9; i++) a += c[i] / (x + i);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

/** Regularized lower incomplete gamma P(a,x) lewat deret (x < a+1). */
function gammaPSeries(a, x) {
  let ap = a, sum = 1 / a, del = sum;
  for (let n = 0; n < 1000; n++) {
    ap += 1;
    del *= x / ap;
    sum += del;
    if (Math.abs(del) < Math.abs(sum) * 1e-16) break;
  }
  return sum * Math.exp(-x + a * Math.log(x) - logGamma(a));
}

/** Regularized upper incomplete gamma Q(a,x) lewat pecahan berlanjut (x ≥ a+1), Lentz. */
function gammaQContinuedFraction(a, x) {
  const FPMIN = 1e-300;
  let b = x + 1 - a;
  let c = 1 / FPMIN;
  let d = 1 / b;
  let h = d;
  for (let i = 1; i < 1000; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b; if (Math.abs(d) < FPMIN) d = FPMIN;
    c = b + an / c; if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-16) break;
  }
  return Math.exp(-x + a * Math.log(x) - logGamma(a)) * h;
}

/**
 * Regularized upper incomplete gamma Q(a, x).
 * @param {number} a > 0
 * @param {number} x ≥ 0
 */
export function gammaQ(a, x) {
  if (!(a > 0) || x < 0) throw new Error('[chiSquareAnalyzer] gammaQ: argumen tidak valid.');
  if (x === 0) return 1;
  return x < a + 1 ? 1 - gammaPSeries(a, x) : gammaQContinuedFraction(a, x);
}

/**
 * Survival function chi-square: P(X ≥ chi2), X ~ χ²(df). Setara scipy.stats.chi2.sf.
 */
export function chiSquarePValue(chi2, df) {
  if (!(df >= 1)) return null;
  if (chi2 <= 0) return 1;
  const p = gammaQ(df / 2, chi2 / 2);
  return Math.min(1, Math.max(0, p));
}

/**
 * χ² Westfeld–Pfitzmann untuk satu histogram 256-bin.
 *
 * @param {ArrayLike<number>} bins  256 frekuensi
 * @param {{minExpected?:number}} [opts]
 * @returns {{chi2:number, df:number, pValue:number|null, pairsUsed:number}}
 */
export function chiSquarePairs(bins, { minExpected = 0 } = {}) {
  if (!bins || bins.length !== 256) {
    throw new Error('[chiSquareAnalyzer] Histogram harus 256 bin.');
  }
  const groups = [];         // { obs, exp }
  let accObs = 0, accExp = 0;

  for (let k = 0; k < 128; k++) {
    const even = bins[2 * k], odd = bins[2 * k + 1];
    accObs += even;
    accExp += (even + odd) / 2;
    if (accExp > 0 && accExp >= minExpected) {
      groups.push({ obs: accObs, exp: accExp });
      accObs = 0; accExp = 0;
    }
  }
  if (accExp > 0) {                        // sisa di ujung → gabung ke kategori terakhir
    if (groups.length) {
      groups[groups.length - 1].obs += accObs;
      groups[groups.length - 1].exp += accExp;
    } else {
      groups.push({ obs: accObs, exp: accExp });
    }
  }

  let chi2 = 0;
  for (const g of groups) {
    const d = g.obs - g.exp;
    chi2 += (d * d) / g.exp;
  }
  const df = groups.length - 1;
  return { chi2, df, pValue: chiSquarePValue(chi2, df), pairsUsed: groups.length };
}

/**
 * Jalankan uji pada histogram R, G, B (hasil computeHistogram).
 * @returns {{r:Result,g:Result,b:Result}}
 */
export function analyzeChiSquare(hist, opts) {
  return {
    r: chiSquarePairs(hist.r, opts),
    g: chiSquarePairs(hist.g, opts),
    b: chiSquarePairs(hist.b, opts),
  };
}
