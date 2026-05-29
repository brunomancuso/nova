# Prediction Model

All formulas match `js/prediction.js` exactly.

---

## Physical Setup

    Table length  : 274 cm  (near end = 0, far end = 274 cm)
    Table width   : 152.5 cm
    Robot depth   : 40 cm   (HWIDTH = 0.40 m, along table length)
    Launch height : h0 = 0.24 m  (above table surface)

    x             — landing position in cm from near end of table
    robotXcm      — robot left-edge position in cm from near end (0 when flush)
    cannonM       — cannon position in meters from near end:
                    cannonM = robotXcm / 100 + 0.40

    -- inverse (calibration): distance from cannon to measured landing point
    x_land = x / 100 - cannonM           (meters)

---

## Robot RPM Model

    Top rpm = 970 + (630.5 x Speed) + (342 x Spin)
    Bot rpm = 970 + (630.5 x Speed) - (342 x Spin)

    -- average -> forward ball speed; spin cancels:
    rpm_avg  = 970 + 630.5 x Speed

    -- difference -> ball rotation:
    rpm_diff = 684 x Spin

---

## Prediction Inputs (raw robot settings)

    Speed    -- speed setting (0-10)
    Spin     -- spin setting  (positive = topspin, negative = backspin)
    height   -- angle parameter (-20 to 40);  angle_deg = (height - 20) x (2/7)   -- zero at height=20, calibrated from (20->0deg) and (-50->-20deg)
    robotXcm -- robot left-edge position in cm from near end

---

## Calibration Constants

    kv   = 0.008978  (km/h)/RPM  -- RPM-to-speed factor
    kd   = 0.01254   s/m         -- air drag; calibrate with spin=0 shots
    kMS  = 0.14357   1/m         -- combined Magnus-Spin constant
                                    kMS = kM x ks x 684
                                    (kM and ks cannot be separated from landing data)

---

## Step-by-Step Prediction

### Step 0 -- derived quantities

    v        = (970 + 630.5 x Speed) x kv / 3.6      (m/s)
    theta    = (height - 20) x (2/7) x pi / 180        (radians)
    cannonM  = robotXcm / 100 + 0.40                  (m from near end to cannon)

### Step 1 -- effective gravity (Magnus effect)

Topspin (Spin > 0) adds downforce -> ball lands shorter.
Backspin (Spin < 0) reduces gravity -> ball lands longer.

    g_eff = 9.81 + kMS x Spin x v

### Step 2 -- projectile range with effective gravity

    vx      = v x cos(theta)
    vy      = v x sin(theta)
    t_land  = (vy + sqrt(vy^2 + 2 x g_eff x h0)) / g_eff
    x_proj  = vx x t_land                             (meters from cannon, no drag)

### Step 3 -- air drag correction

    x_land  = x_proj x exp(-kd x v)                  (meters from cannon)

### Step 4 -- absolute table position

    x_cm = (x_land + cannonM) x 100                  (cm from near end)

---

## Full Formula (collapsed)

    v       = (970 + 630.5 x Speed) x kv / 3.6
    theta   = (height - 20) x (2/7) x pi / 180
    g_eff   = 9.81 + kMS x Spin x v
    vy      = v x sin(theta)
    t_land  = (vy + sqrt(vy^2 + 2 x g_eff x h0)) / g_eff
    x_land  = v x cos(theta) x t_land x exp(-kd x v)   (meters from cannon)
    x_cm    = (x_land + robotXcm/100 + 0.40) x 100     (cm from near end)

---

## Calibration Procedure

### Step 1 -- calibrate kv and kd together (spin=0 shots)

Shoot at Spin=0, 2+ different Speed values, measure landing x in cm.

For a candidate kv, derive per-shot kd:
    v      = (970 + 630.5 x Speed) x kv / 3.6
    x_land = x / 100 - cannonM
    x_proj = v x cos(theta) x t_land(g_eff=9.81)
    kd_i   = -ln(x_land / x_proj) / v

Find kv that minimises variance of kd across all shots (golden-section search on [0.003, 0.015]).
Average the resulting kd values.

### Step 2 -- calibrate kMS (spin != 0 shots)

Use kv and kd from Step 1. Shoot at known Spin != 0, measure x in cm.

    x_land = x / 100 - cannonM
    t_land = (x_land x exp(kd x v)) / (v x cos(theta))   -- undo drag
    g_eff  = 2 x (vy x t_land + h0) / t_land^2           -- back-solve
    kMS_i  = (g_eff - 9.81) / (Spin x v)

Average kMS_i over all shots.

---

## Y Prediction (left/right)

The left_right setting steers the cannon horizontally. Setting 0 = straight, 10 = max angle.
Calibration point: lr=8, distX=238.3 cm, y=72 cm.

    angle_lr = lr x KLR                 (radians)
    y_cm     = distX_cm x tan(angle_lr) (cm from straight-ahead line)

    KLR = 0.036677  rad/unit  -- calibrated from lr=8 -> 72 cm at 238.3 cm dist

Note: y_cm is lateral offset from the cannon's straight-ahead axis.
Add robotYcm (cannon centre position) to get absolute table Y.

---

## Default Values

    h0   = 0.24     m
    kv   = 0.008978  (km/h)/RPM
    kd   = 0.01254   s/m
    kMS  = 0.14357   1/m
    KLR  = 0.036677  rad/unit