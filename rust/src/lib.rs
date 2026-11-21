//! perfscope-core: the number crunching behind the perfscope overlay.
//!
//! Everything is a plain `extern "C"` function over flat `f64` arrays in linear memory, so the
//! JavaScript side needs no glue code: `alloc` a buffer, write records, call, read records back.
//! The functions are pure and allocation-light; the overlay calls them from idle time only.

use std::alloc::{alloc as raw_alloc, dealloc as raw_dealloc, Layout};

// ---------------------------------------------------------------- memory

/// Allocates `len` f64 slots and returns the address.
#[no_mangle]
pub extern "C" fn ps_alloc(len: usize) -> *mut f64 {
    if len == 0 {
        return std::ptr::NonNull::<f64>::dangling().as_ptr();
    }
    unsafe { raw_alloc(Layout::array::<f64>(len).unwrap()) as *mut f64 }
}

/// Frees a buffer from `ps_alloc` (`len` must be the same).
#[no_mangle]
pub extern "C" fn ps_free(ptr: *mut f64, len: usize) {
    if len == 0 {
        return;
    }
    unsafe { raw_dealloc(ptr as *mut u8, Layout::array::<f64>(len).unwrap()) }
}

unsafe fn view<'a>(ptr: *const f64, len: usize) -> &'a [f64] {
    std::slice::from_raw_parts(ptr, len)
}
unsafe fn view_mut<'a>(ptr: *mut f64, len: usize) -> &'a mut [f64] {
    std::slice::from_raw_parts_mut(ptr, len)
}

// ---------------------------------------------------------------- images

/// Input record (10 numbers): group id, css width, css height, natural width, natural height,
/// bytes, format, device pixel ratio, above the fold (0/1), is LCP (0/1).
pub const IMG_IN: usize = 10;
/// Output record (8 numbers): group id, max css width, max css height, target width, target height,
/// estimated bytes after the change, savings in bytes, number of usages.
pub const IMG_OUT: usize = 8;

/// Format codes: 0 unknown, 1 jpeg, 2 png, 3 webp, 4 avif, 5 gif, 6 svg.
fn format_factor(fmt: f64) -> f64 {
    match fmt as i32 {
        1 => 0.72, // jpeg -> webp, same visual quality
        2 => 0.50, // png  -> webp
        5 => 0.40, // gif  -> webp
        _ => 1.0,  // webp / avif / svg / unknown: no format gain assumed
    }
}

/// One image can be used in many places. All usages of the same file (same group id) are folded
/// into one plan whose reference is the LARGEST rendered size (times the pixel ratio, capped at 2x,
/// because a 3x file is rarely worth its bytes). The target is rounded up to a multiple of 16 and
/// never exceeds the natural size. Returns the number of groups written to `out`.
#[no_mangle]
pub extern "C" fn ps_image_plan(n: usize, inp: *const f64, out: *mut f64) -> usize {
    let data = unsafe { view(inp, n * IMG_IN) };
    let mut order: Vec<usize> = (0..n).collect();
    order.sort_by(|&a, &b| data[a * IMG_IN].partial_cmp(&data[b * IMG_IN]).unwrap());
    let out = unsafe { view_mut(out, n * IMG_OUT) };

    let mut groups = 0usize;
    let mut i = 0usize;
    while i < n {
        let gid = data[order[i] * IMG_IN];
        let (mut max_w, mut max_h, mut max_dpr) = (0f64, 0f64, 1f64);
        let (mut nat_w, mut nat_h, mut bytes, mut fmt) = (0f64, 0f64, 0f64, 0f64);
        let mut count = 0f64;
        while i < n && data[order[i] * IMG_IN] == gid {
            let r = &data[order[i] * IMG_IN..order[i] * IMG_IN + IMG_IN];
            max_w = max_w.max(r[1]);
            max_h = max_h.max(r[2]);
            max_dpr = max_dpr.max(r[7]);
            nat_w = nat_w.max(r[3]);
            nat_h = nat_h.max(r[4]);
            bytes = bytes.max(r[5]);
            fmt = r[6];
            count += 1.0;
            i += 1;
        }
        let dpr = max_dpr.clamp(1.0, 2.0);
        let (target_w, target_h, scale) = if fmt as i32 == 6 || nat_w <= 0.0 {
            (nat_w, nat_h, 1.0) // vector or unknown: nothing to resize
        } else {
            let want = ((max_w * dpr) / 16.0).ceil() * 16.0;
            let tw = want.min(nat_w).max(16.0f64.min(nat_w));
            let s = tw / nat_w;
            (tw, (nat_h * s).round(), s)
        };
        let est = if bytes > 0.0 { bytes * scale * scale * format_factor(fmt) } else { 0.0 };
        let savings = if bytes > 0.0 { (bytes - est).max(0.0) } else { 0.0 };
        let o = &mut out[groups * IMG_OUT..groups * IMG_OUT + IMG_OUT];
        o[0] = gid;
        o[1] = max_w;
        o[2] = max_h;
        o[3] = target_w;
        o[4] = target_h;
        o[5] = est.round();
        o[6] = savings.round();
        o[7] = count;
        groups += 1;
    }
    groups
}

