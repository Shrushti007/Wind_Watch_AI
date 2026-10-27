# 🌬️ WindWatch AI – Wind Turbine Status Prediction

An end-to-end machine-learning project: **raw SCADA data → cleaning → EDA → model comparison → joblib model → Flask web app → AWS deployment.**

The web app predicts a turbine's operating status (`Normal Operation`, `Service / Maintenance`, `Other / Downtime`) from sensor readings. You can enter **one sensor at a time**, paste a **complete row**, or **upload an entire dataset**.

## Folder structure

```
wind-turbine-status-ai/
├── application.py              # Flask backend (API + page)  ← entry point
├── templates/index.html        # Web page (HTML)
├── static/css/style.css        # Styling
├── static/js/app.js            # Front-end logic
├── model/
│   └── wind_turbine_model.joblib   # Trained pipeline + metadata
├── notebook/
│   └── wind_turbine_status_prediction.ipynb   # Full ML workflow (with outputs)
├── docs/
│   ├── Project_Synopsis.docx   # Synopsis for your report / viva
│   └── DEPLOYMENT_AWS.md       # Step-by-step AWS deployment
├── sample_data/sample_upload.csv   # 300-row file to test the upload feature
├── data/                       # put windwatchaidataset.xlsx here (not bundled, ~80 MB)
├── requirements.txt            # pinned dependencies
├── Procfile                    # start command for Elastic Beanstalk
├── Dockerfile                  # container build for App Runner / ECS
└── .platform/ .ebignore ...    # AWS config
```

## Run locally

```bash
python -m venv .venv
source .venv/bin/activate            # Windows: .venv\Scripts\activate
pip install -r requirements.txt
python application.py                # → http://127.0.0.1:5000
```

## Re-train the model (optional)

1. Copy `windwatchaidataset.xlsx` into `data/`.
2. Open `notebook/wind_turbine_status_prediction.ipynb` and **Run All** (≈ 3 minutes).
3. The last cells regenerate `model/wind_turbine_model.joblib` and `sample_data/sample_upload.csv`.

## Results (hold-out set)

| Model | Accuracy | Macro recall | Macro-F1 |
|---|---|---|---|
| **Logistic Regression (deployed)** | 0.862 | 0.818 | **0.654** |
| Decision Tree | 0.960 | 0.664 | 0.640 |
| Random Forest | 0.963 | 0.661 | 0.635 |
| Hist Gradient Boosting | 0.959 | 0.659 | 0.629 |

**Why Logistic Regression?** About 78% of rows are "normal", so accuracy is misleading. Macro-F1 weights all statuses equally. Logistic Regression has the best macro-F1 and by far the best recall on the rare states, and it does not overfit (train ≈ test), while the tree models memorise the training period. Honest caveat: the margin is small, and the tree models have higher plain accuracy; status 3 (service) remains hard for every model.

## API

| Method | URL | Purpose |
|---|---|---|
| GET | `/health` | Health check for AWS |
| GET | `/api/schema` | Features, defaults, ranges, metrics, sample rows |
| POST | `/api/predict` | `{"values": {"wind_speed_3_avg": 8.4, ...}}` → status, probabilities, top factors |
| POST | `/api/predict_file` | multipart `file` (.csv / .xlsx) → per-row predictions + summary |

```bash
curl -X POST localhost:5000/api/predict -H "Content-Type: application/json" \
     -d '{"values": {"wind_speed_3_avg": 8.4, "power_29_avg": 0.6, "asset_id": 21}}'
```

## How uploads are handled
The app applies the same cleaning as the notebook (drops empty/repeated-header rows, converts types, derives `hour` and `month` from `time_stamp`), aligns the columns to the 61 model features and fills any missing column with its training median. If your file has a `status_type_id` column, accuracy and macro-F1 are reported too.

## Notes & assumptions
* Sensor names in the dataset are anonymised. Status codes are labelled using the common SCADA convention (0 normal, 3 service, 5 other/downtime) — **confirm against your data dictionary** and edit `STATUS_LABELS` in the notebook if needed.
* The `prediction` rows supplied in the dataset were used as the hold-out test set.

## Tech stack
Python · pandas · NumPy · scikit-learn · Matplotlib / Seaborn · joblib · Flask · Gunicorn · HTML / CSS / JavaScript · AWS (Elastic Beanstalk / EC2 / App Runner) · Docker

## Resume bullets (examples)
* Built an end-to-end ML system predicting wind-turbine operating status from 160K+ SCADA readings (81 sensors); handled corrupted data, class imbalance (78/20/2%) and compared 4 models using macro-F1.
* Deployed a Flask + Gunicorn web app on AWS with single-input, row-paste and bulk-CSV prediction, probability outputs and per-prediction explanations.
