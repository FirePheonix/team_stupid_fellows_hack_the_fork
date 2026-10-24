"""Model A: early final-protein prediction, fault detection, and drivers for the yeast run.

Runs locally (python ml/train_model_a.py) or as a Kaggle notebook with yeast_batches.csv attached as a dataset.
Writes model_a.json (consumed by the dashboard in the browser) and model_a_report.json (metrics for the cards).

Yield model: gradient-boosted trees on features that use only rows up to the prediction time (current value and change
over the last two hours of each signal, fraction of the batch elapsed, feedstock, operator setpoints). Split by batch.
80% interval: split-conformal, per batch stage, from out-of-fold residuals.

Fault model: multivariate statistical process control fitted on normal-window batches only. Each signal is centred and
scaled by its normal mean and spread at that minute of the batch; PCA on those residuals gives Hotelling T2 and SPE.
The score is the larger of the two, each divided by its 99th percentile on training normals. An alarm needs two
consecutive samples above the threshold.
"""
import json
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.decomposition import PCA
from sklearn.ensemble import GradientBoostingRegressor
from sklearn.inspection import permutation_importance
from sklearn.model_selection import GroupKFold

SEED = 7
SIGNALS = ["dissolved_oxygen", "ph", "temperature", "agitation", "aeration", "feed_rate", "biomass", "co2", "substrate",
           "ethanol"]
SETPOINTS = ["sp_ph", "sp_temperature", "sp_agitation", "sp_aeration", "sp_feed"]
FEEDSTOCKS = ["glucose", "molasses", "pea-starch-hydrolysate"]
LAG_ROWS = 12  # two hours at the 10-minute log interval
TRAIN_FRACS = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9]
REPORT_FRACS = [0.2, 0.4, 0.6, 0.8]


def find_data():
    for p in [Path("/kaggle/input"), Path(__file__).resolve().parent / "data" if "__file__" in globals() else Path(".")]:
        hits = list(p.rglob("yeast_batches.csv")) if p.exists() else []
        if hits:
            return hits[0]
    raise FileNotFoundError("yeast_batches.csv not found")


def out_dir():
    k = Path("/kaggle/working")
    if k.exists():
        return k
    d = Path(__file__).resolve().parent / "out"
    d.mkdir(exist_ok=True)
    return d


def feature_names():
    names = ["frac"] + SIGNALS + [f"d_{s}" for s in SIGNALS] + SETPOINTS + [f"fs_{f}" for f in FEEDSTOCKS]
    return names


def features_at(g, frac):
    """One row from a batch using only samples logged up to `frac` of the batch."""
    upto = g[g["frac"] <= frac + 1e-9]
    now = upto.iloc[-1]
    before = upto.iloc[max(0, len(upto) - 1 - LAG_ROWS)]
    row = {"frac": frac}
    for s in SIGNALS:
        row[s] = now[s]
        row[f"d_{s}"] = now[s] - before[s]
    for s in SETPOINTS:
        row[s] = now[s]
    for f in FEEDSTOCKS:
        row[f"fs_{f}"] = float(now["feedstock"] == f)
    return row, float(now["protein_kg"])


def build_table(df, fracs):
    rows, meta = [], []
    for b, g in df.groupby("batch", sort=False):
        g = g.sort_values("t_min")
        first = g.iloc[0]
        for f in fracs:
            r, so_far = features_at(g, f)
            rows.append(r)
            meta.append({"batch": b, "set": first["set"], "scenario": first["scenario"], "fault": int(first["fault"]),
                         "frac": f, "so_far": so_far, "y": float(first["final_protein_kg"])})
    return pd.DataFrame(rows)[feature_names()], pd.DataFrame(meta)


def gbr():
    return GradientBoostingRegressor(n_estimators=500, learning_rate=0.05, max_depth=4, min_samples_leaf=10,
                                     subsample=0.8, random_state=SEED)


def export_trees(model, names):
    trees = []
    for est in model.estimators_[:, 0]:
        t = est.tree_
        trees.append({
            "f": t.feature.tolist(), "t": [round(float(x), 6) for x in t.threshold],
            "l": t.children_left.tolist(), "r": t.children_right.tolist(),
            "v": [round(float(x), 6) for x in t.value[:, 0, 0]],
        })
    return {"features": names, "init": float(model.init_.constant_[0][0]), "lr": model.learning_rate, "trees": trees}


def mape(y, p):
    return float(np.mean(np.abs(p - y) / np.abs(y)) * 100)


def split_batches(batch_meta):
    rng = np.random.default_rng(SEED)
    test = set()
    for s in ["wide", "normal", "fault"]:
        ids = batch_meta.loc[batch_meta["set"] == s, "batch"].to_numpy()
        test |= set(rng.choice(ids, size=int(0.2 * len(ids)), replace=False).tolist())  # 80/20 by batch
    return test


