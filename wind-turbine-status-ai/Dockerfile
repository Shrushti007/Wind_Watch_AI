FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY application.py .
COPY model ./model
COPY templates ./templates
COPY static ./static
COPY sample_data ./sample_data
EXPOSE 8080
CMD ["gunicorn", "application:application", "--bind", "0.0.0.0:8080", "--workers", "2", "--timeout", "120"]
