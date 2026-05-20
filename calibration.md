# Coordinates


Speed=3
Spin=2
x = 240

-- x is landing position in cm from near end
-- robot right side (cannon) sits at robot_width from near end when flush
-- robot_width = 0.5 m = 50 cm

x_real = x / 100 - robot_width         (meters from cannon to landing point)
x_real = x / 100 - 0.5

-- for x = 240:
x_real = 2.40 - 0.50 = 1.90 m

height = 50
throw_angle = height * 0.4

drop -10 a 10
22 grados
dir_angle = drop * 2.2

height:

-20 a 40 

Top rpm = 970 + (630.5 × Speed) + (342 x Spin)
Bot rpm = 970 + (630.5 × Speed) - (342 × Spin)

ball_speed = (top_rpm + bot_rpm) / 2 × k_v    (average → forward velocity)
ball_spin  = (top_rpm - bot_rpm) × k_s         (difference → rotation)

-- expanding with the RPM formulas above:
ball_speed = (970 + 630.5 × Speed) × k_v       (spin cancels out)
ball_spin  = 2 × 342 × Spin × k_s = 684 × Spin × k_s


Speed=2
Spin=0.5
Speed km/h=15
Spin rps=4

-- calibration:
rpm_avg = 970 + 630.5 × 2 = 2231 RPM
rpm_diff = 684 × 0.5     = 342  RPM

k_v = 15 / 2231  = 0.00672  (km/h) / RPM
k_s = 4  / 342   = 0.01170  rps / RPM

Speed=3
Spin=1.5
Speed km/h=18
Spin rps=11

-- calibration:
rpm_avg  = 970 + 630.5 × 3 = 2861.5 RPM
rpm_diff = 684 × 1.5       = 1026   RPM
k_v = 18 / 2861.5 = 0.00629  (km/h) / RPM
k_s = 11 / 1026   = 0.01072  rps / RPM


Speed	Max Spin	rps	km/h	k_v	k_s
1.5	5	28	13	0.00679	0.00819
2	6	36	17	0.00762	0.00877
2.5	7	43	19	0.00746	0.00898
3	8	52	20	0.00699	0.00950
3.5	9	56	23	0.00724	0.00910
4	10	61	24	0.00687	0.00892
4.5	10	66	25	0.00657	0.00965
5	9	59	29	0.00703	0.00958
5.5	8	53	29	0.00654	0.00969
6	8	53	33	0.00695	0.00969
6.5	7	46	34	0.00671	0.00961
7	6	42	36	0.00669	0.01023
7.5	5	33	39	0.00685	0.00965
8	4	28	40	0.00665	0.01023
8.5	3	21	42	0.00664	0.01023
9	2	16	46	0.00692	0.01170

-- averages (16 rows, speed 1.5 to 9):
k_v avg = 0.00691
k_s avg = 0.00961

---

## Ball Landing Prediction

### Inputs
    speed_kmh   — ball speed in km/h  (from k_v calibration)
    spin_rps    — ball spin in rps    (from k_s calibration, + = topspin, - = backspin)
    angle_deg   — throw angle in degrees (= height * 0.4)
    h0          — launch height above table surface in meters (measure once)

### Unit conversions
    v   = speed_kmh / 3.6            (m/s)
    θ   = angle_deg × π / 180        (radians)

### Step 1 — effective gravity (Magnus effect)
Topspin adds downward force → ball lands shorter.
Backspin adds upward force  → ball lands longer.

    g_eff = 9.81 + k_M × spin_rps × v

    k_M : Magnus constant  [s/(m·rps)]  — empirical, calibrate with spin shots

### Step 2 — projectile with effective gravity
    vx      = v × cos(θ)
    vy      = v × sin(θ)
    t_land  = (vy + sqrt(vy² + 2 × g_eff × h0)) / g_eff
    x_proj  = vx × t_land

### Step 3 — air drag correction
    x_land  = x_proj × exp(-k_d × v)

    k_d : drag constant  [s/m]  — empirical, calibrate with spin=0 shots

### Full formula (collapsed)
    v       = speed_kmh / 3.6
    θ       = angle_deg × π / 180
    g_eff   = 9.81 + k_M × spin_rps × v
    t_land  = (v·sin θ + sqrt((v·sin θ)² + 2·g_eff·h0)) / g_eff
    x_land  = v·cos θ · t_land · exp(-k_d · v)            (meters from launch point)

### Calibration
1. k_d first — shoot at spin=0, angle=0, multiple speeds, measure x_land:
       k_d = -ln(x_land / x_proj) / v
   Average over all shots.

2. k_M second — fix speed & angle, vary spin, measure x_land:
   Solve for g_eff that satisfies the formula, then:
       k_M = (g_eff - 9.81) / (spin_rps × v)
   Average over multiple spin values.

### Starting values (tune from here)
    h0  = 0.30  m
    k_d = 0.05  s/m
    k_M = 0.10  s/(m·rps)