// ---------------------------------------------------------------- contrast

fn lin(c: f64) -> f64 {
    let c = c / 255.0;
    if c <= 0.04045 { c / 12.92 } else { ((c + 0.055) / 1.055).powf(2.4) }
}
fn luminance(r: f64, g: f64, b: f64) -> f64 {
    0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

/// Input record (7): fg r, g, b, alpha(0..1), bg r, g, b. Output: WCAG contrast ratio (1..21).
/// A translucent foreground is blended over the background first, as the eye sees it.
#[no_mangle]
pub extern "C" fn ps_contrast(n: usize, inp: *const f64, out: *mut f64) {
    let d = unsafe { view(inp, n * 7) };
    let o = unsafe { view_mut(out, n) };
    for k in 0..n {
        let r = &d[k * 7..k * 7 + 7];
        let a = r[3].clamp(0.0, 1.0);
        let fr = r[0] * a + r[4] * (1.0 - a);
        let fg = r[1] * a + r[5] * (1.0 - a);
        let fb = r[2] * a + r[6] * (1.0 - a);
        let l1 = luminance(fr, fg, fb);
        let l2 = luminance(r[4], r[5], r[6]);
        let (hi, lo) = if l1 > l2 { (l1, l2) } else { (l2, l1) };
        o[k] = (hi + 0.05) / (lo + 0.05);
    }
}

// ---------------------------------------------------------------- ranking

/// Writes the indices of the `k` largest values (descending, ties by lower index) to `out`.
/// Returns how many were written (`min(k, n)`). NaN counts as the smallest value.
#[no_mangle]
pub extern "C" fn ps_top_k(n: usize, vals: *const f64, k: usize, out: *mut f64) -> usize {
    let v = unsafe { view(vals, n) };
    let mut idx: Vec<usize> = (0..n).collect();
    let key = |i: usize| if v[i].is_nan() { f64::NEG_INFINITY } else { v[i] };
    idx.sort_by(|&a, &b| key(b).partial_cmp(&key(a)).unwrap().then(a.cmp(&b)));
    let m = k.min(n);
    let o = unsafe { view_mut(out, m) };
    for (slot, i) in o.iter_mut().zip(idx.iter()) {
        *slot = *i as f64;
    }
    m
}

// ---------------------------------------------------------------- score

fn erf(x: f64) -> f64 {
    // Abramowitz & Stegun 7.1.26, max error 1.5e-7
    let s = x.signum();
    let x = x.abs();
    let t = 1.0 / (1.0 + 0.3275911 * x);
    let y = 1.0
        - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592)
            * t
            * (-x * x).exp();
    s * y
}

