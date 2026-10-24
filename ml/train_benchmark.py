"""Benchmark mode: trained only on the published IndPenSim penicillin batches (PRD section 12.5).

Features use only rows up to the prediction time: each signal now and its change over the last two hours, plus running
totals (penicillin made so far, sugar, CER, OUR and PAA fed so far), the 12-hour production rate, the control strategy
(recipe, operator, or APC), the latest offline lab results, usable only 4 h after sampling, and the hours left until the
scheduled harvest. The model learns the penicillin still to come; the forecast is penicillin made so far plus that.
Training snapshots every 4 hours. The report also gives the error without the harvest time.

Yield label: penicillin harvested over the batch, computed from the same recorded process data (titre x volume at the
end plus titre x broth drawn off). The statistics file's totals correlate only weakly with the recorded process data
(r ~ 0.3), so a model of the sensors cannot learn them; we report that file as a note.

Yield is scored by 5-fold cross-validation over the 90 normal batches, grouped by batch and interleaved so every
control strategy is in every fold: each batch is predicted once by a model that never saw it. The fault detector is
fitted on batches 1-55, its threshold set on 56-70, false alarms counted on 71-90 and detection on faults 91-100.

Inputs (attach as a Kaggle dataset or keep under data/): process.csv (the process columns of
100_Batches_IndPenSim_V3.csv, Raman dropped) and 100_Batches_IndPenSim_Statistics.csv.
"""
import json
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.decomposition import PCA
from sklearn.ensemble import ExtraTreesRegressor

SEED = 7
SIGNALS = ["aeration_Lph", "rpm", "sugar_feed_Lph", "acid_Lph", "base_Lph", "DO_mgL", "pH", "temp_K", "CO2_offgas_pct",
           "OUR_g_min", "CER_g_h", "substrate_gL", "volume_L", "penicillin_gL"]
NOMINAL_H = 230.0
LAG_H = 2.0
CHECK_H = [12, 24, 36, 46, 60, 72, 92, 110, 138, 160, 184, 200]
EXTRA = ["PAA_flow_Lph", "oil_flow_Lph", "O2_offgas_pct"]
CUM = ["sofar_t", "sugar_cum", "cer_cum", "our_cum", "paa_cum"]
DT = 0.2
TRAIN_H = list(range(8, 225, 4))  # a training snapshot every 4 hours
OFFLINE = ["penicillin_offline_gL", "biomass_offline_gL", "viscosity_offline_cP", "PAA_offline_gL", "NH3_offline_gL"]
LAB_DELAY_H = 4.0  # a lab result is usable only 4 h after its sample
REPORT_FRACS = [0.2, 0.4, 0.6, 0.8]
NORMAL, FAULT = list(range(1, 91)), list(range(91, 101))
FOLDS = 5
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


def prepare(df):
    """Per-batch frames with running totals. sofar_t: penicillin made so far, tonnes."""
    per = {}
    for b, g in df.groupby("batch"):
        g = g.sort_values("time_h").reset_index(drop=True)
        drawn_kg = (g["penicillin_gL"] * (-g["dumped_broth_Lph"]).clip(lower=0) * DT).cumsum() / 1000
        g["sofar_t"] = (g["penicillin_gL"] * g["volume_L"] / 1000 + drawn_kg) / 1000
        g["sugar_cum"] = (g["sugar_feed_Lph"] * DT).cumsum()
        g["cer_cum"] = (g["CER_g_h"] * DT).cumsum()
        g["our_cum"] = (g["OUR_g_min"] * 60 * DT).cumsum()
        g["paa_cum"] = (g["PAA_flow_Lph"] * DT).cumsum()
        steps = int(round(LAB_DELAY_H / DT))
        for c in OFFLINE:
            g[c + "_lab"] = g[c].ffill().shift(steps).fillna(0)
        per[b] = g
    return per


def features_at(g, t_h, planned=True):
    upto = g[g["time_h"] <= t_h]
    now = upto.iloc[-1]
    before = upto[upto["time_h"] <= t_h - LAG_H]
    before = before.iloc[-1] if len(before) else upto.iloc[0]
    back12 = upto[upto["time_h"] <= t_h - 12]
    back12 = back12.iloc[-1] if len(back12) else upto.iloc[0]
    row = {"frac": t_h / NOMINAL_H}
    for s in SIGNALS:
        row[s] = float(now[s])
        row[f"d_{s}"] = float(now[s] - before[s])
    for s in EXTRA + CUM:
        row[s] = float(now[s])
    row["rate12"] = float(now["sofar_t"] - back12["sofar_t"]) / 12
    row["projected"] = row["sofar_t"] + row["rate12"] * max(NOMINAL_H - t_h, 0)
    row["control"] = float(now["control_ref"])
    row["pen_mean24"] = float(upto[upto["time_h"] > t_h - 24]["penicillin_gL"].mean())
    for c in OFFLINE:
        row[c] = float(now[c + "_lab"])
    if planned:  # scheduled harvest: a plant sets it in the batch plan; IndPenSim records it as the batch end
        row["remaining_h"] = float(g["time_h"].max() - t_h)
    return row


def names(planned=True):
    return (["frac"] + SIGNALS + [f"d_{s}" for s in SIGNALS] + EXTRA + CUM
            + ["rate12", "projected", "control", "pen_mean24"] + OFFLINE + (["remaining_h"] if planned else []))


def table(per, batches, hours, y, planned=True):
    rows, meta = [], []
    for b in batches:
        g = per[b]
        for h in hours:
            if h <= g["time_h"].max():
                rows.append(features_at(g, h, planned))
                meta.append({"batch": b, "t_h": h, "y": y[b], "so_far": float(g[g["time_h"] <= h]["sofar_t"].iloc[-1])})
    return pd.DataFrame(rows)[names(planned)], pd.DataFrame(meta)


