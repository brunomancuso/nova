"""
Ball landing prediction.

predict_dist(height, spin, speed)
  Returns predicted dist in mm — the flight distance from the cannon.
  This matches the 'dist (mm)' column in data.md.
  To get absolute table position: dist_mm + cannonM_mm (cannon offset from near end).

Constants calibrated from test data with no cannonM offset:
    kv  = 0.010562  (km/h)/RPM
    kd  = 0.06139   s/m
    kMS = 0.06009   1/m
"""

import math

# ── calibration constants ─────────────────────────────────────────────────────
KV   = 0.008978   # (km/h)/RPM — ball speed scaling
KD   = 0.01254    # s/m        — air drag
KMS  = 0.14357    # 1/m        — combined Magnus-Spin constant (kM × ks × 684)

# ── physical constants ────────────────────────────────────────────────────────
H0 = 0.24         # m — launch height above table surface


def predict_dist(height, spin, speed, kv=KV, kd=KD, kMS=KMS):
    """
    Predict ball flight distance from cannon.

    Parameters
    ----------
    height : angle setting (-50 to 100); angle_deg = (height - 20) * 2/7
    spin   : spin setting (positive = topspin, negative = backspin)
    speed  : speed setting (0-10)

    Returns
    -------
    dist_mm : predicted flight distance from cannon in mm
              (matches the 'dist (mm)' column in data.md)
    """
    v     = (970 + 630.5 * speed) * kv / 3.6        # m/s
    theta = (height - 20) * (2 / 7) * math.pi / 180  # radians

    vx    = v * math.cos(theta)
    vy    = v * math.sin(theta)
    g_eff = 9.81 + kMS * spin * v                    # effective gravity (Magnus)

    t_land = (vy + math.sqrt(vy**2 + 2 * g_eff * H0)) / g_eff
    x_land = vx * t_land * math.exp(-kd * v)         # m from cannon

    return x_land * 1000                              # mm = dist


# ── test against data.md ──────────────────────────────────────────────────────
if __name__ == '__main__':
    test_data = [
        # height  spin  speed  dist_mm (measured)
        (40,   0,   2.5,  1400),
        (40,   0,   3.0,  1423),
        (40,   0,   3.0,  1450),
        (30,   0,   4.0,  1435),
        (20,   0,   4.0,  1400),
        (30,   0,   3.5,  1440),
        (30,   0,   3.0,  1400),
        (30,   0,   2.5,  1380),
        (35,   0,   2.0,  1370),
        (40, 0.5,   2.0,  1375),
        (40,   1,   2.0,  1370),
        (40,   2,   2.0,  1360),
        (40,   2,   3.0,  1410),
        (40,   3,   3.0,  1400),
        (40,   4,   3.0,  1390),
        (40,   5,   3.0,  1385),
        (40,   6,   3.0,  1380),
    ]

    print(f"{'h':>4} {'spd':>4} {'sp':>4} | {'calc(mm)':>9} | {'dist(mm)':>9} | {'err%':>6}")
    print('-' * 48)
    for h, sp, spd, dist_mm in test_data:
        calc = predict_dist(h, sp, spd)
        err  = (calc - dist_mm) / dist_mm * 100
        print(f"{h:>4} {spd:>4} {sp:>4} | {calc:>9.0f} | {dist_mm:>9} | {err:>+.1f}%")

    rmse = math.sqrt(sum((predict_dist(h,sp,spd) - d)**2
                         for h,sp,spd,d in test_data) / len(test_data))
    print(f"\nRMSE = {rmse:.1f} mm   ({rmse/10:.2f} cm)")