/// Lighthouse's log-normal curve: `p10` scores 0.9, `median` scores 0.5.
fn curve(value: f64, p10: f64, median: f64) -> f64 {
    const INV_ERFC_ONE_FIFTH: f64 = 0.906_193_802_436_823_2;
    let x_log = (value.max(f64::MIN_POSITIVE) / median).ln();
    let p10_log = -(p10 / median).ln();
    let std = x_log * INV_ERFC_ONE_FIFTH / p10_log;
    let s = (1.0 - erf(std)) / 2.0;
    if value <= p10 { 1.0 } else { s.clamp(0.0, 1.0) }
}

/// Page score 0..100 from the metrics that can be measured while developing. Pass NaN for a metric
/// that is not available yet; its weight moves to the others. Weights: LCP 0.4, CLS 0.3, INP 0.3.
#[no_mangle]
pub extern "C" fn ps_score(lcp_ms: f64, cls: f64, inp_ms: f64, mobile: f64) -> f64 {
    let (lcp_p10, lcp_med) = if mobile >= 0.5 { (2500.0, 4000.0) } else { (1200.0, 2400.0) };
    let parts = [
        (lcp_ms, 0.4, curve(lcp_ms, lcp_p10, lcp_med)),
        (cls, 0.3, if cls <= 0.0 { 1.0 } else { curve(cls, 0.1, 0.25) }),
        (inp_ms, 0.3, curve(inp_ms, 200.0, 500.0)),
    ];
    let (mut sum, mut w) = (0.0, 0.0);
    for (v, weight, s) in parts {
        if !v.is_nan() {
            sum += s * weight;
            w += weight;
        }
    }
    if w == 0.0 { f64::NAN } else { (sum / w * 100.0).round() }
}

// ---------------------------------------------------------------- churn

/// Input records (2): node id, time in ms, one per observed style/class/text mutation.
/// Output records (3): node id, total count, highest count inside any 1000 ms window.
/// A node that changes dozens of times per second is being animated from JavaScript: every change
/// can cost a style recalculation, a layout and a paint. Returns the number of nodes written.
#[no_mangle]
pub extern "C" fn ps_churn(n: usize, inp: *const f64, out: *mut f64) -> usize {
    let d = unsafe { view(inp, n * 2) };
    let mut order: Vec<usize> = (0..n).collect();
    order.sort_by(|&a, &b| {
        d[a * 2].partial_cmp(&d[b * 2]).unwrap().then(d[a * 2 + 1].partial_cmp(&d[b * 2 + 1]).unwrap())
    });
    let o = unsafe { view_mut(out, n * 3) };
    let (mut nodes, mut i) = (0usize, 0usize);
    while i < n {
        let id = d[order[i] * 2];
        let start = i;
        while i < n && d[order[i] * 2] == id {
            i += 1;
        }
        let (mut best, mut lo) = (0usize, start);
        for hi in start..i {
            while d[order[hi] * 2 + 1] - d[order[lo] * 2 + 1] > 1000.0 {
                lo += 1;
            }
            best = best.max(hi - lo + 1);
        }
        o[nodes * 3] = id;
        o[nodes * 3 + 1] = (i - start) as f64;
        o[nodes * 3 + 2] = best as f64;
        nodes += 1;
    }
    nodes
}

#[cfg(test)]
mod tests {
    use super::*;

    fn run_plan(rows: &[[f64; IMG_IN]]) -> Vec<[f64; IMG_OUT]> {
        let flat: Vec<f64> = rows.iter().flatten().copied().collect();
        let mut out = vec![0.0; rows.len() * IMG_OUT];
        let g = ps_image_plan(rows.len(), flat.as_ptr(), out.as_mut_ptr());
        (0..g).map(|k| out[k * IMG_OUT..k * IMG_OUT + IMG_OUT].try_into().unwrap()).collect()
    }