# ---------------------------------------------------------------- fault detector (batch MSPC)

def fit_mspc(df_normal):
    piv = {s: df_normal.pivot(index="batch", columns="t_min", values=s) for s in SIGNALS}
    t_grid = piv[SIGNALS[0]].columns.to_numpy()
    mean = np.stack([piv[s].mean().to_numpy() for s in SIGNALS], axis=1)  # [T, S]
    std = np.stack([piv[s].std().to_numpy() for s in SIGNALS], axis=1)
    std = np.maximum(std, np.array([1.0, 0.02, 0.08, 2, 0.01, 0.003, 0.2, 0.05, 0.15, 0.15]))  # sensor floors
    return t_grid, mean, std


def residuals(df, t_grid, mean, std):
    idx = np.searchsorted(t_grid, df["t_min"].to_numpy()).clip(0, len(t_grid) - 1)
    x = df[SIGNALS].to_numpy()
    return (x - mean[idx]) / std[idx]


def mspc_scores(z, pca, t2_lim, spe_lim):
    scores = pca.transform(z)
    t2 = np.sum(scores ** 2 / pca.explained_variance_, axis=1)
    spe = np.sum((z - pca.inverse_transform(scores)) ** 2, axis=1)
    return np.maximum(t2 / t2_lim, spe / spe_lim)


def alarm_time(times, score, thr, start=60):
    """First time two consecutive samples exceed thr (after the first hour of start-up)."""
    over = (score > thr) & (times >= start)
    hit = np.where(over[1:] & over[:-1])[0]
    return float(times[hit[0] + 1]) if len(hit) else None


