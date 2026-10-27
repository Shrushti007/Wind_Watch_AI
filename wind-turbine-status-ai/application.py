"""
WindWatch AI – Flask web app that serves the trained wind-turbine status model.

Run locally :  python application.py          -> http://127.0.0.1:5000
Production  :  gunicorn application:application  (see Procfile / Dockerfile)

The variable is called `application` because AWS Elastic Beanstalk looks for that name by default.
"""
import io
import os

import joblib
import numpy as np
import pandas as pd
from flask import Flask, jsonify, render_template, request, send_from_directory
from sklearn.metrics import f1_score

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
MODEL_PATH = os.path.join(BASE_DIR, "model", "wind_turbine_model.joblib")
MAX_ROWS = 50_000                      # rows scored per upload (keeps the demo fast)

application = Flask(__name__)
application.config["MAX_CONTENT_LENGTH"] = 40 * 1024 * 1024    # 40 MB upload limit
app = application

# --------------------------------------------------------------------------- model
BUNDLE = joblib.load(MODEL_PATH)
PIPE = BUNDLE["pipeline"]
FEATURES = BUNDLE["features"]
DEFAULTS = BUNDLE["defaults"]
CODES = BUNDLE["class_codes"]                                   # model output index -> status code
LABELS = {int(k): v for k, v in BUNDLE["status_labels"].items()}
IMPORTANCE = BUNDLE["feature_importance"]


def clean_frame(raw: pd.DataFrame):
    """Same cleaning rules as the notebook, then align to the model's feature list."""
    df = raw.dropna(how="all").copy()
    if "time_stamp" in df.columns:                               # repeated header rows
        df = df[df["time_stamp"].astype(str) != "time_stamp"]
    if "time_stamp" in df.columns:
        ts = pd.to_datetime(df["time_stamp"], errors="coerce")
        if "hour" not in df.columns:
            df["hour"] = ts.dt.hour
        if "month" not in df.columns:
            df["month"] = ts.dt.month
    present = [c for c in FEATURES if c in df.columns]
    missing = [c for c in FEATURES if c not in df.columns]
    X = pd.DataFrame(index=df.index)
    for c in FEATURES:
        X[c] = pd.to_numeric(df[c], errors="coerce") if c in present else DEFAULTS[c]
    return df, X, missing


def run_model(X: pd.DataFrame):
    proba = PIPE.predict_proba(X[FEATURES])
    idx = proba.argmax(axis=1)
    return idx, proba


def explain_row(X: pd.DataFrame, pred_idx: int, top=6):
    """Per-feature contribution for the predicted class (works for the linear model)."""
    try:
        z = PIPE.named_steps["scale"].transform(PIPE.named_steps["imp"].transform(X[FEATURES]))[0]
        contrib = z * PIPE.named_steps["clf"].coef_[pred_idx]
        order = np.argsort(-np.abs(contrib))[:top]
        return [{"feature": FEATURES[i], "value": float(X[FEATURES].iloc[0, i]),
                 "impact": float(contrib[i])} for i in order]
    except Exception:
        return []


def pack_probs(p):
    return {str(CODES[i]): round(float(p[i]), 4) for i in range(len(CODES))}


# --------------------------------------------------------------------------- routes
@application.route("/")
def index():
    return render_template("index.html")


@application.route("/health")
def health():
    return jsonify(status="ok", model=BUNDLE["model_name"])


@application.route("/sample")
def sample_file():
    return send_from_directory(os.path.join(BASE_DIR, "sample_data"), "sample_upload.csv",
                               as_attachment=True)


@application.route("/api/schema")
def schema():
    ranked = sorted(FEATURES, key=lambda f: -IMPORTANCE.get(f, 0))
    return jsonify(
        model_name=BUNDLE["model_name"],
        features=[{"name": f, "default": DEFAULTS[f], "min": BUNDLE["ranges"][f][0],
                   "max": BUNDLE["ranges"][f][1], "importance": IMPORTANCE.get(f, 0)} for f in ranked],
        labels={str(k): v for k, v in LABELS.items()},
        codes=CODES,
        metrics=BUNDLE["metrics"],
        samples=BUNDLE["samples"],
        train_rows=BUNDLE["train_rows"], test_rows=BUNDLE["test_rows"],
    )