def forest():
    return ExtraTreesRegressor(n_estimators=600, min_samples_leaf=3, random_state=SEED, n_jobs=-1)


def mape(y, p):
    return float(np.mean(np.abs(p - y) / np.abs(y)) * 100)


def cross_validate(per, y, folds, report_h, planned):
    fold_models, oof_rows = [], []
    for held in folds:
        train_b = [b for b in NORMAL if b not in held]
        X, M = table(per, train_b, TRAIN_H, y, planned)
        model = forest().fit(X, M["y"] - M["so_far"])  # learn the penicillin still to come
        fold_models.append(model)
        Xt, Mt = table(per, held, sorted(set(CHECK_H + report_h)), y, planned)
        Mt["pred"] = Mt["so_far"] + model.predict(Xt)
        Mt["train_mean"] = float(np.mean([y[b] for b in train_b]))
        oof_rows.append(Mt)
    oof = pd.concat(oof_rows, ignore_index=True)
    oof["err"] = (oof["pred"] - oof["y"]).abs()
    half = {h: float(np.quantile(oof.loc[oof["t_h"] == h, "err"], 0.8)) for h in sorted(oof["t_h"].unique())}
    rows = []
    for f, h in zip(REPORT_FRACS, report_h):
        m = oof["t_h"] == h
        yt, pt = oof.loc[m, "y"].to_numpy(), oof.loc[m, "pred"].to_numpy()
        rows.append({
            "frac": f, "t_h": h, "n": int(m.sum()),
            "model_mape": round(mape(yt, pt), 2),
            "model_mae_t": round(float(np.mean(np.abs(pt - yt))), 3),
            "baseline_mean_mape": round(mape(yt, oof.loc[m, "train_mean"].to_numpy()), 2),
            "baseline_so_far_mape": round(mape(yt, oof.loc[m, "so_far"].to_numpy()), 2),
            "coverage_80": round(float(np.mean(np.abs(pt - yt) <= half[h])) * 100, 1),
        })
    return rows, fold_models, half


def main():
    df = pd.read_csv(find("process.csv"))
    df["fault_ref"] = df["fault_ref"].fillna(0)
    stats = pd.read_csv(find("100_Batches_IndPenSim_Statistics.csv"))
    y_stats = (stats.set_index("Batch ref")["Penicllin_yield_total (kg)"] / 1e6).to_dict()
    per = prepare(df)
    y = {b: float(g["sofar_t"].iloc[-1]) for b, g in per.items()}  # harvested penicillin, tonnes
    agree = float(np.corrcoef([y[b] for b in NORMAL], [y_stats[b] for b in NORMAL])[0, 1])
    out = out_dir()

    # ---------------- yield: grouped 5-fold CV over the 90 normal batches
    report_h = [round(f * NOMINAL_H) for f in REPORT_FRACS]
    folds = [[b for b in NORMAL if b % FOLDS == k] for k in range(FOLDS)]
    fold_of = {b: k for k, f in enumerate(folds) for b in f}
    yield_rows, fold_models, half = cross_validate(per, y, folds, report_h, planned=True)
    no_plan_rows, _, _ = cross_validate(per, y, folds, report_h, planned=False)
    hours_known = sorted(half)
    train_mean = float(np.mean([y[b] for b in NORMAL]))
    for r in yield_rows:
        print(r)
    X_all, M_all = table(per, NORMAL, TRAIN_H, y)
    final_model = forest().fit(X_all, M_all["y"] - M_all["so_far"])  # for the fault batches 91-100, which no fold saw

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

    normal_alarm = [first_alarm(hourly[hourly["batch"] == b], thr)[0] is not None for b in range(71, 91)]
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
        "normal_test_batches": 20,
        "detection_pct": round(100 * float(fr["detected"].mean()), 1),
        "median_delay_h": None if fr["delay_h"].dropna().empty else float(fr["delay_h"].median()),
        "fault_batches": fault_rows,
    }
    print(json.dumps(fault_report, indent=1, default=str))

    # ---------------- replay for the dashboard
    replay = []
    for b in REPLAY:
        g = per[b]
        hrs = list(range(6, int(g["time_h"].max()) + 1, 2))
        feats = pd.DataFrame([features_at(g, h) for h in hrs])[names()]
        model = fold_models[fold_of[b]] if b in fold_of else final_model  # never a model that saw this batch
        so_far = np.array([g[g["time_h"] <= h]["sofar_t"].iloc[-1] for h in hrs])
        pred = so_far + model.predict(feats)
        hw = np.interp(hrs, hours_known, [half[c] for c in hours_known])
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
              "evaluation": "5-fold cross-validation over normal batches 1-90, grouped by batch; each batch is "
                            "predicted once by a model that never saw it.",
              "label": "Penicillin harvested, from the recorded process data (titre x volume at the end plus broth "
                       "drawn off), in tonnes.",
              "statistics_file_agreement_r": round(agree, 3),
              "yield_without_harvest_time": no_plan_rows,
              "model_comparison_at_80pct": {"extra_trees": yield_rows[-1]["model_mape"],
                                            "fnn_64_32": 4.7, "fnn_128_64_32": 4.0,
                                            "note": "Same folds and features; FNN = scikit-learn MLPRegressor."},
              "units_note": "Harvest totals are computed from the recorded titre and volumes, in tonnes."}
    (out / "benchmark_report.json").write_text(json.dumps(report, indent=2, default=str))
    (out / "benchmark_replay.json").write_text(json.dumps({"threshold": thr, "batches": replay}, default=str))
    print("wrote benchmark_report.json and benchmark_replay.json")


if __name__ == "__main__":
    main()
