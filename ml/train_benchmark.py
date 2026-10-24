"""Benchmark mode: Model A's recipe on the published IndPenSim penicillin batches (PRD section 12.5).

Same feature recipe as the yeast model (value now and change over the last two hours, using only rows up to the
prediction time), different target and separate weights. Train on batches 1-70, test yield on 71-90, test the fault
detector on 91-100 after calibrating it on normal batches. Exports replay data for one held-out normal batch and for
batches 93 and 99, which show that a fault flag and a bad harvest are different facts.

Inputs (attach as a Kaggle dataset or keep under data/): process.csv (the 36 process columns of
100_Batches_IndPenSim_V3.csv, Raman dropped) and 100_Batches_IndPenSim_Statistics.csv.
The statistics file labels its totals "kg", but the magnitudes (~2.8e6 per batch) match a mass balance in grams, so
totals are reported in tonnes (value / 1e6).
"""
import json
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.decomposition import PCA
from sklearn.ensemble import GradientBoostingRegressor

SEED = 7
SIGNALS = ["aeration_Lph", "rpm", "sugar_feed_Lph", "acid_Lph", "base_Lph", "DO_mgL", "pH", "temp_K", "CO2_offgas_pct",
           "OUR_g_min", "CER_g_h", "substrate_gL", "volume_L", "penicillin_gL"]
NOMINAL_H = 230.0
LAG_H = 2.0
CHECK_H = [12, 24, 36, 48, 72, 96, 120, 150, 180, 210]
REPORT_FRACS = [0.2, 0.4, 0.6, 0.8]
TRAIN, TEST, FAULT = range(1, 71), range(71, 91), range(91, 101)
REPLAY = [80, 93, 99]


def find(name):
    roots = [Path("/kaggle/input"), Path(__file__).resolve().parent.parent.parent / "data",
             Path(__file__).resolve().parent / "data"]
    for r in roots:
        if r.exists():
            hits = list(r.rglob(name))
            if hits:
                return hits[0]
    raise FileNotFoundError(name)


def out_dir():
    k = Path("/kaggle/working")
    if k.exists():
        return k
    d = Path(__file__).resolve().parent / "out"
    d.mkdir(exist_ok=True)
    return d


def features_at(g, t_h):
    upto = g[g["time_h"] <= t_h]
    now = upto.iloc[-1]
    before = upto[upto["time_h"] <= t_h - LAG_H]
    before = before.iloc[-1] if len(before) else upto.iloc[0]
    row = {"frac": t_h / NOMINAL_H}
    for s in SIGNALS:
        row[s] = float(now[s])
        row[f"d_{s}"] = float(now[s] - before[s])
    return row


def names():
    return ["frac"] + SIGNALS + [f"d_{s}" for s in SIGNALS]


def table(df, batches, hours, y):
    rows, meta = [], []
    for b in batches:
        g = df[df["batch"] == b]
        for h in hours:
            if h <= g["time_h"].max():
                rows.append(features_at(g, h))
                meta.append({"batch": b, "t_h": h, "y": y[b]})
    return pd.DataFrame(rows)[names()], pd.DataFrame(meta)


def gbr():
    return GradientBoostingRegressor(n_estimators=400, learning_rate=0.03, max_depth=3, min_samples_leaf=6,
                                     subsample=0.8, random_state=SEED)


def mape(y, p):
    return float(np.mean(np.abs(p - y) / np.abs(y)) * 100)