@application.route("/api/predict", methods=["POST"])
def predict_one():
    payload = request.get_json(silent=True) or {}
    values = payload.get("values", payload)
    if not isinstance(values, dict) or not values:
        return jsonify(error="Send a JSON object of feature values."), 400
    row = pd.DataFrame([values])
    _, X, missing = clean_frame(row)
    known = [k for k in values if k in FEATURES or k in ("time_stamp",)]
    if not known:
        return jsonify(error="None of the supplied fields match the model's features."), 400
    idx, proba = run_model(X)
    i = int(idx[0])
    code = CODES[i]
    return jsonify(
        code=code, label=LABELS[code], confidence=round(float(proba[0, i]), 4),
        probabilities=pack_probs(proba[0]),
        factors=explain_row(X, i),
        filled_defaults=len(missing), total_features=len(FEATURES),
    )


@application.route("/api/predict_file", methods=["POST"])
def predict_file():
    f = request.files.get("file")
    if f is None or not f.filename:
        return jsonify(error="No file uploaded."), 400
    name = f.filename.lower()
    try:
        if name.endswith(".csv"):
            raw = pd.read_csv(f, nrows=MAX_ROWS + 5)
        elif name.endswith((".xlsx", ".xls")):
            raw = pd.read_excel(f, nrows=MAX_ROWS + 5)
        else:
            return jsonify(error="Please upload a .csv or .xlsx file."), 400
    except Exception as exc:
        return jsonify(error=f"Could not read the file: {exc}"), 400

    df, X, missing = clean_frame(raw)
    if len(df) == 0:
        return jsonify(error="The file has no usable rows."), 400
    if len(missing) == len(FEATURES):
        return jsonify(error="No sensor columns from the model were found. "
                             "Check that the column names match the dataset."), 400
    truncated = len(df) > MAX_ROWS
    df, X = df.iloc[:MAX_ROWS], X.iloc[:MAX_ROWS]

    idx, proba = run_model(X)
    codes = np.array(CODES)[idx]
    out = pd.DataFrame({"row": np.arange(1, len(df) + 1), "predicted": codes,
                        "label": [LABELS[c] for c in codes],
                        "confidence": proba.max(axis=1).round(4)})
    for i, c in enumerate(CODES):
        out[f"p_{c}"] = proba[:, i].round(4)
    for extra in ("time_stamp", "asset_id"):
        if extra in df.columns:
            out.insert(1, extra, df[extra].astype(str).values)

    summary = {"rows": int(len(out)), "truncated": truncated, "missing_columns": len(missing),
               "total_features": len(FEATURES),
               "counts": {str(c): int((codes == c).sum()) for c in CODES}}
    if "status_type_id" in df.columns:
        actual = pd.to_numeric(df["status_type_id"], errors="coerce").values
        ok = ~np.isnan(actual)
        if ok.sum():
            out["actual"] = [None if np.isnan(a) else int(a) for a in actual]
            summary["accuracy"] = round(float((actual[ok] == codes[ok]).mean()), 4)
            summary["macro_f1"] = round(float(f1_score(actual[ok].astype(int), codes[ok], average="macro")), 4)
            summary["actual_counts"] = {str(c): int((actual[ok] == c).sum()) for c in CODES}
    return jsonify(summary=summary, rows=out.where(out.notna(), None).to_dict("records"))


@application.errorhandler(413)
def too_large(_):
    return jsonify(error="File too large (limit 40 MB). Upload a CSV or a smaller sample."), 413


if __name__ == "__main__":
    application.run(host="0.0.0.0", port=int(os.environ.get("PORT", 5000)), debug=False)
