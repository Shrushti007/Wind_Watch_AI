# Deploying WindWatch AI on AWS

A trained model is just a file. **Deployment** means wrapping that file in a web service that runs 24/7 on a server people can reach.

```
Browser ──► AWS (load balancer / nginx) ──► Gunicorn ──► Flask (application.py) ──► joblib pipeline
```

| Piece | Role |
|---|---|
| `model/wind_turbine_model.joblib` | The trained pipeline (impute → scale → classify) + metadata |
| `application.py` | Flask app: serves the page and the `/api/*` endpoints |
| Gunicorn | Production-grade Python web server (Flask's own server is for development only) |
| `Procfile` / `Dockerfile` | Tell AWS how to start the app |
| `/health` | URL AWS pings to check the app is alive |

Pick **one** of the three options below. **Option A is the easiest for a first deployment.**

> ⚠️ Cost safety: always **terminate / delete** resources when you finish demoing (`eb terminate`, stop the EC2 instance, delete the App Runner service). Set an AWS Budget alert (Billing → Budgets) before you start.

---

## Before you start (any option)

1. Create an AWS account and an **IAM user** with programmatic access (don't use the root account).
2. Install the AWS CLI and run `aws configure` (access key, secret, region e.g. `ap-south-1` Mumbai).
3. Test locally first:
   ```bash
   python -m venv .venv && source .venv/bin/activate      # Windows: .venv\Scripts\activate
   pip install -r requirements.txt
   python application.py                                  # open http://127.0.0.1:5000
   ```

---

## Option A – AWS Elastic Beanstalk (recommended: least work)

Elastic Beanstalk creates the server, load balancer and monitoring for you from your code folder.

```bash
pip install awsebcli
cd wind-turbine-status-ai            # the project root (contains application.py and Procfile)

eb init                              # choose region, create application "windwatch-ai",
                                     # platform: Python (latest 3.12 offered), no CodeCommit
eb create windwatch-env --single     # --single = one cheap instance, no load balancer
eb status                            # wait until Health is Green
eb open                              # opens your public URL
```

Update after code changes: `eb deploy`  ·  See logs: `eb logs`  ·  Delete everything: `eb terminate windwatch-env`

Notes
* `Procfile` tells Beanstalk to run Gunicorn on port 8000.
* `.platform/nginx/conf.d/upload.conf` raises the upload limit from 1 MB to 50 MB (needed for dataset uploads).
* `.ebignore` keeps the big `data/` and `notebook/` folders out of the upload bundle.

---

## Option B – EC2 virtual machine (most control, best for learning Linux)

1. **Launch** an EC2 instance: Ubuntu 24.04, `t3.micro` (or free-tier eligible type), create a key pair.
   Security group inbound rules: **SSH (22)** from *My IP*, **HTTP (80)** from anywhere.
2. **Copy the project** and connect:
   ```bash
   scp -i key.pem -r wind-turbine-status-ai ubuntu@<EC2-PUBLIC-IP>:~/app
   ssh -i key.pem ubuntu@<EC2-PUBLIC-IP>
   ```
3. **Install and test:**
   ```bash
   sudo apt update && sudo apt install -y python3-venv nginx
   cd ~/app && python3 -m venv .venv && source .venv/bin/activate
   pip install -r requirements.txt
   gunicorn application:application --bind 127.0.0.1:8000     # Ctrl+C after it starts OK
   ```
4. **Keep it running with systemd** – create `/etc/systemd/system/windwatch.service`:
   ```ini
   [Unit]
   Description=WindWatch AI
   After=network.target

   [Service]
   User=ubuntu
   WorkingDirectory=/home/ubuntu/app
   ExecStart=/home/ubuntu/app/.venv/bin/gunicorn application:application --bind 127.0.0.1:8000 --workers 2 --timeout 120
   Restart=always

   [Install]
   WantedBy=multi-user.target
   ```
   ```bash
   sudo systemctl daemon-reload && sudo systemctl enable --now windwatch
   ```
5. **nginx reverse proxy** – create `/etc/nginx/sites-available/windwatch`:
   ```nginx
   server {
       listen 80;
       client_max_body_size 50M;
       location / {
           proxy_pass http://127.0.0.1:8000;
           proxy_set_header Host $host;
           proxy_set_header X-Real-IP $remote_addr;
           proxy_read_timeout 120s;
       }
   }
   ```
   ```bash
   sudo ln -s /etc/nginx/sites-available/windwatch /etc/nginx/sites-enabled/
   sudo rm /etc/nginx/sites-enabled/default
   sudo nginx -t && sudo systemctl restart nginx
   ```
6. Visit `http://<EC2-PUBLIC-IP>`. For HTTPS and a custom domain, add Route 53 + a free certificate (Let's Encrypt / `certbot`).

---

## Option C – Docker + AWS App Runner (modern, container-based)

```bash
# 1) build and test the container locally
docker build -t windwatch-ai .
docker run -p 8080:8080 windwatch-ai            # http://localhost:8080

# 2) push to Amazon ECR (replace ACCOUNT_ID and REGION)
aws ecr create-repository --repository-name windwatch-ai --region REGION
aws ecr get-login-password --region REGION | docker login --username AWS --password-stdin ACCOUNT_ID.dkr.ecr.REGION.amazonaws.com
docker tag windwatch-ai:latest ACCOUNT_ID.dkr.ecr.REGION.amazonaws.com/windwatch-ai:latest
docker push ACCOUNT_ID.dkr.ecr.REGION.amazonaws.com/windwatch-ai:latest
```
3) In the AWS Console → **App Runner → Create service** → source *Container registry (Amazon ECR)* → pick the image →
   **Port 8080** → health check path **/health** → create. App Runner gives you an HTTPS URL automatically.

---

## After deployment – checklist

- [ ] `https://<your-url>/health` returns `{"status":"ok", ...}`
- [ ] Single prediction works; "Load sample row" works
- [ ] Upload `sample_data/sample_upload.csv` and see the results table
- [ ] Put the live URL + GitHub link on your resume / LinkedIn
- [ ] Terminate resources after the demo to avoid charges

## Troubleshooting

| Symptom | Fix |
|---|---|
| `413 Request Entity Too Large` on upload | nginx limit – make sure `upload.conf` (Option A) or `client_max_body_size` (Option B) is in place |
| `ModuleNotFoundError` | Dependencies not installed – check `requirements.txt` and run `pip install -r requirements.txt` |
| Model fails to load / version warning | Use the same scikit-learn version the model was trained with (pinned in `requirements.txt`) or re-run the notebook to regenerate the `.joblib` |
| Beanstalk health is Red | `eb logs` – usually a typo in `Procfile` or a missing package |
| Gateway timeout on large uploads | Upload a CSV (much faster than .xlsx) or a smaller sample |