    #[test]
    fn largest_usage_is_the_reference() {
        // same file used at 300px and 640px on a 2x screen, natural 3840 wide, 900 KB jpeg
        let r = run_plan(&[
            [7.0, 300.0, 200.0, 3840.0, 2560.0, 900_000.0, 1.0, 2.0, 0.0, 0.0],
            [7.0, 640.0, 427.0, 3840.0, 2560.0, 900_000.0, 1.0, 2.0, 1.0, 0.0],
        ]);
        assert_eq!(r.len(), 1);
        assert_eq!(r[0][3], 1280.0); // 640 * 2
        assert_eq!(r[0][4], 853.0);
        assert_eq!(r[0][7], 2.0);
        assert!(r[0][6] > 700_000.0, "{:?}", r[0]);
    }

    #[test]
    fn never_upscales_and_leaves_svg_alone() {
        let r = run_plan(&[
            [1.0, 800.0, 400.0, 400.0, 200.0, 20_000.0, 3.0, 1.0, 1.0, 0.0],
            [2.0, 800.0, 400.0, 400.0, 200.0, 5_000.0, 6.0, 1.0, 1.0, 0.0],
        ]);
        assert_eq!(r[0][3], 400.0);
        assert_eq!(r[0][6], 0.0); // already webp at the right size
        assert_eq!(r[1][3], 400.0);
        assert_eq!(r[1][6], 0.0);
    }

    #[test]
    fn dpr_is_capped_at_two() {
        let r = run_plan(&[[1.0, 400.0, 300.0, 4000.0, 3000.0, 500_000.0, 1.0, 3.0, 1.0, 0.0]]);
        assert_eq!(r[0][3], 800.0);
    }

    #[test]
    fn contrast_matches_wcag_reference_values() {
        let d = [0.0, 0.0, 0.0, 1.0, 255.0, 255.0, 255.0, 119.0, 119.0, 119.0, 1.0, 255.0, 255.0, 255.0];
        let mut o = [0.0; 2];
        ps_contrast(2, d.as_ptr(), o.as_mut_ptr());
        assert!((o[0] - 21.0).abs() < 1e-9);
        assert!((o[1] - 4.48).abs() < 0.02, "{}", o[1]); // #777 on white
    }

    #[test]
    fn top_k_is_descending_and_stable() {
        let v = [1.0, 9.0, 3.0, 9.0, f64::NAN, 5.0];
        let mut o = [0.0; 3];
        assert_eq!(ps_top_k(6, v.as_ptr(), 3, o.as_mut_ptr()), 3);
        assert_eq!(o, [1.0, 3.0, 5.0]);
    }

    #[test]
    fn score_curve_hits_its_anchor_points() {
        assert_eq!(ps_score(2000.0, 0.0, 100.0, 1.0), 100.0);
        let at_median = ps_score(4000.0, f64::NAN, f64::NAN, 1.0);
        assert!((at_median - 50.0).abs() <= 1.0, "{}", at_median);
        assert!(ps_score(9000.0, 0.6, 900.0, 1.0) < 15.0);
        assert!(ps_score(f64::NAN, f64::NAN, f64::NAN, 1.0).is_nan());
    }

    #[test]
    fn churn_finds_the_node_updated_every_frame() {
        let mut d = vec![];
        for f in 0..60 {
            d.extend([5.0, f as f64 * 16.0]); // node 5: 60 updates in ~1 s
        }
        d.extend([9.0, 100.0, 9.0, 4000.0]); // node 9: two, far apart
        let mut o = vec![0.0; (d.len() / 2) * 3];
        let n = ps_churn(d.len() / 2, d.as_ptr(), o.as_mut_ptr());
        assert_eq!(n, 2);
        assert_eq!(&o[0..3], &[5.0, 60.0, 60.0]);
        assert_eq!(&o[3..6], &[9.0, 2.0, 1.0]);
    }
}