def main():
    df = pd.read_csv(find_data())
    out = out_dir()
    print(f"{df['batch'].nunique()} batches, {len(df)} rows")
    batch_meta = df.groupby("batch").first().reset_index()
    test_ids = split_batches(batch_meta)
    is_test = df["batch"].isin(test_ids)

    # ---------------- yield model, trained on non-fault batches
    train_df = df[~is_test & (df["fault"] == 0)]
    X, M = build_table(train_df, TRAIN_FRACS)
    y = M["y"].to_numpy()
    oof = np.zeros(len(y))
    for tr, te in GroupKFold(5).split(X, y, M["batch"]):
        oof[te] = gbr().fit(X.iloc[tr], y[tr]).predict(X.iloc[te])
    halfwidth = {f: float(np.quantile(np.abs(oof - y)[M["frac"] == f], 0.8)) for f in TRAIN_FRACS}
    model = gbr().fit(X, y)
    train_mean = float(np.mean(batch_meta.loc[~batch_meta["batch"].isin(test_ids) & (batch_meta["fault"] == 0),
                                              "final_protein_kg"]))

    Xt, Mt = build_table(df[is_test], REPORT_FRACS)
    pt = model.predict(Xt)
    yield_rows = []
    for group, mask in [("held-out normal", (Mt["set"] == "normal")), ("held-out wide range", Mt["set"] == "wide"),
                        ("held-out drift", Mt["fault"] == 1)]:
        for f in REPORT_FRACS:
            m = (mask & (Mt["frac"] == f)).to_numpy()
            yt, pm = Mt.loc[m, "y"].to_numpy(), pt[m]
            hw = halfwidth[f]
            yield_rows.append({
                "group": group, "frac": f, "n": int(m.sum()),
                "model_mape": round(mape(yt, pm), 2),
                "model_mae_kg": round(float(np.mean(np.abs(pm - yt))), 3),
                "baseline_mean_mape": round(mape(yt, np.full_like(yt, train_mean)), 2),
                "baseline_so_far_mape": round(mape(yt, Mt.loc[m, "so_far"].to_numpy()), 2),
                "coverage_80": round(float(np.mean(np.abs(pm - yt) <= hw)) * 100, 1),
                "halfwidth_kg": round(hw, 3),
            })
    for r in yield_rows:
        print(r)

    # Drivers: permutation importance on held-out normal + wide batches, per stage, grouped by signal
    drivers = {}
    groups = {s: [s, f"d_{s}"] for s in SIGNALS}
    groups.update({s: [s] for s in SETPOINTS})
    groups["feedstock"] = [f"fs_{f}" for f in FEEDSTOCKS]
    for f in REPORT_FRACS:
        m = ((Mt["fault"] == 0) & (Mt["frac"] == f)).to_numpy()
        pi = permutation_importance(model, Xt[m], Mt.loc[m, "y"], n_repeats=5, random_state=SEED,
                                    scoring="neg_mean_absolute_error")
        imp = pd.Series(pi.importances_mean, index=Xt.columns)
        drivers[str(f)] = {k: round(float(imp[v].sum()), 4) for k, v in groups.items()}

    # ---------------- fault detector, fitted on normal-window training batches only
    # Fit on 75% of the training normals; set the alarm threshold on the other 25% so it is not tuned on fitted data
    normal_all = df[~is_test & (df["set"] == "normal")]
    ids = normal_all["batch"].unique()
    calib_ids = set(np.random.default_rng(SEED + 1).choice(ids, size=len(ids) // 4, replace=False).tolist())
    normal_train = normal_all[~normal_all["batch"].isin(calib_ids)]
    normal_calib = normal_all[normal_all["batch"].isin(calib_ids)]
    t_grid, mean, std = fit_mspc(normal_train)
    z_train = residuals(normal_train, t_grid, mean, std)
    pca = PCA(n_components=0.9, random_state=SEED).fit(z_train)
    sc = pca.transform(z_train)
    t2 = np.sum(sc ** 2 / pca.explained_variance_, axis=1)
    spe = np.sum((z_train - pca.inverse_transform(sc)) ** 2, axis=1)
    t2_lim, spe_lim = float(np.quantile(t2, 0.99)), float(np.quantile(spe, 0.99))

    def batch_scores(frame):
        res = {}
        for b, g in frame.groupby("batch"):
            g = g.sort_values("t_min")
            res[b] = (g["t_min"].to_numpy(), mspc_scores(residuals(g, t_grid, mean, std), pca, t2_lim, spe_lim),
                      int(g["fault"].iloc[0]), int(g["onset_min"].iloc[0]), g["scenario"].iloc[0])
        return res

    # Threshold: value giving about 5% of calibration normal batches any alarm
    train_sc = batch_scores(normal_calib)
    max_run = np.array([np.max(np.minimum(s[1:], s[:-1])[t[1:] >= 60]) for t, s, *_ in train_sc.values()])
    curve = [{"false_alarm_pct": q, "threshold": round(float(np.quantile(max_run, 1 - q / 100)), 4)}
             for q in [1, 2, 5, 10, 20, 30, 50]]
    thr = next(c["threshold"] for c in curve if c["false_alarm_pct"] == 5)

    test_sc = batch_scores(df[is_test & ((df["set"] == "normal") | (df["fault"] == 1))])
    normal_alarms = [alarm_time(t, s, thr) is not None for t, s, fl, *_ in test_sc.values() if fl == 0]
    fault_rows = []
    for t, s, fl, onset, scen in test_sc.values():
        if fl:
            at = alarm_time(t, s, thr)
            fault_rows.append({"scenario": scen, "detected": at is not None and at >= onset,
                               "early_false_alarm": at is not None and at < onset,
                               "delay_min": (at - onset) if at is not None and at >= onset else None})
    fr = pd.DataFrame(fault_rows)
    fault_report = {
        "threshold": thr,
        "held_out_normal_batches": len(normal_alarms),
        "false_alarm_batches_pct": round(100 * float(np.mean(normal_alarms)), 1),
        "by_scenario": {
            sc_name: {
                "n": int(len(g)),
                "detection_pct": round(100 * float(g["detected"].mean()), 1),
                "median_delay_min": None if g["delay_min"].dropna().empty else float(g["delay_min"].median()),
                "alarm_before_onset_pct": round(100 * float(g["early_false_alarm"].mean()), 1),
            }
            for sc_name, g in fr.groupby("scenario")
        },
        "sensitivity_curve": curve,
    }
    print(json.dumps(fault_report, indent=1))

    model_json = {
        "version": 1,
        "yield": {**export_trees(model, feature_names()), "halfwidthByFrac": halfwidth, "lagRows": LAG_ROWS,
                  "logEveryMin": 10},
        "fault": {
            "signals": SIGNALS, "tGrid": t_grid.tolist(),
            "mean": np.round(mean, 5).tolist(), "std": np.round(std, 5).tolist(),
            "components": np.round(pca.components_, 6).tolist(), "pcaMean": np.round(pca.mean_, 6).tolist(),
            "variance": np.round(pca.explained_variance_, 6).tolist(),
            "t2Limit": t2_lim, "speLimit": spe_lim, "threshold": thr, "curve": curve, "startMin": 60,
        },
        "drivers": drivers,
    }
    report = {"yield": yield_rows, "fault": fault_report, "drivers": drivers, "train_mean_kg": train_mean,
              "n_batches": int(df["batch"].nunique()), "n_test_batches": len(test_ids)}
    (out / "model_a.json").write_text(json.dumps(model_json, separators=(",", ":")))
    (out / "model_a_report.json").write_text(json.dumps(report, indent=2))
    print("wrote", out / "model_a.json", round((out / "model_a.json").stat().st_size / 1e6, 2), "MB")


if __name__ == "__main__":
    main()