def main():
    df = pd.read_csv(find("process.csv"))
    df["fault_ref"] = df["fault_ref"].fillna(0)
    stats = pd.read_csv(find("100_Batches_IndPenSim_Statistics.csv"))
    y = (stats.set_index("Batch ref")["Penicllin_yield_total (kg)"] / 1e6).to_dict()  # tonnes
    out = out_dir()

    # ---------------- yield
    X, M = table(df, TRAIN, CHECK_H, y)
    # Interval from out-of-batch residuals inside the training batches
    oof = np.zeros(len(M))
    folds = np.array_split(np.random.default_rng(SEED).permutation(list(TRAIN)), 5)
    for f in folds:
        te = M["batch"].isin(f).to_numpy()
        oof[te] = gbr().fit(X[~te], M.loc[~te, "y"]).predict(X[te])
    model = gbr().fit(X, M["y"])
    half = {h: float(np.quantile(np.abs(oof - M["y"])[M["t_h"] == h], 0.8)) for h in CHECK_H}
    train_mean = float(np.mean([y[b] for b in TRAIN]))

    report_h = [round(f * NOMINAL_H) for f in REPORT_FRACS]
    Xt, Mt = table(df, TEST, report_h, y)
    pt = model.predict(Xt)
    so_far = []
    for _, r in Mt.iterrows():  # penicillin made so far: titre x volume + what was drawn off, tonnes
        g = df[(df["batch"] == r["batch"]) & (df["time_h"] <= r["t_h"])]
        drawn = (g["penicillin_gL"] * (-g["dumped_broth_Lph"]).clip(lower=0) * 0.2).sum()
        so_far.append((g["penicillin_gL"].iloc[-1] * g["volume_L"].iloc[-1] + drawn) / 1e6)
    so_far = np.array(so_far)
    yield_rows = []
    for f, h in zip(REPORT_FRACS, report_h):
        m = (Mt["t_h"] == h).to_numpy()
        yt = Mt.loc[m, "y"].to_numpy()
        hw = np.interp(h, CHECK_H, [half[c] for c in CHECK_H])
        yield_rows.append({
            "frac": f, "t_h": h, "n": int(m.sum()),
            "model_mape": round(mape(yt, pt[m]), 2),
            "model_mae_t": round(float(np.mean(np.abs(pt[m] - yt))), 3),
            "baseline_mean_mape": round(mape(yt, np.full_like(yt, train_mean)), 2),
            "baseline_so_far_mape": round(mape(yt, so_far[m]), 2),
            "coverage_80": round(float(np.mean(np.abs(pt[m] - yt) <= hw)) * 100, 1),
        })
    for r in yield_rows:
        print(r)

    # ---------------- fault detector: per-hour normal mean/std on batches 1-55, threshold set on 56-70
    df["hour"] = df["time_h"].round().astype(int)
    fit_b, cal_b = list(range(1, 56)), list(range(56, 71))
    hourly = df.groupby(["batch", "hour"])[SIGNALS].mean().reset_index()
    ref = hourly[hourly["batch"].isin(fit_b)].groupby("hour")[SIGNALS]
    mu, sd = ref.mean(), ref.std().clip(lower=1e-6)
    sd = sd.where(sd > 0.02 * mu.abs(), 0.02 * mu.abs() + 1e-6)

    def z(frame):
        m_ = mu.reindex(frame["hour"]).to_numpy()
        s_ = sd.reindex(frame["hour"]).to_numpy()
        return np.nan_to_num((frame[SIGNALS].to_numpy() - m_) / s_)

    zf = z(hourly[hourly["batch"].isin(fit_b)])
    pca = PCA(n_components=0.9, random_state=SEED).fit(zf)
    sc = pca.transform(zf)
    t2_lim = float(np.quantile(np.sum(sc ** 2 / pca.explained_variance_, axis=1), 0.99))
    spe_lim = float(np.quantile(np.sum((zf - pca.inverse_transform(sc)) ** 2, axis=1), 0.99))

    def score(frame):
        zz = z(frame)
        s_ = pca.transform(zz)
        t2 = np.sum(s_ ** 2 / pca.explained_variance_, axis=1)
        spe = np.sum((zz - pca.inverse_transform(s_)) ** 2, axis=1)
        return np.maximum(t2 / t2_lim, spe / spe_lim)

    def first_alarm(frame, thr):
        s_ = score(frame)
        hrs = frame["hour"].to_numpy()
        over = (s_ > thr) & (hrs >= 10)
        hit = np.where(over[1:] & over[:-1])[0]
        return (float(hrs[hit[0] + 1]) if len(hit) else None), s_

    cal_max = []
    for b in cal_b:
        g = hourly[hourly["batch"] == b]
        s_ = score(g)
        s_ = np.minimum(s_[1:], s_[:-1])[g["hour"].to_numpy()[1:] >= 10]
        cal_max.append(float(s_.max()))
    thr = float(np.quantile(cal_max, 0.9))  # about 10% of calibration batches would alarm somewhere

    normal_alarm = [first_alarm(hourly[hourly["batch"] == b], thr)[0] is not None for b in TEST]
    onsets = df[df["fault_ref"] > 0].groupby("batch")["time_h"].min().to_dict()
    fault_rows = []
    for b in FAULT:
        at, _ = first_alarm(hourly[hourly["batch"] == b], thr)
        on = onsets.get(b)
        fault_rows.append({"batch": b, "onset_h": on, "alarm_h": at,
                           "detected": at is not None and on is not None and at >= on - 1,
                           "delay_h": (at - on) if at is not None and on is not None and at >= on - 1 else None,
                           "total_t": round(y[b], 3)})
    fr = pd.DataFrame(fault_rows)
    fault_report = {
        "threshold": thr,
        "false_alarm_batches_pct": round(100 * float(np.mean(normal_alarm)), 1),
        "normal_test_batches": len(TEST),
        "detection_pct": round(100 * float(fr["detected"].mean()), 1),
        "median_delay_h": None if fr["delay_h"].dropna().empty else float(fr["delay_h"].median()),
        "fault_batches": fault_rows,
    }
    print(json.dumps(fault_report, indent=1, default=str))

    # ---------------- replay for the dashboard
    replay = []
    for b in REPLAY:
        g = df[df["batch"] == b]
        hrs = list(range(6, int(g["time_h"].max()) + 1, 2))
        feats = pd.DataFrame([features_at(g, h) for h in hrs])[names()]
        pred = model.predict(feats)
        hw = np.interp(hrs, CHECK_H, [half[c] for c in CHECK_H])
        hb = hourly[hourly["batch"] == b]
        at, s_ = first_alarm(hb, thr)
        s_by_hour = dict(zip(hb["hour"], s_))
        rows = g.set_index("time_h").reindex([float(h) for h in hrs], method="nearest")
        replay.append({
            "batch": b, "fault": b >= 91, "totalT": round(y[b], 3), "alarmH": at, "onsetH": onsets.get(b),
            "hours": hrs,
            "predT": np.round(pred, 3).tolist(), "halfT": np.round(hw, 3).tolist(),
            "faultScore": [round(float(s_by_hour.get(h, np.nan)), 3) for h in hrs],
            "doMgL": np.round(rows["DO_mgL"].to_numpy(), 2).tolist(),
            "tempC": np.round(rows["temp_K"].to_numpy() - 273.15, 2).tolist(),
            "pH": np.round(rows["pH"].to_numpy(), 3).tolist(),
            "volumeL": np.round(rows["volume_L"].to_numpy(), 0).tolist(),
            "penicillinGL": np.round(rows["penicillin_gL"].to_numpy(), 3).tolist(),
        })
    report = {"yield": yield_rows, "fault": fault_report, "train_mean_t": train_mean, "threshold": thr,
              "units_note": "Statistics file says kg; magnitudes match grams, so totals are shown in tonnes."}
    (out / "benchmark_report.json").write_text(json.dumps(report, indent=2, default=str))
    (out / "benchmark_replay.json").write_text(json.dumps({"threshold": thr, "batches": replay}, default=str))
    print("wrote benchmark_report.json and benchmark_replay.json")


if __name__ == "__main__":
    main()
